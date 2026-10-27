// PII 검사 + 블라인드 마스킹. 완전 익명화 보장 아님(사양 §3, §15).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/g;
const RRN = /\d{6}[-\s]?[1-4]\d{6}/g;

export function detectPii(text = '') {
  const hits = [];
  for (const m of text.matchAll(EMAIL)) hits.push({ type: 'email', value: m[0] });
  for (const m of text.matchAll(PHONE)) hits.push({ type: 'phone', value: m[0] });
  for (const m of text.matchAll(RRN)) hits.push({ type: 'rrn', value: m[0] });
  return hits;
}

export function maskPii(text = '') {
  return text.replace(EMAIL, '[이메일]').replace(PHONE, '[전화번호]').replace(RRN, '[주민번호]');
}

// 블라인드: 이름/학교/출신/성별/연령/가족 단서 마스킹(휴리스틱, 불완전성 고지)
const BLIND_PATTERNS = [
  [/서울대|연세대|고려대|카이스트|포스텍|[가-힣]+대학교/g, '[학교]'],
  [/김[가-힣]{1,3}|이[가-힣]{1,3}|박[가-힣]{1,3}(?=\s*(씨|님|입니다|이에요))/g, '[이름]'],
  [/\d{4}년생|\d{2}세|만\s?\d{1,2}세/g, '[연령]'],
  [/서울\s?출신|부산\s?출신|[가-힣]+시\s?출신/g, '[출신지역]'],
  [/아버지|어머니|부모님|가족/g, '[가족]'],
  [/(남자|여자|남성|여성)(입니다|이에요|으로서)?/g, '[성별]'],
];

export function buildBlindContext(text = '') {
  let out = maskPii(text);
  for (const [re, rep] of BLIND_PATTERNS) out = out.replace(re, rep);
  return out;
}

// 공고 추출: span이 원문 NFC와 정확히 일치해야 함(합성/휴리스틱)
export function extractClaims(sourceText = '', experiences = []) {
  const text = (sourceText || '').normalize('NFC');
  const claims = [];
  const push = (kind, value, docId, rev) => {
    const idx = text.indexOf(value);
    if (idx === -1) return;
    claims.push({
      kind, value, source_document_id: docId, revision: rev,
      start_cp: [...text.slice(0, idx)].length,
      end_cp: [...text.slice(0, idx + value.length)].length,
      quote: value, status: 'user_supplied',
    });
  };
  // 휴리스틱 키워드: 원문에 실제로 존재하는 구절만 claim으로
  const keywords = ['문제 해결', '협업', '소통', '데이터', '고객', '기획', '운영', '분석', '토론', '발표', '우선순위', '갈등', '면접', '팀'];
  for (const kw of keywords) if (text.includes(kw)) push('competency', kw, 'doc-1', 1);
  for (const exp of experiences.slice(0, 3)) {
    const t = String(exp || '').normalize('NFC').slice(0, 20);
    if (t && text.includes(t)) push('experience', t, 'doc-1', 1);
  }
  const missing = [];
  if (!/토론/.test(text)) missing.push('discussion_format');
  if (!/면접\s?시간|분/.test(text)) missing.push('interview_duration');
  if (!/인원|명/.test(text)) missing.push('participant_count');
  return { claims, missing_fields: missing, recommended_template: 'general-entry-v1' };
}

export function verifyClaimSpan(fullText, claim) {
  const chars = Array.from((fullText || '').normalize('NFC'));
  if (claim.start_cp < 0 || claim.end_cp > chars.length || claim.end_cp <= claim.start_cp) return false;
  return chars.slice(claim.start_cp, claim.end_cp).join('') === claim.quote;
}
