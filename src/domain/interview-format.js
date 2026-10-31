// 면접 형태(2026-10-31). 구현 대상은 일반 면접 5단계(GENERAL_STAGES)뿐이다. 특수 면접은 정의만 두고 선택할 수 없다.
// 본질문·근거·연결 문장은 승인 시점에 모두 정해 동결한다(꼬리질문만 면접 중 실시간).
import { buildClaimQuestions, displayQuote } from './claims.js';
import { validateDesignedQuestions, novelFacts } from './question-design.js';

// primary/secondary: 평가 차원(behavioral-ko-v1). 각 차원이 서로 다른 답변 2개 이상에서 실제로 관찰될 수 있는 단계에만 배정한다(도입·마무리에 성찰을 배정했더니 모델이 근거 부족으로 성찰을 판단 보류했다: 실측).
export const GENERAL_STAGES = Object.freeze([
  { id: 'intro', label: '도입 및 자기소개', asks: '지원 동기, 관심 분야', primary: 'relevance', secondary: [], followup: false, evidence: [] },
  { id: 'academic', label: '학업 및 전공 적합성', asks: '전공 이해도, 학습 경험', primary: 'reasoning', secondary: ['relevance'], followup: true, evidence: ['trait-', 'elem-'] },
  { id: 'experience', label: '경험 검증', asks: '실제 수행 내용, 기여도', primary: 'evidence_specificity', secondary: ['reasoning', 'reflection'], followup: true, evidence: ['claim-'] },
  { id: 'reflection', label: '문제 해결 및 성찰', asks: '실패 원인, 한계, 개선 방향', primary: 'reflection', secondary: ['reasoning', 'evidence_specificity'], followup: true, evidence: ['claim-'] },
  { id: 'closing', label: '마무리', asks: '향후 계획과 최종 질문', primary: 'relevance', secondary: [], followup: false, evidence: [] },
]);

// 특수 면접: 진행 방식만 고정해 두고(plan), 선택·구현하지 않는다.
export const SPECIAL_FORMATS = Object.freeze([
  { id: 'pressure', label: '압박 면접', flow: ['주장 확인', '반론 제시', '근거 요구', '재평가'], focus: '논리적 일관성, 대응력', enabled: false },
  { id: 'blind', label: '블라인드 면접', flow: ['익명 자기소개', '역량 경험', '상황 판단', '성찰'], focus: '직무·학업 역량', enabled: false },
  { id: 'personality', label: '인성 면접', flow: ['가치관', '갈등 경험', '윤리적 딜레마', '성찰'], focus: '책임감, 공감, 윤리', enabled: false },
  { id: 'technical', label: '기술 면접', flow: ['개념 확인', '응용 문제', '설계', '한계 분석'], focus: '전문성, 문제 해결', enabled: false },
  { id: 'situational', label: '상황 면접', flow: ['상황 제시', '행동 선택', '근거', '결과 예측'], focus: '판단력, 의사결정', enabled: false },
]);
export const INTERVIEW_FORMATS = Object.freeze([{ id: 'general', label: '일반 면접', flow: GENERAL_STAGES.map((s) => s.label), enabled: true }, ...SPECIAL_FORMATS]);

// 면접관 고정 문장. 클라이언트 FIXED와 같은 문구다.
export const SPOKEN = Object.freeze({
  opening: '안녕하세요. 지금부터 면접을 시작하겠습니다.',
  ack: '네 답변 잘 들었습니다.',
  cutoff: '네, 거기까지만 말해주시면 될 것 같습니다.',
  closing: '이것으로 면접을 마치겠습니다. 수고하셨습니다.',
});

// 단계 전환 연결 문장(Mock 뱅크). 다음 단계 id → 후보. 시드로 하나를 골라 계획에 저장한다.
export const BRIDGES = Object.freeze({
  academic: ['지원 동기는 잘 알겠습니다. 이제 전공 공부에 대해 여쭤보겠습니다.', '관심 분야가 잘 전해졌습니다. 이어서 학업과 관련된 질문을 드리겠습니다.', '좋습니다. 그럼 전공 이해에 대해 조금 더 들어 보겠습니다.'],
  experience: ['잘 알겠습니다. 이번에는 지원서에 쓴 활동을 조금 더 자세히 보겠습니다.', '전공에 대한 생각은 충분히 들었습니다. 이제 직접 하신 활동으로 넘어가 보겠습니다.', '좋습니다. 그럼 지원서에 적은 경험을 하나 짚어 보겠습니다.'],
  reflection: ['직접 하신 부분이 잘 전달됐습니다. 그 과정에서 아쉬웠던 점도 들어 보고 싶습니다.', '활동 내용은 잘 알겠습니다. 이번에는 어려웠던 점과 한계를 여쭤보겠습니다.', '좋습니다. 그 경험을 돌아보면서 질문을 하나 더 드리겠습니다.'],
  closing: ['잘 알겠습니다. 이제 마지막 질문입니다.', '충분히 들었습니다. 면접을 정리하는 질문을 드리겠습니다.', '좋습니다. 마지막으로 하나만 여쭤보겠습니다.'],
});

