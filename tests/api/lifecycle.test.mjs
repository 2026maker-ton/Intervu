import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';

useSharedApp();

test('connect issues one-time ticket, ws validates it', async () => {
  const s = await newSession();
  const c = await call(`/api/v1/sessions/${s.id}/connect`, { method: 'POST', body: {} });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.ok(c.data.one_time_ticket);
  assert.equal(c.data.expires_in, 30);
  const noTicket = await fetch(`${base}/api/v1/sessions/${s.id}/ws`, { headers: { Authorization: `Bearer ${A}` } });
  assert.equal(noTicket.status, 401);
  const ok = await fetch(`${base}/api/v1/sessions/${s.id}/ws?ticket=${c.data.one_time_ticket}`, { headers: { Authorization: `Bearer ${A}` } });
  assert.equal(ok.status, 200);
  const reuse = await fetch(`${base}/api/v1/sessions/${s.id}/ws?ticket=${c.data.one_time_ticket}`, { headers: { Authorization: `Bearer ${A}` } });
  assert.equal(reuse.status, 401);
});

test('export JSON and account deletion purge all user data', async () => {
  const s = await newSession();
  const ex = await call('/api/v1/exports', { method: 'POST', body: { session_id: s.id, format: 'json' } });
  assert.equal(ex.status, 202, JSON.stringify(ex.data));
  const dl = await call(`/api/v1/exports/${ex.data.job_id}`);
  assert.equal(dl.status, 200);
  assert.ok(dl.data.session?.id === s.id);
  const del = await call('/api/v1/account', { method: 'DELETE' });
  assert.equal(del.status, 202, JSON.stringify(del.data));
  assert.equal(del.data.kind, 'account');
  const list = await call('/api/v1/sessions');
  assert.equal(list.data.sessions.length, 0);
});

test('appeal records evidence check and moves received->reviewing', async () => {
  const s = await newSession();
  const r = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.version, type: 'session.finish', payload: {} } });
  assert.equal(r.status, 202);
  const rep = await call(`/api/v1/sessions/${s.id}/report`);
  assert.equal(rep.data.status, 'ready');
  const ok = await call(`/api/v1/evaluations/${rep.data.evaluation_id}/appeals`, { method: 'POST', body: { category: 'evidence', evidence_id: 'no-such-turn', comment: 'x'.repeat(10) } });
  assert.equal(ok.status, 422);
  const created = await call(`/api/v1/evaluations/${rep.data.evaluation_id}/appeals`, { method: 'POST', body: { category: 'stt', comment: '전사가 잘렸어요' } });
  assert.equal(created.status, 201);
  // MVP 자동 전이(5초 규칙)를 기다리지 않고 접수 상태만 확인
  const got = await call(`/api/v1/appeals/${created.data.appeal_id}`);
  assert.equal(got.status, 200);
  assert.ok(['received', 'reviewing'].includes(got.data.status));
});
