// 면접 유형·설정 조합 정의 (데모 완성용)
// 유형과 설정(블라인드/성향/역할/입력/시간)은 독립 축으로 조합한다.
import { ROLE_IDS } from './roles.js';

export const INTERVIEW_TYPES = {
  general: {
    id: 'general', label: '일반·인성 면접',
    desc: '자기소개·지원동기·경험·협업·꼬리질문',
    task_type: 'behavioral', layout: 'one_to_one',
    rubric_version: 'behavioral-ko-v1',
    phases: ['intro', 'core', 'closing'],
  },
  technical: {
    id: 'technical', label: '직무·기술 면접',
    desc: '직무별 질문·개념 설명·문제해결 과정 검토',
    task_type: 'behavioral', layout: 'one_to_one',
    rubric_version: 'technical-ko-v1',
    phases: ['intro', 'core', 'closing'],
  },
  discussion: {
    id: 'discussion', label: '토론면접',
    desc: '사용자 1명 + AI 2명 + 사회자, 입론·반론·자유토론·결론',
    task_type: 'discussion', layout: 'group',
    rubric_version: 'discussion-ko-v1',
    phases: ['reading', 'opening', 'exchange', 'agreement', 'closing'],
  },
  pt: {
    id: 'pt', label: 'PT 면접',
    desc: '과제 제시 → 준비 → 발표 → 질의응답',
    task_type: 'presentation', layout: 'one_to_one',
    rubric_version: 'presentation-ko-v1',
    phases: ['brief', 'prepare', 'present', 'qa', 'closing'],
  },
  situational: {
    id: 'situational', label: '상황·역할극 면접',
    desc: '고객 응대·갈등 해결·돌발 상황 시뮬레이션',
    task_type: 'situational', layout: 'one_to_one',
    rubric_version: 'situational-ko-v1',
    phases: ['intro', 'scenario', 'followup', 'closing'],
  },
  panel: {
    id: 'panel', label: '패널 면접',
    desc: 'HR·실무자·관리자 등 여러 AI 면접관의 역할별 질문',
    task_type: 'behavioral', layout: 'panel',
    rubric_version: 'behavioral-ko-v1',
    phases: ['intro', 'core', 'closing'],
  },
};

export const DURATIONS = [5, 10, 15];
export const PERSONAS = ['supportive', 'standard', 'challenging'];
export const INPUT_MODES = ['text', 'voice'];

export function normalizeInterviewType(raw) {
  const t = String(raw || 'general').trim().toLowerCase();
  if (INTERVIEW_TYPES[t]) return t;
  // 레거시 mode 매핑
  if (t === 'structured') return 'general';
  if (t === 'discussion_beta' || t === 'discussion') return 'discussion';
  if (t === 'pt_beta' || t === 'presentation') return 'pt';
  return 'general';
}

// 조합 검증: 각 축이 충돌하지 않는지 확인한다.
// 블라인드=정보정책, 성향=질문전략, 역할=질문관점으로 분리 → 서로 배타적이지 않음.
// 예외: highschool + gemini 실호출 금지(서버에서 별도 차단), discussion은 panel_roles 대신 고정 AI 2명.
export function validateCombination({ interview_type, blind, persona, interviewer_role, panel_roles, input_mode, duration_minutes, org_type }) {
  const errors = [];
  const it = normalizeInterviewType(interview_type);
  if (!INTERVIEW_TYPES[it]) errors.push('unknown interview_type');
  if (blind !== undefined && typeof blind !== 'boolean') errors.push('blind must be boolean');
  if (persona && !PERSONAS.includes(persona)) errors.push('bad persona');
  if (input_mode && !INPUT_MODES.includes(input_mode)) errors.push('bad input_mode');
  if (duration_minutes && !DURATIONS.includes(Number(duration_minutes))) errors.push('bad duration (5/10/15만 허용)');
  if (panel_roles !== undefined && panel_roles !== null) {
    if (!Array.isArray(panel_roles)) errors.push('panel_roles must be array');
    else if (panel_roles.some((r) => !ROLE_IDS.includes(r))) errors.push('unknown panel role');
    else if (new Set(panel_roles).size !== panel_roles.length) errors.push('duplicate panel role');
    else if (it === 'panel' && panel_roles.length < 2) errors.push('panel needs 2+ interviewers');
    else if (panel_roles.length > 3) errors.push('panel supports up to 3 interviewers');
  }
  if (it === 'discussion' && interviewer_role && !ROLE_IDS.includes(interviewer_role)) {
    errors.push('bad moderator role');
  }
  void org_type;
  return { ok: errors.length === 0, errors, interview_type: it };
}

// 질문 수: 시간에 따라 조정 (5분 데모=3문항, 10분=4문항, 15분=5문항)
export function questionCountForDuration(minutes) {
  if (Number(minutes) <= 5) return 3;
  if (Number(minutes) <= 10) return 4;
  return 5;
}