const LIMIT_RE = /한계|못했|못한|아쉬|실패|단정할 수 없|부족|통제하지|검증하지|않았|배제할 수 없/;
const ACTION_RE = /제작|수집|구현|설계|측정|개발|비교|분석|적용|수행|진행|탐구|조사/;
const pick = (arr, seed, salt) => arr[(((seed >>> 0) + salt * 7919) >>> 0) % arr.length];
const dept = (d) => String(d || '').trim().slice(0, 40);
// 받침에 맞춘 조사(과/와). 한글이 아니면 '과(와)'.
const gwa = (w) => { const c = String(w).trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 ? ((c - 0xac00) % 28 ? '과' : '와') : '과(와)'; };

// 지원서 원문에서 한계·아쉬움을 쓴 문장(성찰 단계 근거). 위치는 원문 코드포인트 기준으로 다시 계산한다.
export function limitationSentences(text = '', max = 3) {
  const src = String(text).normalize('NFC');
  const out = [];
  for (const m of src.matchAll(/[^.!?。\n]+[.!?。]?/g)) {
    const q = m[0].trim();
    if ([...q].length < 10 || !LIMIT_RE.test(q)) continue;
    const at = src.indexOf(q, m.index);
    const start = [...src.slice(0, at)].length;
    out.push({ id: `claim-l${out.length + 1}`, quote: q, start_cp: start, end_cp: start + [...q].length, gaps: [] });
    if (out.length >= max) break;
  }
  return out;
}

// 규칙 기반 단계 질문. 질문 문장은 고정 템플릿 + 입력 인용뿐이라 근거에 없는 사실이 들어가지 않는다.
export function ruleStageQuestions({ department, competencies = [], claims = [], limits = [] }) {
  const d = dept(department);
  const comp = competencies[0];
  // 경험 검증: 실제로 한 행동(제작·측정·구현 등)이 쓰인 주장 중 빠진 정보가 많은 문장.
  const actionClaims = claims.filter((c) => ACTION_RE.test(c.quote));
  const expQ = buildClaimQuestions(actionClaims.length ? actionClaims : claims, { max: 1 })[0];
  const expClaimId = expQ?.application_evidence_ids?.[0];
  const reflClaim = limits[0] || claims.find((c) => c.id !== expClaimId && LIMIT_RE.test(c.quote)) || claims.find((c) => c.id !== expClaimId) || claims[0];
  return {
    intro: { text: `${d ? `${d}에` : '이 학과에'} 지원한 동기와 특히 관심 있는 분야를 말씀해 주세요.`, evidence_ids: [] },
    academic: comp
      ? { text: `‘${comp.label}’${gwa(comp.label)} 관련해 고등학교에서 공부하며 가장 깊이 이해하게 된 개념이나 학습 경험을 말씀해 주세요.`, evidence_ids: [comp.id] }
      : { text: `${d ? `${d} 공부에` : '전공 공부에'} 필요한 기초를 쌓기 위해 어떤 공부를 해 왔는지 말씀해 주세요.`, evidence_ids: [] },
    experience: expQ
      ? { text: expQ.text, evidence_ids: [expClaimId] }
      : { text: '지원서에 쓴 활동 중 하나를 골라 본인이 직접 맡은 역할과 기여를 구체적으로 말씀해 주세요.', evidence_ids: [] },
    reflection: reflClaim
      ? { text: `지원서에 “${displayQuote(reflClaim.quote)}”라고 쓰셨습니다. ${limits[0] === reflClaim ? '그 한계가 생긴 원인은 무엇이었고' : '그 과정에서 부족했던 점의 원인은 무엇이었고'}, 다시 한다면 어떻게 개선하겠습니까?`, evidence_ids: [reflClaim.id] }
      : { text: '활동 중 계획대로 되지 않았던 경험에서 원인은 무엇이었고, 다시 한다면 어떻게 개선하겠습니까?', evidence_ids: [] },
    closing: { text: `마지막으로 입학 후 ${d ? `${d}에서` : '대학에서'} 이루고 싶은 계획과, 저희에게 묻고 싶은 점이 있다면 말씀해 주세요.`, evidence_ids: [] },
  };
}

