// 모델 평가 출력 → 보고서(WP-E). 인용 좌표는 서버가 원문에서 다시 계산하고, 원문에 없는 인용은 버린다.
// 모델이 낸 level은 서로 다른 답변 2개 이상의 검증된 인용이 있을 때만 쓴다(없으면 판단 보류).
const PREDICTION = /합격|불합격|확률|순위|백분위|점수\s*합산|총점|등수|가능성이\s*(높|낮)/;

const unsafe = (s, checkSafety) => PREDICTION.test(String(s || '')) || checkSafety(String(s || '')).length > 0;

// 반환: 보고서({schema_version, rubric_version, dimensions, next_actions}) 또는 null(구조 불량·금지 어휘)
export function buildLlmEvaluation({ parsed, turnsWithText, rubric, checkSafety }) {
  if (!parsed || !Array.isArray(parsed.dimensions)) return null;
  const byDim = new Map();
  for (const d of parsed.dimensions) if (d && typeof d.id === 'string' && !byDim.has(d.id)) byDim.set(d.id, d);
  const dimensions = [];
  for (const id of rubric.dimensions) {
    const m = byDim.get(id);
    const abstain = (reason) => ({ id, status: 'insufficient_evidence', level: null, observation: '관찰 기회가 충분하지 않아 수준을 공개하지 않습니다.', abstention_reason: reason, evidence: [] });
    if (!m || !Number.isInteger(m.level) || m.level < 1 || m.level > 4) { dimensions.push(abstain('모델이 수준을 판단하지 않았거나 판단 보류했습니다.')); continue; }
    if (typeof m.observation !== 'string' || !m.observation.trim() || [...m.observation].length > 300 || unsafe(m.observation, checkSafety)) return null;
    const evidence = [];
    for (const e of Array.isArray(m.evidence) ? m.evidence : []) {
      const t = turnsWithText.find((x) => x.turn_id === e?.turn_id);
      const quote = typeof e?.quote === 'string' ? e.quote.normalize('NFC') : '';
      if (!t || !quote.trim() || !(t.elicited || []).includes(id)) continue;
      const text = t.text.normalize('NFC');
      const idx = text.indexOf(quote);
      if (idx < 0) continue; // 원문에 글자 그대로 없는 인용은 버린다
      const start_cp = Array.from(text.slice(0, idx)).length;
      evidence.push({ turn_id: t.turn_id, revision: t.revision, start_cp, end_cp: start_cp + Array.from(quote).length, quote, anchor_id: `${id}:${m.level}`, answer_level: m.level });
      if (evidence.length >= 3) break;
    }
    if (new Set(evidence.map((e) => e.turn_id)).size < 2) { dimensions.push(abstain('검증된 인용 근거가 서로 다른 답변 2개 미만입니다.')); continue; }
    dimensions.push({ id, status: 'scored', level: m.level, observation: m.observation.trim(), abstention_reason: null, evidence });
  }
  const next_actions = [];
  for (const a of Array.isArray(parsed.next_actions) ? parsed.next_actions : []) {
    if (!rubric.dimensions.includes(a?.dimension_id) || typeof a.action !== 'string' || typeof a.practice_question !== 'string') continue;
    if (!a.action.trim() || !a.practice_question.trim() || [...a.action].length > 300 || [...a.practice_question].length > 300) continue;
    if (unsafe(a.action, checkSafety) || unsafe(a.practice_question, checkSafety)) return null;
    next_actions.push({ dimension_id: a.dimension_id, action: a.action.trim(), practice_question: a.practice_question.trim() });
    if (next_actions.length >= 3) break;
  }
  return { schema_version: '1.0', rubric_version: rubric.version, dimensions, next_actions };
}
