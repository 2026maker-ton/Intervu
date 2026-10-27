// 평가 도메인 검증: schema 불변식 + span/소유권/중앙값/커버리지
const DIMS = ['relevance', 'evidence_specificity', 'reasoning', 'reflection'];

export function validateEvaluation(report, transcripts) {
  const errors = [];
  if (!report || report.schema_version !== '1.0') errors.push('bad schema_version');
  if (report.rubric_version !== 'behavioral-ko-v1') errors.push('bad rubric_version');
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

export const RUBRIC = {
  relevance: { 1: '질문과 다른 주장만 함', 2: '일부 관련하나 핵심에 답하지 않음', 3: '핵심 질문에 직접 답함', 4: '핵심과 제한·조건까지 분명히 함' },
  evidence_specificity: { 1: '주장만 있음', 2: '사례가 있으나 역할/행동이 불명확', 3: '본인 행동과 관찰 결과가 구체적', 4: '대안·기여·결과의 한계까지 구별' },
  reasoning: { 1: '결론과 근거 연결이 모순', 2: '이유는 있으나 중요한 연결 생략', 3: '선택 이유와 근거가 연결', 4: '대안·반례·상충 기준을 비교' },
  reflection: { 1: '성찰 질문에 검토 없이 반복', 2: '일반 교훈만 언급', 3: '경험에서 바꿀 행동 설명', 4: '다른 조건에 적용할 기준과 한계 설명' },
};

const BANNED = [/합격\s?확률/, /백분위/, /성격이\s?나쁘/, /무능력/, /거짓말/];

export function checkFeedbackSafety(text = '') {
  return BANNED.filter((re) => re.test(text)).map((r) => r.source);
}
