// Transfer check: baseline answer → NEW question (same competency) → comparison.
// PROJECT.md §2.7: 같은 역량의 새로운 질문, 같은 루브릭 버전, 두 시도 독립 보관,
// 근거 부족 시 판단 보류. 키워드 주입·표절성 paraphrase를 방지한다.
import { getRubric } from './rubrics.js';

const MIN_QUESTION_CHARS = 12;

// 기준 답변과 같은 역량, 그러나 문면이 다른 새 질문을 만든다.
// - 기존 질문 텍스트와 정규화 유사도가 높으면 거부한다 (단순 paraphrase 금지).
// - 이전 답변 문장을 그대로 재사용할 수 없는 조건을 질문에 포함한다.
export function generateTransferQuestion({ competency, baselineQuestion, baselineAnswer = '', evidenceRefs = [], sourceStatus = 'user_supplied', promptVersion = 'transfer-ko-v1' }) {
  if (!competency) throw Object.assign(new Error('competency required'), { code: 422 });
  const base = String(baselineQuestion || '').trim();
  if ([...base].length < MIN_QUESTION_CHARS) throw Object.assign(new Error('baseline question too short'), { code: 422 });
  const templates = transferTemplatesFor(competency);
  const picked = pickDissimilar(templates, base);
  if (!picked) throw Object.assign(new Error('no distinct transfer question available'), { code: 409 });
  const prior = String(baselineAnswer || '').slice(0, 60);
  return {
    id: `transfer-${competency}-${Math.random().toString(16).slice(2, 8)}`,
    target_competency: competency,
    text: picked,
    baseline_question: base,
    baseline_excerpt: prior,
    application_evidence_ids: Array.isArray(evidenceRefs) ? evidenceRefs.slice(0, 5) : [],
    source_status: sourceStatus,
    prompt_version: promptVersion,
    // 새 질문이 이전 답변을 베껴 쓸 수 없도록 명시한다.
    novelty_guard: '이전 답변과 같은 사례를 반복하지 말고, 다른 상황·다른 선택을 설명하세요.',
  };
}

