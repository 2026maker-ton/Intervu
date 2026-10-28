// HTTP API + 정적 UI. Node 내장 http만 사용.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { loadDotEnv } from './env.js';
import { createStore } from './store.js';
import { createLedger, estimateTokens } from './domain/ledger.js';
import { detectPii, maskPii, buildBlindContext, extractClaims, verifyClaimSpan } from './domain/pii.js';
import { normalizeSource, validateSourceUrl, freshnessOf } from './domain/sources.js';
import { buildInstitutionProfile, linkAnswersToInstitution, normalizeOrgType, providerConstraintForOrg } from './domain/institution.js';
import { normalizeRole, followupForRole, ROLES, ROLE_IDS } from './domain/roles.js';
import { canSessionTransition } from './domain/state.js';
import { selectQuestions, FOLLOWUPS, followupReasonFor } from './domain/questions.js';
import { buildMockEvaluation } from './domain/mock-eval.js';
import { validateEvaluation, checkFeedbackSafety } from './domain/evaluation.js';
import { createMockAdapter, createGeminiAdapter, createGroqWhisperAdapter, selectProvider } from './providers/adapters.js';
import { INTERVIEW_TYPES, DURATIONS, PERSONAS, INPUT_MODES, normalizeInterviewType, validateCombination, questionCountForDuration } from './domain/interview-types.js';
import { rubricForInterviewType, getRubric } from './domain/rubrics.js';
import { buildTypedEvaluation } from './domain/mock-eval-typed.js';
import { validateEvaluationGeneric } from './domain/evaluation-generic.js';
import { createDiscussionState, nextAiUtterance, moderatorLine, recordDiscussionTurn, DISCUSSION_TOPICS } from './domain/discussion.js';
import { PT_TASKS, SITUATION_SCENARIOS, TECHNICAL_QUESTIONS, PANEL_PRESETS } from './domain/scenarios.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, 'public');
// 레거시 mode 값: 하위 호환을 위해 interview_type으로 매핑한다.
const LEGACY_TYPE_ALIASES = ['structured', 'discussion_beta', 'pt_beta', 'presentation'];

