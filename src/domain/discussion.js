// 토론 시뮬레이터 (결정적 상태머신 + 문맥 반응형 발화)
// 원칙: 미리 쓴 대사를 순서대로 출력하지 않고, 직전 발언·주장·단계를 참조해 발화를 조합한다.
// 생성형 AI처럼 이해한다고 과장하지 않는다 — 키워드·주장 참조 기반 결정적 시뮬레이터다.
export const DISCUSSION_TOPICS = [
  {
    id: 'library-weekend',
    title: '지역 공공도서관 한정 예산 우선 사업',
    brief: '지역 공공도서관이 한정된 예산으로 주말 운영 연장과 디지털 교육 중 우선 사업을 정하려 합니다. 아래 숫자와 제약은 현실 통계가 아니라 연습용 가정입니다. (가정) 예산 1단위, 기간 3개월, 인력 2명.',
    claims_seed: [
      { claim_id: 'c-budget', text: '예산 1단위·기간 3개월·인력 2명이라는 제약을 함께 봐야 합니다. (가정)' },
      { claim_id: 'c-access', text: '주말 이용자와 평일 이용자의 접근 조건이 다릅니다. (연습 가정)' },
    ],
    stance_a: '운영 가능성 우선 — 적은 인력으로 지속 가능한 안을 먼저 본다.',
    stance_b: '이용 접근성 우선 — 접근이 어려운 이용자의 편익을 먼저 본다.',
  },
  {
    id: 'campus-shuttle',
    title: '캠퍼스 통학버스 노선 조정',
    brief: '대학교가 통학버스 2대 중 1대의 노선을 조정하려 합니다. 아래 조건은 연습용 가정입니다. (가정) 오전 집중 시간대 혼잡, 야간 수업 학생 소수 존재.',
    claims_seed: [
      { claim_id: 'c-congestion', text: '오전 집중 시간대 혼잡이 확인된 조건입니다. (연습 가정)' },
      { claim_id: 'c-night', text: '야간 수업 학생의 이동이 제약 조건입니다. (연습 가정)' },
    ],
    stance_a: '운영 가능성 우선 — 정시성과 안전 운행을 먼저 본다.',
    stance_b: '이용 접근성 우선 — 소수 이용자의 이동권을 먼저 본다.',
  },
  {
    id: 'festival-budget',
    title: '동아리 축제 예산 배분',
    brief: '학생회가 축제 예산을 공연과 체험 부스 중 어디에 둘지 정하려 합니다. (가정) 총액 고정, 안전 인력 별도 필요.',
    claims_seed: [
      { claim_id: 'c-fixed', text: '총액이 고정되어 있어 한쪽을 늘리면 한쪽이 줍니다. (연습 가정)' },
      { claim_id: 'c-safety', text: '안전 인력이 별도로 필요합니다. (연습 가정)' },
    ],
    stance_a: '운영 가능성 우선 — 안전과 진행 안정성을 먼저 본다.',
    stance_b: '이용 접근성 우선 — 다양한 참여 기회를 먼저 본다.',
  },
];

export const DISCUSSION_PHASES = ['reading', 'opening', 'exchange', 'agreement', 'closing'];

const AI_A = { id: 'ai-a', name: 'AI 참가자 A', perspective: '운영 가능성' };
const AI_B = { id: 'ai-b', name: 'AI 참가자 B', perspective: '이용 접근성' };

export function createDiscussionState(seed = 1, topicId = null) {
  const topic = DISCUSSION_TOPICS.find((t) => t.id === topicId) || DISCUSSION_TOPICS[seed % DISCUSSION_TOPICS.length];
  return {
    topic_id: topic.id,
    phase: 'reading',
    phase_turn: 0,
    total_turns: 0,
    next_speaker: 'moderator', // 사회자 오프닝 → A 입론 → 사용자
    consecutive_ai: 0,
    user_turns: 0,
    user_opportunities: 0, // 사용자에게 발언권이 보장된 횟수
    last_speaker: 'moderator',
    last_ai: 'ai-a',
    phase_announced: 'reading',
    last_claim_id: 'c-budget',
    last_claim_text: topic.claims_seed[0]?.text || '',
    claims: topic.claims_seed.map((c) => ({ ...c, speaker: 'moderator' })),
    agreed_points: [],
    log: [],
  };
}

function pickKeyword(text = '') {
  const t = String(text);
  const kws = ['예산', '시간', '인력', '안전', '접근', '주말', '야간', '혼잡', '비용', '일정', '합의', '대안', '근거', '결과', '운영', '이용자', '학생', '통학', '공연', '체험'];
  for (const k of kws) if (t.includes(k)) return k;
  // 2자 이상 토큰 폴백
  const m = t.replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, ' ').split(/\s+/).find((w) => [...w].length >= 2);
  return m || null;
}

