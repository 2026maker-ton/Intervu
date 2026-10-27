// 면접관 역할(role) × 성향(persona) 분리.
// 역할 = 질문의 초점·꼬리질문 전략. 성향 = 말투·질문 강도.
// 평가 기준은 역할·성향과 무관하게 고정 (임의로 달라지지 않음).
export const ROLES = {
  hr: {
    label: 'HR·인사 담당',
    focus: '지원동기·조직 적합·협업 경험',
    strategy: '경험의 맥락(역할·기간·갈등 해결 방식)을 확인하는 꼬리질문을 우선한다.',
    sample_open: '우리 기관에 지원한 이유와 팀에서 일한 경험을 설명해 주세요.',
  },
  practitioner: {
    label: '현업 실무자',
    focus: '직무 수행 과정·우선순위·실행 결과',
    strategy: '실행 순서·대안 비교·결과 관찰 여부를 파고든다.',
    sample_open: '실무에서 우선순위를 정해 실행한 경험을 과정 중심으로 설명해 주세요.',
  },
  expert: {
    label: '기술·전공 면접관',
    focus: '전문 지식의 적용·판단 근거',
    strategy: '선택 이유와 버린 대안의 기준을 검증한다. 정답을 단정하지 않는다.',
    sample_open: '전공·직무 지식을 적용해 판단한 경험을 근거와 함께 설명해 주세요.',
  },
  executive: {
    label: '관리자·임원',
    focus: '판단·책임·장기 관점',
    strategy: '상충하는 기준·장기 영향을 묻는다. 압박·인격 평가는 금지.',
    sample_open: '어려운 결정을 내린 경험과 그 판단의 기준을 설명해 주세요.',
  },
  admissions: {
    label: '입학전형위원',
    focus: '지원동기·학업계획·전형 평가요소',
    strategy: '지원동기-학업계획-활동의 일관성을 확인한다. 비공개 배점은 언급하지 않는다.',
    sample_open: '이 학과(학교)에 지원한 이유와 학업계획을 설명해 주세요.',
  },
  teacher: {
    label: '전공 담당 교사',
    focus: '학습 과정·탐구·성장',
    strategy: '학습 방법·깨달음·다음 계획을 묻는다.',
    sample_open: '가장 몰입했던 학습·탐구 경험과 배운 점을 설명해 주세요.',
  },
};

export const ROLE_IDS = Object.keys(ROLES);

// 성향은 말투·강도만 조절. 평가 루브릭은 동일하다.
export const PERSONA_TONE = {
  supportive: { label: '친절형', instruction: '차분히 재표현하고 기다린다. 답안을 대신 말하지 않는다.' },
  standard: { label: '일반형', instruction: '중립적으로 묻는다.' },
  challenging: { label: '논리검증형', instruction: '대안·모순·근거를 검증한다. 모욕·인신공격·출신 질문은 금지.' },
};

export function normalizeRole(raw, orgType = 'general') {
  if (raw && ROLES[raw]) return raw;
  // 기관별 기본값: 학교 → 입학전형위원, 그 외 → 현업 실무자
  const t = String(orgType || '').toLowerCase();
  if (t === 'university' || t === 'highschool') return 'admissions';
  return 'practitioner';
}

// 역할별 꼬리질문 전략: followupReason → 역할 맞춤 문장
const ROLE_FOLLOWUP = {
  hr: {
    missing_personal_action: '팀에서 본인이 맡은 역할과 갈등을 풀기 위해 한 일을 설명해 주세요.',
    missing_evidence: '그때 팀과 공유한 기록이나 합의 내용을 덧붙여 주세요.',
    missing_reason: '그 방식을 택한 이유를 조직 관점에서 설명해 주세요.',
    missing_result: '그 이후 팀의 일하는 방식에 어떤 변화가 있었나요?',
    missing_reflection: '다음에 팀으로 일한다면 바꿀 점 한 가지를 말해 주세요.',
    unclear: '팀 경험에서 본인이 한 일을 한 가지 다시 말해 주세요.',
  },
  practitioner: {
    missing_personal_action: '실행 과정에서 본인이 직접 한 일을 단계별로 설명해 주세요.',
    missing_evidence: '판단할 때 확인한 수치·기록·관찰을 한 가지 덧붙여 주세요.',
    missing_reason: '그 대안을 택하지 않은 이유는 무엇인가요?',
    missing_result: '실행 후 관찰된 결과를 한 문장으로 말해 주세요.',
    missing_reflection: '같은 일을 다시 한다면 실행 순서를 어떻게 바꾸겠습니까?',
    unclear: '실행 과정에서 핵심 행동 한 가지를 다시 말해 주세요.',
  },
  expert: {
    missing_personal_action: '본인이 적용한 지식·방법과 맡은 부분을 설명해 주세요.',
    missing_evidence: '판단의 근거가 된 자료·기준을 한 가지 덧붙여 주세요.',
    missing_reason: '다른 방법과 비교해 이 방법을 택한 기준은 무엇인가요?',
    missing_result: '적용 결과 확인한 점을 한 문장으로 말해 주세요.',
    missing_reflection: '그 판단을 일반화할 때의 한계를 말해 주세요.',
    unclear: '적용한 방법의 핵심 한 가지를 다시 말해 주세요.',
  },
  executive: {
    missing_personal_action: '결정 과정에서 본인이 책임진 부분을 설명해 주세요.',
    missing_evidence: '결정할 때 확인한 사실관계를 한 가지 덧붙여 주세요.',
    missing_reason: '상충하는 기준 중 무엇을 우선한 이유는 무엇인가요?',
    missing_result: '그 결정의 장기 영향을 한 문장으로 말해 주세요.',
    missing_reflection: '다음에 같은 결정을 한다면 무엇을 달리하겠습니까?',
    unclear: '결정의 핵심 한 가지를 다시 말해 주세요.',
  },
  admissions: {
    missing_personal_action: '지원 과정에서 본인이 직접 준비·실천한 일을 설명해 주세요.',
    missing_evidence: '학업·활동의 구체적 기록(기간·역할·결과)을 덧붙여 주세요.',
    missing_reason: '이 학과를 택한 이유를 진로계획과 연결해 설명해 주세요.',
    missing_result: '그 활동 이후에 달라진 점을 한 문장으로 말해 주세요.',
    missing_reflection: '입학 후 학습계획에서 먼저 실천할 일 한 가지를 말해 주세요.',
    unclear: '지원동기와 관련된 본인 경험 한 가지를 다시 말해 주세요.',
  },
  teacher: {
    missing_personal_action: '학습 과정에서 본인이 시도한 방법을 설명해 주세요.',
    missing_evidence: '학습 기록(노트·결과물·피드백)을 한 가지 덧붙여 주세요.',
    missing_reason: '그 방법을 택한 이유를 설명해 주세요.',
    missing_result: '학습 후 이해가 달라진 점을 한 문장으로 말해 주세요.',
    missing_reflection: '다음 학습에서 바꿀 방법 한 가지를 말해 주세요.',
    unclear: '가장 몰입했던 학습 한 가지를 다시 말해 주세요.',
  },
};

export function followupForRole(role, reason, fallback) {
  const table = ROLE_FOLLOWUP[role] || {};
  return table[reason] || fallback;
}

export function roleOpening(role, institutionQuestion) {
  if (institutionQuestion) return institutionQuestion;
  return (ROLES[role] || ROLES.practitioner).sample_open;
}
