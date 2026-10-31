import { $, $$ } from './format.js';
import { state, persistSaved } from './state.js';
import { toast } from './toast.js';
import { loadRecent, restoreFromStorage } from '../screens/dashboard.js';
import { renderReport } from '../screens/feedback.js';

export const SCREENS = ['login', 'dashboard', 'application', 'evidence', 'setup', 'room', 'feedback'];

export function go(name) {
  if (!SCREENS.includes(name)) name = 'dashboard';
  if (location.hash !== `#/${name}`) {
    location.hash = `#/${name}`;
    return;
  }
  renderScreen(name);
}

const TITLES = { login: '로그인', dashboard: '대입 면접 연습', application: '지원 정보', evidence: '근거 확인', setup: '면접 준비', room: '면접실', feedback: '면접 결과' };

// 선행 단계 없이 들어온 화면은 알맞은 화면으로 되돌린다(새로고침·직접 URL·뒤로가기 공통).
function guard(name) {
  if (name !== 'login' && !state.user) return ['login', '로그인이 필요합니다.'];
  if (name === 'login' && state.user) return ['dashboard', ''];
  if (name === 'evidence' && !state.profile) return ['application', '지원 정보를 먼저 입력해 주세요.'];
  if (name === 'setup') {
    if (!state.profile) return ['application', '지원 정보를 먼저 입력해 주세요.'];
    if (!state.approved) return ['evidence', '근거를 승인한 뒤 면접을 시작할 수 있습니다.'];
  }
  if (name === 'room' && (!state.session || state.session.state === 'completed')) return ['dashboard', '진행 중인 면접이 없습니다.'];
  if (name === 'feedback') {
    if (!state.session) return ['dashboard', '볼 수 있는 결과가 없습니다.'];
    if (['ready', 'active', 'paused', 'completing'].includes(state.session.state)) return ['room', '면접이 끝나야 결과를 볼 수 있습니다.'];
  }
  return null;
}

function announce(text) {
  let el = $('#routeAnnouncer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'routeAnnouncer';
    el.className = 'route-announcer';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

export function renderScreen(name) {
  const g = guard(name);
  if (g) { if (g[1]) { toast(g[1]); announce(g[1]); } go(g[0]); return; }
  state.screen = name;
  if (name !== 'login') persistSaved();
  document.title = `${TITLES[name] || 'Intervu'} — Intervu`;
  announce(`${TITLES[name] || name} 화면`);
  SCREENS.forEach((s) => { const el = $(`#screen-${s}`); if (el) el.hidden = s !== name; });
  if (name === 'dashboard') loadRecent();
  if (name === 'feedback' && state.lastReport) renderReport(state.lastReport);
  const heading = $(`#screen-${name} h1`);
  if (heading) { heading.setAttribute('tabindex', '-1'); try { heading.focus({ preventScroll: true }); } catch { /* noop */ } }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

export const currentTarget = () => { const raw = (location.hash || '').replace(/^#\/?/, '') || 'dashboard'; return SCREENS.includes(raw) ? raw : 'dashboard'; };

window.addEventListener('hashchange', async () => {
  const name = currentTarget();
  // 새로고침 직후 주소창으로 이동한 경우에도 서버 상태로 복원해 본다(가드에 걸릴 때만)
  if (state.user && guard(name) && await restoreFromStorage(name)) return;
  renderScreen(name);
});

$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
$('.brand[data-go]')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('dashboard'); }
});
