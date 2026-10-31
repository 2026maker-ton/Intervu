// 사이트 입장 비밀번호 화면. 서버(SITE_PASSWORD)가 /api를 잠그고, 통과하면 HttpOnly 쿠키가 생긴다(브라우저 JS는 쿠키를 읽지 않는다).
import { $, setError } from '../core/format.js';
import { api } from '../core/api.js';

let waiting = null;
const lockApp = (on) => { $('#gateScreen').hidden = !on; $('main').hidden = on; document.querySelector('header.topbar').hidden = on; if (on) $('#gatePassword').focus(); };

// 잠금이 필요하면 화면을 띄우고 통과할 때까지 기다린다. 이미 열려 있거나 잠금이 꺼져 있으면 바로 끝난다.
export async function ensureGate() {
  let s = { required: false, open: true };
  try { s = await api('/gate', { auth: false }); } catch { /* 서버 응답이 없으면 아래 화면 로직이 오류를 보인다 */ }
  if (!s.required || s.open) { lockApp(false); return; }
  return showGate();
}
export function showGate() {
  if (waiting) return waiting;
  lockApp(true);
  waiting = new Promise((resolve) => { waiting.resolve = resolve; });
  return waiting;
}
$('#gateForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#gateBtn'); const input = $('#gatePassword');
  setError('#gateError', '');
  btn.disabled = true;
  try {
    await api('/gate', { method: 'POST', body: { password: input.value }, auth: false });
    input.value = '';
    lockApp(false);
    const w = waiting; waiting = null; w?.resolve?.();
    location.reload(); // 잠금이 풀린 상태로 화면을 처음부터 다시 그린다
  } catch (err) {
    setError('#gateError', err.message);
    input.select();
  } finally { btn.disabled = false; }
});
