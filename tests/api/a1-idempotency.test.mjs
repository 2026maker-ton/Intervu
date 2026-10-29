// WP-A1: Idempotency-Key 응답 저장·재생(24h)과 키 재사용 충돌.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, cleanupAll } from '../helpers/app.mjs';

useSharedApp();

const post = (path, key, body, token = A) => fetch(base + path, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify(body),
});

test('A1: same Idempotency-Key + same body replays the stored response (no second execution)', async () => {
  await cleanupAll();
  const key = crypto.randomUUID();
  const body = { mode: 'structured', duration_minutes: 10, input_mode: 'text' };
  const r1 = await post('/api/v1/sessions', key, body);
  assert.equal(r1.status, 201);
  const d1 = await r1.json();
  const r2 = await post('/api/v1/sessions', key, body);
  // 재실행이면 "이미 진행 중인 세션" 409가 나온다. 재생이면 첫 응답과 동일해야 한다.
  assert.equal(r2.status, 201);
  assert.equal(r2.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(await r2.json(), d1);
  assert.equal(r1.headers.get('idempotent-replayed'), null);
  await cleanupAll();
});

test('A1: same key with a different body is rejected with 409', async () => {
  await cleanupAll();
  const key = crypto.randomUUID();
  const r1 = await post('/api/v1/sessions', key, { mode: 'structured', duration_minutes: 10 });
  assert.equal(r1.status, 201);
  const r2 = await post('/api/v1/sessions', key, { mode: 'structured', duration_minutes: 5 });
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).code, 'idempotency_key_reused');
  await cleanupAll();
});

test('A1: idempotency records are owner-scoped (same key from another user is a fresh request)', async () => {
  await cleanupAll();
  const key = crypto.randomUUID();
  const body = { mode: 'structured', duration_minutes: 10 };
  const a = await post('/api/v1/sessions', key, body, A);
  const b = await post('/api/v1/sessions', key, body, B);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual((await a.json()).id, (await b.json()).id);
  await cleanupAll();
});

test('A1: failed responses are not replayed (retry re-executes)', async () => {
  await cleanupAll();
  const key = crypto.randomUUID();
  const bad = await post('/api/v1/sessions', key, { mode: 'nonsense-type' });
  assert.equal(bad.status, 422);
  const again = await post('/api/v1/sessions', key, { mode: 'nonsense-type' });
  assert.equal(again.status, 422);
  assert.equal(again.headers.get('idempotent-replayed'), null);
});

test('A1: deleting a session purges stored replays of that owner (no user text kept after deletion)', async () => {
  await cleanupAll();
  const key = crypto.randomUUID();
  const body = { mode: 'structured', duration_minutes: 10 };
  const r1 = await post('/api/v1/sessions', key, body);
  const { id } = await r1.json();
  const del = await fetch(`${base}/api/v1/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A}`, 'Idempotency-Key': crypto.randomUUID() } });
  assert.equal(del.status, 202);
  // 삭제 후 같은 키는 저장본이 없으므로 새로 실행된다(재생 헤더 없음).
  const r3 = await post('/api/v1/sessions', key, body);
  assert.equal(r3.headers.get('idempotent-replayed'), null);
  await cleanupAll();
});

test('A1: invalid JSON is 400 and oversized body is 413 (not 500)', async () => {
  const bad = await fetch(`${base}/api/v1/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'invalid_json');
  // 413은 핸들러 직접 호출로 확인한다(Node 클라이언트는 업로드 중 응답을 받으면 연결이 끊길 수 있다).
  const big = await app.fetch(new Request('http://local/api/v1/sessions', { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ x: 'a'.repeat(1_100_000) }) }), {}, {});
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, 'payload_too_large');
});
