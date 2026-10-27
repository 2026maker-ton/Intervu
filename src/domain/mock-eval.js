// Mock 평가 생성기: 동결 전사에서 근거(span)를 직접 계산 → 스키마 준수 보고서
// (LLM이 아닌 결정적 코드이므로 인용 불일치가 원천 불가)
import { validateEvaluation, RUBRIC, checkFeedbackSafety } from './evaluation.js';

export function buildMockEvaluation({ sessionId, turnsWithText }) {
  // turnsWithText: [{turn_id, revision, text, elicited:[dims]}]
  const dims = ['relevance', 'evidence_specificity', 'reasoning', 'reflection'];
  const dimensions = dims.map((dim) => {
    const cands = turnsWithText.filter((t) => (t.elicited || []).includes(dim) && [...t.text].length >= 4);
    if (cands.length < 2) {
      return { id: dim, status: 'insufficient_evidence', level: null, observation: '관찰 기회가 충분하지 않아 수준을 공개하지 않습니다.', abstention_reason: '유효한 답변이 두 개 미만입니다.', evidence: [] };
    }
    // 각 답변에서 문장 단위 구간을 인용 → span 정확 보장
    const ev = cands.slice(0, 3).map((t) => {
      const chars = Array.from(t.text.normalize('NFC'));
      const { start, end } = pickSpan(chars);
      const quote = chars.slice(start, end).join('');
      const answer_level = scoreHeuristic(dim, t.text);
      return { turn_id: t.turn_id, revision: t.revision, start_cp: start, end_cp: end, quote, anchor_id: `${dim}:${answer_level}`, answer_level };
    });
    const levels = ev.map((e) => e.answer_level).sort((a, b) => a - b);
    const mid = Math.floor(levels.length / 2);
    const level = levels.length % 2 ? levels[mid] : (levels[mid - 1] + levels[mid]) / 2;
    return {
      id: dim, status: 'scored', level,
      observation: `관찰된 발언은 ‘${RUBRIC[dim][Math.round(level)]}’ 수준이며 ${ev.length}개 답변에서 확인됐습니다.`,
      abstention_reason: null, evidence: ev,
    };
  });
  const weakest = dimensions.filter((d) => d.status === 'scored').sort((a, b) => a.level - b.level)[0];
  const next_actions = weakest ? [{
    dimension_id: weakest.id,
    action: nextActionFor(weakest.id),
    practice_question: practiceQFor(weakest.id),
  }] : [];
  const report = { schema_version: '1.0', session_id: sessionId, rubric_version: 'behavioral-ko-v1', model_version: 'mock-model-v1', dimensions, next_actions };
  const v = validateEvaluation(report, turnsWithText.map((t) => ({ turn_id: t.turn_id, revision: t.revision, speaker: 'user', text: t.text, elicited_dimensions: t.elicited })));
  if (!v.ok) throw new Error('mock evaluation invariant failed: ' + v.errors.join('; '));
  for (const d of dimensions) {
    const bad = checkFeedbackSafety(d.observation);
    if (bad.length) throw new Error('unsafe feedback: ' + bad.join(','));
  }
  return report;
}

// 첫 문장(8~60자)을 인용 구간으로 선택한다. 공백 경계는 잘라내 span과 quote가 항상 일치한다.
function pickSpan(chars) {
  const len = chars.length;
  let start = 0;
  while (start < len && /\s/.test(chars[start])) start += 1;
  const limit = Math.min(len, start + 60);
  let end = limit;
  for (let i = start; i < limit; i += 1) {
    if (/[.!?。!?…\n]/.test(chars[i]) && i + 1 - start >= 8) { end = i + 1; break; }
  }
  if (end - start < 8) end = Math.min(len, start + 8);
  while (end > start && /\s/.test(chars[end - 1])) end -= 1;
  if (end <= start) return { start: 0, end: len };
  return { start, end };
}

function scoreHeuristic(dim, text) {
  const len = [...text].length;
  const hasAction = /(제가|저는|직접|제시|비교|조정|합의|설득)/.test(text);
  const hasReason = /(이유|근거|기준|왜냐|때문|대안)/.test(text);
  const hasResult = /(결과|완료|제출|달라|바뀌|관찰)/.test(text);
  const hasReflect = /(배웠|다음|바꾸|교훈|반성)/.test(text);
  let s = 1;
  if (len >= 12) s = 2;
  if (dim === 'evidence_specificity' && hasAction && hasResult) s = 3;
  if (dim === 'reasoning' && hasReason) s = Math.max(s, 3);
  if (dim === 'relevance' && len >= 12) s = Math.max(s, 3);
  if (dim === 'reflection' && hasReflect) s = Math.max(s, 3);
  if (hasAction && hasReason && hasResult) s = 4;
  return Math.min(4, s);
}

function nextActionFor(dim) {
  return {
    relevance: '질문의 핵심 요구를 한 문장으로 먼저 답한 뒤 근거를 덧붙이세요.',
    evidence_specificity: '선택한 행동이 어떤 결과로 이어졌는지 실제 관찰을 덧붙이세요.',
    reasoning: '선택 이유와 버린 대안의 기준을 한 문장씩 비교하세요.',
    reflection: '다음에 바꿀 행동 한 가지와 확인 방법을 말해 주세요.',
  }[dim];
}
function practiceQFor(dim) {
  return {
    relevance: '이번 주에 처리한 일 중 가장 급한 것을 고른 기준을 설명해 주세요.',
    evidence_specificity: '다른 협업 경험에서 본인의 행동과 관찰한 결과를 설명해 주세요.',
    reasoning: '두 가지 방법 중 하나를 고른 이유와 버린 쪽의 단점을 설명해 주세요.',
    reflection: '최근 아쉬웠던 일에서 다음에 다르게 할 한 가지를 설명해 주세요.',
  }[dim];
}
