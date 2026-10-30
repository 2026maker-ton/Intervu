// questions.design / trends.decide 서버 검증(09 §5.1). 모델 출력은 신뢰하지 않는다: 질문 단위로 검사해 위반하면 그 질문만 버린다.
const BANNED = [
  /합격\s*(가능성|확률|예측)/, /불합격\s*(가능성|확률|예측)/, /정확(히|한)\s*(AI\s*)?(평가|채점)/,
  /순위/, /백분위/, /거짓말\s*탐지/, /(감정|성격|외모)\s*(분석|진단)/, /검증된\s*AI\s*채점/, // public/core/copy.js BANNED_PATTERNS와 같은 목록(public은 import하지 않는다)
  /점수|등급|합격|불합격|모범\s*답안|정답/,
];
const RUBRIC = ['relevance', 'evidence_specificity', 'reasoning', 'reflection'];
const ORG_NOUN = /[\p{Script=Hangul}A-Za-z0-9]+(?:대학교|고등학교|대학|학교|학과|회사|재단|센터|연구소)/gu;
export const MODEL_MAX = 3;

// ponytail: 고유명사는 한국어에 대문자가 없어 휴리스틱(영문 단어·기관명 접미사)만 검사한다. 의미 검증이 아니다.
export function novelFacts(text, evidenceText) {
  const bad = [];
  for (const t of text.match(/\d+(?:[.,]\d+)*/g) || []) if (!evidenceText.includes(t)) bad.push(t);
  for (const t of text.match(/[A-Za-z][A-Za-z0-9.&-]*/g) || []) if (!evidenceText.toLowerCase().includes(t.toLowerCase())) bad.push(t);
  for (const t of text.match(ORG_NOUN) || []) if (!evidenceText.includes(t)) bad.push(t);
  return bad;
}

// evidence: [{id, text}] (입력으로 준 근거 전부). 반환: 통과 질문(내부 형식)과 폐기 수.
export function validateDesignedQuestions(raw, evidence, { max = MODEL_MAX, promptVersion, extraText = '' } = {}) {
  const known = new Map(evidence.map((e) => [e.id, e.text]));
  const all = [...known.values(), extraText].join('\n');
  const out = []; let dropped = 0; const seen = new Set();
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    const text = typeof q?.text === 'string' ? q.text.trim() : '';
    const ids = Array.isArray(q?.evidence_ids) ? q.evidence_ids : [];
    const ok = text && [...text].length <= 200 && (text.match(/[?？]/g) || []).length === 1 && /[?？]$/.test(text) && !/\n/.test(text)
      && !BANNED.some((p) => p.test(text)) && !seen.has(text)
      && ids.length > 0 && ids.every((i) => typeof i === 'string' && known.has(i))
      && novelFacts(text, all).length === 0;
    if (!ok || out.length >= max) { dropped += 1; continue; }
    seen.add(text);
    const primary = RUBRIC.includes(q.target_competency) ? q.target_competency : 'relevance';
    const has = (p) => [...new Set(ids)].filter((i) => i.startsWith(p));
    out.push({
      id: `gen-q-${out.length + 1}`, text, primary, secondary: ['reasoning'], target_competency: primary,
      application_evidence_ids: has('claim-'),
      institution_evidence_ids: [...has('trait-'), ...has('elem-')],
      trend_ids: has('mock-'),
      source_status: has('mock-').length ? 'monthly_trend_mock' : (has('claim-').length ? 'user_supplied' : 'institution_review'),
      generator: 'gemini', prompt_version: promptVersion || null, _institution_basis: '학교 분석 기반(모델 생성·참고용)',
    });
  }
  return { questions: out, dropped };
}

// trends.decide 검증: use_trend===true이고 trend_ids가 모두 Mock 색인에 있어야 사용한다. 그 외는 전부 '사용 안 함'.
export function decideTrendUse(raw, catalog) {
  const ids = Array.isArray(raw?.trend_ids) ? raw.trend_ids.filter((i) => typeof i === 'string') : [];
  const valid = ids.filter((i) => (catalog || []).some((c) => c.id === i));
  const use = raw?.use_trend === true && valid.length > 0 && valid.length === ids.length;
  return { use_trend: use, trend_ids: use ? valid : [], reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 200) : '' };
}