export function createApp(overrides = {}) {
  const env = { ...loadDotEnv(root), ...process.env, ...(overrides.env || {}) };
  const config = loadConfig(env);
  const store = overrides.store || createStore();
  const ledger = overrides.ledger || createLedger({ sessionHardCap: config.budgets.sessionHardCap, monthlyApiBudget: config.budgets.monthlyApiBudget });
  const mock = createMockAdapter();
  const gemini = config.gemini.apiKey ? createGeminiAdapter({ apiKey: config.gemini.apiKey, textModel: config.gemini.textModel, fallbackModel: config.gemini.fallbackModel, timeoutMs: config.gemini.timeoutMs }) : null;
  const groq = config.groq.apiKey ? createGroqWhisperAdapter({ apiKey: config.groq.apiKey, model: config.groq.model, timeoutMs: config.groq.timeoutMs, maxAudioBytes: config.groq.maxAudioBytes }) : null;
  const killed = String(config.killSwitch || '').split(/[,\s]+/).includes('gemini');
  const killedGroq = String(config.killSwitch || '').split(/[,\s]+/).includes('groq');
  // 중요: 합성(synthetic) 요청과 실제 사용자 요청을 구분한다.
  // - 합성(진단/개발 테스트 데이터): allowUnpaid=true면 gemini 허용
  // - 실제 사용자 데이터: paidAck=true일 때만 gemini 허용, 그 외 Mock
  function providerForRequest(body = {}) {
    const synthetic = body.synthetic === true || body._synthetic === true;
    const name = killed ? 'mock' : selectProvider({ config, isSynthetic: synthetic });
    return { name, provider: name === 'gemini' && gemini && !killed ? gemini : mock, synthetic };
  }
  // 기본 경로(Mock): isSynthetic=false → 키 존재만으로 외부 전송 없음
  const { name: providerName, provider } = providerForRequest({});
  const idempotency = new Map();
  const requestLog = [];
  // WSS 대비 일회성 접속 티켓(30초 만료) + 내보내기 작업(10분 만료)
  const tickets = new Map(); // ticket -> { session_id, owner, expires_at }
  const exports = new Map(); // job_id -> { owner_id, session_id, created_at, expires_at, payload }

  // ---- helpers ----
  const now = () => new Date().toISOString();
  const err = (code, message, status, extra = {}) => ({ error: { code, message, retryable: !!extra.retryable, request_id: extra.requestId || null, details: extra.details || null } , status });
  const priceOf = (model, usage) => {
    const p = config.geminiPricing[model];
    if (!p) return 0;
    if (p.perMinute) return ((usage.billedSeconds || 0) / 60) * p.perMinute;
    return ((usage.input || 0) * p.input + (usage.output || 0) * p.output) / 1e6;
  };
  // 유형·단계별 평가 차원 매핑: 보고서의 근거 차원은 발화 시점의 단계로 고정한다.
  const discussionTurnDims = (phase, userTurnNo) => {
    if (userTurnNo <= 1) return ['claim_understanding', 'evidence_use'];
    if (userTurnNo === 2) return ['rebuttal', 'claim_understanding', 'evidence_use'];
    if (userTurnNo === 3) return ['rebuttal', 'collaboration', 'evidence_use'];
    return ['collaboration', 'claim_understanding', 'evidence_use'];
  };
  const situationalTurnDims = (idx, followupCount) => {
    if (idx === 0) return ['role_understanding', 'responsiveness', 'reasoning'];
    if (idx === 1) return ['responsiveness', 'reasoning', 'role_understanding'];
    if (idx <= followupCount) return ['role_understanding', 'reasoning', 'reflection'];
    return ['reflection', 'responsiveness', 'reasoning'];
  };
  const json = (res, status, body) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  };
  const readBody = (req, limit = 1_000_000) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(err('payload_too_large', '요청 본문이 너무 큽니다.', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(err('invalid_json', 'JSON 형식이 올바르지 않습니다.', 400)); }
    });
    req.on('error', reject);
  });
  // multipart/form-data 파서(의존성 없음): 오디오 1개 필드만 추출한다.
  const readMultipartAudio = (req, maxBytes) => new Promise((resolve, reject) => {
    const ctype = String(req.headers['content-type'] || '');
    const m = /boundary=(?:"([^"]+)"|([^\s;]+))/.exec(ctype);
    if (!m) return reject(err('validation_error', 'multipart/form-data 형식이 필요합니다.', 422));
    const boundary = Buffer.from(`--${m[1] || m[2]}`, 'utf8');
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > maxBytes + 65536) { reject(err('payload_too_large', `음성은 ${Math.round(maxBytes / 1024 / 1024)}MB 이하만 가능합니다.`, 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        // 첫 번째 파일 파트의 헤더 종료(\r\n\r\n) 이후 ~ 마지막 boundary 이전을 오디오로 취급
        const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'));
        const tailIdx = buf.lastIndexOf(boundary);
        if (headerEnd === -1 || tailIdx === -1 || tailIdx <= headerEnd) return reject(err('validation_error', '음성 파일을 찾지 못했습니다.', 422));
        const headerText = buf.slice(0, headerEnd).toString('latin1');
        const fnMatch = /filename="([^"]*)"/.exec(headerText);
        const typeMatch = /Content-Type:\s*([^\r\n;]+)/i.exec(headerText);
        let audio = buf.slice(headerEnd + 4, tailIdx);
        if (audio.length >= 2 && audio[audio.length - 2] === 13 && audio[audio.length - 1] === 10) audio = audio.slice(0, -2);
        const filename = (fnMatch?.[1] || 'answer.webm').slice(0, 100);
        const mimeType = (typeMatch?.[1] || 'audio/webm').trim().slice(0, 100);
        resolve({ audio, filename, mimeType });
      } catch {
        reject(err('invalid_audio', '음성 데이터를 읽지 못했습니다.', 422));
      }
    });
    req.on('error', reject);
  });
  const auth = (req) => {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m) return null;
    return config.devTokens[m[1]] || null;
  };
  const providerInfo = () => ({
    selected: provider.name,
    configured: !!config.gemini.apiKey,
    paidAck: config.gemini.paidAck,
    allowUnpaid: config.gemini.allowUnpaid,
    freeOnly: config.gemini.freeOnly !== false,
    textModel: gemini?.model || config.gemini.textModel,
    fallbackModel: config.gemini.fallbackModel,
    killSwitch: [killed ? 'gemini' : null, killedGroq ? 'groq' : null].filter(Boolean).join(',') || 'none',
    groq: groq && !killedGroq
      ? { configured: true, model: groq.model, maxAudioBytes: config.groq.maxAudioBytes, maxRecordingSeconds: config.groq.maxRecordingSeconds }
      : { configured: !!config.groq.apiKey, model: config.groq.model, disabled: true },
    note: killed
      ? 'AI 외부 호출이 비활성화되어 Mock으로 동작합니다.'
      : provider.name === 'gemini'
        ? (config.gemini.freeOnly !== false
          ? '무료 전용 모드: 검증된 무료 모델만 사용, 유료 전환·자동 상향 없음. 실제 개인정보는 전송하지 마세요.'
          : '실사용자 데이터 전송은 Paid 확인 + DPA 검토 후에만 허용됩니다.')
        : 'Mock provider로 동작 중입니다. 실제 사용자 데이터는 외부로 전송되지 않습니다.',
  });

  // ---- route handlers ----
  async function createProfile(owner, body, requestId) {
    // 프로필 API 속도 제한(사양 §15): 계정당 분당2회/일10회 기본값
    const counts = store.recordProfileCall(owner);
    if (counts.minute > config.profileRate.perMinute || counts.day > config.profileRate.perDay) {
      return err('quota_exceeded', '공고 분석 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429, { retryable: true, details: { minute: counts.minute, day: counts.day, limit_minute: config.profileRate.perMinute, limit_day: config.profileRate.perDay } });
    }
    const source = String(body.source_text || '');
    if (source.length > 20000) return err('validation_error', '공고 본문은 20,000자 이하여야 합니다.', 422, { requestId });
    if (!body.target_name && !body.role && !source) return err('validation_error', '기관/직무/공고 중 하나는 필요합니다.', 422, { requestId });
    // 기관 구분: company·public·university·highschool (기존 general 호환)
    const orgType = normalizeOrgType(body.org_type);
    const mc = providerConstraintForOrg(orgType);
    if (mc.forceMock) {
      // 미성년자 이용 가능 기능: 외부 호출 없이 Mock으로만 처리
      body._forceMock = true;
    }
    const pii = detectPii(source + (body.experiences || []).join(' '));
    const { profile, version_id } = store.createProfile(owner, { ...body, org_type: orgType });
    // 사용자 제공 기관 URL(출처 메타): SSRF 방어 검증 후 기록만 한다 (fetch 없음)
    const providedSources = [];
    const rawSources = Array.isArray(body.sources) ? body.sources.slice(0, 10) : (body.source_url ? [{ url: body.source_url, title: '지원 공고 URL' }] : []);
    for (const rs of rawSources) {
      try {
        const ns = normalizeSource(rs, {});
        ns.id = randomUUID();
        store.addSource(profile.id, { ...ns, owner_id: owner });
        providedSources.push(ns);
      } catch (e) {
        return err('validation_error', e.message || '사용할 수 없는 출처 URL입니다.', 422, { requestId, details: e.details || null });
      }
    }
    const pubNotice = body.source_text && providedSources.length === 0
      ? null
      : (providedSources.length ? null : null);
    const masked = maskPii(source);
    const blind = buildBlindContext(masked);
    let extracted;
    try {
      // 미성년자 가능 기관(highschool)은 항상 Mock 추출(외부 전송 금지)
      // 그 외: 합성 요청(synthetic=true + allowUnpaid)이거나 paidAck일 때만 gemini.
      // body.synthetic은 개발/진단용 합성 데이터 표시이며, 실제 개인정보 포함 시 서버가 차단한다.
      const { provider: useProvider, synthetic } = providerForRequest(body);
      if (body._forceMock) {
        extracted = extractClaims(masked, body.experiences || []);
      } else if (synthetic && detectPii(source).length > 0) {
        throw Object.assign(new Error('synthetic traffic must not contain PII'), { code: 422 });
      }
      if (useProvider.name === 'gemini') {
        ledger.reserve(`profile:${profile.id}`, 0.01);
        const caught = await useProvider.extract({ sourceText: masked, blindContext: blind });
        ledger.settle(`profile:${profile.id}`, 0.01, priceOf(caught.model, caught.usage));
        extracted = caught;
      } else {
        extracted = extractClaims(masked, body.experiences || []);
      }
    } catch (e) {
      if (e.code === 422 && /PII/.test(e.message)) {
        return err('validation_error', '합성 테스트 데이터에 개인정보를 포함할 수 없습니다.', 422, { requestId });
      }
      // 추출 실패 → 일반 템플릿(세션은 계속 가능)
      extracted = { claims: [], missing_fields: ['extraction_failed'], recommended_template: 'general-entry-v1', degraded_reason: e.code || 'provider_error' };
    }
    // 서버가 span을 원문에서 직접 계산(모델 좌표를 신뢰하지 않음) 후 일치 검증
    const normalized = (extracted.claims || []).map((c) => {
      const quote = String(c.value || c.quote || '').normalize('NFC').trim();
      if (!quote) return null;
      const chars = Array.from(masked);
      const idx = masked.indexOf(quote);
      if (idx === -1) return null;
      const start_cp = Array.from(masked.slice(0, idx)).length;
      return {
        kind: ['competency', 'format', 'requirement', 'experience'].includes(c.kind) ? c.kind : 'competency',
        value: quote.slice(0, 60),
        source_document_id: c.source_document_id || 'doc-1',
        revision: 1,
        start_cp,
        end_cp: start_cp + Array.from(quote).length,
        quote: quote.slice(0, 200),
        status: 'user_supplied',
      };
    }).filter(Boolean);
    const claims = normalized.filter((c) => verifyClaimSpan(masked, c));
    const rejected = (extracted.claims || []).length - claims.length;
    if (rejected > 0) extracted.rejected_spans = rejected;
    store.setExtracted(version_id, { ...extracted, claims, masked_text: masked, blind_context: blind });
    // 기관 프로필 초안 생성(결정적 분석): 승인 전 사용자가 확인·수정한다
    const institution = buildInstitutionProfile({
      orgType, targetName: body.target_name, role: body.role,
      sources: providedSources, claims, userNotes: (body.experiences || []).join('\n'),
    });
    store.setInstitution(profile.id, institution, 'review');
    void pubNotice;
    return { status: 201, body: { id: profile.id, version_id, status: 'review', pii_warnings: pii.map((x) => x.type), provider: body._forceMock ? 'mock' : provider.name, institution, institution_status: 'review' } };
  }

  function getProfile(owner, id) {
    const p = store.getProfile(owner, id);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const approved = p.approved_version_id ? store.getVersion(p.approved_version_id) : null;
    const current = p.version_id ? store.getVersion(p.version_id) : null;
    const inst = store.getInstitution(id);
    return {
      status: 200,
      body: {
        ...p,
        current_version: current ? { id: current.id, status: current.status, extracted: current.extracted } : null,
        approved_version: approved ? { id: approved.id, extracted: approved.extracted } : null,
        sources: store.listSources(id),
        institution: inst?.profile || null,
        institution_status: inst?.status || null,
      },
    };
  }

  function approveProfile(owner, id, body) {
    const p = store.getProfile(owner, id);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const vid = body.version_id || p.approved_version_id;
    if (!vid) return err('validation_error', 'version_id가 필요합니다.', 422);
    const v = store.approveVersion(owner, id, vid);
    if (!v) return err('not_found', '버전을 찾을 수 없습니다.', 404);
    // 기관 프로필도 함께 승인(불변 스냅샷). 사용자가 수정한 경우 body.institution_edits 반영.
    const inst = store.getInstitution(id);
    let approvedInst = inst?.profile || null;
    if (inst && body.institution_edits && typeof body.institution_edits === 'object') {
      const edits = body.institution_edits;
      approvedInst = {
        ...inst.profile,
        core_values: Array.isArray(edits.core_values) ? edits.core_values.slice(0, 10) : inst.profile.core_values,
        role_focus: Array.isArray(edits.role_focus) ? edits.role_focus.slice(0, 5) : inst.profile.role_focus,
        approved_note: typeof edits.note === 'string' ? edits.note.slice(0, 500) : null,
        user_confirmed_at: now(),
      };
    } else if (inst) {
      approvedInst = { ...inst.profile, user_confirmed_at: now() };
    }
    if (approvedInst) store.setInstitution(id, approvedInst, 'approved');
    return { status: 200, body: { id: v.id, profile_id: id, status: 'approved', approved_at: v.approved_at, institution_status: approvedInst ? 'approved' : null } };
  }

  function createSession(owner, body) {
    if (!body.profile_version_id) {
      if (body.profile_version_id === undefined) {
        // 공고 없음 일반모드 허용
      }
    }
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
    try {
      // 사전 확인만 수행(전액 예약은 다른 호출의 여유를 막음). 실제 예약은 호출 단위.
      if (!ledger.canAfford(`session:${owner}`, config.budgets.sessionHardCap)) {
        throw Object.assign(new Error('session budget exceeded'), { code: 429, retryable: true });
      }
    } catch (e) {
      return err('quota_exceeded', '예산 한도를 초과했습니다.', 429, { retryable: true, details: { reason: e.message } });
    }    const qCount = questionCountForDuration(duration_minutes);
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
      questions = picked.map((q, i) => ({ ...q, _panel_role: roles[i % roles.length] }));
      extra = { panel_roles: roles, participant_layout: 'panel', task_type: 'behavioral' };
      question_basis = `panel-v1 · ${roles.map((r) => ROLES[r]?.label || r).join(' / ')}`;
      coverage = { panel: qCount };
    } else {
      // general: 기존 1:1 흐름 + 시간별 문항 수
      const { picked, coverage: cov } = selectQuestions(seedNum, qCount);
      questions = picked.map((q) => ({ ...q }));
      coverage = cov;
      if (institution && !institution.fallback_to_general && Array.isArray(institution.recommended_questions) && institution.recommended_questions.length) {
        const instQs = institution.recommended_questions.slice(0, 2).map((q) => ({
          id: q.id || `inst-${q.primary}`, text: q.text, primary: q.primary, secondary: q.secondary || [],
          followup: q.text.includes('?') ? q.text : undefined,
          followup_dimensions: [q.primary],
          _institution_basis: q.basis, _rationale: q.rationale,
        }));
        questions = [...instQs, ...questions].slice(0, qCount);
        question_basis = institution.badge || '기관 맞춤 검토 가능';
      }
    }
    const s = store.createSession(owner, {
      ...body, mode, interview_type,
      duration_minutes, duration_seconds,
      interviewer_role: role,
      questions,
      ...extra,
      highschool_mock: institution?.org_type === 'highschool' ? true : !!body._forceMock,
      policy_snapshot: { provider: provider.name, model: config.gemini.textModel, rubric: rubric_version, pack: 'general-entry-ko@0.1.0-draft', budget_cap: config.budgets.sessionHardCap, interviewer_role: role, persona: body.persona || 'standard', question_basis, institution_approved: !!institution },
    });
    store.updateSession(s, { coverage, question_basis });
    store.pushEvent(s.id, 'session.snapshot', { state: 'ready', questions: s.questions.length, interviewer_role: role, question_basis });
    return { status: 201, body: { id: s.id, state: s.state, version: s.version, interview_type, task_type: s.task_type, participant_layout: s.participant_layout, limits: { duration_minutes: s.duration_minutes, duration_seconds: s.duration_seconds, max_user_turns: config.limits.maxUserTurns, budget_cap: config.budgets.sessionHardCap }, provider: provider.name, coverage, interviewer_role: role, role_label: ROLES[role].label, panel_roles: s.panel_roles || null, topic: s.topic_title ? { id: s.topic_id, title: s.topic_title, brief: s.topic_brief } : null, pt_task: s.pt_task_id ? { id: s.pt_task_id, title: s.pt_task_title, brief: s.pt_brief, prepare_seconds: s.pt_prepare_seconds, present_seconds: s.pt_present_seconds } : null, scenario: s.scenario_id ? { id: s.scenario_id, title: s.scenario_title } : null, rubric_version, question_basis } };
  }

  function getSession(owner, id) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    return { status: 200, body: publicSession(s) };
  }
  function publicSession(s) {
    const base = {
      id: s.id, state: s.state, version: s.version, mode: s.mode, task_type: s.task_type,
      interview_type: s.interview_type || s.mode || 'general',
      participant_layout: s.participant_layout || 'one_to_one',
      persona: s.persona, blind: s.blind, interviewer_role: s.interviewer_role || 'practitioner',
      role_label: (ROLES[s.interviewer_role] || ROLES.practitioner).label,
      question_basis: s.question_basis || 'general-template-v1',
      rubric_version: s.policy_snapshot?.rubric || rubricForInterviewType(s.interview_type || s.mode || 'general'),
      duration_minutes: s.duration_minutes, duration_seconds: s.duration_seconds, input_mode: s.input_mode,
      active_elapsed_ms: s.active_elapsed_ms + (s.state === 'active' && s.started_at ? Math.max(0, Date.now() - Date.parse(s.started_at)) : 0), questions: s.questions.map((q) => ({ id: q.id, text: q.text, primary: q.primary, secondary: q.secondary })), q_index: s.q_index,
      current_question: s.questions[s.q_index] || null, followups_used: s.followups_used, llm_calls: s.llm_calls,
      coverage: s.coverage || null, degraded_reason: s.degraded_reason, last_seq: (store.events.get(s.id) || []).filter((e) => e.durable).length,
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

  async function runCommand(owner, sessionId, body, requestId) {
    const s = store.getSession(owner, sessionId);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (s.state === 'deleting' || s.state === 'deleted') return err('not_found', '세션을 찾을 수 없습니다.', 404);
    const commandId = body.command_id;
    if (!commandId) return err('validation_error', 'command_id가 필요합니다.', 422);
    const key = `${sessionId}:${commandId}`;
    const hash = createHash('sha256').update(JSON.stringify(body.payload || {})).digest('hex');
    const prior = store.commands.get(key);
    if (prior) {
      if (prior.request_hash !== hash) return err('conflict', '동일 command_id에 다른 본문이 사용되었습니다.', 409);
      return { status: 202, body: prior.response };
    }
    const expected = body.expected_version;
    if (expected !== undefined && expected !== s.version) return err('conflict', '예상 버전이 일치하지 않습니다.', 409, { details: { current_version: s.version } });
    const type = body.type;
    const payload = body.payload || {};
    const accept = (response) => {
      store.commands.set(key, { request_hash: hash, response });
      return { status: 202, body: response };
    };

    if (type === 'session.start') {
      if (s.state === 'paused') return err('conflict', '일시정지 상태에서는 재개를 사용하세요.', 409);
      if (s.state !== 'ready') return err('conflict', '시작할 수 없는 상태입니다.', 409);
      if (!canSessionTransition(s.state, 'active')) return err('conflict', '전이 불가', 409);
      store.updateSession(s, { state: 'active', started_at: now() });
      store.pushEvent(s.id, 'session.snapshot', { state: 'active' });
      // 유형별 시작 멘트: 토론은 사회자 오프닝 + A 입론, PT는 과제 브리핑
      const it = s.interview_type || s.mode || 'general';
      let openings = [];
      if (it === 'discussion' && s.discussion) {
        const open = moderatorLine(s.discussion, 'open');
        recordDiscussionTurn(s.discussion, { speaker_id: 'moderator', claim_id: 'c-open', text: open });
        const aiA = nextAiUtterance(s.discussion, 'ai-a', '');
        recordDiscussionTurn(s.discussion, { speaker_id: aiA.speaker_id, claim_id: aiA.claim_id, text: aiA.text });
        store.pushEvent(s.id, 'assistant.message', { utterance: open, speaker_id: 'moderator', discussion_phase: s.discussion.phase });
        store.pushEvent(s.id, 'assistant.message', { utterance: aiA.text, speaker_id: aiA.speaker_id, speaker_name: aiA.speaker_name, claim_id: aiA.claim_id, discussion_phase: s.discussion.phase });
        openings = [{ speaker_id: 'moderator', utterance: open }, { speaker_id: aiA.speaker_id, speaker_name: aiA.speaker_name, utterance: aiA.text, claim_id: aiA.claim_id }];
        store.updateSession(s, {});
      } else if (it === 'pt') {
        store.updateSession(s, { pt_phase: 'brief' });
        store.pushEvent(s.id, 'assistant.message', { utterance: s.pt_brief, speaker_id: 'moderator', pt_phase: 'brief' });
      } else if (it === 'situational') {
        store.updateSession(s, { scenario_index: 0 });
        store.pushEvent(s.id, 'assistant.message', { utterance: s.questions[0]?.text || '', speaker_id: 'interviewer', scenario_id: s.scenario_id });
      } else if (it === 'panel' && Array.isArray(s.panel_roles) && s.panel_roles.length) {
        store.pushEvent(s.id, 'assistant.message', { utterance: `패널 면접을 시작합니다. ${s.panel_roles.map((r) => ROLES[r]?.label || r).join(' · ')} 면접관이 돌아가며 질문합니다.`, speaker_id: 'moderator' });
      }
      const base0 = { command_id: commandId, state: 'active', version: s.version, question: s.questions[s.q_index], question_total: s.questions.length, last_seq: (store.events.get(s.id) || []).length };
      if (openings.length) base0.openings = openings;
      if (it === 'discussion') base0.discussion = publicSession(s).discussion;
      if (it === 'pt') { base0.pt_phase = s.pt_phase; base0.pt_task = publicSession(s).pt_task; }
      if (it === 'situational') base0.scenario = publicSession(s).scenario;
      if (it === 'panel') base0.panel_roles = publicSession(s).panel_roles;
      return accept(base0);
    }
    if (type === 'pt.prepare') {
      if (s.interview_type !== 'pt') return err('validation_error', 'PT 세션에서만 사용할 수 있습니다.', 422);
      if (s.state !== 'active') return err('conflict', '진행 중인 세션에서만 단계를 바꿀 수 있습니다.', 409);
      const to = String(payload.phase || '');
      if (!['brief', 'prepare', 'present', 'qa'].includes(to)) return err('validation_error', '단계 값이 올바르지 않습니다.', 422);
      // 건너뛰기 금지: brief → prepare → present → qa 순서만 허용
      const order = ['brief', 'prepare', 'present', 'qa'];
      const from = order.indexOf(s.pt_phase || 'brief');
      const target = order.indexOf(to);
      if (target < from || target > from + 1) return err('conflict', 'PT 단계는 순서대로만 진행할 수 있습니다.', 409, { details: { current: s.pt_phase, requested: to } });
      store.updateSession(s, { pt_phase: to });
      let utterance = null;
      if (to === 'prepare') utterance = `준비 시간 ${Math.round((s.pt_prepare_seconds || 180) / 60)}분입니다. 과제를 읽고 발표 구조를 정리하세요. 준비가 끝나면 “발표 시작”을 누르세요.`;
      if (to === 'present') utterance = `발표 시간 ${Math.round((s.pt_present_seconds || 180) / 60)}분입니다. 결론 → 근거 → 실행계획 순서로 발표해 보세요.`;
      if (to === 'qa') utterance = s.pt_qa?.[0] || '질의응답을 시작합니다.';
      if (utterance) store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', pt_phase: to });
      return accept({ command_id: commandId, state: s.state, version: s.version, pt_phase: to, pt_qa_index: s.pt_qa_index || 0, utterance });
    }
    if (type === 'session.pause') {
      if (s.state !== 'active') return err('conflict', '진행 중인 세션만 일시정지할 수 있습니다.', 409);
      store.updateSession(s, { state: 'paused', active_elapsed_ms: s.active_elapsed_ms + (s.started_at ? Math.max(0, Date.now() - Date.parse(s.started_at)) : 0) });
      store.pushEvent(s.id, 'session.paused', {});
      return accept({ command_id: commandId, state: 'paused', version: s.version });
    }
    if (type === 'session.resume') {
      if (s.state !== 'paused') return err('conflict', '일시정지 상태가 아닙니다.', 409);
      store.updateSession(s, { state: 'active', started_at: now() });
      store.pushEvent(s.id, 'session.snapshot', { state: 'active' });
      return accept({ command_id: commandId, state: 'active', version: s.version });
    }
    if (type === 'turn.text' || type === 'turn.commit') {
      if (s.state !== 'active') return err('conflict', '진행 중인 세션에서만 답변할 수 있습니다.', 409);
      // 서버 시계 기준 시간 상한(클라이언트 타이머 조작과 무관)
      const elapsedMs = s.active_elapsed_ms + (s.started_at ? Math.max(0, Date.now() - Date.parse(s.started_at)) : 0);
      if (elapsedMs >= s.duration_seconds * 1000) return finishSession(owner, s, accept, commandId);
      let text = String(payload.text || '').trim();
      if (!text) return err('validation_error', '답변이 비어 있습니다.', 422);
      if ([...text].length > config.limits.maxAnswerChars) return err('validation_error', '답변은 4,000자 이하여야 합니다.', 422);
      // 블라인드 모드: 저장·평가에 쓰이는 텍스트에서 학교·성별·출신 단서를 마스킹한다.
      // (완전 익명화 보장은 아니며, 원문은 저장하지 않는다.)
      if (s.blind) text = buildBlindContext(text);
      const answered = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user').length;
      if (answered >= config.limits.maxUserTurns) return finishSession(owner, s, accept, commandId);
      const it = s.interview_type || s.mode || 'general';
      // 토론 턴: 사용자 발언 → 상태 기록 → 다음 화자 1명 발언을 함께 반환.
      // 4번째 사용자 발언이 끝나면 사회자가 정리하고 자동 종료한다(발언 기회 4회 보장).
      if (it === 'discussion') {
        const q = s.questions[Math.min(s.q_index, s.questions.length - 1)];
        const phaseBefore = s.discussion?.phase || 'opening';
        const dims = discussionTurnDims(phaseBefore, (s.discussion?.user_turns || 0) + 1);
        const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: q.primary, followup: false, elicited_dims: dims });
        const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
        recordDiscussionTurn(s.discussion, { speaker_id: 'user', claim_id: `c-u-${s.discussion.total_turns + 1}`, text });
        store.pushEvent(s.id, 'assistant.message', { utterance: text, speaker_id: 'user', discussion_phase: s.discussion.phase });
        const utterances = [];
        // 다음 발언: 사용자 → (AI 1명) → 사용자. 사회자는 단계 안내만 한다.
        if (s.discussion.next_speaker === 'user') {
          const line = moderatorLine(s.discussion, s.discussion.phase === 'agreement' ? 'agreement' : 'to_user');
          utterances.push({ speaker_id: 'moderator', utterance: line });
          store.pushEvent(s.id, 'assistant.message', { utterance: line, speaker_id: 'moderator', discussion_phase: s.discussion.phase });
          store.updateSession(s, {});
          return accept({ command_id: commandId, state: s.state, version: s.version, action: 'await_user', utterance: line, utterances, turn_id: turn.id, revision: rev.revision, discussion: publicSession(s).discussion, followups_used: s.followups_used, llm_calls: s.llm_calls });
        }
        if (s.discussion.next_speaker === 'moderator') {
          const closing = moderatorLine(s.discussion, 'closing');
          utterances.push({ speaker_id: 'moderator', utterance: closing });
          store.pushEvent(s.id, 'assistant.message', { utterance: closing, speaker_id: 'moderator', discussion_phase: 'closing' });
          s.q_index = s.questions.length - 1;
          store.updateSession(s, {});
          // 종료 응답은 사회자 마무리 멘트와 토론 상태를 함께 돌려준다(기록도 같은 본문).
          let captured = null;
          const fin = await finishSession(owner, s, (resp) => {
            captured = {
              ...resp, action: 'discussion_complete', utterance: closing, utterances,
              turn_id: turn.id, revision: rev.revision, discussion: publicSession(s).discussion,
            };
            accept(captured);
          }, commandId);
          if (fin.error) return fin;
          return { status: fin.status, body: captured || fin.body };
        }
        const ai = nextAiUtterance(s.discussion, s.discussion.next_speaker, text);
        recordDiscussionTurn(s.discussion, { speaker_id: ai.speaker_id, claim_id: ai.claim_id, text: ai.text });
        store.pushEvent(s.id, 'assistant.message', { utterance: ai.text, speaker_id: ai.speaker_id, speaker_name: ai.speaker_name, claim_id: ai.claim_id, responds_to: ai.responds_to, discussion_phase: s.discussion.phase });
        utterances.push({ speaker_id: ai.speaker_id, speaker_name: ai.speaker_name, utterance: ai.text, claim_id: ai.claim_id });
        // AI 발언 뒤에는 항상 사용자 차례 → 사회자 안내를 덧붙인다
        if (s.discussion.next_speaker === 'user') {
          const line = moderatorLine(s.discussion, s.discussion.phase === 'agreement' ? 'agreement' : 'to_user');
          utterances.push({ speaker_id: 'moderator', utterance: line });
          store.pushEvent(s.id, 'assistant.message', { utterance: line, speaker_id: 'moderator', discussion_phase: s.discussion.phase });
        }
        // 질문 슬롯을 사용자 발언 수에 맞춰 전진 (보고서 elicited 보조 매핑)
        s.q_index = Math.min(s.discussion.user_turns, s.questions.length - 1);
        store.updateSession(s, {});
        return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ai_speaks', utterance: ai.text, utterances, turn_id: turn.id, revision: rev.revision, discussion: publicSession(s).discussion, followups_used: s.followups_used, llm_calls: s.llm_calls });
      }
      // PT 턴: 발표 단계와 Q&A 단계의 답변만 평가 대상으로 기록한다.
      if (it === 'pt') {
        let phase = s.pt_phase || 'brief';
        // 준비 단계에서 바로 발표를 시작해도 막히지 않게 첫 발표 발언으로 기록한다.
        if (phase === 'brief' || phase === 'prepare') {
          store.updateSession(s, { pt_phase: 'present' });
          phase = 'present';
        }
        const inQa = phase === 'qa';
        const qid = inQa ? 'pt-qa' : 'pt-present';
        const q = s.questions.find((x) => x.id === qid) || s.questions[0];
        const dims = inQa ? ['qa_response', 'evidence_use'] : ['structure', 'evidence_use', 'execution_plan'];
        const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: q.primary, followup: inQa, elicited_dims: dims });
        const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
        store.pushEvent(s.id, 'assistant.message', { utterance: text, speaker_id: 'user', pt_phase: phase });
        let utterance = '';
        if (!inQa) {
          const presentCount = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user' && t.question_id === 'pt-present').length;
          if (presentCount >= 2) {
            store.updateSession(s, { pt_phase: 'qa', pt_qa_index: 0 });
            utterance = s.pt_qa[0] || '질의응답을 시작합니다. 질문에 답해 주세요.';
          } else {
            utterance = '발표를 이어가거나, 준비가 끝났으면 “발표 완료”라고 입력해 주세요. 발표가 끝나면 Q&A가 이어집니다.';
          }
        } else {
          const idx = (s.pt_qa_index || 0) + 1;
          if (idx >= s.pt_qa.length) {
            store.updateSession(s, { pt_qa_index: idx });
            return finishSession(owner, s, accept, commandId);
          }
          store.updateSession(s, { pt_qa_index: idx });
          utterance = s.pt_qa[idx];
        }
        store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', pt_phase: s.pt_phase });
        store.updateSession(s, {});
        return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ask_followup', utterance, turn_id: turn.id, revision: rev.revision, pt_phase: s.pt_phase, pt_qa_index: s.pt_qa_index, followups_used: s.followups_used, llm_calls: s.llm_calls });
      }
      // 상황·역할극: 시나리오 오프닝 → 후속 2개 → 성찰 질문 → 종료 (모두 검수된 고정 문장)
      if (it === 'situational') {
        const idx = s.scenario_index || 0; // 0=오프닝 답변, 1..n=후속, n+1=성찰
        const followups = s.scenario_followups || [];
        const inFollowup = idx >= 1;
        const q = s.questions[0];
        const dims = situationalTurnDims(idx, followups.length);
        const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: dims[0], followup: inFollowup, elicited_dims: dims });
        const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
        store.pushEvent(s.id, 'assistant.message', { utterance: text, speaker_id: 'user', scenario_id: s.scenario_id });
        const nextIdx = idx + 1;
        store.updateSession(s, { scenario_index: nextIdx });
        if (nextIdx <= followups.length) {
          const utterance = followups[nextIdx - 1];
          store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', scenario_id: s.scenario_id });
          return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ask_followup', utterance, turn_id: turn.id, revision: rev.revision, scenario_index: nextIdx, followups_used: s.followups_used, llm_calls: s.llm_calls });
        }
        if (nextIdx === followups.length + 1) {
          const utterance = '마지막으로, 이 상황에서 본인이 택한 대응을 다음에 다시 한다면 무엇을 바꾸겠습니까? 그렇게 판단한 기준도 함께 말해 주세요.';
          store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', scenario_id: s.scenario_id });
          return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ask_followup', utterance, turn_id: turn.id, revision: rev.revision, scenario_index: nextIdx, followups_used: s.followups_used, llm_calls: s.llm_calls });
        }
        return finishSession(owner, s, accept, commandId);
      }
      const q = s.questions[s.q_index];
      if (!q) return err('conflict', '남은 질문이 없습니다.', 409);
      const followupTurn = !!q._followedUp && s.followups_used > 0;
      const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: q.primary, followup: followupTurn });
      const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
      // 예산: 대화 호출 1회 예약(보수적 상한)
      if (s.llm_calls >= config.budgets.maxLlmCallsPerSession - 3) {
        // 평가/repair 슬롯 3회 보존
        return finishSession(owner, s, accept, commandId);
      }
      let utterance = q.text;
      let action = 'next_question';
      let followupReason = null;
      let geminiUsed = false;
      let geminiModel = null;
      // 패널: 현재 질문 담당 역할의 꼬리질문 전략을 사용 (평가는 동일 루브릭)
      const panelRole = (s.interview_type === 'panel') ? (q._panel_role || (s.panel_roles || [])[s.q_index % (s.panel_roles || ['practitioner']).length] || s.interviewer_role) : s.interviewer_role;
      const needFollowup = s.followups_used < config.limits.maxFollowupsTotal && !q._followedUp;
      if (needFollowup) {
        followupReason = followupReasonFor(text);
        action = 'ask_followup';
      }
      try {
        ledger.reserve(`session:${s.id}`, 0.005);
        // highschool 세션은 Mock 강제(미성년자 보호)
        // 그 외: 무료 전용 모드 + synthetic(합성 데이터 표시) 또는 paidAck일 때만 gemini.
        // 실제 개인정보 포함 입력은 외부 전송 전 차단 → 안전한 로컬 Mock 경로.
        // turn.text 명령의 synthetic 표시는 payload 안에 담긴다.
        const syntheticTurn = (body.synthetic === true || body.payload?.synthetic === true) && detectPii(text).length === 0;
        const { provider: useProvider } = s.highschool_mock ? { provider: mock } : providerForRequest({ synthetic: syntheticTurn });
        // 최근 대화(최대 4턴)를 문맥으로 전달: Gemini가 답변 근거를 활용하도록
        const pastTurns = store.sessionTurns(s.id).slice(-5, -1);
        const history = pastTurns.map((t) => {
          const revs = store.getRevisions(t.id);
          const last = revs[revs.length - 1];
          const qq = s.questions.find((x) => x.id === t.question_id);
          return { question: qq?.text || '', answer: last?.normalized_text || '' };
        }).filter((h) => h.question || h.answer);
        history.push({ question: q.followup || q.text, answer: text });
        const result = await useProvider.next({
          persona: s.persona, role: panelRole, followupReason,
          questionText: q.followup || q.text, recentAnswer: text,
          interviewType: s.interview_type, history,
        });
        ledger.settle(`session:${s.id}`, 0.005, priceOf(result.model, result.usage));
        utterance = result.utterance;
        if (useProvider.name === 'gemini') {
          // Gemini 실생성 사용 표시(보고서·로그에서 Mock과 구분)
          s.degraded_reason = null;
          geminiUsed = true;
          try { geminiModel = result.model || useProvider.model; } catch { geminiModel = config.gemini.textModel; }
          store.pushEvent(s.id, 'provider.used', { provider: 'gemini', model: geminiModel || result.model });
        }
      } catch (e) {
        // 대체: 검증된 정적 후속/다음 질문 (예약이 있었으면 unknown 처리)
        if (e.code === 429) {
          // 무료 한도 소진: 추가 과금 없이 종료. 유료 모델로 자동 전환 금지.
          s.degraded_reason = 'free_quota_exhausted';
          store.pushEvent(s.id, 'budget.warning', { reason: 'free_quota_exhausted', fallback: 'static', retryable: false });
          utterance = q.text;
          return finishSession(owner, s, accept, commandId);
        }
        const res = ledger.usage(`session:${s.id}`);
        if (res.reserved > 0) ledger.settle(`session:${s.id}`, 0.005, 0.005, { unknown: !e.code || e.code >= 500 });
        // Fallback 전용: 검증된 정적 후속/역할 문장 (Mock 경로와 동일 전략)
        if (followupReason) {
          utterance = followupForRole(panelRole, followupReason, null) || FOLLOWUPS[followupReason] || q.text;
        } else {
          utterance = q.text;
        }
        s.degraded_reason = 'provider_fallback';
        store.pushEvent(s.id, 'budget.warning', { reason: 'provider_fallback', fallback: 'static' });
      }
      s.llm_calls += 1;
      const panel_prefix = (s.interview_type === 'panel' && panelRole) ? `[${(ROLES[panelRole] || {}).label || panelRole}] ` : '';
      if (action === 'ask_followup') {
        s.followups_used += 1;
        q._followedUp = true;
        utterance = panel_prefix + utterance;
        store.pushEvent(s.id, 'assistant.message', { utterance, action: 'ask_followup', target_competency: q.primary, followup_reason: followupReason, speaker_role: panelRole });
      } else {
        s.followups_used = 0;
        s.q_index += 1;
        if (s.q_index >= s.questions.length) {
          return finishSession(owner, s, accept, commandId);
        }
        // 다음 질문은 검수된 팩 문장을 사용(모델이 평가·사실을 만들지 않음)
        utterance = s.questions[s.q_index].text;
        if (s.interview_type === 'panel') {
          const nr = s.questions[s.q_index]._panel_role || (s.panel_roles || [])[s.q_index % (s.panel_roles || ['practitioner']).length];
          utterance = `[${(ROLES[nr] || {}).label || nr}] ${utterance}`;
          store.pushEvent(s.id, 'assistant.message', { utterance, action: 'next_question', target_competency: s.questions[s.q_index].primary, speaker_role: nr });
        } else {
          store.pushEvent(s.id, 'assistant.message', { utterance, action: 'next_question', target_competency: s.questions[s.q_index].primary });
        }
      }
      store.updateSession(s, {});
      const resp = {
        command_id: commandId, state: s.state, version: s.version, action, utterance,
        turn_id: turn.id, revision: rev.revision, current_question: s.questions[s.q_index] || null,
        followups_used: s.followups_used, llm_calls: s.llm_calls,
        provider: geminiUsed ? 'gemini' : 'mock',
        ...(geminiUsed && geminiModel ? { model: geminiModel } : {}),
        ...(s.degraded_reason ? { degraded_reason: s.degraded_reason } : {}),
      };
      if (s.interview_type === 'panel') resp.speaker_role = panelRole;
      return accept(resp);
    }
    if (type === 'session.finish') return finishSession(owner, s, accept, commandId);
    return err('validation_error', '알 수 없는 명령입니다.', 422);
  }

  function finishSession(owner, s, accept, commandId) {
    return finishSessionAsync(owner, s, accept, commandId);
  }

  async function finishSessionAsync(owner, s, accept, commandId) {
    if (s.state === 'completed') return err('conflict', '이미 완료된 세션입니다.', 409);
    if (!canSessionTransition(s.state, 'completing')) return err('conflict', '종료할 수 없는 상태입니다.', 409);
    // 토론 세션은 사용자 발언 기회 미달 시 협업 차원을 보류하고 안내를 보고서에 포함한다
    const it0 = s.interview_type || s.mode || 'general';
    if (it0 === 'discussion' && s.discussion && s.discussion.user_turns < 4) {
      store.pushEvent(s.id, 'session.snapshot', { note: 'discussion_user_turns_below_4' });
    }
    void it0;
    store.updateSession(s, { state: 'completing' });
    const turns = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user');
    const turnsWithText = [];
    for (const t of turns) {
      const revs = store.getRevisions(t.id);
      const rev = revs[revs.length - 1];
      if (!rev) continue;
      const q = s.questions.find((x) => x.id === t.question_id);
      // 발화 시점의 단계별 차원(토론·PT·역할극)을 우선 사용한다.
      let elicited;
      if (Array.isArray(t.elicited_dims) && t.elicited_dims.length) elicited = [...t.elicited_dims];
      else if (t.followup) elicited = [...(q?.followup_dimensions || [q?.primary || 'reflection'])];
      else elicited = q ? [q.primary, ...(q.secondary || [])] : [];
      turnsWithText.push({ turn_id: t.id, revision: rev.revision, text: rev.normalized_text, elicited });
    }
    // 평가 예산 예약(평가 슬롯 보존)
    let report = null;
    try {
      ledger.reserve(`session:${s.id}`, config.budgets.evalReserve);
      const it = s.interview_type || s.mode || 'general';
      const rubric_version = s.policy_snapshot?.rubric || rubricForInterviewType(it);
      const isLegacy = rubric_version === 'behavioral-ko-v1' && (it === 'general' || it === 'panel' || it === 'structured');
      let generated;
      if (isLegacy) {
        generated = buildMockEvaluation({ sessionId: s.id, turnsWithText });
        const v = validateEvaluation(generated, turnsWithText.map((t) => ({ turn_id: t.turn_id, revision: t.revision, speaker: 'user', text: t.text, elicited_dimensions: t.elicited })));
        if (!v.ok) throw new Error(v.errors.join('; '));
      } else {
        generated = buildTypedEvaluation({ rubricVersion: rubric_version, turnsWithText });
        const v = validateEvaluationGeneric(generated, turnsWithText.map((t) => ({ turn_id: t.turn_id, revision: t.revision, speaker: 'user', text: t.text, elicited_dimensions: t.elicited })), getRubric(rubric_version));
        if (!v.ok) throw new Error(v.errors.join('; '));
      }
      // 기관 연결: 공개 요구사항과 답변의 근거 연결 (평가 점수와 별도 레이어)
      let institution_link = { mode: 'general', note: '공고 연결 없이 일반 역량 기준으로만 분석합니다.', links: [], uncovered: [] };
      let institution_profile = null;
      if (s.profile_version_id) {
        const ver = store.getVersion(s.profile_version_id);
        const prof = ver ? store.getProfile(owner, ver.profile_id) : null;
        const inst = ver && prof ? store.getInstitution(prof.id)?.profile : null;
        if (inst) {
          institution_profile = { org_type: inst.org_type, org_label: inst.org_label, target_name: inst.target_name, role: inst.role, badge: inst.badge, fallback_to_general: inst.fallback_to_general, core_values: inst.core_values, unevaluable: inst.unevaluable, disclaimer: inst.disclaimer };
          institution_link = linkAnswersToInstitution({ institution: inst, turnsWithText });
        }
      }
      // 재연습 질문: 기관 미관찰 요구 우선
      const next_actions = [...(generated.next_actions || [])];
      for (const u of (institution_link.uncovered || []).slice(0, 2)) {
        if (next_actions.length >= 3) break;
        if (next_actions.some((a) => a.practice_question?.includes(u.requirement))) continue;
        next_actions.push({
          dimension_id: 'relevance',
          action: `다음 답변에서는 ‘${u.requirement}’ 요구와 연결되는 본인 행동 근거를 한 가지 덧붙이세요.`,
          practice_question: `‘${u.requirement}’ 요구와 연결되는 본인의 경험을 설명해 주세요.`,
          institution_requirement: u.requirement,
        });
      }
      report = {
        ...generated,
        next_actions: next_actions.slice(0, 3),
        evaluation_id: randomUUID(),
        status: 'ready',
        generated_at: now(),
        provider: provider.name,
        interviewer_role: s.interviewer_role || null,
        role_label: s.interviewer_role ? (ROLES[s.interviewer_role]?.label || null) : null,
        institution: institution_profile,
        institution_link,
        badge: 'AI 생성 코칭 · 실제 합격 예측 아님',
        model_version: provider.name === 'gemini' ? config.gemini.textModel : 'mock-model-v1',
        interview_type: it,
        rubric_version,
        transcript_turn_count: turnsWithText.length,
      };
      store.evaluations.set(s.id, report);
      ledger.settle(`session:${s.id}`, config.budgets.evalReserve, Math.min(config.budgets.evalReserve, 0.002));
    } catch (e) {
      ledger.settle(`session:${s.id}`, config.budgets.evalReserve, config.budgets.evalReserve, { unknown: true });
      report = { status: 'failed', error_code: 'evaluation_failed', generated_at: now(), detail: '평가를 생성하지 못했습니다. 확정된 답변은 보존됩니다.', debug: String(e?.message || e).slice(0, 300) };
      store.evaluations.set(s.id, report);
    }
    store.updateSession(s, { state: 'completed', completed_at: now() });
    store.pushEvent(s.id, 'session.completed', { report_ready: report.status === 'ready' });
    if (report.status === 'ready') store.pushEvent(s.id, 'report.ready', { evaluation_id: report.evaluation_id });
    const response = { command_id: commandId, state: 'completed', version: s.version, report_status: report.status };
    if (accept) accept(response);
    return { status: 202, body: response };
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
    tickets.set(one_time_ticket, { session_id: id, owner, expires_at: Date.now() + 30_000 });
    if (tickets.size > 500) for (const [k, v] of tickets) { if (v.expires_at < Date.now()) tickets.delete(k); }
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

  // Groq Whisper STT: POST /sessions/:id/transcriptions (multipart audio)
  // 녹음 후 전사 방식. 전사 텍스트는 답변 입력창 확인용으로만 반환하며,
  // 기존 turn.text 제출 API를 그대로 사용해 Gemini 면접을 진행한다.
  function sttStatus() {
    if (!config.groq.apiKey) return { configured: false, provider: 'none', message: '음성 인식 키가 없습니다. 텍스트로 답해 주세요.' };
    if (killedGroq) return { configured: true, provider: 'disabled', message: '음성 인식이 비활성화되어 있습니다. 텍스트로 답해 주세요.' };
    return {
      configured: true, provider: 'groq-whisper', model: groq.model,
      maxAudioMB: Math.round(config.groq.maxAudioBytes / 1024 / 1024),
      maxRecordingSeconds: config.groq.maxRecordingSeconds,
      message: 'Groq Whisper 한국어 전사를 사용할 수 있습니다.',
    };
  }
  async function transcribeAudio(owner, id) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (s.state === 'deleting' || s.state === 'deleted') return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (!groq || killedGroq || !config.groq.apiKey) {
      return err('stt_unavailable', '음성 인식을 사용할 수 없습니다. 텍스트로 답해 주세요.', 503, { retryable: false });
    }
    return { status: 202, body: { pending: true } }; // 실제 파싱·호출은 라우터에서 수행
  }

  function useTicket(ticket) {
    if (!ticket) return null;
    const t = tickets.get(ticket);
    if (!t) return null;
    tickets.delete(ticket); // 일회성: 재사용 불가
    if (t.expires_at < Date.now()) return null;
    return t;
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

  function addRevision(owner, turnId, body) {
    const turn = store.getTurn(turnId);
    if (!turn) return err('not_found', '턴을 찾을 수 없습니다.', 404);
    const s = store.getSession(owner, turn.session_id);
    if (!s) return err('not_found', '턴을 찾을 수 없습니다.', 404);
    const reason = body.reason;
    if (!['stt_correction', 'content_rewrite'].includes(reason)) return err('validation_error', 'reason 값이 올바르지 않습니다.', 422);
    const text = String(body.text || '').trim();
    if (!text || [...text].length > config.limits.maxAnswerChars) return err('validation_error', '텍스트가 올바르지 않습니다.', 422);
    if (reason === 'content_rewrite') {
      const id = randomUUID();
      store.attempts.set(id, { id, owner_id: owner, origin_evaluation_id: store.evaluations.get(s.id)?.evaluation_id || null, turn_id: turnId, text, created_at: now() });
      return { status: 201, body: { practice_attempt_id: id, note: '내용 개선 답변은 새 연습으로 기록되며 원래 평가를 덮어쓰지 않습니다.' } };
    }
    const rev = store.addRevision(turnId, text, 'stt_correction', []);
    store.pushEvent(s.id, 'transcript.final', { turn_id: turnId, revision: rev.revision, corrected: true });
    return { status: 201, body: { turn_id: turnId, revision: rev.revision, reason, note: '전사 교정은 새 revision으로 기록됩니다. 기존 보고서는 유지됩니다.' } };
  }

  function createAppeal(owner, evaluationId, body) {
    let found = null;
    for (const [sid, r] of store.evaluations) {
      const s = store.getSession(owner, sid);
      if (s && r.evaluation_id === evaluationId) { found = { sid, r }; break; }
    }
    if (!found) return err('not_found', '평가를 찾을 수 없습니다.', 404);
    if (!['stt', 'fact', 'evidence', 'inappropriate'].includes(body.category)) return err('validation_error', 'category 값이 올바르지 않습니다.', 422);
    const comment = String(body.comment || '').slice(0, 500);
    if (body.evidence_id) {
      const hit = (found.r.dimensions || []).some((d) => (d.evidence || []).some((e) => e.turn_id === body.evidence_id));
      if (!hit) return err('validation_error', 'evidence_id가 보고서에 없습니다.', 422);
    }
    const id = randomUUID();
    store.appeals.set(id, { id, owner_id: owner, evaluation_id: evaluationId, category: body.category, evidence_id: body.evidence_id || null, comment, status: 'received', resolution_code: null, created_at: now(), resolved_at: null });
    return { status: 201, body: { appeal_id: id, state: 'received', sla: '처리 목표 3영업일(운영 목표)' } };
  }

  // 사양 §10: 이의 제기 조회(처리 단계 received→reviewing→resolved/rejected)
  function getAppeal(owner, appealId) {
    const a = store.appeals.get(appealId);
    if (!a || a.owner_id !== owner) return err('not_found', '이의 제기를 찾을 수 없습니다.', 404);
    // MVP: 접수 후 자동으로 검토중→완료 안내로 전이(수동 검토자를 흉내내지 않음)
    if (a.status === 'received' && Date.now() - Date.parse(a.created_at) > 5_000) {
      a.status = 'reviewing';
    }
    return { status: 200, body: a };
  }

  // 사양 §10: /exports → JSON 내보내기(10분 signed URL 대신 10분 유효 job)
  function createExport(owner, body) {
    if ((body.format || 'json') !== 'json') return err('validation_error', '현재는 JSON 형식만 지원합니다.', 422);
    const sessionId = body.session_id;
    let payload;
    if (sessionId) {
      const s = store.getSession(owner, sessionId);
      if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
      const report = store.evaluations.get(sessionId) || null;
      const turns = store.sessionTurns(sessionId).map((t) => {
        const revs = store.getRevisions(t.id) || [];
        return { turn_id: t.id, ordinal: t.ordinal, question_id: t.question_id, competency: t.competency, revisions: revs.map((r) => ({ revision: r.revision, text: r.normalized_text, origin: r.origin, created_at: r.created_at })) };
      });
      payload = { exported_at: now(), session: publicSession(s), turns, report };
    } else {
      const sessions = store.listSessions(owner).map((s) => publicSession(s));
      payload = { exported_at: now(), sessions, note: '보고서 원문을 포함하지 않는 요약 목록입니다. 세션별 원문은 session_id로 요청하세요.' };
    }
    const id = randomUUID();
    exports.set(id, { owner_id: owner, session_id: sessionId || null, created_at: now(), expires_at: Date.now() + 10 * 60_000, payload });
    if (exports.size > 200) for (const [k, v] of exports) { if (v.expires_at < Date.now()) exports.delete(k); }
    return { status: 202, body: { job_id: id, status: 'ready', expires_in: 600, download_url: `/api/v1/exports/${id}` } };
  }

  function getExport(owner, id) {
    const e = exports.get(id);
    if (!e || e.owner_id !== owner) return err('not_found', '내보내기 작업을 찾을 수 없습니다.', 404);
    if (e.expires_at < Date.now()) { exports.delete(id); return err('not_found', '만료된 내보내기 작업입니다.', 404); }
    return { status: 200, body: e.payload };
  }

  // 사양 §12: DELETE /account → 최근 재인증 토큰(30분 이내 생성된 명령)으로 계정 전체 삭제
  function deleteAccount(owner) {
    const job = store.deleteAccount(owner);
    return { status: 202, body: { deletion_id: job.id, state: 'completed', kind: 'account', backup_expiry: job.backup_expiry } };
  }

  // ---- 기관 출처·프로필 API ----
  // POST /profiles/:id/sources — 사용자 제공 URL·공식자료 메타 등록(외부 fetch 없음)
  function addInstitutionSource(owner, profileId, body) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const list = Array.isArray(body.sources) ? body.sources : [body];
    if (!list.length || list.length > 10) return err('validation_error', 'sources는 1~10개여야 합니다.', 422);
    const added = [];
    for (const rs of list) {
      try {
        const ns = normalizeSource(rs, {});
        ns.id = randomUUID();
        store.addSource(profileId, { ...ns, owner_id: owner });
        added.push(ns);
      } catch (e) {
        return err('validation_error', e.message || '사용할 수 없는 출처 URL입니다.', 422, { details: e.details || null });
      }
    }
    // 출처 추가 후 기관 프로필 재생성(초안, 승인 전까지 review)
    const ver = p.version_id ? store.getVersion(p.version_id) : null;
    const claims = ver?.extracted?.claims || [];
    const institution = buildInstitutionProfile({
      orgType: normalizeOrgType(p.org_type), targetName: p.target_name, role: p.role,
      sources: store.listSources(profileId), claims, userNotes: (p.experiences || []).join('\n'),
    });
    store.setInstitution(profileId, institution, 'review');
    return { status: 201, body: { added, institution, institution_status: 'review' } };
  }

  function getInstitution(owner, profileId) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const inst = store.getInstitution(profileId);
    if (!inst) return err('not_found', '기관 분석이 없습니다. 먼저 공고를 분석하세요.', 404);
    return { status: 200, body: { profile_id: profileId, status: inst.status, approved_at: inst.approved_at || null, institution: inst.profile, sources: store.listSources(profileId) } };
  }

  function createPractice(owner, body) {
    const eid = body.evaluation_id;
    if (!eid) return err('validation_error', 'evaluation_id가 필요합니다.', 422);
    // 원 평가의 루브릭 차원을 그대로 사용한다(유형별 차원 포함).
    let rubricVersion = 'behavioral-ko-v1';
    let allowed = ['relevance', 'evidence_specificity', 'reasoning', 'reflection'];
    for (const [sid, r] of store.evaluations) {
      if (r.evaluation_id !== eid || !store.getSession(owner, sid)) continue;
      rubricVersion = r.rubric_version || rubricVersion;
      allowed = getRubric(rubricVersion).dimensions;
      break;
    }
    const comp = body.competency_id;
    if (!allowed.includes(comp)) return err('validation_error', '역량 값이 올바르지 않습니다.', 422);
    const q = selectQuestions((Date.now() ^ 0x9e3779b9) >>> 0, 3).picked[0];
    const s = store.createSession(owner, {
      mode: 'structured', interview_type: 'general', duration_minutes: 3, input_mode: 'text', persona: 'standard',
      questions: [{
        ...q, id: `${q.id}-practice-${comp}`, text: practiceText(comp), primary: comp, secondary: [],
        followup: '방금 답변에서 본인이 직접 한 행동을 한 가지 더 구체적으로 설명해 주세요.',
        followup_dimensions: [comp],
      }],
      duration_seconds: 90,
      // 재연습도 원 평가와 같은 루브릭으로 채점해 전후 비교가 성립하게 한다.
      policy_snapshot: { rubric: rubricVersion, practice_of: eid },
    });
    store.updateSession(s, { state: 'ready' });
    return { status: 201, body: { id: s.id, state: s.state, version: s.version, limits: { duration_seconds: s.duration_seconds }, rubric_version: rubricVersion, competency_id: comp, note: '원래 평가를 수정하지 않는 새 연습입니다.' } };
  }
  const practiceText = (c) => ({
    relevance: '최근에 가장 중요한 일을 고른 기준과 다른 일을 미룬 이유를 설명해 주세요.',
    evidence_specificity: '본인이 직접 한 행동과 그 결과가 드러나는 경험을 설명해 주세요.',
    reasoning: '두 대안 중 하나를 고른 이유와 버린 대안의 단점을 비교해 설명해 주세요.',
    reflection: '아쉬웠던 경험에서 다음에 바꿀 행동 한 가지를 설명해 주세요.',
    // 유형별 차원의 재연습 질문 (같은 차원, 다른 질문)
    concept_clarity: '최근 다룬 개념 하나를 전제 조건과 함께 설명해 주세요.',
    applicability: '같은 방법을 조건이 다른 곳에 적용할 때 바꿀 점을 말해 주세요.',
    claim_understanding: '상대 입장에서 가장 강한 근거를 요약한 뒤 내 입장을 말해 주세요.',
    evidence_use: '자료의 어떤 수치·조건에 근거하는지 짚어 주장을 보강해 보세요.',
    rebuttal: '방금 나온 주장에 대한 반박을 근거와 함께 말해 보세요.',
    collaboration: '양측이 합의할 수 있는 한 가지 안과 실행 조건을 말해 보세요.',
    structure: '같은 내용을 결론부터 1분으로 다시 구성해 보세요.',
    execution_plan: '실행 단계와 확인할 지표를 한 가지씩 덧붙여 보세요.',
    qa_response: '예상 반론 하나에 대한 답변을 준비해 보세요.',
    role_understanding: '비슷한 상황에서 지킬 원칙을 먼저 말해 보세요.',
    responsiveness: '화난 고객의 말을 확인하는 한 문장과 다음 조치를 말해 보세요.',
  }[c] || '같은 역량의 다른 경험을 설명해 주세요.');

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
    store.evaluations.delete(id);
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

  // ---- HTTP server ----
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const method = req.method;
    const p = url.pathname;
    requestLog.push({ request_id: requestId, method, path: p, time: now() });
    if (requestLog.length > 1000) requestLog.shift();

    try {
      if (p === '/api/v1/health') return json(res, 200, { ok: true, provider: providerInfo(), time: now() });
      if (p === '/api/v1/interview-types' && method === 'GET') {
        return json(res, 200, {
          types: Object.values(INTERVIEW_TYPES),
          durations: DURATIONS,
          personas: PERSONAS,
          input_modes: INPUT_MODES,
          roles: ROLE_IDS.map((id) => ({ id, label: ROLES[id].label, focus: ROLES[id].focus })),
          panel_presets: PANEL_PRESETS,
          topics: DISCUSSION_TOPICS.map((t) => ({ id: t.id, title: t.title })),
          pt_tasks: PT_TASKS.map((t) => ({ id: t.id, title: t.title })),
          scenarios: SITUATION_SCENARIOS.map((s) => ({ id: s.id, title: s.title })),
        });
      }
      if (p === '/api/v1/metrics' && method === 'GET') {
        const st = gemini?.stats || null;
        return json(res, 200, {
          provider: provider.name,
          gemini: st ? { calls: st.calls, failures: st.failures, rate_limits: st.rateLimits, fallbacks: st.fallbacks, avg_ms: st.calls ? Math.round(st.totalMs / st.calls) : 0 } : null,
          groq: groq?.stats ? { calls: groq.stats.calls, failures: groq.stats.failures, rate_limits: groq.stats.rateLimits, avg_ms: groq.stats.calls ? Math.round(groq.stats.totalMs / groq.stats.calls) : 0 } : null,
          ledger: { monthly_spent: Number(ledger.state.monthlySpent.toFixed(6)), monthly_reserved: Number(ledger.state.monthlyReserved.toFixed(6)), budget: config.budgets.monthlyApiBudget },
        });
      }
      // Groq STT 연결 상태(키 노출 없음, 상태만 반환)
      if (p === '/api/v1/stt/status' && method === 'GET') {
        return json(res, 200, sttStatus());
      }
      // Gemini 진단: 현재 키에서 generateContent 가능한 모델 목록(합성 전용, 키·개인정보 미포함)
      if (p === '/api/v1/diagnostics/gemini-models' && method === 'GET') {
        if (!gemini || killed) return json(res, 200, { available: false, reason: killed ? 'kill_switch' : 'no_key', models: [], configured_model: null });
        try {
          const models = await gemini.listModels();
          const want = [config.gemini.textModel, config.gemini.fallbackModel];
          return json(res, 200, {
            available: true,
            models: models.slice(0, 60),
            configured_model: gemini.model,
            configured_supported: models.includes(gemini.model),
            fallback_model: config.gemini.fallbackModel,
            fallback_supported: models.includes(config.gemini.fallbackModel),
            free_only: config.gemini.freeOnly !== false,
          });
        } catch (e) {
          return json(res, 502, err('diagnostics_failed', '모델 목록 조회에 실패했습니다.', 502, { requestId, details: e.details || null }).error);
        }
      }

      // 정적 UI
      if (!p.startsWith('/api/')) {
        const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
        const file = path.join(staticDir, rel);
        if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return json(res, 404, { error: { code: 'not_found', message: 'Not found', retryable: false, request_id: requestId, details: null } });
        }
        const ext = path.extname(file);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'" });
        return fs.createReadStream(file).pipe(res);
      }

      const owner = auth(req);
      if (!owner) return json(res, 401, err('unauthorized', '인증이 필요합니다.', 401, { requestId }).error);

      // 사양 §10: WSS 일회성 티켓 (/ws?ticket=...) — MVP는 ticket 교환 후 REST 사용 안내
      if (method === 'GET' && /^\/api\/v1\/sessions\/[^/]+\/ws$/.test(p)) {
        const m = /^\/api\/v1\/sessions\/([^/]+)\/ws$/.exec(p);
        const ticket = url.searchParams.get('ticket') || req.headers['x-one-time-ticket'];
        const t = useTicket(ticket);
        if (!t || t.session_id !== m[1] || t.owner !== owner) {
          return json(res, 401, err('unauthorized', '유효한 일회성 티켓이 필요합니다. /connect로 다시 발급받으세요.', 401, { requestId }).error);
        }
        return json(res, 200, { ok: true, session_id: m[1], transport: 'rest-mvp', note: 'MVP는 실시간 소켓 대신 REST 명령과 폴링(/events)으로 진행합니다.' });
      }

      const idemKey = req.headers['idempotency-key'];
      const write = ['POST', 'DELETE', 'PUT', 'PATCH'].includes(method);
      if (write && !idemKey) return json(res, 422, err('idempotency_required', 'Idempotency-Key 헤더가 필요합니다.', 422, { requestId }).error);

      let body = {};
      if (write && !/^\/api\/v1\/sessions\/[^/]+\/transcriptions$/.test(p)) body = await readBody(req);

      // POST /profiles
      if (method === 'POST' && p === '/api/v1/profiles') {
        const r = await createProfile(owner, body, requestId);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      let m;
      if ((m = /^\/api\/v1\/profiles\/([^/]+)$/.exec(p))) {
        if (method === 'GET') { const r = getProfile(owner, m[1]); return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body); }
      }
      if ((m = /^\/api\/v1\/profiles\/([^/]+)\/approve$/.exec(p)) && method === 'POST') {
        const r = approveProfile(owner, m[1], body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/profiles\/([^/]+)\/sources$/.exec(p)) && method === 'POST') {
        const r = addInstitutionSource(owner, m[1], body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/profiles\/([^/]+)\/institution$/.exec(p)) && method === 'GET') {
        const r = getInstitution(owner, m[1]);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if (method === 'POST' && p === '/api/v1/sessions') {
        const r = createSession(owner, body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if (method === 'GET' && p === '/api/v1/sessions') {
        return json(res, 200, { sessions: store.listSessions(owner).filter((s) => !['deleted', 'deleting'].includes(s.state)).map((s) => ({ id: s.id, state: s.state, mode: s.mode, interview_type: s.interview_type || s.mode || 'general', persona: s.persona, blind: !!s.blind, created_at: s.created_at, completed_at: s.completed_at || null, question_count: s.questions.length })) });
      }
      if ((m = /^\/api\/v1\/sessions\/([^/]+)$/.exec(p))) {
        if (method === 'GET') { const r = getSession(owner, m[1]); return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body); }
        if (method === 'DELETE') { const r = deleteSession(owner, m[1]); return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body); }
      }
      if ((m = /^\/api\/v1\/sessions\/([^/]+)\/commands$/.exec(p)) && method === 'POST') {
        const r = await runCommand(owner, m[1], body, requestId);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      // Groq Whisper 전사: multipart 음성 → 텍스트(JSON). 원음은 저장하지 않고 전사 후 폐기.
      if ((m = /^\/api\/v1\/sessions\/([^/]+)\/transcriptions$/.exec(p)) && method === 'POST') {
        const sid = m[1];
        const gate = await transcribeAudio(owner, sid);
        if (gate.error) return json(res, gate.status, { ...gate.error, request_id: requestId });
        let parsed;
        try {
          parsed = await readMultipartAudio(req, config.groq.maxAudioBytes);
        } catch (e) {
          return json(res, e.status || 422, { ...e.error, request_id: requestId });
        }
        // 보안: 허용 오디오 형식만(브라우저 MediaRecorder 출력 + 호환 포맷)
        const ALLOWED_AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/m4a', 'video/webm']);
        const mimeBase = String(parsed.mimeType || '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_AUDIO.has(mimeBase)) {
          return json(res, 422, err('validation_error', `지원하지 않는 음성 형식입니다: ${mimeBase || 'unknown'}`, 422, { requestId }).error);
        }
        try {
          // 합성/개발 표시가 없어도 STT 자체는 PII를 외부로 보내지 않는다:
          // 음성은 전사 목적의 일시 처리이며 텍스트 결과에서 PII 경고를 함께 반환한다.
          const out = await groq.transcribe({ audioBuffer: parsed.audio, filename: parsed.filename, mimeType: mimeBase });
          // parsed.audio 참조 해제(전사 후 메모리에서 폐기)
          parsed.audio = null;
          if (!out.text) {
            return json(res, 200, { text: '', empty: true, model: out.model, note: '전사 결과가 비어 있습니다. 다시 녹음하거나 텍스트로 입력하세요.' });
          }
          const pii = detectPii(out.text).map((x) => x.type);
          return json(res, 200, {
            text: out.text, model: out.model, language: out.language || 'ko',
            pii_warnings: pii,
            note: pii.length ? '전사에 개인정보 후보가 있습니다. 제출 전 확인·수정하세요.' : '전사 결과를 확인·수정한 뒤 답변 제출 버튼을 누르세요.',
          });
        } catch (e) {
          parsed.audio = null;
          if (e.code === 429) {
            // 무료 한도 소진: 텍스트 입력 유지, 재시도 없음
            return json(res, 429, err('quota_exceeded', '음성 인식 무료 한도를 소진했습니다. 텍스트로 답해 주세요.', 429, { retryable: false, requestId }).error);
          }
          if (e.code === 413 || e.code === 422) {
            return json(res, e.code, err(e.code === 413 ? 'payload_too_large' : 'invalid_audio', e.message, e.code, { requestId }).error);
          }
          return json(res, 502, err('stt_failed', '음성 인식에 실패했습니다. 텍스트로 답해 주세요.', 502, { retryable: false, requestId }).error);
        }
      }
      if ((m = /^\/api\/v1\/sessions\/([^/]+)\/connect$/.exec(p)) && method === 'POST') {
        const r = connectSession(owner, m[1]);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/sessions\/([^/]+)\/events$/.exec(p)) && method === 'GET') {
        const r = getEvents(owner, m[1], url.searchParams.get('after_seq'));
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/sessions\/([^/]+)\/report$/.exec(p)) && method === 'GET') {
        const r = getReport(owner, m[1]);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/turns\/([^/]+)\/revisions$/.exec(p)) && method === 'POST') {
        const r = addRevision(owner, m[1], body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/evaluations\/([^/]+)\/appeals$/.exec(p)) && method === 'POST') {
        const r = createAppeal(owner, m[1], body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/appeals\/([^/]+)$/.exec(p)) && method === 'GET') {
        const r = getAppeal(owner, m[1]);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if (p === '/api/v1/practice-attempts' && method === 'POST') {
        const r = createPractice(owner, body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if (p === '/api/v1/exports' && method === 'POST') {
        const r = createExport(owner, body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/exports\/([^/]+)$/.exec(p)) && method === 'GET') {
        const r = getExport(owner, m[1]);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if (p === '/api/v1/account' && method === 'DELETE') {
        const r = deleteAccount(owner);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if ((m = /^\/api\/v1\/deletions\/([^/]+)$/.exec(p)) && method === 'GET') {
        const r = getDeletion(owner, m[1]);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }

      return json(res, 404, { error: { code: 'not_found', message: '경로를 찾을 수 없습니다.', retryable: false, request_id: requestId, details: null } });
    } catch (e) {
      const status = e.code === 413 ? 413 : e.code === 429 ? 429 : 500;
      return json(res, status, { error: { code: e.code || 'internal_error', message: status === 500 ? '서버 오류가 발생했습니다.' : e.message, retryable: !!e.retryable, request_id: requestId, details: null } });
    }
  });

  return {
    server,
    config,
    store,
    ledger,
    providerInfo,
    providerName,
    // 실제로 사용된 공급자 통계(운영 진단)
    providerStats() {
      return gemini?.stats || null;
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.listen(app.config.port, () => {
    const p = app.providerInfo();
    console.log(`Intervu listening on http://localhost:${app.config.port}`);
    console.log(`Provider: ${p.selected} | Gemini key configured: ${p.configured} | paidAck: ${p.paidAck}`);
  });
}
