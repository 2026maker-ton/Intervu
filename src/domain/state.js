// 세션/턴 상태기계 — implementation-spec §4 단일 진실 원천
export const SESSION = ['draft', 'ready', 'active', 'paused', 'completing', 'completed', 'aborted', 'deleting', 'deleted'];
export const TURN = ['queued', 'ai_speaking', 'user_listening', 'transcribing', 'committed', 'deciding', 'done', 'interrupted'];

const SESSION_NEXT = {
  draft: ['ready', 'aborted'],
  ready: ['active', 'aborted'],
  active: ['paused', 'completing', 'aborted'],
  paused: ['active', 'completing', 'aborted'],
  completing: ['completed', 'aborted'],
  completed: [],
  aborted: [],
  deleting: ['deleted'],
  deleted: [],
};

export function canSessionTransition(from, to) {
  if (from === to) return false;
  // 삭제는 모든 동작보다 우선
  if (from !== 'deleting' && from !== 'deleted' && to === 'deleting') return true;
  return (SESSION_NEXT[from] || []).includes(to);
}

const TURN_NEXT = {
  queued: ['ai_speaking', 'interrupted'],
  ai_speaking: ['user_listening', 'interrupted'],
  user_listening: ['transcribing', 'interrupted'],
  transcribing: ['committed', 'user_listening'],
  committed: ['deciding'],
  deciding: ['done', 'queued'],
  done: [],
  interrupted: ['queued', 'user_listening'],
};

export function canTurnTransition(from, to) {
  return (TURN_NEXT[from] || []).includes(to);
}

// 진행기 액션 결정(서버가 최종 결정, 모델 제안은 참고)
export function decideNextAction({ timeUp, followupsUsed, followupsPerQuestion, remainingCore, transcriptEmpty, unanswered }) {
  if (timeUp) return 'finish';
  if (transcriptEmpty || unanswered) return 'clarify';
  if (followupsUsed < 3 && followupsPerQuestion < 1 && remainingCore > 0) return 'ask_followup';
  if (remainingCore > 0) return 'next_question';
  return 'finish';
}

export function mapAction(a) {
  return { ask_followup: 'ASK_FOLLOWUP', next_question: 'ASK_CORE', clarify: 'CLARIFY', finish: 'CLOSE' }[a] || 'CLARIFY';
}
