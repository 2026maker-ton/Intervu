import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';

useSharedApp();

test('provider gate: unpaid key never sent real data', async () => {
  const gated = createApp({ env: { GEMINI_API_KEY: 'fake-key', GEMINI_ALLOW_UNPAID: 'false', GEMINI_PAID_ACK: 'false', DEV_TOKEN_A: A } });
  await new Promise((r) => gated.server.listen(0, r));
  assert.equal(gated.providerName, 'mock');
  gated.server.close();
  const paid = createApp({ env: { GEMINI_API_KEY: 'fake-key', GEMINI_PAID_ACK: 'true', DEV_TOKEN_A: A } });
  assert.equal(paid.providerName, 'gemini');
  paid.server.close();
});

test('profile rate limit: minute cap enforced', async () => {
  const limited = createApp({ env: { GEMINI_API_KEY: '', DEV_TOKEN_A: A, PROFILE_RATE_PER_MINUTE: '1', PROFILE_RATE_PER_DAY: '5' } });
  await new Promise((r) => limited.server.listen(0, r));
  const b2 = `http://127.0.0.1:${limited.server.address().port}`;
  const post = () => fetch(`${b2}/api/v1/profiles`, { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ role: '사무' }) });
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 429);
  limited.server.close();
});
