// 사이트 입장 비밀번호 잠금: 서버가 /api 전체를 강제, 쿠키 위조·비밀번호 변경 시 무효, 시도 제한, 꺼져 있으면 영향 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/server.js';

const PW = 'test-gate-pw';
const BASE_ENV = { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: '', DEV_TOKEN_B: '', TRENDS_FILE: '' };
async function open(env = {}) {
  const app = createApp({ env: { ...BASE_ENV, ...env } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const c = async (path, { method = 'GET', cookie, body, ip } = {}) => {
    const h = {};
    if (cookie) h.cookie = cookie;
    if (ip) h['x-forwarded-for'] = ip;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})), setCookie: res.headers.get('set-cookie') };
  };
  return { c, close: () => new Promise((r) => app.server.close(r)) };
}
const enter = async (c, pw = PW, ip) => c('/api/v1/gate', { method: 'POST', body: { password: pw }, ip });
const cookieOf = (r) => r.setCookie.split(';')[0];

test('gate: /api is 401 gate_required without cookie; wrong password 401; right password opens it', async () => {
  const { c, close } = await open({ SITE_PASSWORD: PW, GATE_SECRET: 's1' });
  try {
    assert.deepEqual((await c('/api/v1/gate')).data, { required: true, open: false });
    for (const p of ['/api/v1/health', '/api/v1/interview-types', '/api/v1/auth/me']) {
      const r = await c(p);
      assert.equal(r.status, 401, p);
      assert.equal(r.data.code, 'gate_required');
    }
    assert.equal((await c('/api/v1/auth/login', { method: 'POST', body: { email: 'a@b.test', password: 'x' } })).data.code, 'gate_required');
    const bad = await enter(c, 'nope');
    assert.equal(bad.status, 401);
    assert.equal(bad.data.code, 'gate_denied');
    assert.equal(bad.setCookie, null);
    const ok = await enter(c);
    assert.equal(ok.status, 200);
    assert.match(ok.setCookie, /HttpOnly/);
    assert.match(ok.setCookie, /SameSite=Strict/);
    assert.doesNotMatch(ok.setCookie, new RegExp(PW));
    const cookie = cookieOf(ok);
    assert.equal((await c('/api/v1/health', { cookie })).status, 200);
    assert.deepEqual((await c('/api/v1/gate', { cookie })).data, { required: true, open: true });
    assert.equal((await c('/api/v1/gate', { method: 'DELETE', cookie })).setCookie.includes('Max-Age=0'), true);
  } finally { await close(); }
});

test('gate: forged or tampered cookie is rejected', async () => {
  const { c, close } = await open({ SITE_PASSWORD: PW, GATE_SECRET: 's1' });
  try {
    const good = cookieOf(await enter(c));
    const [name, val] = good.split('=');
    const [exp, sig] = val.split('.');
    const far = String(Number(exp) + 99999);
    for (const bad of [`${name}=${far}.${sig}`, `${name}=${exp}.${sig.slice(0, -2)}AA`, `${name}=${exp}`, `${name}=1.x`, `${name}=`]) {
      assert.equal((await c('/api/v1/health', { cookie: bad })).status, 401, bad);
    }
    const expired = `${name}=${Math.floor(Date.now() / 1000) - 10}.${sig}`;
    assert.equal((await c('/api/v1/health', { cookie: expired })).status, 401);
  } finally { await close(); }
});

test('gate: cookie from another password or secret is invalid', async () => {
  const a = await open({ SITE_PASSWORD: PW, GATE_SECRET: 's1' });
  const b = await open({ SITE_PASSWORD: PW, GATE_SECRET: 's2' });
  const d = await open({ SITE_PASSWORD: 'other-pw', GATE_SECRET: 's1' });
  try {
    const cookie = cookieOf(await enter(a.c));
    assert.equal((await a.c('/api/v1/health', { cookie })).status, 200);
    assert.equal((await b.c('/api/v1/health', { cookie })).status, 401);
    assert.equal((await d.c('/api/v1/health', { cookie })).status, 401);
  } finally { await a.close(); await b.close(); await d.close(); }
});

test('gate: attempts are rate limited per IP (429 even for the right password)', async () => {
  const { c, close } = await open({ SITE_PASSWORD: PW, GATE_SECRET: 's1' });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await enter(c, 'bad', '9.9.9.9')).status, 401);
    const blocked = await enter(c, PW, '9.9.9.9');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.setCookie, null);
    assert.equal((await enter(c, PW, '8.8.8.8')).status, 200);
  } finally { await close(); }
});

test('gate: disabled when SITE_PASSWORD is empty', async () => {
  const { c, close } = await open();
  try {
    assert.deepEqual((await c('/api/v1/gate')).data, { required: false, open: true });
    assert.equal((await c('/api/v1/health')).status, 200);
  } finally { await close(); }
});
