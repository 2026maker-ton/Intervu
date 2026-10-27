// 예산 원장: 호출 단위 예약→정산. unknown 비용은 자동 반환하지 않는다.
export function createLedger({ sessionHardCap, monthlyApiBudget }) {
  const state = {
    monthlySpent: 0,
    monthlyReserved: 0,
    sessions: new Map(), // sessionId -> {reserved, settled, unknown, calls}
  };
  const empty = () => ({ reserved: 0, settled: 0, unknown: 0, calls: 0 });
  function monthlyAvailable() {
    return monthlyApiBudget - state.monthlySpent - state.monthlyReserved;
  }
  function canAfford(sessionId, amount) {
    const s = state.sessions.get(sessionId) || empty();
    return s.reserved + s.settled + s.unknown + amount <= sessionHardCap + 1e-12
      && state.monthlyReserved + state.monthlySpent + amount <= monthlyApiBudget + 1e-12;
  }
  function reserve(sessionId, amount) {
    if (!(amount > 0)) throw Object.assign(new Error('invalid amount'), { code: 422 });
    if (!canAfford(sessionId, amount)) {
      const s = state.sessions.get(sessionId) || empty();
      const reason = s.reserved + s.settled + s.unknown + amount > sessionHardCap + 1e-12
        ? 'session budget exceeded' : 'monthly budget exceeded';
      throw Object.assign(new Error(reason), { code: 429, retryable: true });
    }
    const s = state.sessions.get(sessionId) || empty();
    s.reserved += amount;
    state.monthlyReserved += amount;
    state.sessions.set(sessionId, s);
    return { reserved: s.reserved };
  }
  function settle(sessionId, reservedAmount, actualCost, { unknown = false } = {}) {
    const s = state.sessions.get(sessionId);
    if (!s) throw Object.assign(new Error('no reservation'), { code: 409 });
    const release = Math.min(reservedAmount, s.reserved);
    s.reserved -= release;
    state.monthlyReserved = Math.max(0, state.monthlyReserved - release);
    if (unknown) {
      // 성공 여부 불명: 예약 전액을 unknown 비용으로 유지(자동 반환 금지)
      s.unknown += release;
      state.monthlySpent += release;
    } else {
      s.settled += Math.max(0, actualCost);
      state.monthlySpent += Math.max(0, actualCost);
    }
    return s;
  }
  function recordCall(sessionId) {
    const s = state.sessions.get(sessionId) || empty();
    s.calls += 1;
    state.sessions.set(sessionId, s);
    return s.calls;
  }
  function usage(sessionId) {
    return state.sessions.get(sessionId) || empty();
  }
  return { state, reserve, settle, recordCall, usage, monthlyAvailable, canAfford };
}

export function estimateTokens(text = '') {
  // 보수적 추정: 한국어 1자 ≈ 2.5 토큰 (사전 차단용 상한 추정치)
  return Math.ceil([...String(text)].length * 2.5);
}
