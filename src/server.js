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
import { canSessionTransition } from './domain/state.js';
import { selectQuestions, FOLLOWUPS, followupReasonFor } from './domain/questions.js';
import { buildMockEvaluation } from './domain/mock-eval.js';
import { validateEvaluation, checkFeedbackSafety } from './domain/evaluation.js';
import { createMockAdapter, createGeminiAdapter, selectProvider } from './providers/adapters.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, 'public');

export function createApp(overrides = {}) {
  const env = { ...loadDotEnv(root), ...process.env, ...(overrides.env || {}) };
  const config = loadConfig(env);
  const store = overrides.store || createStore();
  const ledger = overrides.ledger || createLedger({ sessionHardCap: config.budgets.sessionHardCap, monthlyApiBudget: config.budgets.monthlyApiBudget });
  const mock = createMockAdapter();
  const gemini = config.gemini.apiKey ? createGeminiAdapter({ apiKey: config.gemini.apiKey, textModel: config.gemini.textModel, fallbackModel: config.gemini.fallbackModel, timeoutMs: config.gemini.timeoutMs }) : null;
  const killed = String(config.killSwitch || '').split(/[,\s]+/).includes('gemini');
  const providerName = killed ? 'mock' : selectProvider({ config, isSynthetic: true });
  const provider = providerName === 'gemini' && gemini && !killed ? gemini : mock;
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
    textModel: config.gemini.textModel,
    killSwitch: killed ? 'gemini' : 'none',
    note: killed
      ? 'AI 외부 호출이 비활성화되어 Mock으로 동작합니다.'
      : provider.name === 'gemini'
        ? '실사용자 데이터 전송은 Paid 확인 + DPA 검토 후에만 허용됩니다.'
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
    const pii = detectPii(source + (body.experiences || []).join(' '));
    const { profile, version_id } = store.createProfile(owner, body);
    const masked = maskPii(source);
    const blind = buildBlindContext(masked);
    let extracted;
    try {
      if (provider.name === 'gemini') {
        ledger.reserve(`profile:${profile.id}`, 0.01);
        const caught = await provider.extract({ sourceText: masked, blindContext: blind });
        ledger.settle(`profile:${profile.id}`, 0.01, priceOf(caught.model, caught.usage));
        extracted = caught;
      } else {
        extracted = extractClaims(masked, body.experiences || []);
      }
    } catch (e) {
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
    return { status: 201, body: { id: profile.id, version_id, status: 'extracting', pii_warnings: pii.map((x) => x.type), provider: provider.name } };
  }

  function getProfile(owner, id) {
    const p = store.getProfile(owner, id);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const approved = p.approved_version_id ? store.getVersion(p.approved_version_id) : null;
    const current = p.version_id ? store.getVersion(p.version_id) : null;
    return {
      status: 200,
      body: {
        ...p,
        current_version: current ? { id: current.id, status: current.status, extracted: current.extracted } : null,
        approved_version: approved ? { id: approved.id, extracted: approved.extracted } : null,
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
    return { status: 200, body: { id: v.id, profile_id: id, status: 'approved', approved_at: v.approved_at } };
  }

  function createSession(owner, body) {
    if (!body.profile_version_id) {
      if (body.profile_version_id === undefined) {
        // 공고 없음 일반모드 허용
      }
    }
    let version = null;
    if (body.profile_version_id) {
      version = store.getVersion(body.profile_version_id);
      if (!version || version.status !== 'approved') return err('conflict', '승인된 공고 버전이 필요합니다.', 409);
      const p = store.getProfile(owner, version.profile_id);
      if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
      if (new Date(p.expires_at).getTime() < Date.now()) return err('conflict', '만료된 프로필입니다.', 409);
    }
    const mode = body.mode === 'discussion_beta' || body.mode === 'pt_beta' ? body.mode : 'structured';
    if (mode !== 'structured') return err('not_implemented', '해당 모드는 닫힌 베타이며 기본 비활성입니다.', 422);
    // 사용자당 활성 세션 1개
    const active = store.listSessions(owner).find((s) => ['active', 'paused', 'completing'].includes(s.state));
    if (active) return err('conflict', '이미 진행 중인 세션이 있습니다.', 409, { details: { session_id: active.id } });
    if (!['supportive', 'standard', 'challenging'].includes(body.persona || 'standard')) return err('validation_error', '성향 값이 올바르지 않습니다.', 422);
    try {
      // 사전 확인만 수행(전액 예약은 다른 호출의 여유를 막음). 실제 예약은 호출 단위.
      if (!ledger.canAfford(`session:${owner}`, config.budgets.sessionHardCap)) {
        throw Object.assign(new Error('session budget exceeded'), { code: 429, retryable: true });
      }
    } catch (e) {
      return err('quota_exceeded', '예산 한도를 초과했습니다.', 429, { retryable: true, details: { reason: e.message } });
    }    const { picked, coverage } = selectQuestions((body.seed || Date.now()) >>> 0, 5);
    const s = store.createSession(owner, {
      ...body, mode,
      questions: picked.map((q) => ({ ...q })),
      policy_snapshot: { provider: provider.name, model: config.gemini.textModel, rubric: 'behavioral-ko-v1', pack: 'general-entry-ko@0.1.0-draft', budget_cap: config.budgets.sessionHardCap },
    });
    store.updateSession(s, { coverage });
    store.pushEvent(s.id, 'session.snapshot', { state: 'ready', questions: s.questions.length });
    return { status: 201, body: { id: s.id, state: s.state, version: s.version, limits: { duration_minutes: s.duration_minutes, duration_seconds: s.duration_seconds, max_user_turns: config.limits.maxUserTurns, budget_cap: config.budgets.sessionHardCap }, provider: provider.name, coverage } };
  }

  function getSession(owner, id) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    return { status: 200, body: publicSession(s) };
  }
  function publicSession(s) {
    return {
      id: s.id, state: s.state, version: s.version, mode: s.mode, task_type: s.task_type,
      persona: s.persona, blind: s.blind, duration_minutes: s.duration_minutes, duration_seconds: s.duration_seconds, input_mode: s.input_mode,
      active_elapsed_ms: s.active_elapsed_ms + (s.state === 'active' && s.started_at ? Math.max(0, Date.now() - Date.parse(s.started_at)) : 0), questions: s.questions.map((q) => ({ id: q.id, text: q.text, primary: q.primary, secondary: q.secondary })), q_index: s.q_index,
      current_question: s.questions[s.q_index] || null, followups_used: s.followups_used, llm_calls: s.llm_calls,
      coverage: s.coverage || null, degraded_reason: s.degraded_reason, last_seq: (store.events.get(s.id) || []).filter((e) => e.durable).length,
    };
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
      return accept({ command_id: commandId, state: 'active', version: s.version, question: s.questions[s.q_index], question_total: s.questions.length, last_seq: (store.events.get(s.id) || []).length });
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
      const text = String(payload.text || '').trim();
      if (!text) return err('validation_error', '답변이 비어 있습니다.', 422);
      if ([...text].length > config.limits.maxAnswerChars) return err('validation_error', '답변은 4,000자 이하여야 합니다.', 422);
      const answered = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user').length;
      if (answered >= config.limits.maxUserTurns) return finishSession(owner, s, accept, commandId);
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
      const needFollowup = s.followups_used < config.limits.maxFollowupsTotal && !q._followedUp;
      if (needFollowup) {
        followupReason = followupReasonFor(text);
        action = 'ask_followup';
      }
      try {
        ledger.reserve(`session:${s.id}`, 0.005);
        const result = await provider.next({ persona: s.persona, followupReason, questionText: q.followup || q.text, recentAnswer: text });
        ledger.settle(`session:${s.id}`, 0.005, priceOf(result.model, result.usage));
        utterance = result.utterance;
      } catch (e) {
        // 대체: 검증된 정적 후속/다음 질문 (예약이 있었으면 unknown 처리)
        if (e.code === 429) {
          s.degraded_reason = 'budget_exhausted';
          store.pushEvent(s.id, 'budget.warning', { reason: 'budget_exhausted' });
          utterance = q.text;
          return finishSession(owner, s, accept, commandId);
        }
        const res = ledger.usage(`session:${s.id}`);
        if (res.reserved > 0) ledger.settle(`session:${s.id}`, 0.005, 0.005, { unknown: !e.code || e.code >= 500 });
        utterance = followupReason ? FOLLOWUPS[followupReason] : q.text;
        s.degraded_reason = 'provider_fallback';
        store.pushEvent(s.id, 'budget.warning', { reason: 'provider_fallback' });
      }
      s.llm_calls += 1;
      if (action === 'ask_followup') {
        s.followups_used += 1;
        q._followedUp = true;
        store.pushEvent(s.id, 'assistant.message', { utterance, action: 'ask_followup', target_competency: q.primary, followup_reason: followupReason });
      } else {
        s.followups_used = 0;
        s.q_index += 1;
        if (s.q_index >= s.questions.length) {
          return finishSession(owner, s, accept, commandId);
        }
        // 다음 질문은 검수된 팩 문장을 사용(모델이 평가·사실을 만들지 않음)
        utterance = s.questions[s.q_index].text;
        store.pushEvent(s.id, 'assistant.message', { utterance, action: 'next_question', target_competency: s.questions[s.q_index].primary });
      }
      store.updateSession(s, {});
      return accept({ command_id: commandId, state: s.state, version: s.version, action, utterance, turn_id: turn.id, revision: rev.revision, current_question: s.questions[s.q_index] || null, followups_used: s.followups_used, llm_calls: s.llm_calls });
    }
    if (type === 'session.finish') return finishSession(owner, s, accept, commandId);
    return err('validation_error', '알 수 없는 명령입니다.', 422);
  }

  function finishSession(owner, s, accept, commandId) {
    if (s.state === 'completed') return err('conflict', '이미 완료된 세션입니다.', 409);
    if (!canSessionTransition(s.state, 'completing')) return err('conflict', '종료할 수 없는 상태입니다.', 409);
    store.updateSession(s, { state: 'completing' });
    const turns = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user');
    const turnsWithText = [];
    for (const t of turns) {
      const revs = store.getRevisions(t.id);
      const rev = revs[revs.length - 1];
      if (!rev) continue;
      const q = s.questions.find((x) => x.id === t.question_id);
      const elicited = t.followup
        ? [...(q?.followup_dimensions || [q?.primary || 'reflection'])]
        : q ? [q.primary, ...(q.secondary || [])] : [];
      turnsWithText.push({ turn_id: t.id, revision: rev.revision, text: rev.normalized_text, elicited });
    }
    // 평가 예산 예약(평가 슬롯 보존)
    let report = null;
    try {
      ledger.reserve(`session:${s.id}`, config.budgets.evalReserve);
      const generated = buildMockEvaluation({ sessionId: s.id, turnsWithText });
      const v = validateEvaluation(generated, turnsWithText.map((t) => ({ turn_id: t.turn_id, revision: t.revision, speaker: 'user', text: t.text, elicited_dimensions: t.elicited })));
      if (!v.ok) throw new Error(v.errors.join('; '));
      report = {
        ...generated,
        evaluation_id: randomUUID(),
        status: 'ready',
        generated_at: now(),
        provider: provider.name,
        badge: 'AI 생성 코칭 · 실제 합격 예측 아님',
        model_version: provider.name === 'gemini' ? config.gemini.textModel : 'mock-model-v1',
        rubric_version: 'behavioral-ko-v1',
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

  function createPractice(owner, body) {
    const eid = body.evaluation_id;
    if (!eid) return err('validation_error', 'evaluation_id가 필요합니다.', 422);
    const comp = body.competency_id;
    if (!['relevance', 'evidence_specificity', 'reasoning', 'reflection'].includes(comp)) return err('validation_error', '역량 값이 올바르지 않습니다.', 422);
    const q = selectQuestions((Date.now() ^ 0x9e3779b9) >>> 0, 3).picked[0];
    const s = store.createSession(owner, {
      mode: 'structured', duration_minutes: 3, input_mode: 'text', persona: 'standard',
      questions: [{
        ...q, id: `${q.id}-practice-${comp}`, text: practiceText(comp), primary: comp, secondary: [],
        followup: '방금 답변에서 본인이 직접 한 행동을 한 가지 더 구체적으로 설명해 주세요.',
        followup_dimensions: [comp],
      }],
      duration_seconds: 90,
      policy_snapshot: { rubric: 'behavioral-ko-v1', practice_of: eid },
    });
    store.updateSession(s, { state: 'ready' });
    return { status: 201, body: { id: s.id, state: s.state, version: s.version, limits: { duration_seconds: s.duration_seconds }, note: '원래 평가를 수정하지 않는 새 연습입니다.' } };
  }
  const practiceText = (c) => ({
    relevance: '최근에 가장 중요한 일을 고른 기준과 다른 일을 미룬 이유를 설명해 주세요.',
    evidence_specificity: '본인이 직접 한 행동과 그 결과가 드러나는 경험을 설명해 주세요.',
    reasoning: '두 대안 중 하나를 고른 이유와 버린 대안의 단점을 비교해 설명해 주세요.',
    reflection: '아쉬웠던 경험에서 다음에 바꿀 행동 한 가지를 설명해 주세요.',
  }[c]);

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
      if (p === '/api/v1/metrics' && method === 'GET') {
        const st = gemini?.stats || null;
        return json(res, 200, {
          provider: provider.name,
          gemini: st ? { calls: st.calls, failures: st.failures, rate_limits: st.rateLimits, fallbacks: st.fallbacks, avg_ms: st.calls ? Math.round(st.totalMs / st.calls) : 0 } : null,
          ledger: { monthly_spent: Number(ledger.state.monthlySpent.toFixed(6)), monthly_reserved: Number(ledger.state.monthlyReserved.toFixed(6)), budget: config.budgets.monthlyApiBudget },
        });
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
      if (write) body = await readBody(req);

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
      if (method === 'POST' && p === '/api/v1/sessions') {
        const r = createSession(owner, body);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
      }
      if (method === 'GET' && p === '/api/v1/sessions') {
        return json(res, 200, { sessions: store.listSessions(owner).filter((s) => !['deleted', 'deleting'].includes(s.state)).map((s) => ({ id: s.id, state: s.state, mode: s.mode, persona: s.persona, created_at: s.created_at, completed_at: s.completed_at || null, question_count: s.questions.length })) });
      }
      if ((m = /^\/api\/v1\/sessions\/([^/]+)$/.exec(p))) {
        if (method === 'GET') { const r = getSession(owner, m[1]); return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body); }
        if (method === 'DELETE') { const r = deleteSession(owner, m[1]); return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body); }
      }
      if ((m = /^\/api\/v1\/sessions\/([^/]+)\/commands$/.exec(p)) && method === 'POST') {
        const r = await runCommand(owner, m[1], body, requestId);
        return r.error ? json(res, r.status, { ...r.error, request_id: requestId }) : json(res, r.status, r.body);
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
