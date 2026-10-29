// 인메모리 저장소 (MVP). 운영 교체 대상: Postgres + RLS.
// 모든 행에 owner_id. 조회는 항상 owner scope 강제.
import { isSyntheticText } from '../domain/fixtures.js';
const randomUUID = () => globalThis.crypto.randomUUID();

export function createStore({ ttlDays = 30 } = {}) {
  const ttlMs = ttlDays * 864e5;
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
  const consents = new Map();       // owner -> 최신 동의 행(감사 기록, WP-C6)
  const profileCalls = new Map();   // owner -> [timestamps] (프로필 추출 속도 제한)
  const instSources = new Map();    // profile_id -> [source rows] (기관 자료 출처)
  const institutions = new Map();   // profile_id -> { profile object, approved, approved_at }
  const documents = new Map();      // id -> SourceDocument (원본 바이너리 비저장)
  const docRevisions = new Map();   // documentId -> [DocumentRevision]
  // WP-A1: 예전에 server.js 전역이던 상태 — 모두 Store 뒤로 이동
  const tickets = new Map();        // ticket -> { session_id, owner, expires_at } (30초 일회성)
  const exports_ = new Map();       // job_id -> { owner_id, session_id, expires_at, payload } (10분)
  const transferJobs = new Map();   // transfer_id -> { owner_id, baseline_session_id, retry_session_id, ... }
  const idempotency = new Map();    // `${owner}:${key}` -> { owner, fp, status, text, expires_at } (24시간)
  const ledgerState = { monthlySpent: 0, monthlyReserved: 0, sessions: new Map() };

  const now = () => new Date().toISOString();
  function pushEvent(sessionId, type, payload = {}, opts = {}) {
    const list = events.get(sessionId) || [];
    const durable = opts.durable !== false;
    const seq = durable ? list.filter((e) => e.durable).length + 1 : null;
    const ev = { v: 1, session_id: sessionId, seq, type, durable, server_time: now(), ...opts.fields, payload };
    if (durable) { list.push(ev); events.set(sessionId, list); }
    return ev;
  }

  // 사용자별 속도 제한 기록(WP-B1): bucket별 최근 호출 시각. 분/일 창 안의 횟수를 돌려준다.
  function recordRate(owner, bucket = 'profile') {
    const t = Date.now();
    const k = `${bucket}:${owner}`;
    const list = (profileCalls.get(k) || []).filter((x) => t - x < 86_400_000).concat([t]).slice(-2100);
    profileCalls.set(k, list);
    return { minute: list.filter((x) => t - x < 60_000).length, day: list.length };
  }
  return {
    // profiles
    createProfile(owner, data) {
      const id = randomUUID();
      const doc = {
        id, owner_id: owner, org_type: data.org_type, target_name: String(data.target_name || '').slice(0, 100),
        role: String(data.role || '').slice(0, 100),
        source_text: String(data.source_text || '').slice(0, 20000),
        application_text: String(data.application_text || '').slice(0, 20000), // 마스킹본만 전달됨
        source_url: data.source_url || null, experiences: (data.experiences || []).slice(0, 3).map((e) => String(e).slice(0, 2000)),
        synthetic: data.synthetic === true, fixture_id: data.synthetic === true ? data.fixture_id : null, // 서버 판정값(본문 플래그 아님)
        status: 'extracting', created_at: now(), expires_at: new Date(Date.now() + ttlMs).toISOString(),
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

    // documents (WP-C1)
    createDocument(owner, data) {
      const doc = { id: randomUUID(), owner_id: owner, profile_id: data.profile_id, kind: data.kind, filename: data.filename, sha256: data.sha256, extract_status: data.extract_status, failure_code: data.failure_code || null, created_at: now() };
      documents.set(doc.id, doc);
      docRevisions.set(doc.id, []);
      return doc;
    },
    getDocument(owner, id) { const d = documents.get(id); return d && d.owner_id === owner ? d : null; },
    listDocuments(owner, profile_id) { return [...documents.values()].filter((d) => d.owner_id === owner && d.profile_id === profile_id); },
    addDocumentRevision(owner, id, { text_masked, origin }) {
      const d = documents.get(id);
      if (!d || d.owner_id !== owner) return null;
      const list = docRevisions.get(id);
      const rev = { document_id: id, revision: list.length + 1, origin, text_masked, char_count: [...text_masked].length, created_at: now() };
      list.push(rev);
      return rev;
    },
    getDocumentRevisions(owner, id) { const d = documents.get(id); return d && d.owner_id === owner ? (docRevisions.get(id) || []).slice() : null; },

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
        free_test: data.free_test === true, // 서버가 정한 합성 전용 인스턴스 표시(요청 본문 값 아님)
        server_synthetic: data.server_synthetic === true, // 서버 판정 합성 세션(WP-C6 fixture 해시). 클라이언트 값은 복사하지 않는다
        provider_trace: [], // 공급자 호출 결과 라벨(WP-B1). 본문·키 없음
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
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
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
      const rev = { turn_id: turnId, revision: list.length + 1, normalized_text: text.normalize('NFC'), origin, quality_flags, synthetic: origin === 'user' && isSyntheticText(text), created_at: now() };
      list.push(rev); revisions.set(turnId, list);
      return rev;
    },
    getRevisions(turnId) { return revisions.get(turnId) || []; },
    addConsent(owner, data) {
      const c = { id: randomUUID(), owner_id: owner, age_19_confirmed: data.age_19_confirmed === true, notice_version: data.notice_version, provider_modes_seen: {}, created_at: now() };
      consents.set(owner, c);
      return c;
    },
    getConsent(owner) { return consents.get(owner) || null; },
    recordRate,
    recordProfileCall(owner) { return recordRate(owner, 'profile'); },
    deleteAccount(owner) {
      consents.delete(owner);
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
        p.application_text = '[삭제됨]';
        p.experiences = [];
        p.target_name = '';
        p.status = 'deleted';
        instSources.delete(p.id);
        institutions.delete(p.id);
        const vid = p.approved_version_id || p.version_id;
        const v = profileVersions.get(vid);
        if (v) { v.extracted = null; v.status = 'deleted'; }
      }
      for (const [did, dd] of documents) if (dd.owner_id === owner) { documents.delete(did); docRevisions.delete(did); }
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

    // 일회성 접속 티켓
    putTicket(ticket, rec) {
      tickets.set(ticket, rec);
      if (tickets.size > 500) for (const [k, v] of tickets) { if (v.expires_at < Date.now()) tickets.delete(k); }
    },
    takeTicket(ticket) {
      const t = tickets.get(ticket);
      if (!t) return null;
      tickets.delete(ticket);
      return t.expires_at < Date.now() ? null : t;
    },
    // 내보내기 작업
    putExport(id, rec) {
      exports_.set(id, rec);
      if (exports_.size > 200) for (const [k, v] of exports_) { if (v.expires_at < Date.now()) exports_.delete(k); }
    },
    getExport(id) { return exports_.get(id) || null; },
    deleteExport(id) { exports_.delete(id); },
    // 전이 비교 작업
    putTransferJob(id, job) { transferJobs.set(id, job); },
    getTransferJob(id) { return transferJobs.get(id) || null; },
    // 삭제 시 서버가 쥔 사용자 발언 사본 파기. sessionId가 없으면 소유자 전체.
    // 멱등 응답(전이 비교 발췌 등 사용자 발언 포함 가능)은 소유자 단위로 모두 파기한다.
    purgeOwned(owner, sessionId = null) {
      for (const [id, j] of transferJobs) {
        if (j.owner_id !== owner) continue;
        if (!sessionId || j.baseline_session_id === sessionId || j.retry_session_id === sessionId) transferJobs.delete(id);
      }
      for (const [id, e] of exports_) {
        if (e.owner_id !== owner) continue;
        if (!sessionId || e.session_id === sessionId) exports_.delete(id);
      }
      for (const [k, r] of idempotency) if (r.owner === owner) idempotency.delete(k);
    },
    // Idempotency-Key 저장(24시간)
    getIdem(owner, key) {
      const k = `${owner}:${key}`;
      const r = idempotency.get(k);
      if (r && r.expires_at < Date.now()) { idempotency.delete(k); return null; }
      return r || null;
    },
    putIdem(owner, key, rec) {
      idempotency.set(`${owner}:${key}`, { owner, ...rec });
      if (idempotency.size > 2000) for (const [k, r] of idempotency) { if (r.expires_at < Date.now()) idempotency.delete(k); }
    },
    // 예산 원장 상태(createLedger가 이 객체를 그대로 사용)
    ledgerState() { return ledgerState; },

    // WP-A2: 영속 계층용. 만료된 프로필·세션과 딸린 행을 모두 제거한다(티켓·내보내기는 자체 TTL).
    purgeExpired(nowMs = Date.now()) {
      let removed = 0;
      const gone = new Set();
      for (const [id, s] of sessions) if (Date.parse(s.expires_at) < nowMs) { gone.add(id); sessions.delete(id); removed++; }
      const goneTurns = new Set();
      for (const [id, t] of turns) if (gone.has(t.session_id)) { goneTurns.add(id); turns.delete(id); revisions.delete(id); }
      for (const id of gone) { events.delete(id); evaluations.delete(id); }
      for (const k of commands.keys()) if (gone.has(k.split(':')[0])) commands.delete(k);
      for (const [k, a] of attempts) if (goneTurns.has(a.turn_id)) attempts.delete(k);
      for (const [k, j] of transferJobs) if (gone.has(j.baseline_session_id) || gone.has(j.retry_session_id)) transferJobs.delete(k);
      for (const [id, p] of profiles) if (Date.parse(p.expires_at) < nowMs) {
        profiles.delete(id); instSources.delete(id); institutions.delete(id); removed++;
        for (const [vid, v] of profileVersions) if (v.profile_id === id) profileVersions.delete(vid);
      }
      for (const [k, r] of idempotency) if (r.expires_at < nowMs) idempotency.delete(k);
      return removed;
    },
    // WP-A2: 영속용 내부 맵(내보내기·티켓 제외 — 메모리 전용 TTL).
    _maps: { profiles, profileVersions, sessions, turns, revisions, events, commands, evaluations, appeals, attempts, deletions, profileCalls, instSources, institutions, transferJobs, idempotency, consents, documents, docRevisions },

    // 호환: 컬렉션 맵을 직접 노출(테스트·삭제 경로가 사용). 새 코드는 메서드를 우선한다.
    events, pushEvent, commands, evaluations, appeals, attempts, deletions,
  };
}
