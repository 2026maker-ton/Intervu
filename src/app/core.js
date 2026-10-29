// 플랫폼 중립 앱 코어(WP-A1): 설정·공급자·Store를 묶고 핸들러·라우터를 조립한다.
// node:*·process·fs를 쓰지 않는다. env·store·trends는 어댑터(node/·worker/)가 주입한다.
import { loadConfig } from '../config.js';
import { createStore } from '../store/index.js';
import { createLedger } from '../domain/ledger.js';
import { createMockAdapter, createGeminiAdapter, createGroqWhisperAdapter } from '../providers/adapters.js';
import { createRegistry } from '../providers/registry.js';
import { createCaller } from '../providers/call.js';
import { err, now } from './util.js';
import { safeEqual } from './crypto.js';
import { createProfileHandlers } from './handlers/profiles.js';
import { createConsentHandlers } from './handlers/consents.js';
import { createSessionHandlers } from './handlers/sessions.js';
import { createCommandHandlers } from './handlers/commands.js';
import { createFeedbackHandlers } from './handlers/feedback.js';
import { createTransferHandlers } from './handlers/transfer.js';
import { createAccountHandlers } from './handlers/account.js';
import { createDocumentHandlers } from './handlers/documents.js';
import { createAdminHandlers } from './handlers/admin.js';
import { createSttHandlers } from './handlers/stt.js';
import { createOpsHandlers } from './handlers/ops.js';
import { createFetchHandler } from './router.js';

