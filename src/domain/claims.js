// 지원자 주장 검증 슬라이스(PROJECT.md §2.4, P0-3): 자기소개서·지원서 문장에서
// "지원자가 경험·성과를 주장한 문장"과 그 문장에서 빠진 정보(공백)를 결정적 규칙으로 찾고,
// 그 문장을 그대로 인용하는 검증 질문을 만든다.
// - 모델을 쓰지 않으므로 외부 전송이 없고, 없는 사실·수치를 만들 수 없다(질문은 고정 템플릿+원문 인용).
// - span은 이 모듈이 원문에서 직접 계산하며 verifyClaimSpan으로 재검증한다.
// - 거짓말 탐지가 아니다: 문장에 근거가 적혀 있는지 보고, 비어 있는 부분을 묻는다.
import { verifyClaimSpan } from './pii.js';

export const CLAIM_PROMPT_VERSION = 'claim-probe-v1';
const MIN_CP = 12;
const MAX_QUOTE_CP = 200;
const DISPLAY_QUOTE_CP = 80;

// 경험·성과를 서술하는 문장 표지(없으면 소개·다짐 문장으로 보고 주장에서 제외)
const EXPERIENCE = /(했|하였|맡았|맡아|담당|주도|이끌|참여|운영|기획|개발|제작|구축|설계|해결|조율|달성|수상|개선|진행|수행|도입|제안)/;
const ROLE = /(리더|팀장|회장|부장|총무|대표|담당|맡|역할|주도|책임|이끌|제가|저는|직접)/;
const REASON = /(왜냐|이유|때문|기준|판단|대안|비교|따라서|그래서)/;
const RESULT = /(결과|달성|증가|감소|향상|개선|수상|완료|성공|단축|절감|늘었|줄었|높아|낮아)/;
const NUMBER = /\d/;

// 질문에서 되묻는 순서(앞쪽 공백을 먼저 묻는다)
const GAP_ORDER = ['role', 'result', 'reason', 'number'];
const GAP_ASK = {
  role: '본인이 맡은 역할과 팀원이 한 일의 구분',
  result: '실제로 관찰된 결과',
  reason: '판단 기준과 버린 대안',
  number: '확인할 수 있는 수치나 기록',
};
const GAP_COMPETENCY = { role: 'evidence_specificity', result: 'evidence_specificity', reason: 'reasoning', number: 'evidence_specificity' };

// 문장 단위 분리: 코드포인트 구간을 함께 돌려준다. 소수점(3.5)은 문장 끝으로 보지 않는다.
export function splitSentences(text = '') {
  const chars = Array.from(String(text).normalize('NFC'));
  const out = [];
  const push = (s, e) => {
    while (s < e && /\s/.test(chars[s])) s += 1;
    while (e > s && /\s/.test(chars[e - 1])) e -= 1;
    if (e > s) out.push({ start: s, end: e });
  };
  let start = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (c === '\n') { push(start, i); start = i + 1; continue; }
    if (/[.!?。…]/.test(c) && (i + 1 === chars.length || /\s/.test(chars[i + 1]))) { push(start, i + 1); start = i + 1; }
  }
  push(start, chars.length);
  return out.map(({ start: s, end: e }) => {
    const end = Math.min(e, s + MAX_QUOTE_CP);
    return { start_cp: s, end_cp: end, quote: chars.slice(s, end).join('') };
  });
}

export function extractApplicantClaims(text = '') {
  const full = String(text || '').normalize('NFC');
  const claims = [];
  for (const s of splitSentences(full)) {
    if (Array.from(s.quote).length < MIN_CP || !EXPERIENCE.test(s.quote)) continue;
    const gaps = [];
    if (!ROLE.test(s.quote)) gaps.push('role');
    if (!RESULT.test(s.quote)) gaps.push('result');
    if (!REASON.test(s.quote)) gaps.push('reason');
    if (!NUMBER.test(s.quote)) gaps.push('number');
    const claim = {
      id: `claim-${claims.length + 1}`,
      kind: 'applicant_claim',
      source_document_id: 'doc-application',
      revision: 1,
      start_cp: s.start_cp, end_cp: s.end_cp, quote: s.quote,
      gaps,
      status: 'user_supplied',
    };
    // 서버가 계산한 span을 원문과 다시 대조한다(불일치 시 제외)
    if (verifyClaimSpan(full, claim)) claims.push(claim);
  }
  return claims;
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const a = Array.from(s); return a.length > n ? `${a.slice(0, n).join('')}…` : s; };

// 공백이 많은 주장부터 최대 max개를 골라, 원문을 그대로 인용하는 질문을 만든다.
// 질문 문장은 고정 템플릿+인용뿐이라 지원서에 없는 수치·사람·성과가 들어갈 수 없다.
export function buildClaimQuestions(claims = [], { max = 2 } = {}) {
  const ranked = claims
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.gaps.length - a.c.gaps.length || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i);
  return ranked.map(({ c }, n) => {
    const asks = GAP_ORDER.filter((g) => c.gaps.includes(g)).slice(0, 2);
    const quote = cut(oneLine(c.quote), DISPLAY_QUOTE_CP);
    const text = asks.length
      ? `자기소개서에 “${quote}”라고 쓰셨습니다. 다음을 구분해 설명해 주세요: ${asks.map((g) => GAP_ASK[g]).join(' / ')}.`
      : `자기소개서에 “${quote}”라고 쓰셨습니다. 그 경험에서 본인이 내린 판단 한 가지와 그 근거를 설명해 주세요.`;
    const primary = asks.length ? GAP_COMPETENCY[asks[0]] : 'reasoning';
    return {
      id: `claim-q-${n + 1}`,
      text,
      primary,
      secondary: ['relevance'],
      target_competency: primary,
      application_evidence_ids: [c.id],
      application_evidence: [{ id: c.id, quote: c.quote, start_cp: c.start_cp, end_cp: c.end_cp, gaps: c.gaps }],
      institution_evidence_ids: [],
      source_status: 'user_supplied',
      prompt_version: CLAIM_PROMPT_VERSION,
    };
  });
}
