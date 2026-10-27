// 유형별 평가 검증기 (루브릭 레지스트리 기반 — 구 behavioral 검증과 동일한 불변식)
export function validateEvaluationGeneric(report, transcripts, rubric) {
  const errors = [];
  if (!report || report.schema_version !== '1.0') errors.push('bad schema_version');
  if (report.rubric_version !== rubric.version) errors.push(`bad rubric_version: got ${report.rubric_version}, want ${rubric.version}`);
  const DIMS = rubric.dimensions;
  const ids = (report.dimensions || []).map((d) => d.id);
  if (new Set(ids).size !== ids.length) errors.push('duplicate dimension');
  for (const d of report.dimensions || []) {
    if (!DIMS.includes(d.id)) errors.push(`unknown dimension ${d.id}`);
    const levels = new Map();
    for (const e of d.evidence || []) {
      const t = (transcripts || []).find((t) => t.turn_id === e.turn_id && t.revision === e.revision);
      if (!t || t.speaker !== 'user') { errors.push(`unknown/non-user turn ${e.turn_id}`); continue; }
      if (!(t.elicited_dimensions || []).includes(d.id)) { errors.push(`dimension not elicited ${d.id}@${e.turn_id}`); continue; }
      const chars = Array.from((t.text || '').normalize('NFC'));
      if (!(e.start_cp >= 0 && e.end_cp > e.start_cp && e.end_cp <= chars.length)) { errors.push(`bad span ${e.turn_id}`); continue; }
      if (chars.slice(e.start_cp, e.end_cp).join('') !== e.quote) { errors.push(`quote mismatch ${e.turn_id}`); continue; }
      if (e.anchor_id !== `${d.id}:${e.answer_level}`) { errors.push(`anchor mismatch ${e.turn_id}`); continue; }
      if (!Number.isInteger(e.answer_level) || e.answer_level < 1 || e.answer_level > 4) { errors.push(`bad level ${e.turn_id}`); continue; }
      if (levels.has(e.turn_id) && levels.get(e.turn_id) !== e.answer_level) { errors.push(`conflicting same-turn levels ${e.turn_id}`); continue; }
      levels.set(e.turn_id, e.answer_level);
    }
    if (d.status === 'scored') {
      if (levels.size < 2) errors.push(`insufficient distinct turns for ${d.id}`);
      if (d.abstention_reason !== null) errors.push(`scored must have null abstention ${d.id}`);
      const sorted = [...levels.values()].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      if (d.level !== median) errors.push(`median mismatch ${d.id}: got ${d.level}, want ${median}`);
    } else if (d.status === 'insufficient_evidence') {
      if (d.level !== null) errors.push(`abstained must have null level ${d.id}`);
      if (!d.abstention_reason) errors.push(`abstained needs reason ${d.id}`);
    } else errors.push(`bad status ${d.id}`);
  }
  if ((report.next_actions || []).length > 3) errors.push('too many next_actions');
  return { ok: errors.length === 0, errors };
}
