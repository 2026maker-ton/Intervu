// 기관별 맞춤형 면접 프로필: 수집 자료 → 분석 → 질문/평가 연결.
// 원칙: 확인되지 않은 기업 정보·기출을 만들어내지 않는다.
// 공식 자료가 없으면 일반 템플릿으로 폴백하고 그 사실을 배지로 표시한다.
import { freshnessOf, detectConflicts, sourcePrivacyCheck } from './sources.js';

// 기관 구분 (신규 4종 + 기존 호환)
export const ORG_TYPES = {
  company: { label: '일반기업', school: false, focus: ['직무 수행 능력', '경험', '문제해결', '협업'] },
  general: { label: '일반기업', school: false, aliasOf: 'company', focus: ['직무 수행 능력', '경험', '문제해결', '협업'] },
  public: { label: '공공기관', school: false, focus: ['직무 수행 능력', '공직 가치', '문제해결', '협업'] },
  university: { label: '대학교', school: true, adult: true, focus: ['학업·진로계획', '지원동기', '활동 경험', '전형 평가요소'] },
  highschool: { label: '고등학교', school: true, adult: false, focus: ['학업·진로계획', '지원동기', '활동 경험', '전형 평가요소'] },
};

export function normalizeOrgType(raw) {
  if (!raw) return 'general';
  const t = String(raw).trim().toLowerCase();
  if (ORG_TYPES[t]) return t;
  // 한글 입력 호환
  if (t.includes('고등')) return 'highschool';
  if (t.includes('대학')) return 'university';
  if (t.includes('공공')) return 'public';
  if (t.includes('기업') || t.includes('회사')) return 'company';
  return 'general';
}

export function isMinorPossible(orgType) {
  return normalizeOrgType(orgType) === 'highschool';
}

// 학교 면접은 미성년자 이용 가능 → Gemini 외부 호출 금지, Mock 강제.
// 호출자가 provider 선택 전에 반드시 확인한다.
export function providerConstraintForOrg(orgType) {
  if (isMinorPossible(orgType)) {
    return {
      forceMock: true,
      reason: '고등학교 입학면접(미성년자 이용 가능): Gemini 연령 제한·보호자 요건 확인 전에는 Mock으로만 검증합니다.',
    };
  }
  return { forceMock: false };
}

const COMPETENCY_KEYWORDS = [
  { kw: '문제 해결', competency: 'reasoning', label: '문제해결' },
  { kw: '협업', competency: 'evidence_specificity', label: '협업' },
  { kw: '소통', competency: 'relevance', label: '소통' },
  { kw: '데이터', competency: 'evidence_specificity', label: '데이터 기반 실행' },
  { kw: '고객', competency: 'relevance', label: '고객 지향' },
  { kw: '기획', competency: 'reasoning', label: '기획력' },
  { kw: '운영', competency: 'evidence_specificity', label: '운영 실행' },
  { kw: '분석', competency: 'reasoning', label: '분석력' },
  { kw: '우선순위', competency: 'reasoning', label: '우선순위 판단' },
  { kw: '갈등', competency: 'evidence_specificity', label: '갈등 조정' },
  { kw: '지원동기', competency: 'relevance', label: '지원동기' },
  { kw: '진로', competency: 'reflection', label: '진로계획' },
  { kw: '학업', competency: 'relevance', label: '학업 역량' },
  { kw: '봉사', competency: 'reflection', label: '공동체 기여' },
  { kw: '탐구', competency: 'reasoning', label: '탐구력' },
  { kw: '전공', competency: 'relevance', label: '전공 적합성' },
];

