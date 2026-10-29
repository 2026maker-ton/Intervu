// 일반화된 공급자 게이트(04 §2). 순수 함수: 외부 호출 허용 여부와 차단 사유만 계산한다.
// 요청 본문의 synthetic/free_test 등은 읽지 않는다. ctx는 서버가 만든 값뿐이다(ctx.synthetic은 서버 판정 훅).
//   live = provider≠mock ∧ !kill ∧ 키·BASE_URL·MODEL ∧ LIVE_ACK ∧ (synthetic ∨ (REAL_DATA_ACK ∧ consent ∧ age_19)) ∧ (예산은 call.js)
export function evaluateGate({ provider, gate, killed, ctx = {} }) {
  if (provider === 'mock') return { live: false, reason: null };
  if (ctx.forceMock) return { live: false, reason: 'highschool_mock' };
  if (killed) return { live: false, reason: 'kill_switch' };
  if (!gate || !gate.apiKey || !gate.baseUrl || !gate.model) return { live: false, reason: 'not_configured' };
  if (!gate.liveAck) return { live: false, reason: 'live_ack_missing' };
  if (ctx.synthetic === true) return { live: true, reason: null };
  // 실데이터: 구 PAID_ACK(운영자 약관·DPA 확인)는 동의 절차가 생기기 전 호환 경로로만 허용한다.
  if (gate.legacyRealData) return { live: true, reason: null };
  if (!gate.realDataAck) return { live: false, reason: gate.syntheticOnly ? 'synthetic_only' : 'real_data_ack_missing' };
  if (!ctx.consent || !ctx.age19) return { live: false, reason: 'consent_missing' };
  return { live: true, reason: null };
}
