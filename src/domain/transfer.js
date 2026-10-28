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

function transferTemplatesFor(competency) {
  const bank = {
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
  };
  return bank[competency] || bank.reflection;
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
