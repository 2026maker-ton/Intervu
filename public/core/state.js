import { $ } from './format.js';
import { updateSetupSummary } from '../screens/setup.js';
import { stopVoice } from '../screens/room.js';

export const TOKEN_KEY = 'intervu.token';
export const ADMIN_KEY = 'intervu.admin';
export const SAVED_KEY = 'intervu.saved'; // { profile_id, session_id, skipped } — 새로고침 복원용(서버 상태가 진실)

// 저장소가 막혀 있어도(시크릿 모드 등) 앱이 동작하도록 모든 접근을 감싼다. 세션 저장소 우선, 로컬은 보조 복사본.
export function loadSaved() {
  for (const st of ['sessionStorage', 'localStorage']) {
    try { const v = JSON.parse(window[st].getItem(SAVED_KEY) || 'null'); if (v && typeof v === 'object') return v; } catch { /* noop */ }
  }
  return {};
}
export function persistSaved() {
  // 병합 저장: 아직 복원되지 않은 id를 null로 덮어쓰지 않는다(지우기는 clearSaved/resetFlow만)
  const old = loadSaved();
  const v = JSON.stringify({ profile_id: state.profile?.id || old.profile_id || null, session_id: state.session?.id || old.session_id || null, skipped: !!state.skipped || !!old.skipped });
  for (const st of ['sessionStorage', 'localStorage']) { try { window[st].setItem(SAVED_KEY, v); } catch { /* noop */ } }
}
export function clearSaved() {
  for (const st of ['sessionStorage', 'localStorage']) { try { window[st].removeItem(SAVED_KEY); } catch { /* noop */ } }
}

export const state = {
  token: localStorage.getItem(TOKEN_KEY) || '', // 내장 토큰 없음: 첫 401에서 접속 토큰을 물어본다
  screen: 'dashboard',
  journey: null,            // 'highschool' | 'university'
  profile: null,
  versionId: null,
  sources: [],
  approved: false,
  session: null,            // { id, version }
  flow: 'interview',        // 'interview' | 'repractice' | 'review'
  transfer: null,           // practice-attempts 응답
  comparison: null,
  lastReport: null,
  questionCount: 0,
  questionTotal: 1,
  timer: null,
  paused: false,
  endAt: 0,
  pausedAt: 0,
  catalog: { types: [], roles: [], topics: [], pt_tasks: [], scenarios: [] },
  stt: null,
  adminToken: sessionStorage.getItem(ADMIN_KEY) || '',
  adminEnabled: null,
  adminUnlocked: false,
  uploadedText: '',
  skipped: false,           // '자료 없이 일반 연습' 선택 여부(설정 화면 가드용)
};

// ---- 초기화 ----
export function resetFlow() {
  clearInterval(state.timer);
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
  stopVoice();
  state.skipped = false;
  clearSaved();
  state.profile = null;
  state.versionId = null;
  state.sources = [];
  state.approved = false;
  state.session = null;
  state.flow = 'interview';
  state.transfer = null;
  state.comparison = null;
  state.lastReport = null;
  state.questionCount = 0;
  state.paused = false;
  state.uploadedText = '';
  state.finished = false;
  state.finishing = false;
  const form = $('#applicationForm');
  if (form) form.reset();
  const setup = $('#setupForm');
  if (setup) setup.reset();
  const note = $('#evidenceNote');
  if (note) note.value = '';
  updateSetupSummary();
}