// ---- 질문 설계 2단계: 구조(skeleton) 검증 ----
export const FOCUSES = ['motivation', 'concept', 'role', 'judgment', 'result', 'cause', 'improvement', 'plan'];
export const FORMS = ['open', 'case', 'compare', 'hypothetical'];
// 모델이 낸 구조를 단계 계약으로 걸러 낸다: 알려진 단계, 허용 접두사 근거 id만, enum 초점·방식. 위반한 단계는 빠진다(규칙 템플릿이 대신 쓰인다).
export function validateSkeleton(raw, knownIds) {
  const out = {}; let dropped = 0;
  const used = new Set();
  for (const st of Array.isArray(raw?.stages) ? raw.stages : []) {
    const def = GENERAL_STAGES.find((g) => g.id === st?.stage);
    const ids = Array.isArray(st?.evidence_ids) ? st.evidence_ids.filter((i) => typeof i === 'string') : [];
    const ok = def && !out[def.id] && FOCUSES.includes(st.focus) && FORMS.includes(st.form)
      && ids.length <= 2 && ids.every((i) => knownIds.has(i) && def.evidence.some((p) => i.startsWith(p)))
      && (def.evidence.length ? ids.length >= 1 : ids.length === 0)
      && !(def.id !== 'academic' && ids.some((i) => used.has(i)));
    if (!ok) { dropped += 1; continue; }
    ids.forEach((i) => used.add(i));
    out[def.id] = { stage: def.id, evidence_ids: ids, focus: st.focus, form: st.form };
  }
  return { skeleton: out, dropped };
}

const BRIDGE_BANNED = /점수|등급|합격|불합격|모범\s*답안|정답|순위|백분위/;
// 모델이 만든 단계 질문·연결 문장 검증. 단계마다 허용 근거 접두사가 다르고, 위반한 단계만 규칙 템플릿으로 남는다.
export function validateModelStages(raw, evidence, { promptVersion, extraText = '' } = {}) {
  const out = {}; let dropped = 0;
  const all = [...evidence.map((e) => e.text), extraText].join('\n');
  for (const st of Array.isArray(raw?.stages) ? raw.stages : []) {
    const def = GENERAL_STAGES.find((g) => g.id === st?.stage);
    if (!def || out[def.id]) { dropped += 1; continue; }
    const ids = Array.isArray(st.evidence_ids) ? st.evidence_ids : [];
    const allowedIds = def.evidence.length ? ids.filter((i) => def.evidence.some((p) => String(i).startsWith(p))) : [];
    // 근거가 필요한 단계는 허용 접두사 근거를 하나 이상, 도입·마무리는 근거 없이도 통과(학과명만 사용).
    const evForCheck = def.evidence.length ? evidence : [...evidence, { id: 'stage-free', text: extraText }];
    const v = validateDesignedQuestions({ questions: [{ text: st.question, evidence_ids: def.evidence.length ? allowedIds : ['stage-free'], target_competency: def.primary }] }, evForCheck, { max: 1, promptVersion, extraText });
    // 근거 단계는 허용 접두사 id만, 도입·마무리는 id가 없어야 한다(계약 위반은 그 단계만 폐기).
    if (!v.questions.length || allowedIds.length !== ids.length) { dropped += 1; continue; }
    const bridge = typeof st.bridge === 'string' ? st.bridge.trim() : '';
    const bridgeOk = bridge && [...bridge].length <= 80 && !/[?？\n]/.test(bridge) && !BRIDGE_BANNED.test(bridge) && novelFacts(bridge, all).length === 0;
    out[def.id] = { text: v.questions[0].text, evidence_ids: def.evidence.length ? allowedIds : [], ...(bridgeOk ? { bridge } : {}) };
  }
  return { stages: out, dropped };
}

// 계획 조립: 모델 단계가 있으면 우선, 없으면 규칙 템플릿. 근거 상세(인용·출처)는 질문에 같이 저장해 보고서 i 버튼이 쓴다.
export function buildGeneralPlan({ department, competencies = [], claims = [], limits = [], modelStages = {}, seed = 0, generator = 'rule', provider_trace = [] }) {
  const rule = ruleStageQuestions({ department, competencies, claims, limits });
  const byId = new Map([...competencies.map((c) => [c.id, { kind: 'institution', id: c.id, label: c.label, quote: c.quote || null, status: c.status || null, source_title: c.source_title || null, url: c.url || null }]), ...[...claims, ...limits].map((c) => [c.id, { kind: 'application', id: c.id, quote: c.quote, start_cp: c.start_cp, end_cp: c.end_cp, gaps: c.gaps || [] }])]);
  const stages = GENERAL_STAGES.map((def, i) => {
    const m = modelStages[def.id];
    const q = m || rule[def.id];
    const next = GENERAL_STAGES[i + 1];
    return {
      id: `stage-${def.id}`, stage: def.id, stage_label: def.label, text: q.text,
      primary: def.primary, secondary: [...def.secondary], followup_allowed: def.followup,
      evidence: q.evidence_ids.map((id) => byId.get(id)).filter(Boolean),
      generator: m ? generator : 'rule',
      bridge: next ? (m?.bridge && modelStages[next.id] ? m.bridge : pick(BRIDGES[next.id], seed, i)) : null,
    };
  });
  return {
    format: 'general', stages, generator: stages.some((s) => s.generator !== 'rule') ? generator : 'rule', provider_trace, designed_at: new Date().toISOString(),
    // 보고서의 대학 역량 적합성 차트가 쓰는 목록(승인 시점 동결).
    competencies: competencies.map((c) => ({ id: c.id, label: c.label, status: c.status || null })),
  };
}

