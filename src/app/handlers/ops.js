// 상태·메타·관리자 조회 핸들러. 동작 불변 추출(WP-A1): server.js 라우터 본문에 인라인이던 것들.
import { INTERVIEW_TYPES, DURATIONS, PERSONAS, INPUT_MODES } from '../../domain/interview-types.js';
import { ROLES, ROLE_IDS } from '../../domain/roles.js';
import { PT_TASKS, SITUATION_SCENARIOS, PANEL_PRESETS } from '../../domain/scenarios.js';
import { DISCUSSION_TOPICS } from '../../domain/discussion.js';

export function createOpsHandlers(d) {
  const { config, store, ledger, trends, err, now, provider, providerInfo, gemini, groq, killed, adminEnabled, checkAdmin, parseTrendId } = d;

  // 공개 상태 확인은 최소 정보만: 설정·모델·예산 정보는 인증된 사용자에게만 준다.
  const health = (authed) => ({ status: 200, body: { ok: true, provider: authed ? providerInfo() : { selected: provider.name }, time: now() } });

  const interviewTypes = () => ({
    status: 200,
    body: {
      types: Object.values(INTERVIEW_TYPES),
      durations: DURATIONS,
      personas: PERSONAS,
      input_modes: INPUT_MODES,
      roles: ROLE_IDS.map((id) => ({ id, label: ROLES[id].label, focus: ROLES[id].focus })),
      panel_presets: PANEL_PRESETS,
      topics: DISCUSSION_TOPICS.map((t) => ({ id: t.id, title: t.title })),
      pt_tasks: PT_TASKS.map((t) => ({ id: t.id, title: t.title })),
      scenarios: SITUATION_SCENARIOS.map((s) => ({ id: s.id, title: s.title })),
    },
  });

  async function metrics(req) {
    const gate = await checkAdmin(req);
    if (gate) return gate;
    const st = gemini?.stats || null;
    return {
      status: 200,
      body: {
        provider: provider.name,
        gemini: st ? { calls: st.calls, failures: st.failures, rate_limits: st.rateLimits, fallbacks: st.fallbacks, avg_ms: st.calls ? Math.round(st.totalMs / st.calls) : 0 } : null,
        groq: groq?.stats ? { calls: groq.stats.calls, failures: groq.stats.failures, rate_limits: groq.stats.rateLimits, avg_ms: groq.stats.calls ? Math.round(groq.stats.totalMs / groq.stats.calls) : 0 } : null,
        ledger: { monthly_spent: Number(ledger.state.monthlySpent.toFixed(6)), monthly_reserved: Number(ledger.state.monthlyReserved.toFixed(6)), budget: config.budgets.monthlyApiBudget },
      },
    };
  }

  // Gemini 진단: 현재 키에서 generateContent 가능한 모델 목록(합성 전용, 키·개인정보 미포함)
  async function geminiModels(req, requestId) {
    const gate = await checkAdmin(req);
    if (gate) return gate;
    if (!gemini || killed) return { status: 200, body: { available: false, reason: killed ? 'kill_switch' : 'no_key', models: [], configured_model: null } };
    try {
      const models = await gemini.listModels();
      return {
        status: 200,
        body: {
          available: true,
          models: models.slice(0, 60),
          configured_model: gemini.model,
          configured_supported: models.includes(gemini.model),
          fallback_model: config.gemini.fallbackModel,
          fallback_supported: models.includes(config.gemini.fallbackModel),
          free_only: config.gemini.freeOnly !== false,
        },
      };
    } catch (e) {
      return err('diagnostics_failed', '모델 목록 조회에 실패했습니다.', 502, { requestId, details: e.details || null });
    }
  }

  const adminStatus = () => ({ status: 200, body: adminEnabled ? { admin_enabled: true } : { admin_enabled: false, note: 'ADMIN_TOKEN이 설정되지 않아 관리 기능이 꺼져 있습니다.' } });

  // 관리자: 버전 이력 조회 (초안·공개·롤백 기록). 일반 사용자에게는 노출하지 않는다.
  async function trendHistory(req, rawId, requestId) {
    const gate = await checkAdmin(req);
    if (gate) return gate;
    let trendId = rawId;
    try { trendId = decodeURIComponent(trendId); } catch { /* raw 사용 */ }
    try {
      const { segment, yyyyMm } = parseTrendId(trendId);
      const versions = trends.history({ segment, yyyyMm });
      const published = trends.published({ segment, yyyyMm });
      return { status: 200, body: { segment, yyyyMm, versions, published_version: published?.version ?? null } };
    } catch (e) {
      return err(e.code === 404 ? 'not_found' : 'validation_error', e.message, e.code === 404 ? 404 : 422, { requestId });
    }
  }

  function publicTrend(segment, yyyyMm) {
    const pub = trends.published({ segment, yyyyMm });
    if (!pub) return { status: 200, body: { segment, yyyyMm, status: 'unavailable', items: [], note: '승인된 월간 역량이 없습니다. 일반 기준으로 연습하세요.' } };
    return { status: 200, body: { segment, yyyyMm, ...pub, status: 'monthly_trend', note: '검수된 월간 보조 기준입니다. 기관 공식 요구가 아닙니다.' } };
  }

  function listSessions(owner) {
    return { status: 200, body: { sessions: store.listSessions(owner).filter((s) => !['deleted', 'deleting'].includes(s.state)).map((s) => ({ id: s.id, state: s.state, mode: s.mode, interview_type: s.interview_type || s.mode || 'general', persona: s.persona, blind: !!s.blind, created_at: s.created_at, completed_at: s.completed_at || null, question_count: s.questions.length })) } };
  }

  return { health, interviewTypes, metrics, geminiModels, adminStatus, trendHistory, publicTrend, listSessions };
}
