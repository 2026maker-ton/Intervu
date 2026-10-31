import { $ } from './format.js';

export const TOKEN_KEY = 'intervu.token';
export const SAVED_KEY = 'intervu.saved'; // { profile_id, session_id } — 새로고침 복원용(서버 상태가 진실)

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
  const v = JSON.stringify({ profile_id: state.profile?.id || old.profile_id || null, session_id: state.session?.id || old.session_id || null });
  for (const st of ['sessionStorage', 'localStorage']) { try { window[st].setItem(SAVED_KEY, v); } catch { /* noop */ } }
}
export function clearSaved() {
  for (const st of ['sessionStorage', 'localStorage']) { try { window[st].removeItem(SAVED_KEY); } catch { /* noop */ } }
}
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
export function setToken(t) {
  state.token = t || '';
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

export const state = {
  token: readToken(),
  user: null,               // { id, email, name }
  screen: 'dashboard',
  journey: 'university',
  profile: null,
  versionId: null,
  sources: [],
  approved: false,
  session: null,            // { id, version, state }
  lastReport: null,
  stt: null,
  providerStatus: null,
};

// ---- 초기화 ----
export function resetFlow() {
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
  clearSaved();
  Object.assign(state, { profile: null, versionId: null, sources: [], approved: false, session: null, lastReport: null });
  $('#applicationForm')?.reset();
  $('#setupForm')?.reset();
}
