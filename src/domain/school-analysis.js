// 학교 분석 결과의 서버 검증·규칙 기반 폴백·병합(docs/plan/09 §3.3). 모델 출력은 신뢰하지 않는다:
// 모든 quote는 소스 본문의 부분 문자열이어야 하고, 위치(start_cp/end_cp)는 서버가 다시 계산한다.
import { COMPETENCY_KEYWORDS } from './institution.js';

const CATS = [['talent_traits', 'trait', '인재상'], ['admission_elements', 'elem', '전형요소'], ['interview_format', null, '면접 형식']];
const nfc = (s) => String(s ?? '').normalize('NFC');
const cp = (s) => Array.from(s).length;

// segments: [{id, text}]. 인용은 한 소스 안에서 그대로 찾을 때만 채택한다(소스 경계를 넘는 인용 금지).
export function locateQuote(segments, quote) {
  const q = nfc(quote).trim();
  if (q.length < 2) return null;
  for (const seg of segments) {
    const i = seg.text.indexOf(q);
    if (i !== -1) {
      const start = cp(seg.text.slice(0, i));
      return { source_id: seg.id, quote: q.slice(0, 300), start_cp: start, end_cp: start + cp(q) };
    }
  }
  return null;
}

// 분류 결과 {talent_traits, admission_elements, interview_format}에서 검증을 통과한 항목만 남기고 id를 붙인다.
export function verifyAnalysis(raw, segments) {
  const out = {}; let dropped = 0;
  for (const [key, prefix] of CATS) {
    const seen = new Set(); const items = [];
    for (const it of Array.isArray(raw?.[key]) ? raw[key] : []) {
      const loc = locateQuote(segments, it?.quote);
      const label = nfc(it?.label).trim().slice(0, 12);
      if (!loc || !label || seen.has(loc.quote)) { dropped += 1; continue; }
      seen.add(loc.quote);
      if (items.length < 6) items.push({ ...(prefix ? { id: `${prefix}-${items.length + 1}` } : {}), label, ...loc });
    }
    out[key] = items;
  }
  return { ...out, dropped };
}

// 규칙 기반 폴백: 원문 문장 중 키워드·범주 단어가 있는 문장을 그대로 인용한다.
const sentencesOf = (text) => nfc(text).split(/(?<=[.。!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 2);
export function ruleBasedAnalysis(segments) {
  const raw = { talent_traits: [], admission_elements: [], interview_format: [] };
  for (const seg of segments) {
    for (const s of sentencesOf(seg.text)) {
      const hit = COMPETENCY_KEYWORDS.find((k) => s.includes(k.kw));
      if (hit && /인재상|역량|태도|적합/.test(s)) raw.talent_traits.push({ label: hit.label, quote: s });
      if (/전형|서류|학생부|반영|선발|지원 ?자격/.test(s)) raw.admission_elements.push({ label: s.includes('면접') ? '면접 포함 전형' : '전형 요소', quote: s });
      if (/면접/.test(s)) raw.interview_format.push({ label: '면접 언급', quote: s });
    }
  }
  return raw;
}

// 모델이 못 찾았거나 원문에 없는 범주는 추측하지 않고 unconfirmed로 남긴다.
export function buildUnconfirmed(verified, modelNotes = []) {
  const list = [];
  for (const [key, , label] of CATS) if (!verified[key].length) list.push(`${label} 미확인`);
  const fmt = verified.interview_format.map((x) => x.quote).join(' ');
  if (!/\d+\s*(분|명|점|%)/.test(fmt)) list.push('면접 시간·배점 미확인');
  for (const n of modelNotes) { const t = nfc(n).trim().slice(0, 60); if (t && !list.includes(t) && list.length < 8) list.push(t); }
  return list;
}

// 기존 기관 프로필 구조에 병합(승인 흐름 유지): 확인된 인재상만 core_values로 올리고 출처·확인 시점을 남긴다.
export function mergeIntoInstitution(inst, analysis, sourcesById) {
  const kwOf = (label) => COMPETENCY_KEYWORDS.find((k) => k.label === label);
  const core = analysis.talent_traits.map((t) => ({
    label: t.label, competency: kwOf(t.label)?.competency || 'relevance', basis: 'official', trait_id: t.id,
    source_title: sourcesById[t.source_id]?.title || null, source_quote: t.quote, confirmed_at: sourcesById[t.source_id]?.confirmed_at || analysis.analyzed_at,
  }));
  return {
    ...inst,
    core_values: core.length ? core : inst.core_values,
    formats: analysis.interview_format.length ? analysis.interview_format.map((f) => ({ item: f.label, basis: 'official', note: f.quote })) : inst.formats,
    school_analysis: analysis,
  };
}
