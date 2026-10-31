// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID } from '../crypto.js';
import { planGeneralQuestions, prependClaimQuestions } from '../../domain/plan.js';
import { normalizeRole, ROLES } from '../../domain/roles.js';
import { selectQuestions } from '../../domain/questions.js';
import { INTERVIEW_TYPES, DURATIONS, normalizeInterviewType, validateCombination, questionCountForDuration } from '../../domain/interview-types.js';
import { rubricForInterviewType } from '../../domain/rubrics.js';
import { getFixture } from '../../domain/fixtures.js';
import { createDiscussionState, DISCUSSION_TOPICS } from '../../domain/discussion.js';
import { PT_TASKS, SITUATION_SCENARIOS, TECHNICAL_QUESTIONS, PANEL_PRESETS } from '../../domain/scenarios.js';
import { INTERVIEW_FORMATS, stageQuestions } from '../../domain/interview-format.js';

// 레거시 mode 값: 하위 호환을 위해 interview_type으로 매핑한다.
const LEGACY_TYPE_ALIASES = ['structured', 'discussion_beta', 'pt_beta', 'presentation'];

export function createSessionHandlers(d) {
  const { config, store, ledger, trends, err, now, provider, syntheticTraffic, caller, requestContext } = d;
  // 세션 생성 시점의 라우팅 예고(아직 호출 전): 실제 호출 결과는 명령 응답·보고서의 provider_trace가 알려 준다.
  const planTrace = (p) => ({ operation: p.operation, provider: p.provider, mode: p.mode, reason: p.reason, model_alias: p.live ? p.route.alias : 'mock', latency_ms: null });
  function createSession(owner, body) {
    // 일반 면접 5단계(2026-10-31): interview_format을 보내는 클라이언트(현재 UI)는 승인된 학교·학과 계획으로만 진행한다.
    // interview_format 없이 오는 요청은 레거시 경로(유형별 질문 팩·자료 없는 일반모드)로 남긴다.
    if (body.interview_format !== undefined) return createGeneralSession(owner, body);
    let version = null;
    let institution = null;
    if (body.profile_version_id) {
      version = store.getVersion(body.profile_version_id);
      if (!version || version.status !== 'approved') return err('conflict', '승인된 공고 버전이 필요합니다.', 409);
      const p = store.getProfile(owner, version.profile_id);
      if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
      if (new Date(p.expires_at).getTime() < Date.now()) return err('conflict', '만료된 프로필입니다.', 409);
      institution = store.getInstitution(p.id)?.profile || null;
    }
    // 서버가 fixture로 판정한 합성 프로필에서 만든 세션인지(음성 읽기 시연 등 STT 게이트에만 사용; 턴·평가는 답변 텍스트별로 따로 판정)
    const fixtureSession = !!(version && store.getProfile(owner, version.profile_id)?.synthetic === true);
    // 면접 유형 + 설정 조합 검증 (유형과 블라인드/성향/역할/입력/시간은 독립 축)
    const rawType = body.interview_type ?? body.mode;
    const interview_type = normalizeInterviewType(rawType || 'general');
    if (rawType && !INTERVIEW_TYPES[String(rawType).toLowerCase()] && !LEGACY_TYPE_ALIASES.includes(String(rawType).toLowerCase())) {
      return err('validation_error', `알 수 없는 면접 유형입니다: ${String(rawType).slice(0, 40)}`, 422);
    }
    const rawDuration = body.duration_minutes;
    if (rawDuration !== undefined && !DURATIONS.includes(Number(rawDuration))) {
      return err('validation_error', '면접 시간은 5·10·15분 중에서 선택해야 합니다.', 422);
    }
    const duration_minutes = rawDuration === undefined ? 15 : Number(rawDuration);
    // duration_seconds가 명시되면 우선 (PT 준비/발표 타이머·재연습 90초 등)
    const duration_seconds = Number.isFinite(body.duration_seconds) && body.duration_seconds > 0
      ? Math.round(body.duration_seconds)
      : duration_minutes * 60;
    const panel_roles_in = Array.isArray(body.panel_roles) ? body.panel_roles.filter((r) => ROLES[r]) : null;
    const combo = validateCombination({
      interview_type, blind: body.blind ?? false, persona: body.persona || 'standard',
      interviewer_role: body.interviewer_role, panel_roles: panel_roles_in,
      input_mode: body.input_mode || 'text', duration_minutes, org_type: institution?.org_type,
    });
    if (!combo.ok) return err('validation_error', `지원하지 않는 설정 조합입니다: ${combo.errors.join(', ')}`, 422);
    // 레거시 mode 매핑 유지 (항상 interview_type으로 정규화)
    const mode = interview_type;
    void body.mode;
    // 사용자당 활성 세션 1개
    const active = store.listSessions(owner).find((s) => ['active', 'paused', 'completing'].includes(s.state));
    if (active) return err('conflict', '이미 진행 중인 세션이 있습니다.', 409, { details: { session_id: active.id } });
    if (!['supportive', 'standard', 'challenging'].includes(body.persona || 'standard')) return err('validation_error', '성향 값이 올바르지 않습니다.', 422);
    const orgOf = institution?.org_type || (version ? store.getProfile(owner, version?.profile_id)?.org_type : null);
    // 기술 면접은 면접관 역할을 명시하지 않으면 기술·전공 면접관이 기본이다.
    const requestedRole = body.interviewer_role || (interview_type === 'technical' ? 'expert' : null);
    const role = normalizeRole(requestedRole, orgOf || 'general');
    if (requestedRole && !ROLES[requestedRole]) return err('validation_error', '면접관 역할 값이 올바르지 않습니다.', 422);
    if (institution?.org_type === 'highschool' && provider.name === 'gemini') {
      return err('not_implemented', '고등학교 입학면접 연습은 Mock 검증 범위이며 Gemini 실호출을 사용하지 않습니다.', 422);
    }
    // 사전 예산 확인(BUG-8): 세션 id가 생기기 전이므로 월 예산 잔여가 세션 상한을 감당하는지만 본다(과거 `session:${owner}` 가짜 키 제거).
    // 실제 예약·정산은 호출 단위(providers/call.js)가 세션 키로 한다.
    const sessionCtx = requestContext(owner, { forceMock: institution?.org_type === 'highschool' || !!body._forceMock });
    const dialoguePlan = caller.plan('dialogue.next', sessionCtx);
    if (ledger.monthlyAvailable() < config.budgets.sessionHardCap) {
      return err('quota_exceeded', '예산 한도를 초과했습니다.', 429, { retryable: true, details: { reason: 'monthly budget exceeded' } });
    }
    const qCount = questionCountForDuration(duration_minutes);
    let questions = [];
    let coverage = null;
    let question_basis = 'general-template-v1';
    let rubric_version = rubricForInterviewType(interview_type);
    let extra = {};
    const seedNum = (body.seed || Date.now()) >>> 0;

    if (interview_type === 'technical') {
      // 직무·기술: 기술 팩 + 기관 맞춤 앞배치
      const tqs = [...TECHNICAL_QUESTIONS].slice(0, qCount).map((q) => ({ ...q }));
      questions = tqs;
      question_basis = 'technical-ko-v1';
      coverage = { technical: qCount };
      if (institution && !institution.fallback_to_general && Array.isArray(institution.recommended_questions) && institution.recommended_questions.length) {
        const instQs = institution.recommended_questions.slice(0, 1).map((q) => ({
          id: q.id || `inst-${q.primary}`, text: q.text, primary: q.primary, secondary: q.secondary || [],
          followup: undefined, followup_dimensions: [q.primary],
          _institution_basis: q.basis, _rationale: q.rationale,
        }));
        questions = [...instQs, ...questions].slice(0, qCount);
        question_basis = institution.badge || '기관 맞춤 검토 가능';
      }
      const tc = prependClaimQuestions(questions, version, version?.frozen_excluded_claim_ids, qCount);
      questions = tc.questions;
      if (tc.n) question_basis = `지원서 주장 검증 ${tc.n}건 · ${question_basis}`;
    } else if (interview_type === 'discussion') {
      // 토론: 사회자 + AI 2명 + 사용자. 질문 대신 토론 주제로 시작.
      const pickedTopic = DISCUSSION_TOPICS.find((t) => t.id === body.topic_id) || DISCUSSION_TOPICS[seedNum % DISCUSSION_TOPICS.length];
      const disc = createDiscussionState(seedNum, pickedTopic.id);
      extra = {
        discussion: disc,
        topic_id: pickedTopic.id, topic_title: pickedTopic.title, topic_brief: pickedTopic.brief,
        task_type: 'discussion', participant_layout: 'group',
      };
      // 토론의 사용자 발언 기회(최소 4회)를 질문 슬롯으로 환산 — 보고서 elicited 매핑용 더미 질문
      questions = [
        { id: 'disc-open', text: `입론: “${pickedTopic.title}”에 대한 당신의 입장을 말해 주세요.`, primary: 'claim_understanding', secondary: ['evidence_use'] },
        { id: 'disc-exch', text: '반론: AI 참가자의 주장 중 하나를 짚고 근거와 함께 반박해 보세요.', primary: 'rebuttal', secondary: ['claim_understanding'] },
        { id: 'disc-agree', text: '합의: 양보할 점과 지킬 점을 각각 한 가지씩 말해 보세요.', primary: 'collaboration', secondary: ['evidence_use'] },
      ];
      question_basis = 'discussion-topic-v1 · AI 2명 + 사회자';
      coverage = { discussion: 3 };
    } else if (interview_type === 'pt') {
      // PT: 과제 제시 → 준비(서버 타이머) → 발표 → Q&A
      const task = PT_TASKS.find((t) => t.id === body.pt_task_id) || PT_TASKS[seedNum % PT_TASKS.length];
      extra = {
        pt_task_id: task.id, pt_task_title: task.title, pt_brief: task.brief,
        pt_phase: 'brief', pt_prepare_seconds: task.prepare_seconds, pt_present_seconds: task.present_seconds,
        pt_qa: task.qa_bank.slice(0, task.qa_count), pt_qa_index: 0,
        task_type: 'presentation',
      };
      questions = [
        { id: 'pt-present', text: `발표: “${task.title}” 기획안을 3분 안에 발표해 보세요.`, primary: 'structure', secondary: ['evidence_use', 'execution_plan'] },
        { id: 'pt-qa', text: '질의응답: 면접관의 질문에 답해 보세요.', primary: 'qa_response', secondary: ['evidence_use'] },
      ];
      question_basis = `pt-task-v1 · ${task.title}`;
      coverage = { presentation: 2 };
      rubric_version = 'presentation-ko-v1';
    } else if (interview_type === 'situational') {
      // 상황·역할극: 시나리오 오프닝 + 후속 전개
      const sc = SITUATION_SCENARIOS.find((x) => x.id === body.scenario_id) || SITUATION_SCENARIOS[seedNum % SITUATION_SCENARIOS.length];
      extra = {
        scenario_id: sc.id, scenario_title: sc.title, scenario_followups: sc.followups,
        task_type: 'situational',
      };
      questions = [{ id: `sit-${sc.id}`, text: sc.opening, primary: 'role_understanding', secondary: ['responsiveness', 'reasoning'] }];
      question_basis = `situation-scenario-v1 · ${sc.title}`;
      coverage = { situational: 1 };
      rubric_version = 'situational-ko-v1';
    } else if (interview_type === 'panel') {
      // 패널: 역할 2~3명이 돌아가며 질문
      const roles = panel_roles_in && panel_roles_in.length >= 2 ? panel_roles_in.slice(0, 3)
        : (institution?.org_type === 'university' || institution?.org_type === 'highschool') ? PANEL_PRESETS.school : PANEL_PRESETS.default;
      const { picked } = selectQuestions(seedNum, qCount);
      const pc = prependClaimQuestions(picked.map((q) => ({ ...q })), version, version?.frozen_excluded_claim_ids, qCount);
      questions = pc.questions.map((q, i) => ({ ...q, _panel_role: roles[i % roles.length] }));
      extra = { panel_roles: roles, participant_layout: 'panel', task_type: 'behavioral' };
      question_basis = `panel-v1 · ${roles.map((r) => ROLES[r]?.label || r).join(' / ')}${pc.n ? ` · 지원서 주장 검증 ${pc.n}건` : ''}`;
      coverage = { panel: qCount };
    } else {
      // general: 질문 계획은 GET /profiles/:id/plan과 같은 함수를 쓴다. 제외·동결은 승인 시점 스냅샷 기준.
      const plan = planGeneralQuestions({ version, institution, orgType: orgOf, trends, qCount, seedNum, excludedClaimIds: version?.frozen_excluded_claim_ids || [], modelQuestions: version?.plan?.model_questions || [] });
      questions = plan.questions; coverage = plan.coverage; question_basis = plan.question_basis;
    }
    const s =store.createSession(owner, {
      ...body, free_test: syntheticTraffic, mode, interview_type,
      duration_minutes, duration_seconds,
      interviewer_role: role,
      questions,
      ...extra,
      highschool_mock: institution?.org_type === 'highschool' ? true : !!body._forceMock,
      server_synthetic: fixtureSession,
      sample_fixture_id: fixtureSession ? (store.getProfile(owner, version.profile_id)?.fixture_id || null) : null,
      policy_snapshot: { provider: dialoguePlan.provider, model: config.gemini.textModel, rubric: rubric_version, pack: 'general-entry-ko@0.1.0-draft', budget_cap: config.budgets.sessionHardCap, interviewer_role: role, persona: body.persona || 'standard', question_basis, institution_approved: !!institution },
    });
    store.updateSession(s, { coverage, question_basis });
    store.pushEvent(s.id, 'session.snapshot', { state: 'ready', questions: s.questions.length, interviewer_role: role, question_basis });
    return { status: 201, body: { sample_answers: sampleAnswersOf(s), id: s.id, state: s.state, version: s.version, interview_type, task_type: s.task_type, participant_layout: s.participant_layout, free_test: !!s.free_test, limits: { duration_minutes: s.duration_minutes, duration_seconds: s.duration_seconds, max_user_turns: config.limits.maxUserTurns, budget_cap: config.budgets.sessionHardCap }, provider: dialoguePlan.provider, provider_trace: [planTrace(dialoguePlan)], coverage, interviewer_role: role, role_label: ROLES[role].label, panel_roles: s.panel_roles || null, topic: s.topic_title ? { id: s.topic_id, title: s.topic_title, brief: s.topic_brief } : null, pt_task: s.pt_task_id ? { id: s.pt_task_id, title: s.pt_task_title, brief: s.pt_brief, prepare_seconds: s.pt_prepare_seconds, present_seconds: s.pt_present_seconds } : null, scenario: s.scenario_id ? { id: s.scenario_id, title: s.scenario_title } : null, rubric_version, question_basis } };
  }

  function createGeneralSession(owner, body) {
    const f = INTERVIEW_FORMATS.find((x) => x.id === body.interview_format);
    if (!f) return err('validation_error', '알 수 없는 면접 형태입니다.', 422);
    if (!f.enabled) return err('not_implemented', '특수 면접은 아직 준비 중입니다. 일반 면접으로 진행해 주세요.', 422);
    if (!body.profile_version_id) return err('validation_error', '학교·학과 근거를 승인한 뒤 면접을 시작할 수 있습니다.', 422);
    const version = store.getVersion(body.profile_version_id);
    if (!version || version.status !== 'approved') return err('conflict', '승인된 공고 버전이 필요합니다.', 409);
    const p = store.getProfile(owner, version.profile_id);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    if (new Date(p.expires_at).getTime() < Date.now()) return err('conflict', '만료된 프로필입니다.', 409);
    const plan = version.plan?.general;
    if (!plan?.stages?.length) return err('conflict', '질문 계획이 없습니다. 근거를 다시 승인해 주세요.', 409);
    const active = store.listSessions(owner).find((s) => ['active', 'paused', 'completing'].includes(s.state));
    if (active) return err('conflict', '이미 진행 중인 세션이 있습니다.', 409, { details: { session_id: active.id } });
    if (ledger.monthlyAvailable() < config.budgets.sessionHardCap) return err('quota_exceeded', '예산 한도를 초과했습니다.', 429, { retryable: true, details: { reason: 'monthly budget exceeded' } });
    const sessionCtx = requestContext(owner, {});
    const dialoguePlan = caller.plan('dialogue.next', sessionCtx);
    const questions = stageQuestions(plan);
    // 세션 상한: 본질문·꼬리질문 모두 답변 제한시간 + 여유. 화면에는 전체 시계를 보이지 않는다.
    const duration_seconds = questions.length * 2 * (config.budgets.answerSeconds + 45);
    const role = normalizeRole(null, p.org_type || 'university');
    const s = store.createSession(owner, {
      interview_type: 'general', mode: 'general', duration_minutes: Math.ceil(duration_seconds / 60), duration_seconds,
      input_mode: ['groq', 'text'].includes(body.input_mode) ? body.input_mode : 'text', persona: 'standard', interviewer_role: role,
      profile_version_id: version.id, questions, question_basis: '일반 면접 5단계', free_test: syntheticTraffic,
      server_synthetic: p.synthetic === true, sample_fixture_id: p.synthetic === true ? p.fixture_id || null : null,
      policy_snapshot: { provider: dialoguePlan.provider, model: config.gemini.textModel, rubric: 'behavioral-ko-v1', format: 'general', budget_cap: config.budgets.sessionHardCap, interviewer_role: role, question_basis: '일반 면접 5단계', institution_approved: true },
    });
    store.updateSession(s, { format: 'general', answer_seconds: config.budgets.answerSeconds, coverage: { general_stages: questions.length }, question_basis: '일반 면접 5단계' });
    store.pushEvent(s.id, 'session.snapshot', { state: 'ready', questions: questions.length, format: 'general' });
    return { status: 201, body: { id: s.id, state: s.state, version: s.version, interview_type: 'general', interview_format: 'general', limits: { duration_seconds, answer_seconds: config.budgets.answerSeconds, question_count: questions.length, max_user_turns: config.limits.maxUserTurns, budget_cap: config.budgets.sessionHardCap }, provider: dialoguePlan.provider, provider_trace: [planTrace(dialoguePlan)], rubric_version: 'behavioral-ko-v1', question_basis: '일반 면접 5단계', sample_answers: sampleAnswersOf(s) } };
  }

  function getSession(owner, id) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    return { status: 200, body: publicSession(s) };
  }
  const sampleAnswersOf = (s) => (s.sample_fixture_id ? getFixture(s.sample_fixture_id)?.answers || null : null);
  function publicSession(s) {
    const base = {
      sample_answers: sampleAnswersOf(s),
      id: s.id, state: s.state, version: s.version, mode: s.mode, task_type: s.task_type,
      interview_type: s.interview_type || s.mode || 'general',
      participant_layout: s.participant_layout || 'one_to_one',
      persona: s.persona, blind: s.blind, free_test: !!s.free_test, interviewer_role: s.interviewer_role || 'practitioner',
      role_label: (ROLES[s.interviewer_role] || ROLES.practitioner).label,
      question_basis: s.question_basis || 'general-template-v1',
      rubric_version: s.policy_snapshot?.rubric || rubricForInterviewType(s.interview_type || s.mode || 'general'),
      duration_minutes: s.duration_minutes, duration_seconds: s.duration_seconds, input_mode: s.input_mode,
      active_elapsed_ms: s.active_elapsed_ms + (s.state === 'active' && s.started_at ? Math.max(0, Date.now() - Date.parse(s.started_at)) : 0), questions: s.questions.map((q) => ({ id: q.id, text: q.text, primary: q.primary, secondary: q.secondary, ...(q.trend_ids ? { trend_ids: q.trend_ids, source_status: q.source_status, basis: q._institution_basis } : {}), ...(q.application_evidence ? { application_evidence: q.application_evidence, source_status: q.source_status, prompt_version: q.prompt_version } : {}) })), q_index: s.q_index,
      current_question: s.questions[s.q_index] || null, followups_used: s.followups_used, llm_calls: s.llm_calls,
      format: s.format || null, answer_seconds: s.answer_seconds || null, awaiting_followup: !!s.awaiting_followup, current_followup: s.awaiting_followup ? s.current_followup : null,
      coverage: s.coverage || null, degraded_reason: s.degraded_reason, provider_trace: (s.provider_trace || []).slice(-20), last_seq: (store.events.get(s.id) || []).filter((e) => e.durable).length,
    };
    if (s.interview_type === 'discussion') {
      base.topic = s.topic_id ? { id: s.topic_id, title: s.topic_title, brief: s.topic_brief } : null;
      base.discussion = s.discussion ? {
        phase: s.discussion.phase, next_speaker: s.discussion.next_speaker,
        user_turns: s.discussion.user_turns, user_opportunities: s.discussion.user_opportunities,
        total_turns: s.discussion.total_turns, agreed_points: s.discussion.agreed_points || [],
      } : null;
    }
    if (s.interview_type === 'pt') {
      base.pt_task = s.pt_task_id ? { id: s.pt_task_id, title: s.pt_task_title, brief: s.pt_brief, prepare_seconds: s.pt_prepare_seconds, present_seconds: s.pt_present_seconds } : null;
      base.pt_phase = s.pt_phase || 'brief';
      base.pt_qa_index = s.pt_qa_index || 0;
      base.pt_qa_total = (s.pt_qa || []).length;
    }
    if (s.interview_type === 'situational') {
      base.scenario = s.scenario_id ? { id: s.scenario_id, title: s.scenario_title } : null;
      base.scenario_index = s.scenario_index || 0;
      base.scenario_followup_total = (s.scenario_followups || []).length;
    }
    if (s.interview_type === 'panel') {
      base.panel_roles = (s.panel_roles || []).map((r) => ({ id: r, label: (ROLES[r] || {}).label || r }));
      base.current_panel_role = s.questions[s.q_index]?._panel_role || s.panel_roles?.[0] || null;
    }
    return base;
  }

  function getEvents(owner, id, afterSeq) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    const all = (store.events.get(id) || []).filter((e) => e.durable);
    const after = Number.isFinite(Number(afterSeq)) ? Number(afterSeq) : 0;
    const events = all.filter((e) => e.seq > after).slice(0, 100);
    return { status: 200, body: { events, next_cursor: events.length ? events[events.length - 1].seq : after } };
  }

  // 사양 §10: /sessions/:id/connect → 일회성 30초 WSS 티켓
  // 구현 명세의 실제 WSS 미연동 구간에서 ticket만 발급한다(기존 세션 재접속용).
  function connectSession(owner, id) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (s.state === 'deleting' || s.state === 'deleted') return err('not_found', '세션을 찾을 수 없습니다.', 404);
    const last_seq = (store.events.get(id) || []).filter((e) => e.durable).length;
    const one_time_ticket = randomUUID();
    store.putTicket(one_time_ticket, { session_id: id, owner, expires_at: Date.now() + 30_000 });
    return {
      status: 200,
      body: {
        one_time_ticket, expires_in: 30, ws_url: `/api/v1/sessions/${id}/ws`,
        state: s.state, version: s.version, last_seq,
        // MVP는 실제 WSS 미연동이므로 REST commands로 진행한다
        note: 'MVP는 실제 소켓 연결 없이 REST 명령으로 진행합니다.',
      },
    };
  }

  function useTicket(ticket) {
    if (!ticket) return null;
    return store.takeTicket(ticket); // 일회성: 재사용 불가, 만료 시 null
  }

  function getReport(owner, id) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (s.state === 'deleting' || s.state === 'deleted') return err('not_found', '세션을 찾을 수 없습니다.', 404);
    const r = store.evaluations.get(id);
    if (!r) return { status: 202, body: { status: 'pending', retry_at: new Date(Date.now() + 3000).toISOString() } };
    if (r.status === 'failed') return { status: 202, body: { status: 'failed', detail: r.detail } };
    return { status: 200, body: r };
  }

  function deleteSession(owner, id) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    const deletionId = randomUUID();
    store.updateSession(s, { state: 'deleting' });
    // 활성 저장소 파기: 전사·보고서·이벤트 payload
    for (const t of store.sessionTurns(id)) {
      const list = store.getRevisions(t.id) || [];
      for (const r of list) r.normalized_text = '[삭제됨]';
    }
    const evs = store.events.get(id) || [];
    for (const e of evs) e.payload = {};
    // 이 세션의 답변 재작성 연습(발언 원문)·이의 제기(코멘트)도 파기
    const turnIds = new Set(store.sessionTurns(id).map((t) => t.id));
    const evalId = store.evaluations.get(id)?.evaluation_id;
    for (const [k, a] of store.attempts) if (a.owner_id === owner && turnIds.has(a.turn_id)) store.attempts.delete(k);
    for (const [k, a] of store.appeals) if (a.owner_id === owner && evalId && a.evaluation_id === evalId) store.appeals.delete(k);
    store.evaluations.delete(id);
    store.purgeOwned(owner, id);
    store.updateSession(s, { state: 'deleted' });
    const job = { id: deletionId, owner_id: owner, session_id: id, state: 'completed', requested_at: now(), completed_at: now(), access_revoked: true, primary_purged: true, backup_expiry: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) };
    store.deletions.set(deletionId, job);
    return { status: 202, body: { deletion_id: deletionId, state: 'completed', backup_expiry: job.backup_expiry } };
  }
  function getDeletion(owner, id) {
    const d = store.deletions.get(id);
    if (!d || d.owner_id !== owner) return err('not_found', '삭제 요청을 찾을 수 없습니다.', 404);
    return { status: 200, body: d };
  }

  return { createSession, getSession, publicSession, getEvents, connectSession, useTicket, getReport, deleteSession, getDeletion };
}
