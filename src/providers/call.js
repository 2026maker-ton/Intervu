// 공통 호출 래퍼(04 §3). 게이트 → 예산 예약 → 어댑터 호출(타임아웃·1회 재시도) → 출력 검증 → 정산 → { value, trace }.
// 폴백은 항상 mock/정적 결과이고 다른 유료 공급자로 자동 전환하지 않는다. 본문·키를 로그에 남기지 않는다.
// Web 표준만 사용한다(Workers 이식).
import { evaluateGate } from './gate.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 이 사유는 오류가 아니라 정상적인 mock 처리이므로 mode를 'mock'으로 표기한다(blocked 배너를 띄우지 않는다).
const MOCK_REASONS = new Set(['not_configured', 'highschool_mock']);

function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('provider timeout'), { code: 504, timeout: true })), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export function reasonOf(e) {
  if (e?.invalid) return 'invalid_output';
  if (e?.code === 429) return 'rate_limited';
  if (e?.timeout || e?.code === 504) return 'timeout';
  return 'provider_error';
}

// registry: createRegistry 결과. adapters: {mock, gemini, groq}. killed: Set<provider>. gates: config.providerGate. timeouts: {provider: ms}
export function createCaller({ registry, gates, killed = new Set(), adapters, ledger, priceOf = () => 0, timeouts = {}, sleepFn = sleep }) {
  function plan(operation, ctx = {}) {
    const route = registry.route(operation);
    const g = evaluateGate({ provider: route.provider, gate: gates[route.provider], killed: killed.has(route.provider), ctx });
    let mode = 'mock';
    if (g.live) mode = 'live';
    else if (g.reason && !MOCK_REASONS.has(g.reason)) mode = 'blocked';
    return { operation, route, live: g.live, reason: g.reason, mode, provider: g.live ? route.provider : 'mock' };
  }

  async function call(operation, { ctx = {}, invoke, mock, fallback, validate, reserve, passthrough, mockAlias = 'mock' } = {}) {
    const p = plan(operation, ctx);
    const t0 = Date.now();
    const trace = (provider, mode, reason, alias) => ({ operation, provider, mode, reason: reason || null, model_alias: alias, latency_ms: Date.now() - t0 });
    const useMock = async (mode, reason) => ({ value: await (mock || fallback)(), trace: trace('mock', mode, reason, mockAlias), live: false });
    if (!p.live) return useMock(p.mode, p.reason);
    // 폴백(장애 후): 정적 결과. 별도 지정이 없으면 mock 결과.
    const fail = async (reason) => ({ value: await (fallback || mock)(), trace: trace('mock', 'fallback', reason, mockAlias), live: false });

    const adapter = adapters[p.provider];
    const amount = reserve?.amount || 0;
    if (amount > 0) {
      try { ledger.reserve(reserve.key, amount); } catch { return useMock('blocked', 'budget_cap'); }
    }
    let settled = false;
    const settle = (cost, unknown = false) => {
      if (amount <= 0 || settled) return;
      settled = true;
      try { ledger.settle(reserve.key, amount, cost, { unknown }); } catch { /* 원장 오류가 응답을 깨지 않게 한다 */ }
    };
    const outerMs = (timeouts[p.provider] || 12000) * 2 + 6000; // 어댑터 재시도·429 대기(≤5s)를 포함하는 안전 상한
    let out;
    try {
      for (let n = 0; ; n++) {
        try {
          out = await withTimeout(invoke(adapter), outerMs);
          break;
        } catch (e) {
          // 어댑터가 이미 대체 모델로 재시도했으면(attempts>=2) 다시 시도하지 않는다. 재시도는 총 1회.
          if (n === 0 && e?.retryable && !(e.attempts >= 2)) {
            if (e.code === 429) await sleepFn(Math.min(Number.isFinite(e.retryAfter) ? e.retryAfter : 2, 5) * 1000);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      // 429는 과금 없음(0 정산), 호출자 입력 오류(passthrough)도 0, 결과 불명(타임아웃·5xx)은 unknown 유지
      const noCharge = e?.code === 429 || (passthrough && passthrough(e));
      settle(noCharge ? 0 : amount, !noCharge && (!e?.code || e.code >= 500));
      if (passthrough && passthrough(e)) throw e;
      return fail(reasonOf(e));
    }
    settle(priceOf(out?.model, out?.usage || {}));
    if (validate && !validate(out)) return fail('invalid_output');
    return { value: out, trace: trace(p.provider, 'live', null, p.route.alias), live: true };
  }

  return { plan, call };
}
