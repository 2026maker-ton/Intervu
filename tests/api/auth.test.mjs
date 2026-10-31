// 이메일 로그인(2026-10-31): 가입·로그인·로그아웃·me, 비밀번호/토큰 해시 저장, 계정 존재 노출 방지, 시도 제한, 계정 삭제.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/server.js';
import { verifyPassword, hashPassword } from '../../src/app/crypto.js';

async function open(env = {}) {
  const app = createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: '', DEV_TOKEN_B: '', TRENDS_FILE: '', ...env } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const c = async (path, { method = 'GET', token, body, ip } = {}) => {
    const h = {};
    if (token) h.Authorization = `Bearer ${token}`;
    if (ip) h['x-forwarded-for'] = ip;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { app, c, close: () => new Promise((r) => app.server.close(r)) };
}
const SIGNUP = { email: 'Student@Example.test', name: '김지원', password: 'correct-horse-1', age_18_confirmed: true, notice_ack: true };

test('auth: signup -> me -> logout invalidates the token; login works; DEV tokens off means no implicit users', async () => {
  const { app, c, close } = await open();
  try {
    assert.equal((await c('/api/v1/auth/me', { token: 'dev-user-a-token' })).status, 401);
    const s = await c('/api/v1/auth/signup', { method: 'POST', body: SIGNUP });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    assert.equal(s.data.user.email, 'student@example.test');
    assert.ok(!('pass' in s.data.user));
    const me = await c('/api/v1/auth/me', { token: s.data.token });
    assert.equal(me.data.name, '김지원');
    // 저장 형태: 비밀번호 평문 없음, 토큰은 해시로만
    const u = app.store.getUserByEmail('student@example.test');
    assert.ok(u.pass.hash && u.pass.salt && !JSON.stringify(u).includes(SIGNUP.password));
    assert.equal(await verifyPassword(SIGNUP.password, u.pass), true);
    assert.ok(![...app.store._maps.authSessions.keys()].includes(s.data.token));
    assert.equal(app.store.getConsent(u.id).age_18_confirmed, true);
    assert.equal((await c('/api/v1/auth/logout', { method: 'POST', token: s.data.token, body: {} })).status, 200);
    assert.equal((await c('/api/v1/auth/me', { token: s.data.token })).status, 401);
    const l = await c('/api/v1/auth/login', { method: 'POST', body: { email: 'student@example.test', password: SIGNUP.password } });
    assert.equal(l.status, 200);
    assert.equal((await c('/api/v1/sessions', { token: l.data.token })).status, 200);
  } finally { await close(); }
});

test('auth: same error for wrong password and unknown email; validation; minors rejected; duplicate email', async () => {
  const { c, close } = await open();
  try {
    await c('/api/v1/auth/signup', { method: 'POST', body: SIGNUP });
    const wrong = await c('/api/v1/auth/login', { method: 'POST', body: { email: SIGNUP.email, password: 'nope-nope-1' }, ip: '1.1.1.1' });
    const none = await c('/api/v1/auth/login', { method: 'POST', body: { email: 'ghost@example.test', password: 'nope-nope-1' }, ip: '1.1.1.2' });
    assert.equal(wrong.status, 401); assert.equal(none.status, 401);
    assert.equal(wrong.data.message, none.data.message);
    assert.equal((await c('/api/v1/auth/signup', { method: 'POST', body: { ...SIGNUP, email: 'x@y.test', age_18_confirmed: false } })).status, 403);
    assert.equal((await c('/api/v1/auth/signup', { method: 'POST', body: { ...SIGNUP, email: 'bad' } })).status, 422);
    assert.equal((await c('/api/v1/auth/signup', { method: 'POST', body: { ...SIGNUP, email: 'x@y.test', password: 'short' } })).status, 422);
    assert.equal((await c('/api/v1/auth/signup', { method: 'POST', body: { ...SIGNUP, email: 'x@y.test', notice_ack: false } })).status, 422);
    assert.equal((await c('/api/v1/auth/signup', { method: 'POST', body: SIGNUP })).status, 409);
  } finally { await close(); }
});

test('auth: rate limit per email+ip; expired token rejected; account deletion removes user and sessions; owner isolation', async () => {
  const { app, c, close } = await open();
  try {
    let last;
    for (let i = 0; i < 6; i++) last = await c('/api/v1/auth/login', { method: 'POST', body: { email: 'a@b.test', password: 'whatever-1' }, ip: '9.9.9.9' });
    assert.equal(last.status, 429);
    const a = (await c('/api/v1/auth/signup', { method: 'POST', body: { ...SIGNUP, email: 'a1@x.test' } })).data;
    const b = (await c('/api/v1/auth/signup', { method: 'POST', body: { ...SIGNUP, email: 'b1@x.test' } })).data;
    const p = await c('/api/v1/profiles', { method: 'POST', token: a.token, body: { org_type: 'university', school_name: '임의대학교', department: '국문과', application_text: '저는 동아리에서 행사를 기획했습니다.' } });
    assert.equal(p.status, 201, JSON.stringify(p.data));
    assert.equal((await c(`/api/v1/profiles/${p.data.id}`, { token: b.token })).status, 404);
    for (const s of app.store._maps.authSessions.values()) if (s.owner === b.user.id) s.expires_at = Date.now() - 1;
    assert.equal((await c('/api/v1/auth/me', { token: b.token })).status, 401);
    assert.equal((await c('/api/v1/account', { method: 'DELETE', token: a.token })).status, 202);
    assert.equal(app.store.getUserByEmail('a1@x.test'), null);
    assert.equal((await c('/api/v1/auth/me', { token: a.token })).status, 401);
  } finally { await close(); }
});

test('auth: with the file store (server default) users and login tokens survive a restart', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intervu-auth-'));
  try {
    const a = await open({ STORE: 'file', DATA_DIR: dir });
    const s = (await a.c('/api/v1/auth/signup', { method: 'POST', body: SIGNUP })).data;
    a.app.store.close(); await a.close();
    const b = await open({ STORE: 'file', DATA_DIR: dir });
    try {
      assert.equal((await b.c('/api/v1/auth/me', { token: s.token })).status, 200, 'token still valid after restart');
      assert.equal((await b.c('/api/v1/auth/logout', { method: 'POST', token: s.token, body: {} })).status, 200);
      b.app.store.close();
    } finally { await b.close(); }
    const c = await open({ STORE: 'file', DATA_DIR: dir });
    try { assert.equal((await c.c('/api/v1/auth/me', { token: s.token })).status, 401, 'logout persisted'); c.app.store.close(); } finally { await c.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('crypto: password hashes are salted (same password, different hash)', async () => {
  const [h1, h2] = await Promise.all([hashPassword('same-pass-1'), hashPassword('same-pass-1')]);
  assert.notEqual(h1.hash, h2.hash);
  assert.equal(await verifyPassword('same-pass-1', h1), true);
  assert.equal(await verifyPassword('other-pass-1', h1), false);
});
