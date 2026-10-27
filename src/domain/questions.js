// 검수 초안 질문 팩 (원본 작성, 기출 아님). packs/general-entry-ko v0.1.0-draft
export const PACK = {
  pack_id: 'general-entry-ko',
  version: '0.1.0-draft',
  status: 'draft',
  rights: 'original',
  questions: [
    { id: 'q1', text: '갈등을 해결한 경험에서 본인의 행동과 결과를 설명해 주세요.', primary: 'evidence_specificity', secondary: ['relevance', 'reasoning'], followup: '다시 한다면 무엇을 바꾸겠습니까?', followup_dimensions: ['reflection'] },
    { id: 'q2', text: '제한된 시간에 우선순위를 정한 경험과 다른 선택을 하지 않은 이유를 설명해 주세요.', primary: 'reasoning', secondary: ['relevance', 'evidence_specificity'] },
    { id: 'q3', text: '예상과 달랐던 결과에서 배운 점과 다음에 바꾼 행동을 설명해 주세요.', primary: 'reflection', secondary: ['evidence_specificity', 'relevance'] },
    { id: 'q4', text: '고객 요구와 내부 기준이 충돌하면 무엇을 확인하고 어떻게 결정하겠습니까?', primary: 'reasoning', secondary: ['relevance'] },
    { id: 'q5', text: '앞선 경험의 교훈을 새로운 팀에 적용할 때 무엇을 유지하고 무엇을 바꾸겠습니까?', primary: 'reflection', secondary: ['reasoning', 'relevance'] },
    { id: 'q6', text: '협업 중 의견이 엇갈렸을 때 본인이 제시한 대안과 선택 기준을 말해 주세요.', primary: 'evidence_specificity', secondary: ['reasoning', 'relevance'] },
    { id: 'q7', text: '모호한 요구를 받았을 때 확인한 내용과 실행 순서를 설명해 주세요.', primary: 'relevance', secondary: ['reasoning', 'evidence_specificity'] },
    { id: 'q8', text: '실패하거나 부족했던 경험 이후에 바꾼 구체적인 행동을 설명해 주세요.', primary: 'reflection', secondary: ['evidence_specificity'] },
  ],
};

export function selectQuestions(seed = 1, count = 5) {
  // 결정적 선택 + 중첩 커버리지(각 차원 2회 이상 기회)
  const qs = [...PACK.questions];
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  // Fisher-Yates with seeded rnd
  for (let i = qs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [qs[i], qs[j]] = [qs[j], qs[i]];
  }
  const picked = qs.slice(0, count);
  // 커버리지 확인: 4차원이 각각 2회 이상 등장(primary+secondary+followup)하는지
  const cov = { relevance: 0, evidence_specificity: 0, reasoning: 0, reflection: 0 };
  for (const q of picked) {
    cov[q.primary] = (cov[q.primary] || 0) + 1;
    for (const d of q.secondary || []) cov[d] = (cov[d] || 0) + 1;
    for (const d of q.followup_dimensions || []) cov[d] = (cov[d] || 0) + 1;
  }
  return { picked, coverage: cov };
}

export const FOLLOWUPS = {
  missing_personal_action: '그 과정에서 본인이 직접 한 행동을 한 가지 설명해 주세요.',
  missing_evidence: '그때 확인한 근거(수치·관찰·기록)를 한 가지 덧붙여 주세요.',
  missing_reason: '그 대안을 택하지 않은 이유는 무엇인가요?',
  missing_result: '그 행동 이후에 관찰된 결과를 한 문장으로 말해 주세요.',
  missing_reflection: '그 경험에서 다음에 바꿀 행동 한 가지를 말해 주세요.',
  unclear: '답변이 잘 들리지 않았습니다. 핵심 행동 한 가지를 다시 말해 주세요.',
};

export function followupReasonFor(text = '') {
  const t = text.replace(/\s/g, '');
  if (t.length < 8) return 'unclear';
  if (!/(제가|저는|본인|제가 직접)/.test(text)) return 'missing_personal_action';
  if (!/(이유|근거|기준|왜냐|때문)/.test(text)) return 'missing_reason';
  if (!/(결과|바뀌|달라|관찰|제출|완료)/.test(text)) return 'missing_result';
  return 'missing_reflection';
}
