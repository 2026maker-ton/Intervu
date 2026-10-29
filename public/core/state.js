import { $ } from './format.js';
import { updateSetupSummary } from '../screens/setup.js';
import { stopVoice } from '../screens/room.js';

export const TOKEN_KEY = 'intervu.token';
export const ADMIN_KEY = 'intervu.admin';

export const state = {
  token: localStorage.getItem(TOKEN_KEY) || '', // 내장 토큰 없음: 첫 401에서 접속 토큰을 물어본다
  screen: 'dashboard',
  journey: null,            // 'company' | 'university'
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
};

// ---- 초기화 ----
export function resetFlow() {
  clearInterval(state.timer);
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
  stopVoice();
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
