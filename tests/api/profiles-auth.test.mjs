import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';

useSharedApp();

test('health: mock provider when no key', async () => {
  const h = await call('/api/v1/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.provider.selected, 'mock');
});

test('auth required', async () => {
  const r = await call('/api/v1/sessions', { token: 'nope' });
  assert.equal(r.status, 401);
});

test('idempotency key required on writes', async () => {
  const r = await call('/api/v1/sessions', { method: 'POST', body: {}, idem: false });
  assert.equal(r.status, 422);
});

test('profile extraction keeps only span-verified claims + PII masked', async () => {
  const text = '담당업무: 문제 해결, 협업, 데이터 분석. 지원자 이메일 test@example.com 연락처 010-1234-5678';
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'public', target_name: '테스트공사', role: '사무', source_text: text } });
  assert.equal(p.status, 201);
  assert.ok(p.data.pii_warnings.includes('email'));
  const d = await call(`/api/v1/profiles/${p.data.id}`);
  assert.equal(d.status, 200);
  const claims = d.data.current_version.extracted.claims;
  assert.ok(claims.length >= 3);
  for (const c of claims) assert.equal(c.quote, claims[0].quote.length > 1000 ? '' : c.quote);
  assert.match(d.data.current_version.extracted.masked_text, /\[이메일\]/);
  assert.doesNotMatch(d.data.current_version.extracted.masked_text, /test@example\.com/);
});

test('session requires approved profile version', async () => {
  const p = await call('/api/v1/profiles', { method: 'POST', body: { role: '사무', source_text: '문제 해결 역량' } });
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.data.version_id } });
  assert.equal(s.status, 409);
  const ok = await call(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', body: { version_id: p.data.version_id } });
  assert.equal(ok.status, 200);
  const s2 = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.data.version_id } });
  assert.equal(s2.status, 201);
});
