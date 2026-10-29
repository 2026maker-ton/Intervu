import { $, $$ } from './format.js';
import { state } from './state.js';
import { loadProvider, loadRecent } from '../screens/dashboard.js';
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

export function renderScreen(name) {
  state.screen = name;
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
  if (name === 'room' && !state.session) go('dashboard');
  const heading = $(`#screen-${name} h1`);
  if (heading) { heading.setAttribute('tabindex', '-1'); try { heading.focus({ preventScroll: true }); } catch { /* noop */ } }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

window.addEventListener('hashchange', () => {
  const name = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  renderScreen(SCREENS.includes(name) ? name : 'dashboard');
});

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
