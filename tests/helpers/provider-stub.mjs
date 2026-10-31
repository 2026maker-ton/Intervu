// WP-B1 시험 헬퍼: 스크립트 가능한 공급자 스텁 fetch. 실제 네트워크 호출은 하지 않는다(가짜 키·가짜 BASE_URL).
import assert from 'node:assert/strict';
import { createApp } from '../../src/server.js';
import { A, ensureConsent, needsConsent } from './app.mjs';

export const FAKE_KEY = 'fake-secret-key-XYZ-123';
export const STUB_BASE = 'https://stub.gemini.test/v9';
export const STUB_MODEL = 'gemini-3.6-flash';

export const okReply = (utterance = '그 선택을 한 판단 기준은 무엇이었나요?', extra = {}) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ utterance, ...extra }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }), { status: 200 });
export const rawReply = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }), { status: 200 });
export const statusReply = (status, headers = {}) => new Response(JSON.stringify({ error: { message: `upstream said ${FAKE_KEY}` } }), { status, headers });
// 응답하지 않다가 AbortController 신호로만 끝나는 요청(타임아웃 시험)
export const hang = (opts) => new Promise((_, rej) => {
  opts?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

// respond(call, n): call={url, headers, body(JSON|text)}, n=이 앱에서 N번째 공급자 호출(1부터). Response 또는 Promise<Response>.
export async function withProviders({ env = {}, overrides = {}, respond = () => okReply() }, fn) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith(STUB_BASE) || u.includes('stub.groq.test')) {
      let body = String(opts.body ?? '');
      try { body = JSON.parse(body); } catch { /* multipart 등은 문자열 */ }
      calls.push({ url: u, headers: { ...(opts.headers || {}) }, body });
      return respond(calls[calls.length - 1], calls.length, opts);
    }
    return realFetch(url, opts);
  };
  const app = createApp({
    env: {
      GEMINI_API_KEY: FAKE_KEY, GEMINI_BASE_URL: STUB_BASE, GEMINI_TEXT_MODEL: STUB_MODEL, GEMINI_FALLBACK_MODEL: STUB_MODEL,
      GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', GROQ_LIVE_ACK: '', GROQ_REAL_DATA_ACK: '', GEMINI_ALLOW_UNPAID: '', GEMINI_PAID_ACK: '', GEMINI_LIVE_ACK: '', GEMINI_REAL_DATA_ACK: '', DEV_TOKEN_A: A, DEV_TOKEN_B: 'dev-user-b-token', TRENDS_FILE: '',
      PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100', ADMIN_TOKEN: 'b1-admin', ...env,
    },
    ...overrides,
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const g = async (path, { method = 'GET', body, token = A, noConsent = false } = {}) => {
    if (token && needsConsent(method, path, noConsent)) await ensureConsent(base, token, realFetch);
    const h = {};
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
    const res = await realFetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  // 세션 시작 → 답변 한 번 제출(공급자 호출 1회가 일어나는 지점)
  const startSession = async (extra = {}) => {
    const s = await g('/api/v1/sessions', { method: 'POST', body: { duration_minutes: 10, ...extra } });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    const st = await g(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
    assert.equal(st.status, 202, JSON.stringify(st.data));
    return { id: s.data.id, created: s.data, version: st.data.version };
  };
  const turn = async (sess, text = '제가 직접 일정을 조정했고 결과적으로 기한 안에 제출했습니다.', extra = {}) => {
    const r = await g(`/api/v1/sessions/${sess.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: sess.version, type: 'turn.text', payload: { text }, ...extra } });
    if (r.status === 202) sess.version = r.data.version;
    return r;
  };
  try { await fn({ g, app, calls, startSession, turn, base }); } finally { globalThis.fetch = realFetch; app.server.close(); }
}