// 기관 프로필 생성 (결정적, LLM 없이 서버에서 계산 → 환각 원천 차단)
export function buildInstitutionProfile({ orgType: rawOrg, targetName = '', role = '', sources = [], claims = [], userNotes = '' }) {
  const orgType = normalizeOrgType(rawOrg);
  const meta = ORG_TYPES[orgType];
  const official = sources.filter((s) => s.kind === 'official' || (s.status || '').includes('official'));
  const unofficial = sources.filter((s) => s.kind === 'unofficial' || (s.status || '').includes('unofficial'));

  // 출처 텍스트 풀 (공식 우선)
  const corpus = [...official, ...unofficial].map((s) => `${s.title || ''} ${s.quote || ''}`).join('\n');
  const claimText = (claims || []).map((c) => c.quote || c.value || '').join('\n');
  const fullText = `${corpus}\n${claimText}\n${userNotes || ''}`;

  // 핵심 가치·요구 역량: 원문에 실제로 등장한 키워드만 "확인됨"으로 표시
  const confirmed = [];
  for (const { kw, competency, label } of COMPETENCY_KEYWORDS) {
    if (fullText.includes(kw)) {
      const src = findSourceForKeyword([...official, ...unofficial, ...claims.map((c) => ({ title: '공고 본문', quote: c.quote || c.value }))], kw);
      confirmed.push({
        key: kw, label, competency,
        basis: 'official' in (src || {}) || (src?.from === 'official') ? 'official' : src ? 'user' : 'user',
        source_title: src?.title || null,
        source_quote: src?.quote || kw,
      });
    }
  }

  // 직무·학과별 중요 항목 (학교 vs 기업 분기, 가정은 assumption 배지)
  const roleFocus = role
    ? [{ item: `${role} 관련 경험·동기`, basis: 'user', note: '사용자가 입력한 지원 직무·학과를 기준으로 합니다. 기관이 공개한 세부 기준이 아닙니다.' }]
    : [];

  // 확인된 면접 형식 (원문에 면접 시간·인원·형식 언급이 있을 때만)
  const formats = [];
  if (/면접/.test(fullText)) {
    formats.push({ item: '면접 실시 언급 있음', basis: fullText.includes('토론') ? 'official' : 'user', note: '형식 세부(시간·인원·배점)는 공고 원문을 확인하세요.' });
  }
  if (/토론/.test(fullText)) formats.push({ item: '토론 형식 언급', basis: 'official', note: '원문 표현을 그대로 따릅니다.' });
  if (/발표|PT/.test(fullText)) formats.push({ item: '발표(PT) 형식 언급', basis: 'official', note: '원문 표현을 그대로 따릅니다.' });
  if (/블라인드/.test(fullText)) formats.push({ item: '블라인드 언급', basis: 'official', note: '원문 표현을 그대로 따릅니다.' });

  // 권장 연습 질문: 확인된 역량마다 1개씩, 근거 표시. 확인된 역량이 없으면 일반 템플릿 3개.
  const questions = buildRecommendedQuestions({ orgType, confirmed, role });
  // 평가 가능/불가능 영역
  const evaluable = confirmed.map((c) => ({ competency: c.competency, label: c.label, basis: c.basis }));
  const unevaluable = buildUnevaluable({ orgType, confirmed });

  const conflicts = detectConflicts([
    ...sources.map((s) => ({ key: s.title || s.url || '', text: s.title || s.url || '', value: s.quote || '' })),
  ]);
  const freshness = sources.map((s) => ({ title: s.title || s.url, ...freshnessOf(s) }));
  const privacy = sourcePrivacyCheck(sources);
  const hasOfficial = official.length > 0 && confirmed.length > 0;
  const fallbackToGeneral = !hasOfficial;

  return {
    org_type: orgType,
    org_label: meta.label,
    target_name: String(targetName || '').slice(0, 100),
    role: String(role || '').slice(0, 100),
    focus_areas: meta.focus,
    core_values: confirmed.length
      ? confirmed.map((c) => ({ label: c.label, competency: c.competency, basis: c.basis, source_title: c.source_title, source_quote: c.source_quote }))
      : [{ label: '일반 역량(확인된 기관 고유 역량 없음)', competency: 'relevance', basis: 'assumption', note: '기관 공식 자료를 확보하지 못해 일반 템플릿으로 연습합니다.' }],
    role_focus: roleFocus,
    formats: formats.length ? formats : [{ item: '면접 형식 미확인 — 1:1 일반 연습으로 구성', basis: 'assumption', note: '공고에 형식이 명시되어 있지 않습니다.' }],
    recommended_questions: questions,
    evaluable,
    unevaluable,
    sources_summary: {
      official_count: official.length,
      unofficial_count: unofficial.length,
      freshness,
      conflicts,
      privacy_issues: privacy,
    },
    badge: hasOfficial ? '기관 맞춤 검토 가능' : '일반 템플릿 — 기관 맞춤 검증 아님',
    fallback_to_general: fallbackToGeneral,
    generated_at: new Date().toISOString(),
    disclaimer: 'AI 연습용 분석이며 기관의 비공개 채점기준을 아는 것처럼 표현하지 않습니다. 비공식 후기는 참고용으로만 사용하세요.',
  };
}

function findSourceForKeyword(sources, kw) {
  for (const s of sources) {
    const t = `${s.title || ''} ${s.quote || ''} ${s.value || ''}`;
    if (t.includes(kw)) {
      const isOfficial = /go\.kr|ac\.kr|요강|채용공고|직무기술서|인재상/i.test(t) || s.kind === 'official';
      return { title: s.title || '공고 본문', quote: kw, from: isOfficial ? 'official' : 'user' };
    }
  }
  return null;
}

function buildRecommendedQuestions({ orgType, confirmed, role }) {
  const isSchool = ORG_TYPES[normalizeOrgType(orgType)]?.school;
  const bank = isSchool ? SCHOOL_QUESTIONS : COMPANY_QUESTIONS;
  if (!confirmed.length) {
    return bank.slice(0, 3).map((q) => ({ ...q, basis: 'assumption', rationale: '확인된 기관 자료가 없어 일반 연습 질문을 제공합니다.' }));
  }
  return confirmed.slice(0, 5).map((c, i) => {
    const base = bank[i % bank.length];
    return {
      id: `inst-q${i + 1}`,
      text: base.text.replace('{역량}', c.label).replace('{직무}', role || (isSchool ? '지원 학과' : '지원 직무')),
      primary: c.competency,
      secondary: [],
      basis: c.basis,
      rationale: c.source_title
        ? `‘${c.source_title}’에서 확인된 ‘${c.source_quote}’ 요구와 연결됩니다.`
        : `사용자 입력에서 확인된 ‘${c.label}’ 요구와 연결됩니다.`,
      source_quote: c.source_quote,
    };
  });
}

