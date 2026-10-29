import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.js';
import { createFileTrendStore as createTrendStore } from '../../src/node/trends-file.js';
import { ensureConsent } from '../helpers/app.mjs';

const A = 'dev-user-a-token';
const ADMIN = 'c3-admin';
const month = new Date().toISOString().slice(0, 7);
const goodItem = { competency: '문제 해결', comment: '최근 공고에서 강조됨', sources: ['https://example.com/a'] };

async function withC3(fn, { file = '' } = {}) {
  const app = createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: A, DEV_TOKEN_B: 'dev-user-b-token', ADMIN_TOKEN: ADMIN, TRENDS_FILE: file, PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const c = async (p, { method = 'GET', body, admin = true } = {}) => {
    const h = { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json' };
    if (admin) h['x-admin-token'] = ADMIN;
    if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
    if (method === 'POST' && p === '/api/v1/profiles') await ensureConsent(base, A);
    const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try { await fn(c); } finally { app.server.close(); }
}

const publish = (c, seg, ym, v) => c(`/api/v1/admin/trends/${encodeURIComponent(`${seg}|${ym}`)}/publish`, { method: 'POST', body: { version: v } });

async function sessionQuestions(c, orgType) {
  const p = await c('/api/v1/profiles', { method: 'POST', admin: false, body: { org_type: orgType, target_name: '테스트', role: '기획', source_text: '문제 해결 역량을 봅니다. 지원동기를 말해 주세요.' } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const ok = await c(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', admin: false, body: { version_id: p.data.version_id, institution_edits: { note: 'ok' } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const s = await c('/api/v1/sessions', { method: 'POST', admin: false, body: { profile_version_id: p.data.version_id, duration_minutes: 10, input_mode: 'text' } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const got = await c(`/api/v1/sessions/${s.data.id}`, { admin: false });
  await c(`/api/v1/sessions/${s.data.id}`, { method: 'DELETE', admin: false });
  return got.data.questions;
}

test('C3: item without sources or comment is rejected 422; version sources are inherited', async () => {
  await withC3(async (c) => {
    const noSrc = await c('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyy_mm: month, items: [{ competency: 'a', comment: 'x' }] } });
    assert.equal(noSrc.status, 422);
    const noComment = await c('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyy_mm: month, items: [{ competency: 'a', sources: ['https://e.com'] }] } });
    assert.equal(noComment.status, 422);
    const noComp = await c('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyy_mm: month, items: [{ competency: ' ', comment: 'x', sources: ['https://e.com'] }] } });
    assert.equal(noComp.status, 422);
    const inherit = await c('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyy_mm: month, items: [{ competency: 'a', comment: 'x' }], sources: ['https://e.com'] } });
    assert.equal(inherit.status, 201, JSON.stringify(inherit.data));
    assert.deepEqual(inherit.data.items[0].sources, ['https://e.com']);
  });
});

test('C3: list, publish sets approved_by, unpublish hides but keeps history, republish blocked for non-draft', async () => {
  await withC3(async (c) => {
    const d = await c('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyy_mm: month, items: [goodItem] } });
    assert.equal(d.status, 201, JSON.stringify(d.data));
    let list = await c('/api/v1/admin/trends');
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.trends.map((t) => [t.segment, t.yyyyMm, t.versions, t.published_version]), [['company', month, 1, null]]);
    const pub = await publish(c, 'company', month, 1);
    assert.equal(pub.status, 200);
    assert.equal(pub.data.approved_by, 'admin');
    assert.equal((await publish(c, 'company', month, 1)).status, 422, 'already published');
    list = await c('/api/v1/admin/trends');
    assert.equal(list.data.trends[0].published_version, 1);
    const un = await c(`/api/v1/admin/trends/${encodeURIComponent(`company|${month}`)}/unpublish`, { method: 'POST', body: {} });
    assert.equal(un.status, 200, JSON.stringify(un.data));
    const pubView = await c(`/api/v1/trends/company/${month}`);
    assert.equal(pubView.data.status, 'unavailable');
    const hist = await c(`/api/v1/admin/trends/${encodeURIComponent(`company|${month}`)}/history`);
    assert.equal(hist.data.versions.length, 1);
    assert.equal(hist.data.versions[0].status, 'unpublished');
    const again = await c(`/api/v1/admin/trends/${encodeURIComponent(`company|${month}`)}/unpublish`, { method: 'POST', body: {} });
    assert.equal(again.status, 404);
  });
});

test('C3: admin gating unchanged for list/unpublish', async () => {
  await withC3(async (c) => {
    assert.equal((await c('/api/v1/admin/trends', { admin: false })).status, 403);
    assert.equal((await c(`/api/v1/admin/trends/${encodeURIComponent(`company|${month}`)}/unpublish`, { method: 'POST', body: {}, admin: false })).status, 403);
  });
});

test('C3: legacy published version violating rules is not served and is reported', async () => {
  const f = path.join(os.tmpdir(), `intervu-c3-${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify({ version: 1, rows: { [`company:${month}`]: { segment: 'company', yyyyMm: month, versions: [{ version: 1, items: [{ id: 't1', competency: 'a', comment: '', sources: [] }], status: 'published', published_at: '2026-01-01' }] } } }));
  try {
    const store = createTrendStore({ filePath: f });
    assert.equal(store.published({ segment: 'company', yyyyMm: month }), null);
    assert.deepEqual(store.legacyInvalidReport(), [{ segment: 'company', yyyyMm: month, version: 1 }]);
    await withC3(async (c) => {
      const r = await c(`/api/v1/trends/company/${month}`);
      assert.equal(r.data.status, 'unavailable');
      const l = await c('/api/v1/admin/trends');
      assert.equal(l.data.legacy_invalid.length, 1);
      assert.equal(l.data.trends[0].published_version, null);
    }, { file: f });
  } finally { try { fs.unlinkSync(f); } catch { /* noop */ } }
});

test('C3: trend question appended only from published trend, labelled as supplementary', async () => {
  await withC3(async (c) => {
    const none = await sessionQuestions(c, 'company');
    assert.ok(!none.some((q) => q.trend_ids), 'no published trend -> nothing added');
    await c('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyy_mm: month, items: [goodItem] } });
    const draftOnly = await sessionQuestions(c, 'company');
    assert.ok(!draftOnly.some((q) => q.trend_ids), 'draft not reflected');
    await publish(c, 'company', month, 1);
    const withTrend = await sessionQuestions(c, 'company');
    const t = withTrend.filter((q) => q.trend_ids);
    assert.equal(t.length, 1);
    assert.equal(withTrend[withTrend.length - 1].id, t[0].id, 'at the end');
    assert.equal(t[0].source_status, 'monthly_trend');
    assert.equal(t[0].basis, '월간 트렌드(보조)');
    assert.deepEqual(t[0].trend_ids, ['trend-1']);
    // 다른 분야(대학)는 회사 트렌드를 받지 않는다
    const uni = await sessionQuestions(c, 'university');
    assert.ok(!uni.some((q) => q.trend_ids));
    // 공개 중단 후 다시 제외
    await c(`/api/v1/admin/trends/${encodeURIComponent(`company|${month}`)}/unpublish`, { method: 'POST', body: {} });
    assert.ok(!(await sessionQuestions(c, 'company')).some((q) => q.trend_ids));
  });
});
