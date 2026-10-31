// AI 기능 스위치: 비밀번호가 맞아야만 켜고 끌 수 있고, 꺼지면 외부 AI 호출이 0건이며 기본(규칙 기반) 동작은 계속된다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProviders, FAKE_KEY, STUB_BASE } from '../helpers/provider-stub.mjs';
import { createApp } from '../../src/server.js';

const CLAUDE = { LLM_ANALYSIS_PROVIDER: 'claude', CLAUDE_API_KEY: FAKE_KEY, CLAUDE_BASE_URL: `${STUB_BASE}/claude`, CLAUDE_MODEL: 'stub-claude-model', CLAUDE_LIVE_ACK: 'true', CLAUDE_TIMEOUT_MS: '200', GEMINI_API_KEY: '', ROUTE_SCHOOL_ANALYZE: 'claude', AI_SWITCH_PASSWORD: 'sw-pass' };
const text = (o) => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(o) }], usage: { input_tokens: 80, output_tokens: 40 } }), { status: 200 });
const respond = () => text({ talent_traits: [{ label: '탐구', quote: '탐구 역량' }], admission_elements: [], interview_format: [], unconfirmed: [] });
const sw = (ctx, body, ip) => fetch(`${ctx.base}/api/v1/ai-switch`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: JSON.stringify(body) });

test('ai switch: wrong/missing password rejected, right password toggles, off blocks all provider calls but the flow still works', async () => {
  await withProviders({ env: CLAUDE, overrides: { syntheticTraffic: true }, respond }, async (ctx) => {
    const base = ctx.base ?? ctx.baseUrl; // 헬퍼가 노출하는 이름 차이를 흡수
    ctx.base = base;
    const get = async () => (await fetch(`${base}/api/v1/ai-switch`)).json();
    assert.deepEqual(await get(), { on: true, configured: true });
    assert.equal((await sw(ctx, { on: false, password: 'nope' })).status, 401);
    assert.equal((await sw(ctx, { on: false })).status, 401);
    assert.equal((await sw(ctx, { password: 'sw-pass' })).status, 422);
    assert.equal((await get()).on, true, 'rejected attempts change nothing');

    const prof = () => ctx.g('/api/v1/profiles', { method: 'POST', body: { org_type: 'university', school_name: '임의대학교', department: '국문과', source_text: '인재상: 탐구 역량을 봅니다.', application_text: '저는 동아리 앱 개발 프로젝트에서 팀장을 맡아 일정을 조율했습니다.' } });
    const calls = () => ctx.calls.filter((c) => c.url.includes('/claude/messages')).length;
    const p1 = await prof();
    await ctx.g(`/api/v1/profiles/${p1.data.id}/school-analysis`, { method: 'POST', body: { refresh: true } });
    assert.ok(calls() >= 1, 'AI on: provider called');

    const off = await sw(ctx, { on: false, password: 'sw-pass' });
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { on: false });
    assert.equal((await get()).on, false);
    const before = calls();
    const p2 = await prof();
    assert.equal(p2.status, 201, 'profile creation still works with AI off');
    const a = await ctx.g(`/api/v1/profiles/${p2.data.id}/school-analysis`, { method: 'POST', body: { refresh: true } });
    assert.equal(a.status, 200);
    assert.equal(a.data.analysis_provider, 'rule', 'rule-based fallback with AI off');
    const ap = await ctx.g(`/api/v1/profiles/${p2.data.id}/approve`, { method: 'POST', body: { version_id: p2.data.version_id } });
    assert.equal(ap.status, 200, 'approval (plan design) works with AI off');
    assert.equal(calls(), before, 'no provider calls while AI is off');
    const st = await ctx.g('/api/v1/providers/status');
    assert.equal(st.data.summary, 'mock');

    assert.equal((await sw(ctx, { on: true, password: 'sw-pass' })).status, 200);
    assert.equal((await get()).on, true);
  });
});

test('ai switch: disabled without a configured password; attempts are rate limited', async () => {
  const app = createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: '', DEV_TOKEN_B: '', TRENDS_FILE: '' } });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (b, ip) => fetch(`${base}/api/v1/ai-switch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(b) });
  try {
    assert.equal((await post({ on: false, password: '' }, '1.1.1.1')).status, 503);
    assert.equal((await (await fetch(`${base}/api/v1/ai-switch`)).json()).configured, false);
  } finally { await new Promise((r) => app.server.close(r)); }
  await withProviders({ env: { ...CLAUDE }, respond }, async (ctx) => {
    for (let i = 0; i < 5; i++) assert.equal((await sw(ctx, { on: false, password: 'bad' }, '7.7.7.7')).status, 401);
    assert.equal((await sw(ctx, { on: false, password: 'sw-pass' }, '7.7.7.7')).status, 429);
    assert.equal((await sw(ctx, { on: false, password: 'sw-pass' }, '8.8.8.8')).status, 200);
  });
});

test('ai switch sits behind the entry gate', async () => {
  await withProviders({ env: { ...CLAUDE, SITE_PASSWORD: 'gate-pw', GATE_SECRET: 'g' }, respond }, async (ctx) => {
    const r = await fetch(`${ctx.base}/api/v1/ai-switch`);
    assert.equal(r.status, 401);
    assert.equal((await r.json()).code, 'gate_required');
    assert.equal((await sw(ctx, { on: false, password: 'sw-pass' })).status, 401);
  });
});
