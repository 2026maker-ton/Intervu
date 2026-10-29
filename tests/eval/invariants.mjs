// WP-B7: 순수 불변식 함수. 규칙 출력과 공급자 어댑터 출력 모두에 같은 함수를 적용한다. 각 함수는 위반 목록(빈 배열=통과)을 돌려준다.
import { BANNED_PATTERNS, NEGATION } from '../../public/core/copy.js';

const cps = (s) => Array.from(String(s ?? '').normalize('NFC'));
// 질문 문장 안의 지원자 인용(“…”)은 지원자의 말이므로 어휘·물음표·숫자 검사에서 제외한다.
export const stripQuotes = (s) => String(s ?? '').replace(/“[^]*”/g, '');
export const digitTokens = (s) => String(s ?? '').match(/\d+(?:[.,]\d+)*/g) || [];

// 점수 어휘: 면접 중 발화·질문에 나오면 안 되는 말(validate.js FORBIDDEN_IN_INTERVIEW + 순위/백분위/총점).
export const SCORING_VOCAB = /점수|등급|합격|불합격|모범\s*답안|정답은|\d\s*\/\s*4|백분위|순위|총점/;

// 1) 인용이 원문과 글자 단위로 같고 [start_cp,end_cp) 위치도 맞다.
export function claimsAreVerbatim(claims, text) {
  const chars = cps(text);
  const v = [];
  for (const c of claims || []) {
    if (!(Number.isInteger(c.start_cp) && Number.isInteger(c.end_cp) && c.start_cp >= 0 && c.end_cp > c.start_cp && c.end_cp <= chars.length)) { v.push(`${c.id}: span out of range`); continue; }
    if (chars.slice(c.start_cp, c.end_cp).join('') !== c.quote) v.push(`${c.id}: quote differs from source span`);
  }
  return v;
}

// 2) 질문에 있는 숫자는 모두 근거(evidence: 문자열 또는 문자열 배열)에 이미 있어야 한다(인용 구간 포함).
export function noNewNumbers(question, evidence) {
  const ev = [].concat(evidence ?? []).join('\n');
  return digitTokens(question).filter((t) => !ev.includes(t)).map((t) => `new number "${t}"`);
}

// 3) 질문 하나(물음표 1개 이하, 비어 있지 않음). requireMark=true면 물음표 정확히 1개.
export function singleQuestion(text, { requireMark = false } = {}) {
  const t = stripQuotes(text).trim();
  const n = (t.match(/[?？]/g) || []).length;
  const v = [];
  if (!t) v.push('empty question');
  if (n > 1) v.push(`${n} question marks`);
  if (requireMark && n !== 1) v.push(`expected exactly 1 question mark, got ${n}`);
  return v;
}

// 4) 금지 어휘: 제품 금지 표현(public/core/copy.js 목록, 부정 문맥 허용) + 점수 어휘. 지원자 인용 부분은 제외.
export function noBannedVocabulary(text) {
  const t = stripQuotes(text);
  const v = [];
  if (SCORING_VOCAB.test(t)) v.push(`scoring vocabulary: ${SCORING_VOCAB.exec(t)[0]}`);
  for (const s of t.split(/\n|(?<=[.!?。])\s+/)) {
    const p = BANNED_PATTERNS.find((re) => re.test(s));
    if (p && !NEGATION.test(s)) v.push(`banned expression: ${p.exec(s)[0]}`);
  }
  return v;
}

// 5) 평가 근거 span이 해당 답변(turn_id+revision) 원문과 일치한다. transcripts: [{turn_id,revision,text}]
export function spansValid(report, transcripts) {
  const v = [];
  for (const d of report?.dimensions || []) {
    for (const e of d.evidence || []) {
      const t = (transcripts || []).find((x) => x.turn_id === e.turn_id && x.revision === e.revision);
      if (!t) { v.push(`${d.id}: unknown turn ${e.turn_id}@${e.revision}`); continue; }
      const chars = cps(t.text);
      if (!(e.start_cp >= 0 && e.end_cp > e.start_cp && e.end_cp <= chars.length)) v.push(`${d.id}: bad span`);
      else if (chars.slice(e.start_cp, e.end_cp).join('') !== e.quote) v.push(`${d.id}: span != quote`);
    }
  }
  return v;
}

// 6) 점수가 공개된 차원은 비어 있지 않은 인용을 가져야 하고, 근거 부족 차원은 수준을 공개하지 않는다.
export function evaluationHasQuotes(report) {
  const v = [];
  for (const d of report?.dimensions || []) {
    if (d.status === 'scored') {
      if (!(d.evidence || []).length) v.push(`${d.id}: scored without evidence`);
      for (const e of d.evidence || []) if (!String(e.quote || '').trim()) v.push(`${d.id}: empty quote`);
    } else if (d.status === 'insufficient_evidence') {
      if (d.level != null) v.push(`${d.id}: insufficient_evidence must not expose a level`);
    } else v.push(`${d.id}: unknown status ${d.status}`);
  }
  return v;
}

// 질문/발화 공통 묶음: 모든 사람에게 보이는 질문 문장에 적용.
export function questionInvariants(text, evidence, opts) {
  return [...singleQuestion(text, opts), ...noBannedVocabulary(text), ...noNewNumbers(stripQuotes(text), evidence)];
}
