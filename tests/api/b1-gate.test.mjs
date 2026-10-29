// WP-B1: 일반화된 게이트(04 §2)와 operation 라우팅·상태 API. 04 §7 항목 1·2·7·8. 스텁 fetch·가짜 키만 사용한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A } from '../helpers/app.mjs';
import { FORGED, REAL_TEXT } from '../helpers/stub-fetch.mjs';
import { withProviders, FAKE_KEY, STUB_BASE, STUB_MODEL } from '../helpers/provider-stub.mjs';
import { evaluateGate } from '../../src/providers/gate.js';

const LIVE = { GEMINI_LIVE_ACK: 'true' };

// 실데이터 흐름 1회: 프로필(공고) + 세션 + 답변. 공급자가 열려 있으면 외부 호출이 생긴다.
async function realFlow({ g, startSession, turn }) {
  const pr = await g('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', role: 'PM', source_text: '문제 해결 협업 인재상', ...FORGED } });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  const s = await startSession(FORGED);
  const t = await turn(s, REAL_TEXT, FORGED);
  assert.equal(t.status, 202, JSON.stringify(t.data));
  return { pr, t, s };
}

test('B1 gate unit: every condition closes the gate and names its reason', () => {
  const gate = { apiKey: 'k', baseUrl: 'https://x.test', model: 'm', liveAck: true, realDataAck: true, legacyRealData: false, syntheticOnly: false };
  const real = { consent: true, age19: true };
  const ev = (over = {}, ctx = real, killed = false) => evaluateGate({ provider: 'gemini', gate: { ...gate, ...over }, killed, ctx });
  assert.deepEqual(ev(), { live: true, reason: null });
  assert.equal(evaluateGate({ provider: 'mock', gate, killed: false, ctx: real }).live, false);
  assert.equal(ev({}, real, true).reason, 'kill_switch');
  assert.equal(ev({ apiKey: '' }).reason, 'not_configured');
  assert.equal(ev({ baseUrl: '' }).reason, 'not_configured');
  assert.equal(ev({ model: '' }).reason, 'not_configured');
  assert.equal(ev({ liveAck: false }).reason, 'live_ack_missing');
  assert.equal(ev({ realDataAck: false }).reason, 'real_data_ack_missing');
  assert.equal(ev({ realDataAck: false, syntheticOnly: true }).reason, 'synthetic_only');
  assert.equal(ev({}, { consent: false, age19: true }).reason, 'consent_missing');
  assert.equal(ev({}, { consent: true, age19: false }).reason, 'consent_missing');
  assert.equal(ev({ realDataAck: false }, { synthetic: true }).live, true, 'server-judged synthetic needs only LIVE_ACK');
  assert.equal(ev({ liveAck: false }, { synthetic: true }).reason, 'live_ack_missing');
  assert.equal(ev({}, { ...real, forceMock: true }).reason, 'highschool_mock');
  // 서버 판정이 아닌 값(문자열 등)은 합성으로 취급하지 않는다
  assert.equal(ev({ realDataAck: false }, { synthetic: 'true' }).live, false);
});

test('B1 gate: each missing condition means zero outbound calls and a reason in provider_trace', async () => {
  const cases = [
    ['no key', { GEMINI_API_KEY: '', ...LIVE }, 'not_configured'],
    ['no LIVE_ACK', {}, 'live_ack_missing'],
    ['kill switch', { ...LIVE, KILL_PROVIDERS: 'gemini' }, 'kill_switch'],
    ['live ack but real data unapproved', LIVE, 'synthetic_only'],
    ['real-data ack but no consent record', { ...LIVE, GEMINI_REAL_DATA_ACK: 'true' }, 'consent_missing'],
  ];
  for (const [name, env, reason] of cases) {
    await withProviders({ env }, async (ctx) => {
      const { t, pr } = await realFlow(ctx);
      assert.equal(ctx.calls.length, 0, `${name}: no outbound request`);
      assert.equal(t.data.provider, 'mock', name);
      const tr = t.data.provider_trace[0];
      assert.equal(tr.operation, 'dialogue.next');
      assert.equal(tr.provider, 'mock');
      assert.notEqual(tr.mode, 'live', name);
      assert.equal(tr.reason, reason, name);
      assert.equal(pr.data.provider, 'mock');
      assert.equal(pr.data.provider_trace[0].reason, reason, `${name} (claims.extract)`);
    });
  }
});

test('B1 gate: forged client flags never open the gate, even with LIVE_ACK (headers/query/body)', async () => {
  await withProviders({ env: LIVE }, async (ctx) => {
    const r = await ctx.g('/api/v1/profiles?synthetic=true&free_test=true', { method: 'POST', body: { org_type: 'company', role: 'PM', source_text: '문제 해결 협업 인재상', ...FORGED } });
    assert.equal(r.status, 201);
    await realFlow(ctx);
    assert.equal(ctx.calls.length, 0);
    const st = await ctx.g('/api/v1/providers/status?synthetic=true');
    assert.equal(st.data.operations['dialogue.next'].mode, 'mock');
  });
});