function normalizeQ(s) {
  return String(s || '').normalize('NFC').replace(/[\s?,.!…。!?·"“”'’]+/g, '').toLowerCase();
}

// 토큰 Jaccard 유사도: 0.55 이상이면 같은 질문의 paraphrase로 본다.
export function questionSimilarity(a, b) {
  const ta = new Set([...normalizeQ(a)].map((c, i, arr) => arr.slice(i, i + 2).join('')));
  const tb = new Set([...normalizeQ(b)].map((c, i, arr) => arr.slice(i, i + 2).join('')));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function pickDissimilar(templates, base) {
  const ranked = templates
    .map((t) => ({ t, sim: questionSimilarity(t, base) }))
    .filter((x) => x.sim < 0.55)
    .sort((a, b) => a.sim - b.sim);
  return ranked.length ? ranked[0].t : null;
}

// 루브릭 전 차원(행동·기술·토론·PT·상황)별 3개 이상 템플릿. 알 수 없는 역량은 다른 역량 질문으로 대체하지 않고 422.
export const TRANSFER_BANK = {
  relevance: [
    '이번 달에 맡은 일 중 가장 먼저 처리한 일과 그 판단 근거를 설명해 주세요.',
    '상충하는 요청이 동시에 왔을 때 무엇을 먼저 했는지 기준과 함께 말해 주세요.',
    '질문의 핵심과 다른 이야기를 하게 될 때 어떻게 되돌아오는지 예를 들어 설명해 주세요.',
  ],
  evidence_specificity: [
    '다른 협업 경험에서 본인이 직접 한 행동과 관찰된 결과를 설명해 주세요.',
    '최근 프로젝트에서 본인 기여와 팀원 기여를 구분해 설명해 주세요.',
    '수치나 기록으로 확인할 수 있는 본인 행동 사례를 설명해 주세요.',
  ],
  reasoning: [
    '두 가지 방법 중 하나를 고른 이유와 버린 쪽의 단점을 비교해 설명해 주세요.',
    '상충하는 기준 사이에서 우선순위를 정한 경험과 그 판단 근거를 말해 주세요.',
    '처음 판단이 틀렸다고 안 뒤 바꾼 기준을 예를 들어 설명해 주세요.',
  ],
  reflection: [
    '최근 아쉬웠던 일에서 다음에 다르게 할 행동 한 가지를 설명해 주세요.',
    '같은 실패를 반복하지 않기 위해 바꾼 습관이나 절차를 설명해 주세요.',
    '피드백을 받고 실제 행동을 바꾼 경험을 설명해 주세요.',
  ],
  concept_clarity: [
    '배운 이론 중 하나를 전공이 다른 친구에게 비유 없이 정확히 설명한다면 어떻게 말하겠습니까?',
    '자주 혼동되는 두 용어의 차이를 정의와 예시로 구분해 주세요.',
    '이 원리가 성립하지 않는 경우는 언제인지 한계 조건을 말해 주세요.',
  ],
  applicability: [
    '배운 지식을 규모나 환경이 다른 문제에 옮길 때 가장 먼저 점검할 점은 무엇입니까?',
    '학교 밖 실제 현장에서 이 방법을 쓰려면 어떤 제약을 고려해야 합니까?',
    '이전과 다른 데이터나 자원이 주어진다면 접근을 어떻게 수정하겠습니까?',
  ],
  claim_understanding: [
    '상대 발언에서 핵심 주장과 그 전제를 한 문장씩 요약해 보세요.',
    '토론 주제에 대해 찬반이 갈리는 지점이 정확히 어디인지 짚어 주세요.',
    '내가 반대하는 입장의 가장 강한 논거를 먼저 정리해 주세요.',
  ],
  evidence_use: [
    '주장을 뒷받침하려고 인용할 자료의 출처와 신뢰할 수 있는 이유를 말해 주세요.',
    '발표에서 가장 중요한 숫자 하나를 고르고 그 의미를 설명해 주세요.',
    '근거가 부족한 부분은 어떻게 표시하고 보완하겠습니까?',
  ],
  rebuttal: [
    '내 주장의 약점을 지적받았을 때 인정할 부분과 반박할 부분을 어떻게 나누겠습니까?',
    '상대 논리의 허점을 감정 없이 짚는 문장을 직접 만들어 보세요.',
    '반론이 타당하다면 입장을 어디까지 조정하겠습니까?',
  ],
  collaboration: [
    '의견이 다른 참가자를 끌어들여 결론을 함께 만드는 방법을 말해 주세요.',
    '발언 기회가 한쪽으로 쏠릴 때 균형을 맞추는 행동은 무엇입니까?',
    '모둠의 합의 사항을 마무리할 때 무엇을 확인하겠습니까?',
  ],
  structure: [
    '청중이 처음 보는 주제라면 발표 순서를 어떻게 짜겠습니까?',
    '결론을 앞에 두는 구성과 뒤에 두는 구성 중 무엇을 고르겠습니까?',
    '시간이 절반으로 줄면 어떤 내용을 남기고 무엇을 덜어내겠습니까?',
  ],
  execution_plan: [
    '제안한 계획을 첫 주에 무엇부터 실행에 옮기겠습니까?',
    '일정이 밀릴 때를 대비한 대체안과 담당자를 말해 주세요.',
    '계획이 성공했는지 어떤 지표로 확인하겠습니까?',
  ],
  qa_response: [
    '발표 직후 가장 날카로운 질문이 나온다면 어떻게 받겠습니까?',
    '답을 모르는 질문을 받았을 때 어떻게 대응하겠습니까?',
    '질문 의도가 불분명할 때 되묻는 방식을 예로 들어 주세요.',
  ],
  role_understanding: [
    '맡은 역할에서 가장 먼저 지켜야 할 책임은 무엇이라고 생각합니까?',
    '내 역할의 범위를 벗어난 부탁을 받았을 때 어떻게 판단하겠습니까?',
    '이 자리에서 기대되는 행동과 금지되는 행동을 각각 하나씩 말해 주세요.',
  ],
  responsiveness: [
    '예상 밖의 변수가 생겼을 때 첫 대응으로 무엇을 하겠습니까?',
    '상대가 불만을 표현할 때 어떤 말로 시작하겠습니까?',
    '한 번 정한 방침을 현장 반응에 맞춰 바꾼 적이 있다면 설명해 주세요.',
  ],
};

function transferTemplatesFor(competency) {
  const t = TRANSFER_BANK[competency];
  if (!t) throw Object.assign(new Error('unknown competency'), { code: 422 });
  return t;
}

// 전후 비교: 같은 루브릭·같은 역량, 두 시도의 발언 근거를 나란히 둔다.
// 증거가 부족하면 observed_change를 주장하지 않고 insufficient_evidence를 반환한다.
export function compareTransfer({ rubricVersion, competency, baseline, retry }) {
  const rubric = getRubric(rubricVersion || 'behavioral-ko-v1');
  if (!rubric.dimensions.includes(competency)) {
    throw Object.assign(new Error('competency not in rubric'), { code: 422 });
  }
  const b = normalizeAttempt(baseline);
  const r = normalizeAttempt(retry);
  if (!b || !r) {
    return { status: 'insufficient_evidence', reason: '두 시도 중 하나에 유효한 확정 답변이 없습니다.', baseline: b, retry: r };
  }
  if (b.questionId && r.questionId && normalizeQ(b.questionId) === normalizeQ(r.questionId)) {
    return { status: 'insufficient_evidence', reason: '두 질문이 동일합니다. 다른 질문으로 다시 시도하세요.', baseline: b, retry: r };
  }
  if (questionSimilarity(b.questionText || '', r.questionText || '') >= 0.55) {
    return { status: 'insufficient_evidence', reason: '두 질문이 너무 유사합니다. 서로 다른 질문으로 다시 시도하세요.', baseline: b, retry: r };
  }
  if (b.rubricVersion !== r.rubricVersion) {
    return { status: 'insufficient_evidence', reason: '평가 기준 버전이 달라 비교할 수 없습니다.', baseline: b, retry: r };
  }
  const bLevel = levelOf(b, competency);
  const rLevel = levelOf(r, competency);
  if (bLevel == null || rLevel == null) {
    return {
      status: 'insufficient_evidence', reason: '목표 역량에 대한 관찰 근거가 부족합니다.',
      baseline: b, retry: r, rubric_version: b.rubricVersion, competency,
    };
  }
  const delta = rLevel - bLevel;
  const headline = delta > 0
    ? '두 번째 답변이 목표 역량에서 더 구체적인 근거를 보였습니다.'
    : delta < 0
      ? '두 번째 답변에서 목표 역량의 근거가 더 약하게 관찰됐습니다.'
      : '두 답변에서 목표 역량의 관찰 수준이 비슷했습니다.';
  return {
    status: delta !== 0 ? 'observed_change' : 'no_clear_change',
    rubric_version: b.rubricVersion,
    competency,
    baseline: { ...b, level: bLevel },
    retry: { ...r, level: rLevel },
    delta,
    headline,
    // 원문 인용을 그대로 노출: 어느 답변이 무엇을 말했는지 검증 가능하게.
    evidence: [
      { attempt: 'baseline', quote: b.excerpt, question: b.questionText },
      { attempt: 'retry', quote: r.excerpt, question: r.questionText },
    ],
    caution: '단일 재연습 비교는 학습 효과를 입증하지 않습니다. 사람 평가자·대조 설계가 필요합니다.',
  };
}

function normalizeAttempt(a) {
  if (!a) return null;
  if (typeof a.excerpt !== 'string' || [...a.excerpt.trim()].length < 8) return null;
  return {
    questionId: a.questionId || null,
    questionText: a.questionText || '',
    excerpt: String(a.excerpt).slice(0, 500),
    rubricVersion: a.rubricVersion || 'behavioral-ko-v1',
    levels: a.levels || {},
    turnId: a.turnId || null,
    revision: a.revision ?? null,
  };
}

function levelOf(attempt, competency) {
  const v = attempt.levels?.[competency];
  return Number.isFinite(v) ? v : null;
}
