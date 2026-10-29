// WP-A4: CORS 허용 목록·사전 요청·와일드카드 금지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/server.js';

const OK = 'https://ui.example.com';
const BAD = 'https://evil.example.com';
const mk = (cors) => createApp({ env: { CORS_ALLOW_ORIGINS: cors, DEV_TOKEN_A: 'tok-a-long-enough-1234', ADMIN_TOKEN: 'adm-long-enough-1234', GEMINI_API_KEY: '', PROVIDER: 'mock' } });
const req = (app, p, { method = 'GET', origin, headers = {} } = {}) => app.fetch(new Request(`http://local${p}`, { method, headers: { ...(origin ? { Origin: origin } : {}), ...headers } }), {}, {});

test('A4 CORS: allowed origin gets exact echo + Vary, never *', async () => {
  const app = mk(`${OK}, *`);
  const r = await req(app, '/api/v1/health', { origin: OK });
  assert.equal(r.headers.get('access-control-allow-origin'), OK);
  assert.match(r.headers.get('vary'), /Origin/);
  const r2 = await req(app, '/api/v1/health', { origin: 'https://x.example' });
  assert.equal(r2.headers.get('access-control-allow-origin'), null);
});

test('A4 CORS: disallowed origin and no-origin get no CORS headers', async () => {
  const app = mk(OK);
  for (const origin of [BAD, undefined]) {
    const r = await req(app, '/api/v1/health', { origin });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
});

test('A4 CORS: preflight allowed origin lists headers/methods; disallowed gets none', async () => {
  const app = mk(OK);
  const pf = (origin) => req(app, '/api/v1/sessions', { method: 'OPTIONS', origin, headers: { 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'authorization,idempotency-key,x-admin-token' } });
  const ok = await pf(OK);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), OK);
  const h = ok.headers.get('access-control-allow-headers').toLowerCase();
  for (const x of ['authorization', 'content-type', 'idempotency-key', 'x-admin-token']) assert.ok(h.includes(x), x);
  const m = ok.headers.get('access-control-allow-methods');
  assert.ok(/DELETE/.test(m) && /PATCH/.test(m));
  assert.match(ok.headers.get('vary'), /Origin/);
  const bad = await pf(BAD);
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  assert.equal(bad.headers.get('access-control-allow-headers'), null);
});

test('A4 CORS: wildcard-only config and default config disable CORS', async () => {
  for (const cfg of ['*', '']) {
    const app = mk(cfg);
    const r = await req(app, '/api/v1/health', { origin: OK });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const p = await req(app, '/api/v1/sessions', { method: 'OPTIONS', origin: OK, headers: { 'Access-Control-Request-Method': 'POST' } });
    assert.equal(p.headers.get('access-control-allow-origin'), null);
  }
});

test('A4 CORS: x-admin-token is allowed in preflight only for listed origin', async () => {
  const app = mk(OK);
  const get = (o) => req(app, '/api/v1/metrics', { method: 'OPTIONS', origin: o, headers: { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-admin-token' } });
  assert.match((await get(OK)).headers.get('access-control-allow-headers'), /x-admin-token/i);
  assert.equal((await get(BAD)).headers.get('access-control-allow-headers'), null);
});

test('A4 static CSP includes API_BASE origin in connect-src', async () => {
  const app = createApp({ env: { API_BASE: 'https://api.example.com/path', DEV_TOKEN_A: 'tok-a-long-enough-1234' } });
  await new Promise((r) => app.server.listen(0, r));
  const { port } = app.server.address();
  const r = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(r.headers.get('content-security-policy'), /connect-src 'self' https:\/\/api\.example\.com(;|$)/);
  await new Promise((r2) => app.server.close(r2));
});
