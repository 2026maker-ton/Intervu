import { uuid } from './format.js';
import { state } from './state.js';

// config.js(window.__INTERVU__.API_BASE)가 주는 API 서버 주소. 빈 값이면 같은 오리진.
export const apiUrl = (p) => `${(globalThis.__INTERVU__?.API_BASE || '').replace(/\/+$/, '')}/api/v1${p}`;

// 로그인 토큰이 없거나 만료되면(401) 로그인 화면으로 보낸다(app.js가 등록).
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
// 입장 비밀번호 잠금(401 gate_required)이면 입장 화면으로 보낸다(screens/gate.js가 등록).
let onGate = () => {};
export const setGateHandler = (fn) => { onGate = fn; };

export async function api(path, { method = 'GET', body, idempotent = false, auth = true } = {}) {
  const headers = {};
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotent) headers['Idempotency-Key'] = uuid();
  const res = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data?.code || data?.error?.code) === 'gate_required') onGate();
  else if (res.status === 401 && auth) onUnauthorized();
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `요청을 처리하지 못했습니다 (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}
