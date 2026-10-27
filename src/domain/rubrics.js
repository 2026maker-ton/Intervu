// 유형별 평가 루브릭 (데모용). 공통 검증기는 이 레지스트리를 사용한다.
// 원칙: 점수 보정이 아닌 관찰 기준. 유효 답변 2개 미만이면 insufficient_evidence.
export const RUBRICS = {
  'behavioral-ko-v1': {
    version: 'behavioral-ko-v1',
    label: '일반·인성 / 상황·패널 공용',
    dimensions: ['relevance', 'evidence_specificity', 'reasoning', 'reflection'],
    anchors: {
      relevance: { 1: '질문과 다른 주장만 함', 2: '일부 관련하나 핵심에 답하지 않음', 3: '핵심 질문에 직접 답함', 4: '핵심과 제한·조건까지 분명히 함' },
      evidence_specificity: { 1: '주장만 있음', 2: '사례가 있으나 역할/행동이 불명확', 3: '본인 행동과 관찰 결과가 구체적', 4: '대안·기여·결과의 한계까지 구별' },
      reasoning: { 1: '결론과 근거 연결이 모순', 2: '이유는 있으나 중요한 연결 생략', 3: '선택 이유와 근거가 연결', 4: '대안·반례·상충 기준을 비교' },
      reflection: { 1: '성찰 질문에 검토 없이 반복', 2: '일반 교훈만 언급', 3: '경험에서 바꿀 행동 설명', 4: '다른 조건에 적용할 기준과 한계 설명' },
    },
    nextAction: {
      relevance: '질문의 핵심 요구를 한 문장으로 먼저 답한 뒤 근거를 덧붙이세요.',
      evidence_specificity: '선택한 행동이 어떤 결과로 이어졌는지 실제 관찰을 덧붙이세요.',
      reasoning: '선택 이유와 버린 대안의 기준을 한 문장씩 비교하세요.',
      reflection: '다음에 바꿀 행동 한 가지와 확인 방법을 말해 주세요.',
    },
    practiceQuestion: {
      relevance: '이번 주에 처리한 일 중 가장 급한 것을 고른 기준을 설명해 주세요.',
      evidence_specificity: '다른 협업 경험에서 본인의 행동과 관찰한 결과를 설명해 주세요.',
      reasoning: '두 가지 방법 중 하나를 고른 이유와 버린 쪽의 단위를 설명해 주세요.',
      reflection: '최근 아쉬웠던 일에서 다음에 다르게 할 한 가지를 설명해 주세요.',
    },
  },
  'technical-ko-v1': {
    version: 'technical-ko-v1',
    label: '직무·기술',
    dimensions: ['concept_clarity', 'evidence_specificity', 'reasoning', 'applicability'],
    anchors: {
      concept_clarity: { 1: '개념을 설명하지 못함', 2: '부분적으로 언급하나 핵심 정의가 불명확', 3: '핵심 개념을 자신의 말로 분명히 설명', 4: '개념의 전제·한계까지 구분해 설명' },
      evidence_specificity: { 1: '주장만 있음', 2: '사례가 있으나 역할/행동이 불명확', 3: '본인 행동과 관찰 결과가 구체적', 4: '대안·기여·결과의 한계까지 구별' },
      reasoning: { 1: '결론과 근거 연결이 모순', 2: '이유는 있으나 중요한 연결 생략', 3: '선택 이유와 근거가 연결', 4: '대안·반례·상충 기준을 비교' },
      applicability: { 1: '적용 방법을 말하지 않음', 2: '일반적 적용만 언급', 3: '구체적 상황에서의 적용 절차 설명', 4: '적용 조건·위험·대안까지 비교' },
    },
    nextAction: {
      concept_clarity: '핵심 개념을 한 문장으로 정의한 뒤, 전제 조건을 덧붙이세요.',
      evidence_specificity: '직접 적용한 사례의 행동과 결과를 덧붙이세요.',
      reasoning: '다른 방법과 비교한 선택 기준을 설명하세요.',
      applicability: '실제 적용 순서와 확인할 지표를 덧붙이세요.',
    },
    practiceQuestion: {
      concept_clarity: '최근 다룬 개념 하나를 전제 조건과 함께 설명해 주세요.',
      evidence_specificity: '그 개념을 적용한 경험의 행동과 결과를 말해 주세요.',
      reasoning: '두 방법 중 하나를 고른 이유와 버린 쪽의 단점을 말해 주세요.',
      applicability: '같은 방법을 다른 조건에 적용할 때 바꿀 점을 말해 주세요.',
    },
  },
  'discussion-ko-v1': {
    version: 'discussion-ko-v1',
    label: '토론',
    dimensions: ['claim_understanding', 'evidence_use', 'rebuttal', 'collaboration'],
    anchors: {
      claim_understanding: { 1: '상대 주장을 왜곡하거나 무시', 2: '부분적으로 언급하나 핵심을 놓침', 3: '상대 주장의 핵심을 정확히 요약', 4: '양측 주장의 전제·차이를 구분해 요약' },
      evidence_use: { 1: '근거 없이 주장만 반복', 2: '근거를 언급하나 출처·관찰이 불명확', 3: '자료·관찰 근거를 연결해 제시', 4: '근거의 한계까지 밝히며 제시' },
      rebuttal: { 1: '반박 없이 동의·회피만 반복', 2: '반박을 시도하나 근거 연결이 약함', 3: '상대 근거에 대한 구체적 반박 제시', 4: '대안·절충안과 함께 반박' },
      collaboration: { 1: '협의 없이 자기 주장만 고수', 2: '양보를 말하나 구체안 없음', 3: '구체적 양보·통합안을 제시', 4: '합의안의 실행 조건까지 제시' },
    },
    nextAction: {
      claim_understanding: '상대 주장의 핵심을 한 문장으로 요약한 뒤 내 입장을 말하세요.',
      evidence_use: '자료의 어떤 부분에 근거하는지 짚어 말하세요.',
      rebuttal: '상대 근거의 약한 연결을 짚고 대안을 제시하세요.',
      collaboration: '양보할 점과 지킬 점을 각각 한 가지씩 말하세요.',
    },
    practiceQuestion: {
      claim_understanding: '상대 입장에서 가장 강한 근거를 요약해 보세요.',
      evidence_use: '자료의 수치·조건 하나를 인용해 주장을 보강해 보세요.',
      rebuttal: '방금 나온 주장에 대한 반박을 근거와 함께 말해 보세요.',
      collaboration: '양측이 합의할 수 있는 한 가지 안을 말해 보세요.',
    },
  },
  'presentation-ko-v1': {
    version: 'presentation-ko-v1',
    label: 'PT (발표)',
    dimensions: ['structure', 'evidence_use', 'execution_plan', 'qa_response'],
    anchors: {
      structure: { 1: '주장·순서가 불명확', 2: '주장은 있으나 구성이 느슨함', 3: '주장·근거·결론이 순서 있게 연결', 4: '핵심 메시지와 분량이 청중 기준으로 정리' },
      evidence_use: { 1: '근거 없이 주장만 반복', 2: '근거 언급은 있으나 연결이 약함', 3: '자료·관찰 근거를 주장과 연결', 4: '근거의 출처·한계까지 명시' },
      execution_plan: { 1: '실행 방안을 말하지 않음', 2: '추상적 계획만 언급', 3: '단계·담당·일정이 구체적', 4: '위험·대안·확인 지표까지 포함' },
      qa_response: { 1: '질문에 답하지 않음', 2: '부분적으로 답하나 핵심을 비껴감', 3: '질문의 핵심에 직접 답변', 4: '답변의 전제·한계까지 밝힘' },
    },
    nextAction: {
      structure: '결론을 먼저 말하고 근거 2개로 뒷받침하세요.',
      evidence_use: '자료의 어떤 수치·관찰에 근거하는지 명시하세요.',
      execution_plan: '1·2·3단계와 확인할 지표를 덧붙이세요.',
      qa_response: '질문의 전제를 먼저 확인한 뒤 답하세요.',
    },
    practiceQuestion: {
      structure: '같은 내용을 결론부터 1분으로 다시 구성해 보세요.',
      evidence_use: '주장을 뒷받침하는 근거 하나를 출처와 함께 보강해 보세요.',
      execution_plan: '실행 단계와 위험 대응을 한 가지씩 덧붙여 보세요.',
      qa_response: '예상 반론 하나에 대한 답변을 준비해 보세요.',
    },
  },
  'situational-ko-v1': {
    version: 'situational-ko-v1',
    label: '상황·역할극',
    dimensions: ['role_understanding', 'responsiveness', 'reasoning', 'reflection'],
    anchors: {
      role_understanding: { 1: '상황의 역할·제약을 파악하지 못함', 2: '부분적으로 파악하나 핵심 제약을 놓침', 3: '역할·제약을 파악하고 대응', 4: '제약·우선순위를 구분해 대응' },
      responsiveness: { 1: '상대 요구를 무시하거나 회피', 2: '형식적 대응에 그침', 3: '상대 요구를 확인하며 단계적으로 대응', 4: '감정·사실·다음 조치를 함께 정리' },
      reasoning: { 1: '결론과 근거 연결이 모순', 2: '이유는 있으나 중요한 연결 생략', 3: '선택 이유와 근거가 연결', 4: '대안·반례·상충 기준을 비교' },
      reflection: { 1: '성찰 질문에 검토 없이 반복', 2: '일반 교훈만 언급', 3: '경험에서 바꿀 행동 설명', 4: '다른 조건에 적용할 기준과 한계 설명' },
    },
    nextAction: {
      role_understanding: '내 역할과 지킬 제약을 먼저 말한 뒤 대응하세요.',
      responsiveness: '상대 말을 한 문장으로 확인한 뒤 다음 조치를 말하세요.',
      reasoning: '그 대응을 택한 이유와 버린 대안을 비교하세요.',
      reflection: '다음에 바꿀 대응 한 가지를 말하세요.',
    },
    practiceQuestion: {
      role_understanding: '비슷한 상황에서 지킬 원칙을 먼저 말해 보세요.',
      responsiveness: '화난 고객의 말을 확인하는 한 문장을 말해 보세요.',
      reasoning: '두 대응 중 하나를 고른 이유를 말해 보세요.',
      reflection: '이번 대응에서 다음에 바꿀 점을 말해 보세요.',
    },
  },
};

export function getRubric(version) {
  return RUBRICS[version] || RUBRICS['behavioral-ko-v1'];
}

export function rubricForInterviewType(interviewType) {
  switch (interviewType) {
    case 'technical': return 'technical-ko-v1';
    case 'discussion': return 'discussion-ko-v1';
    case 'pt': return 'presentation-ko-v1';
    case 'situational': return 'situational-ko-v1';
    default: return 'behavioral-ko-v1';
  }
}

export const DIM_LABEL_KO = {
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
