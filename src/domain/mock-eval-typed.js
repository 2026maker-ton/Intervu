// 유형별 평가 생성기: 동결 전사에서 근거 span을 직접 계산한다 (LLM이 좌표를 만들지 않음).
// 차원 집합은 루브릭 버전별로 다르며, 검증도 같은 레지스트리로 수행한다.
import { getRubric } from './rubrics.js';
import { validateEvaluationGeneric } from './evaluation-generic.js';

export function buildTypedEvaluation({ rubricVersion = 'behavioral-ko-v1', turnsWithText }) {
  const rubric = getRubric(rubricVersion);
  const dims = rubric.dimensions;
  const dimensions = dims.map((dim) => {
    const cands = (turnsWithText || []).filter((t) => (t.elicited || []).includes(dim) && [...t.text].length >= 4);
    if (cands.length < 2) {
      return { id: dim, status: 'insufficient_evidence', level: null, observation: '관찰 기회가 충분하지 않아 수준을 공개하지 않습니다.', abstention_reason: '유효한 답변이 두 개 미만입니다.', evidence: [] };
    }
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
    const anchor = rubric.anchors[dim]?.[Math.round(level)] || '';
    return {
      id: dim, status: 'scored', level,
      observation: `관찰된 발언은 ‘${anchor}’ 수준이며 ${ev.length}개 답변에서 확인됐습니다.`,
      abstention_reason: null, evidence: ev,
    };
  });
  const weakest = dimensions.filter((d) => d.status === 'scored').sort((a, b) => a.level - b.level)[0];
  const next_actions = weakest ? [{
    dimension_id: weakest.id,
    action: rubric.nextAction[weakest.id] || '다음 답변에서 근거를 덧붙이세요.',
    practice_question: rubric.practiceQuestion[weakest.id] || '같은 역량의 다른 경험을 설명해 주세요.',
  }] : [];
  const report = { schema_version: '1.0', rubric_version: rubricVersion, dimensions, next_actions };
  const v = validateEvaluationGeneric(report, (turnsWithText || []).map((t) => ({ turn_id: t.turn_id, revision: t.revision, speaker: 'user', text: t.text, elicited_dimensions: t.elicited })), rubric);
  if (!v.ok) throw new Error('typed evaluation invariant failed: ' + v.errors.join('; '));
  return report;
}

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
  const t = String(text || '');
  const hasAction = /(제가|저는|직접|제시|비교|조정|합의|설득)/.test(t);
  const hasReason = /(근거|기준|왜냐|때문|대안)/.test(t) || /(이유)/.test(t);
  const hasResult = /(결과|완료|제출|달라|바뀌|관찰)/.test(t);
  const hasReflect = /(배웠|다음|바꾸|교훈|반성)/.test(t);
  const substantive = substantiveScore(t);
  let s = 1;
  if (len >= 12 && substantive >= 2) s = 2;
  if ((dim === 'evidence_specificity' || dim === 'evidence_use') && hasAction && hasResult && substantive >= 3 && len >= 30) s = 3;
  if (dim === 'reasoning' && hasReason && substantive >= 3 && len >= 30) s = Math.max(s, 3);
  if (dim === 'relevance' && len >= 12 && substantive >= 2) s = Math.max(s, 3);
  if ((dim === 'reflection' || dim === 'collaboration' || dim === 'execution_plan' || dim === 'qa_response' || dim === 'responsiveness') && (hasReflect || hasResult) && substantive >= 2 && len >= 20) s = Math.max(s, 3);
  if ((dim === 'concept_clarity' || dim === 'claim_understanding' || dim === 'structure' || dim === 'role_understanding') && len >= 20 && substantive >= 2) s = Math.max(s, 3);
  if ((dim === 'rebuttal' || dim === 'applicability') && hasReason && substantive >= 3 && len >= 30) s = Math.max(s, 3);
  if (hasAction && hasReason && hasResult && (hasReflect || /대안|비교|한계/.test(t)) && len >= 60 && substantive >= 5) s = 4;
  return Math.min(4, s);
}

function substantiveScore(t) {
  const signals = [
    /(제가|저는).{2,}(했|하였|수행|담당|제안|결정|주도)/.test(t),
    /(직접|본인)/.test(t),
    /(제시|비교|조정|합의|설득)/.test(t),
    /(근거|기준|왜냐|때문)/.test(t) && t.replace(/\s/g, '').length >= 15,
    /(결과|완료|제출|달라|바뀌|관찰)/.test(t) && t.replace(/\s/g, '').length >= 15,
    /(배웠|다음|바꾸|교훈|반성)/.test(t),
    /\d/.test(t),
    /[.!?。]\s*.+/.test(t) || t.split(/\n/).filter((x) => x.trim().length >= 8).length >= 2,
    [...t.replace(/\s/g, '')].length >= 40,
  ];
  return signals.filter(Boolean).length;
}
