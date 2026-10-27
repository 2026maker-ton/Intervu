// PT / 역할극 / 패널 시나리오 뱅크 (검수된 데모용 합성 자료 — 기출 아님)
// 모든 수치·제약은 연습용 가정이며 보고서에 그대로 표시한다.
export const PT_TASKS = [
  {
    id: 'pt-library',
    title: '도서관 주말 프로그램 기획안',
    brief: '과제 (연습용 가정): 한정된 예산 1단위·기간 3개월·인력 2명으로 주말 프로그램 1개를 기획하세요. 성공 기준은 (가정) 참여 50명·만족도 설문 회수율 60%입니다.',
    prepare_seconds: 180,
    present_seconds: 180,
    qa_count: 2,
    qa_bank: [
      '예산이 절반으로 줄면 무엇을 먼저 조정하겠습니까?',
      '참여가 목표의 절반에 그치면 다음 달에 무엇을 바꾸겠습니까?',
    ],
  },
  {
    id: 'pt-onboarding',
    title: '신입 온보딩 개선안',
    brief: '과제 (연습용 가정): 신입 5명이 2주 안에 실무에 투입되도록 온보딩 계획을 세우세요. 제약은 (가정) 멘토 2명·교육 시간 주 4시간입니다.',
    prepare_seconds: 180,
    present_seconds: 180,
    qa_count: 2,
    qa_bank: [
      '멘토 1명이 이탈하면 계획을 어떻게 조정하겠습니까?',
      '교육 효과가 낮게 나오면 무엇을 먼저 확인하겠습니까?',
    ],
  },
];

export const SITUATION_SCENARIOS = [
  {
    id: 'sit-angry-customer',
    title: '화난 고객 응대',
    opening: '역할극을 시작합니다. 저는 화가 난 고객입니다. “어제 신청한 서류가 아직 안 왔어요. 오늘 꼭 필요한데 어떻게 된 거예요?” — 먼저 상황을 확인하고 다음 조치를 말해 보세요.',
    followups: [
      '“말로만 하지 말고 지금 당장 되는 방법을 말해 보세요.” — 구체적 다음 조치를 제시해 보세요.',
      '“그 방법도 안 되면요?” — 대안을 한 가지 더 제시해 보세요.',
    ],
    rubric_hint: 'role_understanding·responsiveness 중심',
  },
  {
    id: 'sit-team-conflict',
    title: '팀 갈등 중재',
    opening: '역할극을 시작합니다. 저는 마감 방식을 두고 다투는 팀원입니다. “A는 오늘 끝내자고 하고, B는 내일 하자고 해요. 당신은 어떻게 하겠어요?” — 중재안을 말해 보세요.',
    followups: [
      '“둘 다 자기 말이 맞다고 해요.” — 판단 기준을 제시해 보세요.',
      '“합의가 안 되면요?” — 다음 확인할 절차를 말해 보세요.',
    ],
    rubric_hint: 'reasoning·collaboration 중심',
  },
  {
    id: 'sit-sudden-change',
    title: '돌발 일정 변경',
    opening: '역할극을 시작합니다. 저는 발표 30분 전 일정을 바꾼 담당자입니다. “죄송하지만 발표 순서를 앞으로 당겨야 해요.” — 우선 확인할 것과 대응을 말해 보세요.',
    followups: [
      '“자료가 아직 안 됐어요.” — 지금 할 수 있는 최소 조치를 말해 보세요.',
      '“다른 팀도 같은 요구를 해요.” — 우선순위 기준을 말해 보세요.',
    ],
    rubric_hint: 'role_understanding·reasoning 중심',
  },
];

export const TECHNICAL_QUESTIONS = [
  { id: 't1', text: '지원 직무에서 가장 자신 있는 개념 하나를 전제 조건과 함께 설명해 주세요.', primary: 'concept_clarity', secondary: ['reasoning'] },
  { id: 't2', text: '그 개념을 실제 업무·과제에 적용한 경험을 과정 중심으로 설명해 주세요.', primary: 'evidence_specificity', secondary: ['applicability'] },
  { id: 't3', text: '두 가지 방법 중 하나를 고른 경험에서 선택 기준과 버린 쪽의 단점을 설명해 주세요.', primary: 'reasoning', secondary: ['concept_clarity'] },
  { id: 't4', text: '같은 방법을 조건이 다른 곳에 적용한다면 무엇을 바꾸고 무엇을 유지하겠습니까?', primary: 'applicability', secondary: ['reasoning'] },
];

export const PANEL_PRESETS = {
  default: ['hr', 'practitioner', 'executive'],
  tech: ['practitioner', 'expert', 'executive'],
  school: ['admissions', 'teacher'],
};

export function pickScenario(list, seed = 1) {
  if (!list.length) return null;
  return list[(seed >>> 0) % list.length];
}