// AI 발화 생성: (내 관점 + 참조 대상의 주장/키워드 + 단계 목표)를 조합한다.
export function nextAiUtterance(disc, speakerId, userText = '') {
  const topic = DISCUSSION_TOPICS.find((t) => t.id === disc.topic_id) || DISCUSSION_TOPICS[0];
  const me = speakerId === 'ai-b' ? AI_B : AI_A;
  const other = speakerId === 'ai-b' ? AI_A : AI_B;
  const kw = pickKeyword(userText) || pickKeyword(disc.last_claim_text);
  const ref = disc.last_claim_text ? `직전 발언(“${truncate(disc.last_claim_text, 40)}”)에서 ` : '';
  const kwPart = kw ? `‘${kw}’와 관련해 ` : '';
  let body = '';
  if (disc.phase === 'opening') {
    const stance = speakerId === 'ai-b' ? topic.stance_b : topic.stance_a;
    body = `${kwPart}${stance} ${ref}이 관점에서 입론합니다. 근거는 자료의 제약 조건입니다.`;
  } else if (disc.phase === 'exchange') {
    // 반론: 상대 주장의 약한 연결을 짚고 내 관점 대안 제시
    body = `${ref}${kwPart}${other.name}의 주장에서 빠진 연결이 있습니다. ${me.perspective} 관점에서는 이렇게 봅니다. 대안으로 단계적 도입을 제안합니다.`;
    if (userText) body = `사용자 의견에서 ${kw ? `‘${kw}’ 부분을 ` : ''}받았습니다. ${body}`;
  } else if (disc.phase === 'agreement') {
    body = `합의를 위해 양보할 점과 지킬 점을 말합니다. ${ref}${kwPart}공통 조건을 기준으로 절충안을 제안합니다.`;
  } else {
    body = `${ref}${kwPart}마무리 의견을 말합니다.`;
  }
  const text = `[${me.name}·${me.perspective}] ${body}`.slice(0, 240);
  const claim_id = `c-${disc.total_turns + 1}-${speakerId}`;
  return { speaker_id: speakerId, speaker_name: me.name, perspective: me.perspective, claim_id, responds_to: disc.last_claim_id, text };
}

function truncate(s, n) {
  const c = [...String(s || '')];
  return c.length > n ? c.slice(0, n).join('') + '…' : c.join('');
}

// 사회자 멘트 (결정적)
export function moderatorLine(disc, kind) {
  const topic = DISCUSSION_TOPICS.find((t) => t.id === disc.topic_id) || DISCUSSION_TOPICS[0];
  switch (kind) {
    case 'open':
      return `[사회자] 주제는 “${topic.title}”입니다. 자료: ${topic.brief} 먼저 A의 입론을 듣겠습니다.`;
    case 'to_user':
      return '[사회자] 사용자 차례입니다. 한 가지 입장을 1분 내로 말해 주세요.';
    case 'to_b':
      return '[사회자] 다음은 B의 반론입니다.';
    case 'to_a':
      return '[사회자] 다음은 A의 반론입니다.';
    case 'agreement':
      return '[사회자] 이제 합의안을 모아봅니다. 양보할 점과 지킬 점을 각각 말해 주세요.';
    case 'closing':
      return '[사회자] 논의를 정리합니다. 합의점과 남은 쟁점을 확인하겠습니다.';
    default:
      return '[사회자] 다음 발언을 이어가겠습니다.';
  }
}

// 상태 전이: 발언 1건 기록 후 다음 화자·단계를 결정한다.
// 규칙: (1) AI가 연속 2회 말한 뒤에는 반드시 사용자 차례, (2) 사용자 발언 기회 최소 4회 보장,
// (3) 단계는 사용자 발언 횟수로 전이해 결정적으로 재현된다.
export function recordDiscussionTurn(disc, { speaker_id, claim_id, text }) {
  disc.total_turns += 1;
  disc.phase_turn += 1;
  disc.last_speaker = speaker_id;
  disc.last_claim_id = claim_id || disc.last_claim_id;
  disc.last_claim_text = text || disc.last_claim_text;
  disc.claims.push({ claim_id: disc.last_claim_id, speaker: speaker_id, text: disc.last_claim_text });
  if (disc.claims.length > 30) disc.claims = disc.claims.slice(-30);
  disc.log.push({ speaker_id, claim_id: disc.last_claim_id, phase: disc.phase });

  if (speaker_id === 'user') {
    disc.user_turns += 1;
    disc.consecutive_ai = 0;
    disc.user_opportunities = disc.user_turns;
  } else if (speaker_id.startsWith('ai-')) {
    disc.consecutive_ai += 1;
    disc.last_ai = speaker_id;
  } else {
    disc.consecutive_ai = 0;
  }

  // 단계 전이 (사용자 발언 횟수 기준, 결정적)
  if (disc.phase === 'reading') setPhase(disc, 'opening');
  if (speaker_id === 'user' && disc.user_turns === 1) setPhase(disc, 'exchange');
  if (speaker_id === 'user' && disc.user_turns === 3) setPhase(disc, 'agreement');
  // 4번째 사용자 발언 뒤 AI 응답까지 마치면 마무리 단계로
  if (disc.user_turns >= 4 && disc.phase === 'agreement') setPhase(disc, 'closing');

  // 다음 화자: AI 발언 뒤에는 항상 사용자 차례(2연속 금지) → 발언 기회 보장
  if (disc.phase === 'closing') disc.next_speaker = 'moderator';
  else if (speaker_id === 'moderator') disc.next_speaker = 'ai-a';
  else if (speaker_id.startsWith('ai-')) disc.next_speaker = 'user';
  else disc.next_speaker = disc.last_ai === 'ai-b' ? 'ai-a' : 'ai-b';
  return disc;
}

// 토론 종료 조건: 사용자 최소 4회 발언 + 마무리 단계 도달
export function isDiscussionComplete(disc) {
  return !!disc && disc.user_turns >= 4 && disc.phase === 'closing';
}

function setPhase(disc, phase) {
  disc.phase = phase;
  disc.phase_turn = 0;
}

export function discussionParticipants() {
  return [AI_A, AI_B];
}
