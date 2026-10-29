import { $, $$ } from './format.js';
import { state, persistSaved } from './state.js';
import { toast } from './toast.js';
import { loadProvider, loadRecent, restoreFromStorage } from '../screens/dashboard.js';
import { renderReport } from '../screens/feedback.js';
import { renderRepractice } from '../screens/repractice.js';
import { loadHistory, loadTrendLookup } from '../screens/history.js';
import { initAdmin } from '../screens/admin.js';

export const SCREENS = ['dashboard', 'application', 'evidence', 'setup', 'room', 'feedback', 'repractice', 'history', 'admin'];

export function go(name) {
  if (!SCREENS.includes(name)) name = 'dashboard';
  if (location.hash !== `#/${name}`) {
    location.hash = `#/${name}`;
    return;
  }
  renderScreen(name);
}

const TITLES = {
  dashboard: '대시보드', application: '지원 정보', evidence: '근거 확인', setup: '면접 설정', room: '면접실',
  feedback: '근거 기반 코칭', repractice: '새 질문 재연습', history: '기록·데이터', admin: '월간 자료 검수',
};

// 선행 단계 없이 들어온 화면은 설명과 함께 알맞은 화면으로 되돌린다(새로고침·직접 URL·뒤로가기 공통).
function guard(name) {
  if (name === 'evidence' && !state.profile) return ['application', '지원 정보를 먼저 입력해 주세요. 자료 없이 연습하려면 설정 화면으로 바로 갈 수도 있습니다.'];
  if (name === 'setup') {
    if (state.profile && !state.approved) return ['evidence', '근거 확인에서 내용을 승인한 뒤 면접을 설정할 수 있습니다.'];
    if (!state.profile && !state.skipped) return ['application', '지원 정보를 입력하거나 “자료 없이 일반 연습”을 선택해 주세요.'];
  }
  if (name === 'room' && (!state.session || state.session.state === 'completed')) return ['dashboard', '진행 중인 면접이 없어 대시보드로 이동했습니다.'];
  if (name === 'feedback') {
    if (!state.session) return ['dashboard', '볼 수 있는 보고서가 없어 대시보드로 이동했습니다.'];
    if (['ready', 'active', 'paused', 'completing'].includes(state.session.state)) return ['room', '면접이 끝나야 코칭을 볼 수 있습니다.'];
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
  if (g) { toast(g[1]); announce(g[1]); go(g[0]); return; }
  state.screen = name;
  persistSaved();
  document.title = `${TITLES[name] || 'Intervu'} — Intervu`;
  announce(`${TITLES[name] || name} 화면`);
  SCREENS.forEach((s) => {
    const el = $(`#screen-${s}`);
    if (el) el.hidden = s !== name;
  });
  $$('.navbtn').forEach((b) => {
    const active = b.dataset.go === name;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (name === 'dashboard') loadRecent();
  if (name === 'history') { loadHistory(); loadProvider(); loadTrendLookup(); }
  if (name === 'admin') initAdmin();
  if (name === 'feedback' && state.lastReport) renderReport(state.lastReport);
  if (name === 'repractice') renderRepractice();
  const heading = $(`#screen-${name} h1`);
  if (heading) { heading.setAttribute('tabindex', '-1'); try { heading.focus({ preventScroll: true }); } catch { /* noop */ } }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

window.addEventListener('hashchange', async () => {
  const raw = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  const name = SCREENS.includes(raw) ? raw : 'dashboard';
  // 새로고침 직후 주소창으로 이동한 경우에도 서버 상태로 복원해 본다(가드에 걸릴 때만)
  if (guard(name) && await restoreFromStorage(name)) return;
  renderScreen(name);
});

// 자료 없이 일반 연습: 설정 화면 가드를 통과시키는 표식(다른 화면 모듈은 건드리지 않는다)
$('#skipApplicationBtn')?.addEventListener('click', () => { state.skipped = true; }, true);

$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

// 이용 안내 패널
$('#helpBtn')?.addEventListener('click', () => {
  const panel = $('#helpPanel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#helpBtn').setAttribute('aria-expanded', String(open));
});
$('#helpCloseBtn')?.addEventListener('click', () => {
  $('#helpPanel').hidden = true;
  $('#helpBtn').setAttribute('aria-expanded', 'false');
});