test('B1 gate: server-owned synthetic instance + LIVE_ACK reaches the stub; request shape follows env (04 §7-1)', async () => {
  await withProviders({ env: LIVE, overrides: { syntheticTraffic: true } }, async (ctx) => {
    const { t, s } = await realFlow(ctx);
    // 프로필 추출 1회 + 답변 1회
    assert.equal(ctx.calls.length, 2);
    for (const c of ctx.calls) {
      assert.ok(c.url.startsWith(`${STUB_BASE}/models/${STUB_MODEL}:generateContent`), c.url);
      assert.equal(c.headers['x-goog-api-key'], FAKE_KEY);
      assert.equal(c.headers['Content-Type'], 'application/json');
      assert.ok(Array.isArray(c.body.contents) && c.body.contents[0].role === 'user');
      assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
    }
    assert.equal(t.data.provider, 'gemini');
    assert.equal(t.data.provider_trace[0].mode, 'live');
    assert.equal(t.data.provider_trace[0].provider, 'gemini');
    assert.equal(t.data.provider_trace[0].reason, null);
    assert.equal(typeof t.data.provider_trace[0].latency_ms, 'number');
    assert.ok(!JSON.stringify(t.data.provider_trace).includes(STUB_MODEL), 'trace carries an alias, not the model id');
    // 같은 세션 조회의 요약과 일치
    const got = await ctx.g(`/api/v1/sessions/${s.id}`);
    assert.deepEqual(got.data.provider_trace.at(-1).mode, 'live');
  });
});

test('B1 routing: config.registry decides the provider per operation (ROUTE_* overrides)', async () => {
  await withProviders({ env: { ...LIVE, ROUTE_DIALOGUE_NEXT: 'mock' }, overrides: { syntheticTraffic: true } }, async (ctx) => {
    const st = await ctx.g('/api/v1/providers/status');
    assert.equal(st.data.operations['dialogue.next'].provider, 'mock');
    assert.equal(st.data.operations['claims.extract'].provider, 'gemini');
    const s = await ctx.startSession();
    const t = await ctx.turn(s);
    assert.equal(ctx.calls.length, 0, 'dialogue.next routed to mock: no outbound');
    assert.equal(t.data.provider_trace[0].mode, 'mock');
  });
  // 지원하지 않는 조합(gemini에 STT)은 호출하지 않고 mock
  await withProviders({ env: { ...LIVE, ROUTE_SPEECH_TRANSCRIBE: 'gemini' }, overrides: { syntheticTraffic: true } }, async (ctx) => {
    const st = await ctx.g('/api/v1/providers/status');
    assert.equal(st.data.operations['speech.transcribe'].provider, 'mock');
  });
});

test('B1 /providers/status: auth required, operation map only, no keys or model ids (04 §7-8)', async () => {
  await withProviders({ env: { ...LIVE, GROQ_WHISPER_KEY: 'gsk_fake_groq_key', GROQ_BASE_URL: 'https://stub.groq.test/v1', GROQ_LIVE_ACK: 'true', GEMINI_REAL_DATA_ACK: 'true' } }, async ({ g }) => {
    assert.equal((await g('/api/v1/providers/status', { token: null })).status, 401);
    const r = await g('/api/v1/providers/status');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data.operations).sort(), ['claims.extract', 'dialogue.next', 'evaluation.generate', 'speech.synthesize', 'speech.transcribe']);
    for (const o of Object.values(r.data.operations)) assert.deepEqual(Object.keys(o).filter((k) => !['provider', 'mode', 'blocked_reason'].includes(k)), []);
    assert.equal(r.data.operations['dialogue.next'].blocked_reason, 'consent_missing');
    assert.equal(r.data.operations['evaluation.generate'].provider, 'mock');
    assert.equal(r.data.summary, 'mock');
    const text = JSON.stringify(r.data);
    for (const leak of [FAKE_KEY, 'gsk_fake', STUB_MODEL, 'whisper-large', 'stub.gemini.test', 'stub.groq.test']) assert.ok(!text.includes(leak), `status leaks ${leak}`);
  });
  await withProviders({ env: { ...LIVE, GROQ_WHISPER_KEY: 'gsk_fake_groq_key', GROQ_LIVE_ACK: 'true' }, overrides: { syntheticTraffic: true } }, async ({ g }) => {
    const r = await g('/api/v1/providers/status');
    assert.equal(r.data.operations['dialogue.next'].mode, 'live');
    assert.equal(r.data.operations['speech.transcribe'].provider, 'groq');
    assert.equal(r.data.summary, 'partial_live');
  });
});

test('B1 STT gate: voice needs GROQ_LIVE_ACK and a data class; blocked state is visible in /stt/status', async () => {
  await withProviders({ env: { GROQ_WHISPER_KEY: 'gsk_fake_groq_key' } }, async ({ g }) => {
    const r = await g('/api/v1/stt/status');
    assert.equal(r.data.provider, 'disabled');
    assert.equal(r.data.blocked_reason, 'live_ack_missing');
    assert.ok(!JSON.stringify(r.data).includes('gsk_fake'));
  });
});
