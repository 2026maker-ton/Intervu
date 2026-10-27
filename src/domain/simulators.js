// 유형별 Mock 시뮬레이터: 상태 + 사용자 발언에 따라 진행되는 결정적 시뮬레이터.
// 고정 대사가 아니라 세션 상태(단계·차례·질문)와 사용자 발언 키워드에서 다음 발화를 조합한다.
import { createDiscussionState, nextAiUtterance, moderatorLine, recordDiscussionTurn } from './discussion.js';
import { PT_TASKS, SITUATION_SCENARIOS, TECHNICAL_QUESTIONS, pickScenario } from './scenarios.js';
import { followupReasonFor, FOLLOWUPS } from './questions.js';
import { followupForRole } from './roles.js';

export function nextMockUtterance({ interviewType, session, userText }) {
  const role = session.interviewer_role || 'practitioner';
  switch (interviewType) {
    case 'technical': {
      const reason = followupReasonFor(userText);
      return {
        action: 'ask_followup',
        utterance: `개념을 적용한 과정을 더 묻겠습니다. ${followupForRole('expert', reason, FOLLOWUPS[reason])}`,
        followup_reason: reason,
      };
    }
    case 'situational': {
      const idx = Math.min(session.q_index, (session.scenario_followups || []).length);
      const fu = (session.scenario_followups || [])[idx];
      if (fu) return { action: 'ask_followup', utterance: fu, followup_reason: 'missing_result' };
      return { action: 'next_question', utterance: session.questions[session.q_index]?.text || '' };
    }
    case 'pt': {
      // QA 단계: 질문 은행에서 순서대로
      const qa = session.pt_qa || [];
      const qi = session.pt_qa_index || 0;
      if (session.pt_phase === 'qa' && qa[qi]) return { action: 'ask_followup', utterance: qa[qi], followup_reason: 'missing_evidence' };
      return { action: 'next_question', utterance: session.questions[session.q_index]?.text || '' };
    }
    case 'discussion': {
      const disc = session.discussion;
      const speaker = disc.next_speaker === 'user' ? 'user' : disc.next_speaker;
      if (speaker === 'user') return { action: 'await_user', utterance: moderatorLine(disc, 'to_user') };
      const u = nextAiUtterance(disc, speaker, userText);
      return { action: 'ai_speaks', utterance: u.text, speaker_id: u.speaker_id, claim_id: u.claim_id, responds_to: u.responds_to };
    }
    case 'panel': {
      // 패널: 질문마다 다른 역할이 돌아가며 질문. 꼬리질문은 해당 역할 전략.
      const roles = session.panel_roles || ['hr', 'practitioner'];
      const cur = roles[session.q_index % roles.length];
      const reason = followupReasonFor(userText);
      return { action: 'ask_followup', utterance: followupForRole(cur, reason, FOLLOWUPS[reason]), followup_reason: reason, speaker_role: cur };
    }
    default: {
      const reason = followupReasonFor(userText);
      return { action: 'ask_followup', utterance: followupForRole(role, reason, FOLLOWUPS[reason]), followup_reason: reason };
    }
  }
}

export { createDiscussionState, nextAiUtterance, moderatorLine, recordDiscussionTurn, PT_TASKS, SITUATION_SCENARIOS, TECHNICAL_QUESTIONS, pickScenario };
