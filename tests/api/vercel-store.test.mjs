// Vercel + Upstash Redis 저장 방식: 요청마다 새 코어, 사용자 데이터는 Redis에서 불러오고 저장. 가짜 Redis(메모리)로 시험한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVercelHandler } from '../../src/vercel/handler.js';
import { createRedis } from '../../src/vercel/redis.js';
import { getFixture } from '../../src/domain/fixtures.js';

// Upstash REST를 흉내 내는 fetch: 실제 createRedis 클라이언트를 통과시킨다.
function fakeUpstash() {
  const kv = new Map(); const sets = new Map(); const hashes = new Map(); let evals = 0;
  const run = (c) => {
    const [op, ...a] = c; const o = op.toUpperCase();
    if (o === 'GET') return kv.has(a[0]) ? kv.get(a[0]) : null;
    if (o === 'SET') { if (a.includes('NX') && kv.has(a[0])) return null; kv.set(a[0], a[1]); return 'OK'; }
    if (o === 'DEL') { const had = kv.delete(a[0]); sets.delete(a[0]); hashes.delete(a[0]); return had ? 1 : 0; }
    if (o === 'INCR') { const n = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(n)); return n; }
    if (o === 'EXPIRE') return 1;
    if (o === 'SADD') { const s = sets.get(a[0]) || new Set(); s.add(a[1]); sets.set(a[0], s); return 1; }
    if (o === 'SMEMBERS') return [...(sets.get(a[0]) || [])];
    if (o === 'HMGET') { const h = hashes.get(a[0]) || {}; return a.slice(1).map((f) => (f in h ? String(h[f]) : null)); }
    if (o === 'HINCRBYFLOAT') { const h = hashes.get(a[0]) || {}; h[a[1]] = (Number(h[a[1]]) || 0) + Number(a[2]); hashes.set(a[0], h); return String(h[a[1]]); }
    if (o === 'EVAL') { evals++; if (kv.get(a[2]) === a[3]) { kv.delete(a[2]); return 1; } return 0; }
    throw new Error('unsupported ' + op);
  };
  const fetchFn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (opts.headers.Authorization !== 'Bearer tok') return new Response('{}', { status: 401 });
    const res = String(url).endsWith('/pipeline') ? body.map((c) => ({ result: run(c) })) : { result: run(body) };
    return new Response(JSON.stringify(res), { status: 200 });
  };
  return { kv, fetchFn, get evals() { return evals; } };
}
const ENV = { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', CLAUDE_API_KEY: '', DEV_TOKEN_A: '', DEV_TOKEN_B: '', TRENDS_FILE: '', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' };
function setup() {
  const up = fakeUpstash();
  const redis = createRedis({ url: 'https://redis.test', token: 'tok', fetchFn: up.fetchFn });
  // 요청마다 새 핸들러(=콜드 스타트)로 호출해 인메모리 상태가 이어지지 않음을 보장한다.
  const call = async (path, { method = 'GET', body, token, ip = '1.1.1.1' } = {}) => {
    const h = createVercelHandler({ env: ENV, redis });
    const headers = { 'x-forwarded-for': ip };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
    const r = await h(new Request('http://x' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  return { up, call };
}
const SIGNUP = { email: 'V@Example.test', name: '브이', password: 'vercel-pass-1', age_18_confirmed: true, notice_ack: true };

test('cold starts: signup -> me -> login -> logout survive across stateless requests; tokens/passwords are stored hashed', async () => {
  const { up, call } = setup();
  const s = await call('/api/v1/auth/signup', { method: 'POST', body: SIGNUP });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal((await call('/api/v1/auth/me', { token: s.data.token })).data.name, '브이');
  const l = await call('/api/v1/auth/login', { method: 'POST', body: { email: 'v@example.test', password: SIGNUP.password } });
  assert.equal(l.status, 200);
  assert.equal((await call('/api/v1/auth/me', { token: l.data.token })).status, 200);
  assert.ok(![...up.kv.keys()].some((k) => k.includes(s.data.token)), 'token never stored raw');
  assert.ok(![...up.kv.values()].some((v) => String(v).includes(SIGNUP.password)), 'password never stored raw');
  assert.equal((await call('/api/v1/auth/logout', { method: 'POST', token: s.data.token, body: {} })).status, 200);
  assert.equal((await call('/api/v1/auth/me', { token: s.data.token })).status, 401);
  assert.equal((await call('/api/v1/auth/me', { token: l.data.token })).status, 200, 'other device session stays');
  assert.equal((await call('/api/v1/auth/signup', { method: 'POST', body: SIGNUP, ip: '2.2.2.2' })).status, 409, 'duplicate email');
  assert.equal((await call('/api/v1/auth/me')).status, 401);
  assert.ok(up.evals >= 1, 'per-owner lock is released through the compare-and-delete script');
  assert.equal([...up.kv.keys()].filter((k) => k.startsWith('lock:')).length, 0);
});

test('cold starts: profile, approval and interview state persist per owner; other owners cannot read it; account delete wipes everything', async () => {
  const { up, call } = setup();
  const a = (await call('/api/v1/auth/signup', { method: 'POST', body: SIGNUP })).data;
  const b = (await call('/api/v1/auth/signup', { method: 'POST', body: { ...SIGNUP, email: 'other@example.test' }, ip: '3.3.3.3' })).data;
  const fx = getFixture('smp-snu-bio');
  const p = await call('/api/v1/profiles', { method: 'POST', token: a.token, body: { org_type: 'university', school_name: fx.school_name, department: fx.department, track: fx.track, source_text: fx.posting_text, application_text: fx.application_text, fixture_id: fx.id } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal((await call(`/api/v1/profiles/${p.data.id}`, { token: a.token })).data.school_name, fx.school_name, 'read after cold start');
  assert.equal((await call(`/api/v1/profiles/${p.data.id}`, { token: b.token })).status, 404, 'owner isolation');
  const ap = await call(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', token: a.token, body: { version_id: p.data.version_id } });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  const s = await call('/api/v1/sessions', { method: 'POST', token: a.token, body: { profile_version_id: p.data.version_id, interview_format: 'general', input_mode: 'text' } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const st = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', token: a.token, body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  assert.equal(st.status, 202, JSON.stringify(st.data));
  const t = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', token: a.token, body: { command_id: crypto.randomUUID(), expected_version: st.data.version, type: 'turn.text', payload: { text: fx.answers[0] } } });
  assert.equal(t.status, 202, JSON.stringify(t.data));
  assert.equal((await call(`/api/v1/sessions/${s.data.id}`, { token: a.token })).data.q_index, 1, 'turn state persisted');
  assert.ok(up.kv.has(`own:${a.user.id}`) && up.kv.get(`own:${a.user.id}`).length < 200_000, 'one compressed bundle per owner');
  assert.equal((await call('/api/v1/account', { method: 'DELETE', token: a.token })).status, 202);
  for (const k of [`user:${a.user.id}`, `own:${a.user.id}`, 'email:v@example.test', `usess:${a.user.id}`]) assert.equal(up.kv.has(k), false, k);
  assert.equal((await call('/api/v1/auth/me', { token: a.token })).status, 401);
  assert.equal((await call('/api/v1/auth/me', { token: b.token })).status, 200, 'other account untouched');
});

test('auth rate limit lives in Redis (survives cold starts); unconfigured store and Redis outage fail closed', async () => {
  const { call } = setup();
  let last;
  for (let i = 0; i < 6; i++) last = await call('/api/v1/auth/login', { method: 'POST', body: { email: 'x@y.test', password: 'whatever-1' }, ip: '9.9.9.9' });
  assert.equal(last.status, 429);
  const none = await createVercelHandler({ env: ENV, redis: null })(new Request('http://x/api/v1/sessions', { headers: { Authorization: 'Bearer z' } }));
  assert.equal(none.status, 503);
  const down = createRedis({ url: 'https://redis.test', token: 'tok', fetchFn: async () => new Response('{}', { status: 500 }) });
  const out = await createVercelHandler({ env: ENV, redis: down })(new Request('http://x/api/v1/sessions', { headers: { Authorization: 'Bearer z' } }));
  assert.equal(out.status, 503);
});

test('gate on Vercel: locked requests never touch Redis; fail closed without SITE_PASSWORD; Redis-counted attempts', async () => {
  const up = fakeUpstash();
  const redis = createRedis({ url: 'https://redis.test', token: 'tok', fetchFn: up.fetchFn });
  const mk = (extra) => createVercelHandler({ env: { ...ENV, ...extra }, redis });
  const req = (path, init = {}) => new Request('http://x' + path, { headers: { 'x-forwarded-for': '2.2.2.2', ...(init.headers || {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, ...init });

  // 비밀번호 환경변수가 없는 Vercel 배포는 닫힌다
  const closed = await mk({ VERCEL: '1' })(req('/api/v1/health'));
  assert.equal(closed.status, 503);
  assert.equal((await closed.json()).error.code, 'gate_unconfigured');

  const h = mk({ VERCEL: '1', SITE_PASSWORD: 'pw-vercel', GATE_SECRET: 'g' });
  const before = up.kv.size;
  const locked = await h(req('/api/v1/auth/signup', { method: 'POST', body: JSON.stringify(SIGNUP) }));
  assert.equal(locked.status, 401);
  assert.equal((await locked.json()).error.code, 'gate_required');
  assert.equal(up.kv.size, before, 'nothing written to Redis while locked');

  assert.equal((await h(req('/api/v1/gate', { method: 'POST', body: JSON.stringify({ password: 'bad' }) }))).status, 401);
  const ok = await h(req('/api/v1/gate', { method: 'POST', body: JSON.stringify({ password: 'pw-vercel' }) }));
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await h(req('/api/v1/health', { headers: { cookie } }))).status, 200);
  // 다른 비밀값으로 만든 핸들러(=다른 배포 설정)는 이 쿠키를 거절한다
  assert.equal((await mk({ VERCEL: '1', SITE_PASSWORD: 'pw-vercel', GATE_SECRET: 'other' })(req('/api/v1/health', { headers: { cookie } }))).status, 401);

  // 시도 제한은 Redis로 센다: 콜드 스타트마다 새 핸들러여도 누적
  let last;
  for (let i = 0; i < 6; i++) last = await mk({ VERCEL: '1', SITE_PASSWORD: 'pw-vercel', GATE_SECRET: 'g' })(req('/api/v1/gate', { method: 'POST', body: JSON.stringify({ password: 'bad' }), headers: { 'x-forwarded-for': '3.3.3.3' } }));
  assert.equal(last.status, 429);
});
