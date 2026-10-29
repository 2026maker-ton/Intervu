import { $, uuid } from './format.js';
import { askInput } from './dialog.js';
import { TOKEN_KEY, state } from './state.js';

// config.js(window.__INTERVU__.API_BASE)가 주는 API 서버 주소. 빈 값이면 같은 오리진.
export const apiUrl = (p) => `${(globalThis.__INTERVU__?.API_BASE || '').replace(/\/+$/, '')}/api/v1${p}`;

// 접속 토큰: 서버가 401을 주면 대화상자로 한 번 묻고 저장한다(취소하면 이 페이지에서는 다시 묻지 않는다).
let tokenPrompt = null;
let tokenDeclined = false;
export function promptToken() {
  if (tokenDeclined) return Promise.resolve(null);
  if (!tokenPrompt) {
    tokenPrompt = askInput('접속 토큰', '운영자에게 받은 접속 토큰을 입력하세요.', '접속 토큰').then((v) => {
      tokenPrompt = null;
      if (!v) { tokenDeclined = true; return null; }
      state.token = v.trim();
      try { localStorage.setItem(TOKEN_KEY, state.token); } catch { /* noop */ }
      return state.token;
    });
  }
  return tokenPrompt;
}

export async function api(path, { method = 'GET', body, idempotent = false, admin = false, retried = false } = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotent) headers['Idempotency-Key'] = uuid();
  if (admin && state.adminToken) headers['x-admin-token'] = state.adminToken;
  const res = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried && !admin) {
    const t = await promptToken();
    if (t) return api(path, { method, body, idempotent, admin, retried: true });
  }
  if (!res.ok) {
    const msg = data?.error?.message || `요청을 처리하지 못했습니다 (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}
