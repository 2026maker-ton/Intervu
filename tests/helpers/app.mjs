// 공용 HTTP 헬퍼. 모듈 상태는 테스트 파일(프로세스)마다 독립이다.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/server.js';

export const A = 'dev-user-a-token';
export const B = 'dev-user-b-token';
export let app, base;

export async function call(path, { method = 'GET', token = A, body, idem = true, headers = {} } = {}) {
  const h = { Authorization: `Bearer ${token}`, ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (idem && method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export async function newSession(token = A, { persona = 'standard', blind = false } = {}) {
  await cleanupAll();
  const s = await call('/api/v1/sessions', { method: 'POST', token, body: { mode: 'structured', persona, blind, duration_minutes: 10, input_mode: 'text' } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const start = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', token, body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  assert.equal(start.status, 202);
  return { id: s.data.id, version: start.data.version, question: start.data.question };
}

export async function cleanupAll() {
  for (const token of [A, B]) {
    const { data } = await call('/api/v1/sessions', { token });
    for (const s of data.sessions || []) {
      await call(`/api/v1/sessions/${s.id}`, { method: 'DELETE', token });
    }
  }
}

// 파일마다 자기 앱 인스턴스를 띄우고 닫는다(파일 간 공유 상태 없음).
export function useSharedApp() {
  before(async () => {
    // 로컬 .env 실키와 무관하게 기준선은 Mock: Groq 키도 명시적으로 비운다.
    app = createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: A, DEV_TOKEN_B: B, TRENDS_FILE: '', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' } });
    await new Promise((r) => app.server.listen(0, r));
    base = `http://127.0.0.1:${app.server.address().port}`;
  });
  after(async () => { await cleanupAll(); app.server.close(); });
}

export async function withApp(env, fn) {
  const a = createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: A, DEV_TOKEN_B: B, ADMIN_TOKEN: '', TRENDS_FILE: '', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100', ...env } });
  await new Promise((r) => a.server.listen(0, r));
  const base2 = `http://127.0.0.1:${a.server.address().port}`;
  const c = async (path, { method = 'GET', token = A, admin, body, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (admin) h['x-admin-token'] = admin;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
    const res = await fetch(base2 + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try { await fn(c); } finally { a.server.close(); }
}
