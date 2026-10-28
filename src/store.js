// 인메모리 저장소 (MVP). 운영 교체 대상: Postgres + RLS.
// 모든 행에 owner_id. 조회는 항상 owner scope 강제.
import { randomUUID } from 'node:crypto';

export function createStore() {
  const profiles = new Map();       // id -> {id, owner_id, ...}
  const profileVersions = new Map();// id -> version row
  const sessions = new Map();       // id -> session
  const turns = new Map();          // id -> turn
  const revisions = new Map();      // turnId -> [revision rows]
  const events = new Map();         // sessionId -> [events]
  const commands = new Map();       // `${sessionId}:${commandId}` -> response
  const evaluations = new Map();    // sessionId -> evaluation
  const appeals = new Map();        // id -> appeal
  const attempts = new Map();       // id -> practice attempt
  const deletions = new Map();      // id -> deletion job
  const profileCalls = new Map();   // owner -> [timestamps] (프로필 추출 속도 제한)
  const instSources = new Map();    // profile_id -> [source rows] (기관 자료 출처)
  const institutions = new Map();   // profile_id -> { profile object, approved, approved_at }

  const now = () => new Date().toISOString();
  function pushEvent(sessionId, type, payload = {}, opts = {}) {
    const list = events.get(sessionId) || [];
    const durable = opts.durable !== false;
    const seq = durable ? list.filter((e) => e.durable).length + 1 : null;
    const ev = { v: 1, session_id: sessionId, seq, type, durable, server_time: now(), ...opts.fields, payload };
    if (durable) { list.push(ev); events.set(sessionId, list); }
    return ev;
  }

  return {
    // profiles
    createProfile(owner, data) {
      const id = randomUUID();
      const doc = {
        id, owner_id: owner, org_type: data.org_type, target_name: String(data.target_name || '').slice(0, 100),
        role: String(data.role || '').slice(0, 100),
        source_text: String(data.source_text || '').slice(0, 20000),
        source_url: data.source_url || null, experiences: (data.experiences || []).slice(0, 3).map((e) => String(e).slice(0, 2000)),
        status: 'extracting', created_at: now(), expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      };
      profiles.set(id, doc);
      const version_id = randomUUID();
      doc.version_id = version_id;
      profiles.set(id, doc);
      profileVersions.set(version_id, { id: version_id, profile_id: id, version: 1, status: 'draft', extracted: null, created_at: now() });
      return { profile: doc, version_id };
    },
    getProfile(owner, id) {
      const p = profiles.get(id);
      if (!p || p.owner_id !== owner) return null;
      return p;
    },
    setExtracted(version_id, extracted) {
      const v = profileVersions.get(version_id);
      if (!v) return null;
      v.extracted = extracted; v.status = 'review';
      return v;
    },
    approveVersion(owner, profile_id, version_id) {
      const p = profiles.get(profile_id);
      if (!p || p.owner_id !== owner) return null;
      const v = profileVersions.get(version_id);
      if (!v || v.profile_id !== profile_id) return null;
      v.status = 'approved'; v.approved_at = now();
      p.status = 'approved'; p.approved_version_id = version_id;
      return v;
    },
    getVersion(id) { return profileVersions.get(id) || null; },
    // 기관 출처: 사용자 제공 URL·공식자료 메타 + 검수 상태. 외부 fetch 없음.
    addSource(profile_id, row) {
      const list = instSources.get(profile_id) || [];
      list.push(row);
      instSources.set(profile_id, list.slice(-30));
      return row;
    },
    listSources(profile_id) { return (instSources.get(profile_id) || []).slice(); },
    // 기관 프로필(분석 결과 버전): 승인 전 review, 승인 후 approved(불변 스냅샷)
    setInstitution(profile_id, profile, status = 'review') {
      const row = { profile_id, status, profile, created_at: now(), approved_at: status === 'approved' ? now() : null };
      institutions.set(profile_id, row);
      return row;
    },
    getInstitution(profile_id) { return institutions.get(profile_id) || null; },

    // sessions
    createSession(owner, data) {
      const id = randomUUID();
      const s = {
        id, owner_id: owner, profile_version_id: data.profile_version_id || null,
        mode: data.mode || 'general', interview_type: data.interview_type || data.mode || 'general',
        task_type: data.task_type || 'behavioral',
        participant_layout: data.participant_layout || 'one_to_one', blind: !!data.blind, persona: data.persona || 'standard',
        interviewer_role: data.interviewer_role || 'practitioner',
        question_basis: data.question_basis || 'general-template-v1',
        free_test: data.synthetic === true, // 무료 테스트 세션: 합성 데이터 표시, Gemini 무료 경로 허용
        panel_roles: data.panel_roles || null,
        topic_id: data.topic_id || null, topic_title: data.topic_title || null, topic_brief: data.topic_brief || null,
        discussion: data.discussion || null,
        pt_task_id: data.pt_task_id || null, pt_task_title: data.pt_task_title || null, pt_brief: data.pt_brief || null,
        pt_phase: data.pt_phase || null, pt_prepare_seconds: data.pt_prepare_seconds || null,
        pt_present_seconds: data.pt_present_seconds || null, pt_qa: data.pt_qa || null, pt_qa_index: data.pt_qa_index || 0,
        scenario_id: data.scenario_id || null, scenario_title: data.scenario_title || null,
        scenario_followups: data.scenario_followups || null, scenario_index: data.scenario_index || 0,
        highschool_mock: !!data.highschool_mock,
        duration_minutes: Number.isFinite(data.duration_minutes) && data.duration_minutes > 0 ? data.duration_minutes : 15,
        duration_seconds: Number.isFinite(data.duration_seconds) && data.duration_seconds > 0 ? data.duration_seconds : (Number.isFinite(data.duration_minutes) && data.duration_minutes > 0 ? data.duration_minutes * 60 : 900),
        input_mode: ['voice', 'groq'].includes(data.input_mode) ? data.input_mode : 'text',
        state: 'ready', version: 1, active_elapsed_ms: 0, seed: (Math.random() * 2 ** 31) >>> 0,
        questions: data.questions || [], q_index: 0, followups_used: 0, llm_calls: 0,
        policy_snapshot: data.policy_snapshot || {}, created_at: now(),
        expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
        degraded_reason: null,
      };
      sessions.set(id, s);
      events.set(id, []);
      pushEvent(id, 'session.snapshot', { state: 'ready' });
      return s;
    },
    getSession(owner, id) {
      const s = sessions.get(id);
      if (!s || s.owner_id !== owner) return null;
      return s;
    },
    listSessions(owner) {
      return [...sessions.values()].filter((s) => s.owner_id === owner).slice(-20).reverse();
    },
    updateSession(s, patch) { Object.assign(s, patch); s.version += 1; return s; },

    // turns & transcripts
    createTurn(sessionId, data) {
      const id = randomUUID();
      const ordinal = [...turns.values()].filter((t) => t.session_id === sessionId).length + 1;
      const t = { id, session_id: sessionId, ordinal, speaker_id: data.speaker_id || 'user', question_id: data.question_id || null, competency: data.competency || null, followup: !!data.followup, elicited_dims: Array.isArray(data.elicited_dims) ? data.elicited_dims : null, status: 'queued', epoch: 1, spoken_ms: 0, created_at: now() };
      turns.set(id, t);
      return t;
    },
    getTurn(id) { return turns.get(id) || null; },
    sessionTurns(sessionId) { return [...turns.values()].filter((t) => t.session_id === sessionId).sort((a, b) => a.ordinal - b.ordinal); },
    addRevision(turnId, text, origin = 'user', quality_flags = []) {
      const list = revisions.get(turnId) || [];
      const rev = { turn_id: turnId, revision: list.length + 1, normalized_text: text.normalize('NFC'), origin, quality_flags, created_at: now() };
      list.push(rev); revisions.set(turnId, list);
      return rev;
    },
    getRevisions(turnId) { return revisions.get(turnId) || []; },
    recordProfileCall(owner) {
      const t = Date.now();
      const list = (profileCalls.get(owner) || []).concat([t]).slice(-40);
      profileCalls.set(owner, list);
      return {
        minute: list.filter((x) => t - x < 60_000).length,
        day: list.filter((x) => t - x < 86_400_000).length,
      };
    },
    deleteAccount(owner) {
      const deletionId = randomUUID();
      const requested_at = now();
      for (const [sid, s] of sessions) {
        if (s.owner_id !== owner) continue;
        s.state = 'deleted';
        s.questions = [];
        for (const t of [...turns.values()].filter((t) => t.session_id === sid)) {
          t.question_id = null;
          const revs = revisions.get(t.id) || [];
          for (const r of revs) r.normalized_text = '[삭제됨]';
        }
        const evs = events.get(sid) || [];
        for (const e of evs) { e.payload = {}; delete e.epoch; }
        evaluations.delete(sid);
      }
      for (const [, p] of profiles) {
        if (p.owner_id !== owner) continue;
        p.source_text = '[삭제됨]';
        p.experiences = [];
        p.target_name = '';
        p.status = 'deleted';
        instSources.delete(p.id);
        institutions.delete(p.id);
        const vid = p.approved_version_id || p.version_id;
        const v = profileVersions.get(vid);
        if (v) { v.extracted = null; v.status = 'deleted'; }
      }
      for (const [aid, a] of appeals) if (a.owner_id === owner) appeals.delete(aid);
      for (const [pid2, a2] of attempts) if (a2.owner_id === owner) attempts.delete(pid2);
      const job = {
        id: deletionId, kind: 'account', owner_id: owner, state: 'completed',
        requested_at, completed_at: now(),
        access_revoked: true, primary_purged: true,
        backup_expiry: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      };
      deletions.set(deletionId, job);
      return job;
    },

    events, pushEvent, commands, evaluations, appeals, attempts, deletions,
  };
}
