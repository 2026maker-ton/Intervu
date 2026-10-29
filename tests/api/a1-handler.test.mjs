// WP-A1: 플랫폼 중립 핸들러((Request, env, ctx) => Response) 직접 호출 == HTTP 경로, 코어의 node 비의존.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useSharedApp, app, base, A } from '../helpers/app.mjs';

useSharedApp();

const direct = (p, { method = 'GET', body, token = A, key } = {}) => app.fetch(new Request(`http://local${p}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'Idempotency-Key': key || crypto.randomUUID() } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
}), {}, {});
const http = (p, { method = 'GET', body, token = A, key } = {}) => fetch(base + p, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'Idempotency-Key': key || crypto.randomUUID() } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'request_id' ? undefined : v)));

test('A1 handler: direct Request call returns the same status/body as the HTTP path', async () => {
  const doc = { filename: 'a.txt', mime_type: 'text/plain', content_base64: Buffer.from('협업 경험을 쌓았습니다.').toString('base64') };
  const cases = [
    ['/api/v1/interview-types', {}],
    ['/api/v1/sessions', {}],
    ['/api/v1/documents/extract', { method: 'POST', body: doc }],
    ['/api/v1/sessions', { token: null }], // 401
    ['/api/v1/nope', {}], // 404
    ['/api/v1/sessions', { method: 'POST', body: { mode: 'nonsense' } }], // 422
  ];
  for (const [p, opt] of cases) {
    const [a, b] = [await direct(p, opt), await http(p, opt)];
    assert.equal(a.status, b.status, `${p} status`);
    assert.deepEqual(strip(await a.json()), strip(await b.json()), `${p} body`);
    assert.equal(a.headers.get('cache-control'), b.headers.get('cache-control'));
  }
});

test('A1 handler: direct Request path also replays idempotent writes', async () => {
  const key = crypto.randomUUID();
  const body = { mode: 'structured', duration_minutes: 10 };
  const r1 = await direct('/api/v1/sessions', { method: 'POST', body, key });
  assert.equal(r1.status, 201);
  const d1 = await r1.json();
  const r2 = await direct('/api/v1/sessions', { method: 'POST', body, key });
  assert.equal(r2.status, 201);
  assert.deepEqual(await r2.json(), d1);
  const del = await direct(`/api/v1/sessions/${d1.id}`, { method: 'DELETE' });
  assert.equal(del.status, 202);
});

test('A1 handler: src/app/** uses no node:* imports, no process/Buffer-free claims beyond documents, no process.env', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk('src/app')) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/from 'node:|require\('node:/.test(t), `${f} imports a node: module`);
    assert.ok(!/process\.env/.test(t), `${f} reads process.env`);
  }
  // GEMINI_FREE_ONLY는 설정으로만 주입한다(어댑터에서 직접 조회 금지).
  assert.ok(!/process\.env/.test(fs.readFileSync('src/providers/adapters.js', 'utf8')), 'adapters read process.env');
});
