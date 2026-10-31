// 로그인·가입·로그아웃·내 데이터 삭제. 토큰은 서버가 발급한 로그인 토큰만 저장한다(비밀번호는 저장하지 않음).
import { $, $$, setError } from '../core/format.js';
import { api } from '../core/api.js';
import { state, setToken, resetFlow } from '../core/state.js';
import { go } from '../core/router.js';
import { toast } from '../core/toast.js';
import { askConfirm, askInput, dialog } from '../core/dialog.js';
import { loadProvider } from './dashboard.js';

function showUser() {
  $('#userMenu').hidden = !state.user;
  $('#userName').textContent = state.user?.name ? `${state.user.name}님` : '';
}

// 저장된 토큰으로 사용자 확인. 실패하면 로그아웃 상태.
export async function loadMe() {
  if (!state.token) { state.user = null; showUser(); return false; }
  try { state.user = await api('/auth/me'); } catch { state.user = null; setToken(''); }
  showUser();
  return !!state.user;
}

let handling = false;
// message: 401(만료·서버 초기화)로 나간 경우 이유를 알린다. 직접 로그아웃은 메시지 없음.
export function signedOut(message = '로그인이 만료됐습니다. 다시 로그인해 주세요.') {
  if (handling) return;
  handling = true;
  const wasIn = !!state.user;
  setToken(''); state.user = null; resetFlow(); showUser();
  go('login');
  if (wasIn && message) toast(message, true);
  handling = false;
}

function selectTab(signup) {
  $('#tabLogin').setAttribute('aria-selected', String(!signup)); $('#tabLogin').tabIndex = signup ? -1 : 0;
  $('#tabSignup').setAttribute('aria-selected', String(signup)); $('#tabSignup').tabIndex = signup ? 0 : -1;
  $('#loginForm').hidden = signup; $('#signupForm').hidden = !signup;
  setError('#authError', '');
}
$('#tabLogin')?.addEventListener('click', () => selectTab(false));
$('#tabSignup')?.addEventListener('click', () => selectTab(true));
$$('[role=tab]').forEach((t) => t.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault(); const signup = t.id === 'tabLogin'; selectTab(signup); (signup ? $('#tabSignup') : $('#tabLogin')).focus();
}));

async function enter(path, body, btn) {
  setError('#authError', '');
  btn.disabled = true;
  try {
    const r = await api(path, { method: 'POST', body, auth: false });
    setToken(r.token); state.user = r.user; showUser();
    await loadProvider();
    go('dashboard');
  } catch (err) {
    setError('#authError', err.message);
  } finally { btn.disabled = false; }
}
$('#loginForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  enter('/auth/login', { email: f.get('email'), password: f.get('password') }, $('#loginBtn'));
});
$('#signupForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (f.get('age_18_confirmed') !== 'on') return setError('#authError', '만 18세 이상만 이용할 수 있습니다.');
  if (f.get('notice_ack') !== 'on') return setError('#authError', '처리 안내에 동의해 주세요.');
  enter('/auth/signup', { name: f.get('name'), email: f.get('email'), password: f.get('password'), age_18_confirmed: true, notice_ack: true }, $('#signupBtn'));
});

$('#logoutBtn')?.addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST', idempotent: true, body: {} }); } catch { /* 토큰은 아래에서 지운다 */ }
  signedOut('');
  toast('로그아웃했습니다.');
});

// 내 데이터: 면접 기록 전체 삭제 또는 계정 삭제(되돌릴 수 없음).
$('#myDataBtn')?.addEventListener('click', async () => {
  const choice = await dialog({ title: '내 데이터', message: '삭제는 되돌릴 수 없습니다.', label: '선택', choices: [['sessions', '면접 기록 모두 삭제'], ['account', '계정과 모든 자료 삭제']], okText: '계속', danger: true });
  if (choice === 'sessions') {
    if (!(await askConfirm('면접 기록 삭제', '모든 면접 답변·결과를 삭제합니다.', { okText: '삭제', danger: true }))) return;
    try {
      const { sessions } = await api('/sessions');
      for (const s of sessions || []) if (!['deleted', 'deleting'].includes(s.state)) await api(`/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE', idempotent: true });
      resetFlow(); toast('면접 기록을 삭제했습니다.'); go('dashboard');
    } catch (err) { toast(err.message, true); }
  }
  if (choice === 'account') {
    const typed = await askInput('계정 삭제', '확인을 위해 “삭제”를 입력하세요.', '확인 문구');
    if (typed !== '삭제') return;
    try { await api('/account', { method: 'DELETE', idempotent: true }); } catch (err) { toast(err.message, true); return; }
    signedOut('계정을 삭제했습니다.');
  }
});
