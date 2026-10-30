// 일반 면접 질문 계획(WP-C8): 세션 생성과 GET /profiles/:id/plan이 같은 함수를 쓴다(계획 == 세션 질문).
// 규칙 기반(generator 'rule'): 지원서 주장 질문(제외 반영) → 기관 추천 → 정적 팩 → (트렌드 1개).
import { buildClaimQuestions } from './claims.js';
import { selectQuestions } from './questions.js';

// 주장 검증 질문을 앞에 붙이고 qCount로 자른다(일반·패널·기술 공용). 질문 수는 늘지 않는다.
export function prependClaimQuestions(questions, version, excludedClaimIds, qCount) {
  const ex = new Set(excludedClaimIds || []);
  const claimQs = buildClaimQuestions((version?.extracted?.applicant_claims || []).filter((c) => !ex.has(c.id)));
  return claimQs.length ? { questions: [...claimQs, ...questions].slice(0, qCount), n: claimQs.length } : { questions, n: 0 };
}

export function planGeneralQuestions({ version, institution, orgType, trends, qCount, seedNum, excludedClaimIds = [], modelQuestions = [], yyyyMm = new Date().toISOString().slice(0, 7) }) {
  const { picked, coverage } = selectQuestions(seedNum, qCount);
  let questions = picked.map((q) => ({ ...q }));
  let question_basis = 'general-template-v1';
  if (institution && !institution.fallback_to_general && Array.isArray(institution.recommended_questions) && institution.recommended_questions.length) {
    const instQs = institution.recommended_questions.slice(0, 2).map((q) => ({
      id: q.id || `inst-${q.primary}`, text: q.text, primary: q.primary, secondary: q.secondary || [],
      followup: q.text.includes('?') ? q.text : undefined,
      followup_dimensions: [q.primary],
      _institution_basis: q.basis, _rationale: q.rationale,
    }));
    questions = [...instQs, ...questions].slice(0, qCount);
    question_basis = institution.badge || '기관 맞춤 검토 가능';
  }
  // 모델 질문(승인 시점 동결, 09 §5.1)은 주장 질문 뒤·기관/정적 질문 앞. 주장 질문은 아래에서 항상 맨 앞에 붙는다.
  if (modelQuestions.length) { questions = [...modelQuestions.map((q) => ({ ...q })), ...questions].slice(0, qCount); question_basis = '학교 분석 기반 질문(모델 생성·참고용)'; }
  const wc = prependClaimQuestions(questions, version, excludedClaimIds, qCount);
  questions = wc.questions;
  if (wc.n) question_basis = `지원서 주장 검증 ${wc.n}건 · ${question_basis}`;
  // 월간 트렌드(보조 기준): 공개본이 있을 때만 끝에 최대 1개.
  const seg = { company: 'company', university: 'university' }[orgType];
  const item = (seg && trends?.published ? trends.published({ segment: seg, yyyyMm }) : null)?.items?.[0];
  if (item) {
    questions = [...questions, {
      id: `trend-${item.id}`, text: `최근 ${item.competency} 역량이 중요하게 언급됩니다. 이 역량을 보여 준 본인의 경험과 구체적 행동을 설명해 주세요.`,
      primary: 'evidence_specificity', secondary: ['relevance'],
      trend_ids: [item.id], source_status: 'monthly_trend', _institution_basis: '월간 트렌드(보조)',
    }];
  }
  return { questions, coverage, question_basis };
}

// 공개용 계획 항목(내부 필드 제외)
export function publicPlanItem(q) {
  const inst = !!q._institution_basis && !q.trend_ids?.length && !q.generator;
  return {
    question_id: q.id, text: q.text, target_competency: q.target_competency || q.primary,
    application_evidence_ids: q.application_evidence_ids || [],
    institution_evidence_ids: q.institution_evidence_ids || (inst ? [q.id] : []),
    trend_ids: q.trend_ids || [],
    ...(q.trend_label ? { trend_label: q.trend_label } : {}),
    source_status: q.source_status || (inst ? 'institution_review' : 'static_pack'),
    generator: q.generator || 'rule', prompt_version: q.prompt_version || null,
    provider_trace: q.provider_trace || { provider: 'mock', mode: 'mock', reason: 'rule_based_no_ai' },
  };
}
