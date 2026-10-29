import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';

useSharedApp();

test('P2: admin trends require token when ADMIN_TOKEN set; draft→publish→rollback→published-only', async () => {
  const { createApp } = await import('../../src/server.js');
  const adminApp = createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', DEV_TOKEN_A: A, DEV_TOKEN_B: B, ADMIN_TOKEN: 'test-admin-token', TRENDS_FILE: '', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' } });
  await new Promise((r) => adminApp.server.listen(0, r));
  const ab = `http://127.0.0.1:${adminApp.server.address().port}`;
  const acall = async (p, { method = 'GET', body, admin = false } = {}) => {
    const headers = { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
    if (admin) headers['x-admin-token'] = 'test-admin-token';
    const res = await fetch(ab + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try {
    const denied = await acall('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyyMm: '2026-11', items: [{ competency: 'a' }] } });
    assert.equal(denied.status, 403, 'admin gate without token must be 403');
    const draft = await acall('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyyMm: '2026-11', items: [{ competency: '문제 해결', comment: '월간 코멘트', sources: ['https://example.com'] }] }, admin: true });
    assert.equal(draft.status, 201, JSON.stringify(draft.data));
    // 공개 전에는 사용자 조회에 노출되지 않는다
    const before = await acall('/api/v1/trends/company/2026-11');
    assert.equal(before.status, 200);
    assert.equal(before.data.status, 'unavailable');
    // 인코딩된 publish/rollback 경로 (segment|yyyy-mm)
    const id = encodeURIComponent('company|2026-11');
    const pub = await acall(`/api/v1/admin/trends/${id}/publish`, { method: 'POST', body: { version: 1 }, admin: true });
    assert.equal(pub.status, 200, JSON.stringify(pub.data));
    const after = await acall('/api/v1/trends/company/2026-11');
    assert.equal(after.status, 200);
    assert.equal(after.data.status, 'monthly_trend');
    assert.equal(after.data.items[0].competency, '문제 해결');
    // 두 번째 초안→공개 후 첫 버전으로 롤백하면 새 버전이 생긴다
    await acall('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyyMm: '2026-11', items: [{ competency: '협업', comment: '협업 강조', sources: ['https://example.com/2'] }] }, admin: true });
    await acall(`/api/v1/admin/trends/${id}/publish`, { method: 'POST', body: { version: 2 }, admin: true });
    const rb = await acall(`/api/v1/admin/trends/${id}/rollback`, { method: 'POST', body: { version: 1 }, admin: true });
    assert.equal(rb.status, 200, JSON.stringify(rb.data));
    assert.equal(rb.data.version, 3);
    const rolled = await acall('/api/v1/trends/company/2026-11');
    assert.equal(rolled.data.version, 3);
    assert.equal(rolled.data.items[0].competency, '문제 해결');
    // 4개 초과는 거부된다
    const over = await acall('/api/v1/admin/trends', { method: 'POST', body: { segment: 'company', yyyyMm: '2026-12', items: [1, 2, 3, 4].map((i) => ({ competency: `c${i}`, comment: 'c', sources: ['https://e.com'] })) }, admin: true });
    assert.equal(over.status, 422);
  } finally {
    adminApp.server.close();
  }
});

test('P2: trends persist to TRENDS_FILE across restarts', async () => {
  const { createApp } = await import('../../src/server.js');
  const { writeFileSync, unlinkSync, existsSync } = await import('node:fs');
  const f = `${process.env.TEMP || '/tmp'}/intervu-trends-${Date.now()}.json`;
  const mk = (extra = {}) => createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', DEV_TOKEN_A: A, DEV_TOKEN_B: B, TRENDS_FILE: f, ADMIN_TOKEN: 'persist-admin', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100', ...extra } });
  const a1 = mk();
  await new Promise((r) => a1.server.listen(0, r));
  try {
    const b1 = `http://127.0.0.1:${a1.server.address().port}`;
    const res = await fetch(`${b1}/api/v1/admin/trends`, { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'x-admin-token': 'persist-admin', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ segment: 'university', yyyyMm: '2026-10', items: [{ competency: '학업 역량', comment: '학업 강조', sources: ['https://e.com'] }] }) });
    assert.equal(res.status, 201);
    assert.ok(existsSync(f), 'trends file must be written');
    const saved = JSON.parse((await import('node:fs')).readFileSync(f, 'utf8'));
    assert.ok(saved.rows['university:2026-10'], 'draft persisted to file');
  } finally {
    a1.server.close();
  }
  const a2 = mk();
  await new Promise((r) => a2.server.listen(0, r));
  try {
    const b2 = `http://127.0.0.1:${a2.server.address().port}`;
    const h2 = { Authorization: `Bearer ${A}`, 'x-admin-token': 'persist-admin', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
    const res = await fetch(`${b2}/api/v1/trends/university/2026-10`, { headers: h2 });
    // draft만 있고 publish가 없으므로 재시작 후에도 unavailable이어야 한다 (미승인 노출 금지)
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'unavailable');
    // 파일에서 버전 이력이 복원됐다면 다음 초안은 v2가 된다.
    const next = await fetch(`${b2}/api/v1/admin/trends`, { method: 'POST', headers: h2, body: JSON.stringify({ segment: 'university', yyyyMm: '2026-10', items: [{ competency: '학업 역량', comment: '학업 강조', sources: ['https://e.com'] }] }) });
    assert.equal(next.status, 201);
    assert.equal((await next.json()).version, 2, 'version history must survive restart');
    const pub = await fetch(`${b2}/api/v1/admin/trends/${encodeURIComponent('university|2026-10')}/publish`, { method: 'POST', headers: h2, body: JSON.stringify({ version: 2 }) });
    assert.equal(pub.status, 200);
    const pubBody = await fetch(`${b2}/api/v1/trends/university/2026-10`, { headers: h2 }).then((r) => r.json());
    assert.equal(pubBody.status, 'monthly_trend');
    assert.equal(pubBody.items[0].competency, '학업 역량');
  } finally {
    a2.server.close();
    try { unlinkSync(f); } catch { /* noop */ }
    void writeFileSync;
  }
});