const COMPANY_QUESTIONS = [
  { id: 'c1', text: '{직무}에서 {역량}이 필요했던 경험을 설명해 주세요.', primary: 'evidence_specificity' },
  { id: 'c2', text: '{역량}과 관련해 우선순위를 정한 경험과 이유를 설명해 주세요.', primary: 'reasoning' },
  { id: 'c3', text: '협업 중 의견이 엇갈렸을 때 {역량}을 발휘한 경험을 말해 주세요.', primary: 'evidence_specificity' },
  { id: 'c4', text: '예상과 달랐던 결과에서 {역량} 관점으로 배운 점을 말해 주세요.', primary: 'reflection' },
  { id: 'c5', text: '{직무}의 고객·이해관계자 요구와 내부 기준이 충돌하면 어떻게 판단하겠습니까?', primary: 'reasoning' },
];

const SCHOOL_QUESTIONS = [
  { id: 's1', text: '{직무}에 지원한 동기와 {역량}을 키운 경험을 설명해 주세요.', primary: 'relevance' },
  { id: 's2', text: '학업·활동 중 {역량}이 드러난 경험과 본인의 역할을 말해 주세요.', primary: 'evidence_specificity' },
  { id: 's3', text: '진로계획과 관련해 {역량}을 어떻게 발전시킬지 설명해 주세요.', primary: 'reflection' },
  { id: 's4', text: '어려웠던 과제에서 {역량} 관점으로 판단한 기준을 말해 주세요.', primary: 'reasoning' },
  { id: 's5', text: '전형에서 평가할 수 있는 {역량}을 보여주는 활동을 소개해 주세요.', primary: 'evidence_specificity' },
];

function buildUnevaluable({ orgType, confirmed }) {
  const base = [
    { area: '실제 기관의 비공개 채점기준·배점', reason: '공개 자료에 없으므로 평가하지 않습니다.' },
    { area: '서류·성적·자격증의 사실 여부', reason: '진위 확인 기능이 없습니다.' },
    { area: '합격 가능성·순위', reason: '예측하지 않습니다.' },
  ];
  if (isMinorPossible(orgType)) {
    base.push({ area: '미성년자 대상 정밀 평가', reason: '연령·보호자 요건 확인 전까지 Mock 연습 범위로만 제공합니다.' });
  }
  if (!confirmed.length) {
    base.push({ area: '기관 고유 역량', reason: '공식 자료 미확보 — 일반 역량만 관찰합니다.' });
  }
  return base;
}

// 보고서 연결: 사용자 답변이 기관의 공개 요구사항 중 무엇을 근거로 제시했는지 분석.
// 환각 방지: 요구 텍스트가 답변에 실제로 포함된 키워드와 겹칠 때만 observed.
export function linkAnswersToInstitution({ institution, turnsWithText }) {
  if (!institution || institution.fallback_to_general) {
    return {
      mode: 'general',
      note: '확인된 기관 요구사항이 없어 일반 역량 기준으로만 분석합니다.',
      links: [],
      uncovered: [],
    };
  }
  const reqs = institution.core_values || [];
  const links = [];
  const covered = new Set();
  for (const t of turnsWithText || []) {
    const text = t.text || '';
    for (const r of reqs) {
      const key = r.label || r.key;
      if (!key) continue;
      // 키워드 매칭: 라벨 전체 또는 2자 이상 토큰
      const tokens = key.split(/[\s·/,-]+/).filter((x) => [...x].length >= 2);
      const hit = text.includes(key) || tokens.some((tk) => text.includes(tk));
      // 행동 근거 동반 여부 (구체성)
      const hasAction = /(제가|저는|직접|제시|비교|조정|합의|설득)/.test(text);
      if (hit) {
        covered.add(key);
        links.push({
          requirement: key,
          competency: r.competency,
          basis: r.basis,
          turn_id: t.turn_id,
          observed_with_evidence: !!hasAction,
          note: hasAction
            ? `‘${key}’ 요구에 대해 본인 행동 근거를 함께 제시했습니다.`
            : `‘${key}’ 요구를 언급했으나 본인 행동 근거는 아직 확인되지 않았습니다.`,
        });
      }
    }
  }
  const uncovered = reqs
    .map((r) => r.label || r.key)
    .filter((k) => k && !covered.has(k))
    .map((k) => ({ requirement: k, note: '이번 면접에서 아직 관찰되지 않았습니다. 재연습 질문으로 보완하세요.' }));
  return { mode: 'institution', note: '기관이 공개적으로 강조한 요구와 답변의 연결을 분석합니다.', links, uncovered };
}
