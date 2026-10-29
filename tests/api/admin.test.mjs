import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp, A, B } from '../helpers/app.mjs';

const TREND = { segment: 'company', yyyyMm: '2026-11', items: [{ competency: '문제 해결', comment: '코멘트', sources: ['https://example.com'] }] };

test('P0-6: admin is disabled (not open) when ADMIN_TOKEN is unset', async () => {
  await withApp({}, async (c) => {
    const d = await c('/api/v1/admin/trends', { method: 'POST', token: B, body: TREND });
    assert.equal(d.status, 403, 'ordinary dev-token users must not be admins');
    assert.equal(d.data.code, 'admin_disabled');
    assert.equal((await c(`/api/v1/admin/trends/${encodeURIComponent('company|2026-11')}/history`)).status, 403);
    assert.equal((await c(`/api/v1/admin/trends/${encodeURIComponent('company|2026-11')}/publish`, { method: 'POST', body: { version: 1 } })).status, 403);
    assert.equal((await c(`/api/v1/admin/trends/${encodeURIComponent('company|2026-11')}/rollback`, { method: 'POST', body: { version: 1 } })).status, 403);
    assert.equal((await c('/api/v1/admin/trends', { method: 'POST', body: TREND, admin: 'anything' })).status, 403);
    const st = await c('/api/v1/admin/status');
    assert.equal(st.data.admin_enabled, false);
    assert.equal((await c('/api/v1/trends/company/2026-11')).status, 200, 'published trend lookup stays public');
  });
});

test('P0-6: admin token is accepted only via header, never query string or body', async () => {
  await withApp({ ADMIN_TOKEN: 'secret-admin-token' }, async (c) => {
    assert.equal((await c('/api/v1/admin/trends?admin_token=secret-admin-token', { method: 'POST', body: TREND })).status, 403);
    assert.equal((await c('/api/v1/admin/trends', { method: 'POST', body: { ...TREND, admin_token: 'secret-admin-token' } })).status, 403);
    assert.equal((await c('/api/v1/admin/trends', { method: 'POST', body: TREND, admin: 'secret-admin-tokeX' })).status, 403);
    assert.equal((await c('/api/v1/admin/trends', { method: 'POST', body: TREND, admin: 'secret-admin-token' })).status, 201);
    assert.equal((await c('/api/v1/admin/status')).data.admin_enabled, true);
  });
});

test('P0-6: metrics and gemini diagnostics need authentication; admin only for spend/diagnostics', async () => {
  await withApp({ ADMIN_TOKEN: 'secret-admin-token' }, async (c) => {
    for (const p of ['/api/v1/metrics', '/api/v1/diagnostics/gemini-models']) {
      assert.equal((await c(p, { token: null })).status, 401, `${p} without auth`);
      assert.equal((await c(p)).status, 403, `${p} with ordinary user token`);
      assert.equal((await c(p, { admin: 'secret-admin-token' })).status, 200, `${p} with admin token`);
    }
  });
  await withApp({}, async (c) => {
    assert.equal((await c('/api/v1/metrics', { admin: 'x' })).status, 403, 'disabled admin never grants metrics');
  });
});

test('P0-6: public health is minimal; full provider info needs a user token', async () => {
  await withApp({ GEMINI_API_KEY: 'fake-key', GEMINI_ALLOW_UNPAID: 'true' }, async (c) => {
    const pub = await c('/api/v1/health', { token: null });
    assert.equal(pub.status, 200);
    assert.deepEqual(Object.keys(pub.data.provider), ['selected']);
    const text = JSON.stringify(pub.data);
    for (const leak of ['paidAck', 'allowUnpaid', 'freeOnly', 'textModel', 'configured', 'trends', 'groq', 'killSwitch']) assert.ok(!text.includes(leak), `public health leaks ${leak}`);
    const full = await c('/api/v1/health');
    assert.equal(full.data.provider.selected, 'mock');
    assert.equal(full.data.provider.paidAck, false);
    assert.equal(full.data.provider.adminEnabled, false);
  });
});

test('P0-6: no built-in dev tokens; unauthenticated STT status rejected', async () => {
  await withApp({ DEV_TOKEN_A: '', DEV_TOKEN_B: '' }, async (c) => {
    for (const t of ['dev-user-a-token', 'dev-user-b-token', 'user-a', '']) {
      assert.equal((await c('/api/v1/sessions', { token: t || 'x' })).status, 401, `token "${t}" must not work`);
    }
  });
  await withApp({}, async (c) => {
    assert.equal((await c('/api/v1/stt/status', { token: null })).status, 401);
    assert.equal((await c('/api/v1/stt/status')).status, 200);
  });
});
