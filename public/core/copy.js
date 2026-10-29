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
