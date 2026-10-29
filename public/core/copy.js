// ---- 공통 표시 ----
export const DIM_LABEL = {
  relevance: '질문 적합성',
  evidence_specificity: '경험·근거 구체성',
  reasoning: '논리·판단',
  reflection: '성찰·전이',
  concept_clarity: '개념 설명 명확성',
  applicability: '적용·실행 계획',
  claim_understanding: '주장 이해',
  evidence_use: '근거 활용',
  rebuttal: '반박',
  collaboration: '협의 과정',
  structure: '구성',
  execution_plan: '실행 계획',
  qa_response: '질의응답',
  role_understanding: '역할 이해',
  responsiveness: '상황 대응',
};
export const dimLabel = (id) => DIM_LABEL[id] || id;
export const TYPE_LABEL = {
  general: '일반·인성', technical: '직무·기술', discussion: '토론', pt: 'PT', situational: '상황·역할극', panel: '패널',
};
export const typeLabel = (id) => TYPE_LABEL[id] || id || '일반·인성';

export function rubricNote(t) {
  return ({
    discussion: '토론은 주장 이해·근거·반박·협의 과정을 봅니다. 발언 기회가 부족한 차원은 공개하지 않습니다.',
    pt: 'PT는 구성·근거·실행 계획·질의응답을 봅니다. 준비 단계의 메모는 평가하지 않습니다.',
    situational: '상황 면접은 역할·제약 이해, 상황 대응, 판단, 성찰을 봅니다.',
    technical: '기술 면접은 개념 설명·근거·판단·적용 계획을 봅니다. 정답 암기 여부는 평가하지 않습니다.',
  }[t] || '일반·패널 면접은 질문 적합성·근거·판단·성찰을 봅니다.');
}

// ---- 고정 문구 (06 §6) ----
export const FIXED = {
  evaluator: '규칙 기반 참고 관찰',
  mockMode: 'Mock 모드 · 외부 전송 없음',
  abstain: '판단 보류',
  synthetic: '합성 샘플',
  noLieJudge: '거짓 여부를 판정하지 않습니다',
  singleCompare: '단일 재연습 비교는 학습 효과를 입증하지 않습니다',
  fallback: 'AI 응답을 받지 못해 기본 질문으로 이어갑니다.',
};

// ---- 출처 상태 라벨 (06 §6, 고정) ----
export const SOURCE_STATUS = {
  official_verified: { label: '공식 자료 확인', tone: 'ok', icon: '✓', hint: '서버가 공식 도메인에서 수집·발췌 확인(수집기 구현 후에만 사용)' },
  user_supplied: { label: '사용자 제공', tone: 'info', icon: '✎', hint: '직접 입력·업로드. 진위 미확인' },
  monthly_trend: { label: '월간 트렌드(보조)', tone: 'neutral', icon: '≈', hint: '관리자 검수 자료. 기관 공식 요구가 아님' },
  unverified: { label: '확인되지 않음', tone: 'warn', icon: '?', hint: '근거 부족' },
  unavailable: { label: '수집 실패', tone: 'error', icon: '✕', hint: '접속 불가·거절·시간 초과' },
  stale: { label: '오래된 자료', tone: 'warn', icon: '⏱', hint: '365일 초과 등' },
  conflict: { label: '내용 충돌', tone: 'error', icon: '≠', hint: '서로 다른 값 — 어느 쪽도 사실로 단정하지 않음' },
};

// ---- provider_trace reason -> 한국어 (03 §4) ----
export const REASON_COPY = {
  rate_limited: '요청 한도에 도달해 기본 동작으로 대체했습니다.',
  timeout: '응답이 늦어 기본 동작으로 대체했습니다.',
  invalid_output: '응답 형식이 올바르지 않아 기본 동작으로 대체했습니다.',
  budget_cap: '사용 한도에 도달해 외부 AI를 사용하지 않습니다.',
  kill_switch: '관리자가 외부 AI 사용을 중지했습니다.',
  not_configured: '외부 AI가 설정되지 않아 Mock으로 동작합니다.',
  live_ack_missing: '외부 AI 사용 확인이 없어 Mock으로 동작합니다.',
  real_data_ack_missing: '실제 지원 자료의 외부 전송 확인이 없어 사용하지 않습니다.',
  consent_missing: '동의가 없어 외부 AI를 사용하지 않습니다.',
  synthetic_only: '합성 샘플에만 외부 AI를 사용할 수 있습니다.',
};
export const reasonCopy = (r) => REASON_COPY[r] || '기본 동작으로 대체했습니다.';

// ---- 금지 표현 (06 §6) ----
export const BANNED_PATTERNS = [
  /합격\s*(가능성|확률|예측)/, /불합격\s*(가능성|확률|예측)/, /정확(히|한)\s*(AI\s*)?(평가|채점)/,
  /순위/, /백분위/, /거짓말\s*탐지/, /(감정|성격|외모)\s*(분석|진단)/, /검증된\s*AI\s*채점/,
];
// 부정 문맥("아닙니다", "하지 않습니다" 등)은 허용한다.
export const NEGATION = /(아닙니다|아님|않습니다|않는|없습니다|금지|하지 않|입증하지)/;
export function containsBannedExpression(text) {
  return String(text ?? '').split(/\n|(?<=[.!?。])\s+/).some((s) => BANNED_PATTERNS.some((p) => p.test(s)) && !NEGATION.test(s));
}