// ---- 면접 중 규칙 기반 판단(모델이 막히거나 실패했을 때) ----
// 답변 완료 판단은 브라우저가 한다(public/core/sentence.js: 종결어미 + 3초 정적).

// 꼬리질문 여부: 단계별로 질문이 요구한 요소가 답변에 보이지 않을 때만. 문장은 검수된 고정 문장이다.
const RULE_FOLLOWUP = {
  academic: { need: (t) => !/이유|근거|기준|때문|원리/.test(t), text: '그 내용을 그렇게 이해하게 된 근거나 판단 기준은 무엇이었나요?' },
  experience: { need: (t) => !/제가|저는|본인|직접/.test(t) || !/결과|확인|바뀌|개선|높였|줄였|측정/.test(t), text: '그 과정에서 본인이 직접 한 일과 그 결과를 구체적으로 말씀해 주시겠어요?' },
  reflection: { need: (t) => !/원인|때문|한계|부족/.test(t) || !/다음|개선|바꾸|다시|계획/.test(t), text: '그 한계가 생긴 원인과 다음에 바꿀 방법을 한 가지씩 말씀해 주시겠어요?' },
};
export function ruleFollowup(stage, text) {
  const r = RULE_FOLLOWUP[stage];
  return r && r.need(String(text)) ? r.text : null;
}

// 답변 하나에 대한 참고 점수(1~4). 의미 평가가 아니라 표지어·길이 휴리스틱이다(ponytail: 실모델 평가와 사람 검수 비교 전까지 참고용).
export function ruleTurnScore(text) {
  const t = String(text); const n = [...t.trim()].length;
  const c = (re) => (re.test(t) ? 1 : 0);
  const cap = (v) => Math.max(1, Math.min(4, v));
  return {
    relevance: cap(n < 20 ? 1 : n < 60 ? 2 : 3 + c(/(다|요)[.!]?\s*$/) * (n >= 120 ? 1 : 0)),
    specificity: cap(1 + c(/제가|저는|본인|직접/) + c(/\d|결과|측정|비교/) + (n >= 120 ? 1 : 0)),
    reasoning: cap(1 + c(/이유|근거|기준|때문/) + c(/그래서|따라서|그 결과|비교|반면/) + c(/대안|한계|다만|그러나/)),
  };
}
export function validTurnScore(s) {
  return !!s && ['relevance', 'specificity', 'reasoning'].every((k) => Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= 4);
}

// 대학 역량 적합성(보고서 차트): 역량 이름의 단어가 답변에 나온 답변 수와 그 답변들의 평균 참고 점수. 키워드 일치 기반 참고 지표다.
export function competencyFit(competencies = [], turns = []) {
  return competencies.map((c) => {
    const words = String(c.label).split(/[\s·,/()]+/).map((w) => w.replace(/(역량|능력|태도|적합성|이해|적|의|과|와|및)$/u, '')).filter((w) => [...w].length >= 2);
    const hits = turns.filter((t) => words.some((w) => t.text.includes(w)));
    const avg = hits.length ? hits.reduce((s, t) => s + (t.turn_score ? (t.turn_score.relevance + t.turn_score.specificity + t.turn_score.reasoning) / 3 : 0), 0) / hits.length : 0;
    return { id: c.id, label: c.label, status: c.status, answers: hits.length, avg_score: Math.round(avg * 10) / 10, turn_ids: hits.map((t) => t.turn_id) };
  });
}

// 세션용 질문 목록(서버 내부 형식). application_evidence는 기존 보고서·주장 연결 코드가 읽는다.
export const stageQuestions = (plan) => (plan?.stages || []).map((s) => ({
  id: s.id, text: s.text, primary: s.primary, secondary: s.secondary, stage: s.stage, stage_label: s.stage_label,
  followup_allowed: s.followup_allowed, bridge: s.bridge, evidence: s.evidence,
  ...(s.evidence.some((e) => e.kind === 'application') ? { application_evidence: s.evidence.filter((e) => e.kind === 'application') } : {}),
  followup_dimensions: [s.primary],
}));
