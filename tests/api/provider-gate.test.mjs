import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';
import { withGeminiStub, FORGED, REAL_TEXT, runForgedFlow } from '../helpers/stub-fetch.mjs';

useSharedApp();

test('P0 gate: forged synthetic flags with allowUnpaid never reach Gemini (profile + turn)', async () => {
  await withGeminiStub({ GEMINI_ALLOW_UNPAID: 'true', GEMINI_PAID_ACK: 'false' }, {}, async ({ gcall, outbound, app }) => {
    assert.equal(app.providerName, 'mock');
    const { pr, turn } = await runForgedFlow(gcall);
    assert.equal(outbound.length, 0, 'no outbound Gemini request for client-flagged traffic');
    assert.equal(pr.data.provider, 'mock');
    assert.equal(turn.data.provider, 'mock');
    assert.equal((await gcall('/api/v1/health')).data.provider.selected, 'mock');
  });
});

test('P0 gate: highschool real profile is rejected even when paidAck is set (adult-only, 2026-10-31)', async () => {
  await withGeminiStub({ GEMINI_PAID_ACK: 'true' }, {}, async ({ gcall, outbound }) => {
    const pr = await gcall('/api/v1/profiles', { method: 'POST', body: { org_type: 'highschool', target_name: 'X', role: '학업', source_text: '문제 해결 협업 진로' } });
    assert.equal(pr.status, 422, JSON.stringify(pr.data));
    assert.equal(outbound.length, 0);
  });
});

test('P0 gate: server-owned syntheticTraffic instance may use free Gemini; real-looking PII still blocked', async () => {
  await withGeminiStub({ GEMINI_ALLOW_UNPAID: 'true', GEMINI_PAID_ACK: 'false' }, { syntheticTraffic: true }, async ({ gcall, outbound, app }) => {
    assert.equal(app.providerName, 'gemini');
    const bad = await gcall('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', role: 'PM', source_text: '문제 해결 협업 연락처 010-1234-5678' } });
    assert.equal(bad.status, 422);
    assert.equal(outbound.length, 0, 'PII blocked before any outbound call');
    const ok = await gcall('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', role: 'PM', source_text: '문제 해결 협업 인재상' } });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.provider, 'gemini');
    assert.equal(outbound.length, 1);
    const s = await gcall('/api/v1/sessions', { method: 'POST', body: { duration_minutes: 10 } });
    assert.equal(s.data.free_test, true);
  });
});

test('P0 gate: HTTP/env cannot enable synthetic mode (only createApp override)', async () => {
  await withGeminiStub({ GEMINI_ALLOW_UNPAID: 'true', GEMINI_PAID_ACK: 'false', SYNTHETIC_TRAFFIC: 'true', INTERVU_SYNTHETIC: 'true' }, {}, async ({ app }) => {
    assert.equal(app.providerName, 'mock');
  });
});
