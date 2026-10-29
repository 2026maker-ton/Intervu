// WP-A3: Worker 진입점 계약(바인딩 없는 단일 isolate 모드, wrangler·네트워크 없음) + 이식성 정적 검사.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import worker from '../../src/worker/index.js';
import { SessionDO } from '../../src/worker/do-session.js';

const env = { DEV_TOKEN_A: 'tok-a-1234567890', GEMINI_API_KEY: '', GROQ_API_KEY: '', GROQ_WHISPER_KEY: '', TRENDS_FILE: '', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100', SESSION_DO_NOT_BOUND: { not: 'a string' } };
const req = (p, { method = 'GET', token, body } = {}) => new Request(`https://api.example${p}`, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
});

test('A3 worker: health·비 API 404·인증 401', async () => {
  assert.equal((await worker.fetch(req('/api/v1/health'), env, {})).status, 200);
  assert.equal((await worker.fetch(req('/index.html'), env, {})).status, 404);
  assert.equal((await worker.fetch(req('/api/v1/profiles'), env, {})).status, 401);
  assert.equal((await worker.fetch(req('/api/v1/profiles', { token: 'wrong' }), env, {})).status, 401);
});

test('A3 worker: 동의 → 프로필 생성 흐름', async () => {
  const t = env.DEV_TOKEN_A;
  const noConsent = await worker.fetch(req('/api/v1/profiles', { method: 'POST', token: t, body: { org_type: 'company', role: '기획', source_text: '문제 해결' } }), env, {});
  assert.equal(noConsent.status, 428);
  const c = await worker.fetch(req('/api/v1/consents', { method: 'POST', token: t, body: { age_19_confirmed: true, notice_version: 'test-1' } }), env, {});
  assert.equal(c.status, 201);
  const p = await worker.fetch(req('/api/v1/profiles', { method: 'POST', token: t, body: { org_type: 'company', role: '기획', source_text: '문제 해결' } }), env, {});
  assert.equal(p.status, 201);
});

test('A3 DO: 가짜 저장소로 요청 직렬 처리·스냅샷 복원', async () => {
  const mem = new Map();
  const storage = {
    async get(k) { return Array.isArray(k) ? new Map(k.filter((x) => mem.has(x)).map((x) => [x, mem.get(x)])) : mem.get(k); },
    async put(o) { for (const [k, v] of Object.entries(o)) mem.set(k, v); },
    async delete(ks) { for (const k of ks) mem.delete(k); },
  };
  const ctx = { storage, blockConcurrencyWhile: (fn) => { ctx.ready = fn(); return ctx.ready; } };
  const mk = async () => { const d = new SessionDO(ctx, env); await ctx.ready; return d; };
  const d1 = await mk();
  const t = env.DEV_TOKEN_A;
  await d1.fetch(req('/api/v1/consents', { method: 'POST', token: t, body: { age_19_confirmed: true, notice_version: 'test-1' } }));
  const rs = await Promise.all([1, 2, 3].map(() => d1.fetch(req('/api/v1/profiles', { method: 'POST', token: t, body: { org_type: 'company', role: '기획', source_text: '문제 해결' } }))));
  assert.deepEqual(rs.map((r) => r.status), [201, 201, 201]);
  const d2 = await mk(); // 새 인스턴스 = 저장소에서 복원
  const consent = await d2.fetch(req('/api/v1/profiles', { method: 'POST', token: t, body: { org_type: 'company', role: '기획', source_text: '복원' } }));
  assert.equal(consent.status, 201, '동의 기록이 복원돼 428이 아니어야 한다');
});

test('A3 이식성: src/app·domain·providers·config·store(비 file) 에 node: 임포트 없음', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', 'src');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(root);
  const allowed = (f) => { const r = path.relative(root, f).replace(/\\/g, '/'); return r.startsWith('node/') || ['server.js', 'env.js', 'store/file.js'].includes(r); };
  const offenders = files.filter((f) => !allowed(f) && /(?:from\s+|import\(\s*|require\(\s*)['"]node:/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(root, f)), []);
});
