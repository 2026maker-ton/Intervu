import { $ } from './format.js';

let toastTimer = null;
export function toast(message, isError = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4600);
}