// env: 평탄한 문자열 맵(어댑터가 .env·환경변수·바인딩을 합쳐 준다).
// trends: 월간 트렌드 저장소(영속은 어댑터 책임). syntheticTraffic: 코드로만 켜는 합성 전용 인스턴스.
export function createCore({ env = {}, store: storeIn, ledger: ledgerIn, trends, syntheticTraffic = false } = {}) {
  const config = loadConfig(env);
  const store = storeIn || createStore();
  const ledger = ledgerIn || createLedger({ sessionHardCap: config.budgets.sessionHardCap, monthlyApiBudget: config.budgets.monthlyApiBudget, state: store.ledgerState() });
  const mock = createMockAdapter();
  const gemini = config.gemini.apiKey ? createGeminiAdapter({ apiKey: config.gemini.apiKey, textModel: config.gemini.textModel, fallbackModel: config.gemini.fallbackModel, timeoutMs: config.gemini.timeoutMs, freeOnly: config.gemini.freeOnly, baseUrl: config.providerGate.gemini.baseUrl }) : null;
  const groq = config.groq.apiKey ? createGroqWhisperAdapter({ apiKey: config.groq.apiKey, model: config.groq.model, timeoutMs: config.groq.timeoutMs, maxAudioBytes: config.groq.maxAudioBytes, baseUrl: config.providerGate.groq.baseUrl }) : null;
  const killList = String(config.killSwitch || '').split(/[,\s]+/);
  const killed = killList.includes('gemini');
  const killedGroq = killList.includes('groq');
  // 공급자 라우팅·게이트·호출 래퍼(WP-B1, 04 §1~3). 외부 전송 허용 여부는 서버 상태(ctx)로만 정한다.
  // 요청 본문의 synthetic/free_test 값은 어떤 경로에서도 전송 근거가 아니다.
  const registry = createRegistry(config);
  const caller = createCaller({
    registry, gates: config.providerGate, ledger, priceOf: (model, usage) => priceOf(model, usage),
    killed: new Set(killList), adapters: { mock, gemini, groq },
    timeouts: { gemini: config.gemini.timeoutMs, groq: config.groq.timeoutMs },
  });
  // 요청 컨텍스트: synthetic은 서버가 코드로 켠 인스턴스이거나 서버 판정 훅(extra.synthetic, WP-C6 fixture 해시)일 때만 true.
  // consent/age19는 Store의 동의 기록에서만 온다(동의 API 전에는 항상 false).
  const requestContext = (owner, extra = {}) => {
    const consent = store.getConsent?.(owner) || null;
    return { owner, synthetic: syntheticTraffic === true || extra.synthetic === true, forceMock: !!extra.forceMock, consent: !!consent, age19: !!consent?.age_19_confirmed };
  };
  // 서버 기본 컨텍스트에서 실제로 외부 호출이 열려 있는 공급자(없으면 mock): 상태 표시·구 호환용.
  const providerName = ['dialogue.next', 'claims.extract'].map((op) => caller.plan(op, requestContext(null))).find((p) => p.live)?.provider || 'mock';
  const provider = { name: providerName };
  const adminEnabled = !!config.adminToken;

  // ---- 관리자 인증 ----
  // ADMIN_TOKEN 미설정이면 관리 기능 전체가 꺼진다. 토큰은 x-admin-token 헤더로만 받는다.
  async function checkAdmin(req) {
    if (!adminEnabled) return err('admin_disabled', '관리자 기능이 꺼져 있습니다. 서버에 ADMIN_TOKEN을 설정해야 사용할 수 있습니다.', 403);
    const got = String(req.headers.get('x-admin-token') || '');
    if (!got || !(await safeEqual(got, config.adminToken))) {
      return err('admin_forbidden', '관리자 인증이 필요합니다. x-admin-token을 확인하세요.', 403);
    }
    return null;
  }
  const auth = (req) => {
    const h = req.headers.get('authorization') || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m) return null;
    return config.devTokens[m[1]] || null;
  };
  const priceOf = (model, usage) => {
    const p = config.geminiPricing[model];
    if (!p) return 0;
    if (p.perMinute) return ((usage.billedSeconds || 0) / 60) * p.perMinute;
    return ((usage.input || 0) * p.input + (usage.output || 0) * p.output) / 1e6;
  };
  const providerInfo = () => ({
    routes: Object.fromEntries(registry.operations().map((op) => [op, registry.route(op).provider])),
    selected: provider.name,
    configured: !!config.gemini.apiKey,
    paidAck: config.gemini.paidAck,
    allowUnpaid: config.gemini.allowUnpaid,
    freeOnly: config.gemini.freeOnly !== false,
    adminEnabled,
    trends: trends?.status ? trends.status() : null,
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

  // ---- 핸들러 조립 ----
  const checkRate = (owner, bucket) => {
    const lim = config.rateLimits[bucket];
    const c = store.recordRate(owner, bucket);
    if (c.minute > lim.perMinute || c.day > lim.perDay) return err('quota_exceeded', '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429, { retryable: true, details: { bucket, minute: c.minute, day: c.day, limit_minute: lim.perMinute, limit_day: lim.perDay } });
    return null;
  };
  const d = { config, store, ledger, trends, err, now, priceOf, provider, providerInfo, syntheticTraffic, gemini, groq, killed, killedGroq, adminEnabled, checkAdmin, mock, registry, caller, requestContext, checkRate };
  const sessions = createSessionHandlers(d);
  d.publicSession = sessions.publicSession;
  const admin = createAdminHandlers(d);
  d.parseTrendId = admin.parseTrendId;
  const handlers = {
    sessions,
    profiles: createProfileHandlers(d),
    consents: createConsentHandlers(d),
    commands: createCommandHandlers(d),
    feedback: createFeedbackHandlers(d),
    transfer: createTransferHandlers(d),
    account: createAccountHandlers(d),
    documents: createDocumentHandlers(d),
    admin,
    stt: createSttHandlers(d),
    ops: createOpsHandlers(d),
  };
  const requestLog = [];
  const fetch = createFetchHandler({ store, auth, handlers, requestLog });

  return {
    fetch, config, store, ledger, providerInfo, providerName, handlers,
    // 실제로 사용된 공급자 통계(운영 진단)
    providerStats() { return gemini?.stats || null; },
  };
}
