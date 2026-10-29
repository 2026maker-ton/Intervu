// PII 검사 + 블라인드 마스킹. 완전 익명화 보장 아님(사양 §3, §15).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/g;
const RRN = /\d{6}[-\s]?[1-4]\d{6}/g;

// ponytail: 아래 name/school/address/id_number는 휴리스틱(표지어·접미어 기반)이다. 누락·오탐 가능, 완전 익명화 아님.
// 흔한 성씨 + 표지어(제 이름은/저는 …입니다/성명:/○○○ 학생)가 있을 때만 이름으로 본다.
const SUR = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현';
const NOT_NAME = new Set(['이유', '이번', '이해', '이상', '이후', '이전', '이내', '이용', '이미', '이것', '정말', '정도', '정확', '정리', '정보', '고객', '고등', '고민', '고려', '한국', '하나', '주요', '주로', '주도', '주장', '문제', '문화', '전체', '전문', '최근', '최대', '최종', '구체', '구성', '구조', '우리', '신규', '신뢰', '안전', '안내', '조금', '조사', '강점', '장점', '서로', '나름', '원래', '성격', '성장', '진행', '지원', '지금', '유지', '유사']);
const NAME_RES = [
  new RegExp(String.raw`((?:제\s?이름은|이름\s*[:：]|성명\s*[:：])\s*)([${SUR}][가-힣]{1,2})(?=입니다|이에요|이고|이라고|라고|[^가-힣]|$)`, 'g'),
  new RegExp(String.raw`(저는\s*)([${SUR}][가-힣]{1,2})(?=\s*(?:입니다|이에요|이라고|라고))`, 'g'),
  new RegExp(String.raw`(?<![가-힣])()([${SUR}][가-힣]{1,2})(?=\s?(?:학생|지원자)(?:[은는이가을를의도]|[^가-힣]|$))`, 'g'),
];
const SCHOOL_RE = /(?<![가-힣])(?:[가-힣]{1,5}(?:초등학교|중학교|고등학교|대학교)|(?:서울|연세|고려|한양|중앙|경희|성균관|이화|부산|경북|전남|전북|충남|충북|강원|제주|인하|아주|건국|동국|홍익|숙명|서강)대(?:[는은를을에가의도와]|(?![가-힣]))|[가-힣]{2,4}(?:과학|외국어|여자|예술)고(?![가-힣]))/g;
const ADDR_RE = /(?<![가-힣])(?:[가-힣]{1,6}(?:시|도)\s?)?[가-힣]{1,6}(?:구|군)\s?[가-힣0-9]{1,10}(?:동|로|길)\s?\d{1,4}(?:-\d{1,4})?(?:번지|호)?/g;
const ID_RE = /(?:학번|사번|수험번호|학생번호|사원번호)\s*[:：]?\s*(?:은|는)?\s*[A-Za-z]?\d{5,12}/g;

function nameMatches(text) {
  const out = [];
  for (const re of NAME_RES) for (const m of text.matchAll(re)) if (!NOT_NAME.has(m[2])) out.push(m[2]);
  return out;
}

export function detectPii(text = '') {
  const hits = [];
  for (const m of text.matchAll(EMAIL)) hits.push({ type: 'email', value: m[0] });
  for (const m of text.matchAll(PHONE)) hits.push({ type: 'phone', value: m[0] });
  for (const m of text.matchAll(RRN)) hits.push({ type: 'rrn', value: m[0] });
  for (const v of nameMatches(text)) hits.push({ type: 'name', value: v });
  for (const m of text.matchAll(SCHOOL_RE)) hits.push({ type: 'school', value: m[0] });
  for (const m of text.matchAll(ADDR_RE)) hits.push({ type: 'address', value: m[0] });
  for (const m of text.matchAll(ID_RE)) hits.push({ type: 'id_number', value: m[0] });
  return hits;
}

// 길이 불변 가정 없음(claims는 마스킹된 텍스트 기준으로 span 계산). 휴리스틱이며 완전 익명화가 아니다.
export function maskPii(text = '') {
  let out = text.replace(EMAIL, '[이메일]').replace(PHONE, '[전화번호]').replace(RRN, '[주민번호]')
    .replace(ID_RE, '[식별번호]').replace(ADDR_RE, '[주소]').replace(SCHOOL_RE, '[학교]');
  for (const re of NAME_RES) out = out.replace(re, (m, pre, nm) => (NOT_NAME.has(nm) ? m : `${pre}[이름]`));
  return out;
}

// 블라인드: 이름/학교/출신/성별/연령/가족 단서 마스킹(휴리스틱, 불완전성 고지)
// P0 회귀: '이번/이유/이해/21세기'는 일반 조사·명사이므로 마스킹하지 않는다.
const BLIND_PATTERNS = [
  [/서울대|연세대|고려대|카이스트|포스텍|[가-힣]+대학교/g, '[학교]'],
  // 가족명 + 호칭이 뒤따를 때만 이름으로 본다. 그룹화 누락(이번/이유/이해 오탐) 수정.
  [/(?:김|이|박)[가-힣]{1,3}(?=\s*(?:씨|님|입니다|이에요))/g, '[이름]'],
  // '21세기' 오탐 방지: 세 뒤에 한글이 오면 연령이 아니다.
  [/\d{4}년생(?![가-힣])|\d{2}세(?![가-힣])|만\s?\d{1,2}\s?세(?![가-힣])/g, '[연령]'],
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
