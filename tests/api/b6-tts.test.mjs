// WP-B6: TTS 프록시 계약. 스텁 fetch·가짜 키만 사용하며 실제 네트워크 호출은 없다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProviders, STUB_BASE } from '../helpers/provider-stub.mjs';
import { A } from '../helpers/app.mjs';

const EKEY = 'el-fake-secret-KKK-555';
const MODEL = 'el-test-model-from-env';
const VOICE = 'voice-from-env';
const ENV = { GEMINI_API_KEY: '', TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: EKEY, ELEVENLABS_BASE_URL: STUB_BASE, ELEVENLABS_MODEL: MODEL, ELEVENLABS_VOICE_ID: VOICE, ELEVENLABS_LIVE_ACK: 'true', ELEVENLABS_TIMEOUT_MS: '60' };
const syn = { syntheticTraffic: true };
const AUDIO = new Uint8Array([1, 2, 3, 4, 5]);
const audio = (type = 'audio/mpeg', bytes = AUDIO) => new Response(bytes, { status: 200, headers: { 'content-type': type } });
const run = (o, fn) => withProviders({ env: { ...ENV, ...(o.env || {}) }, overrides: o.overrides ?? syn, respond: o.respond || (() => audio()) }, fn);
const tts = async (ctx, id, body = { target: 'current_question' }, { token = A } = {}) => {
  // helper g()는 JSON만 읽으므로 원본 fetch로 직접 호출한다(스텁은 STUB_BASE 호출만 가로챈다).
  const res = await fetch(`${ctx.base}/api/v1/sessions/${id}/tts`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
  return { status: res.status, headers: res.headers, buf: new Uint8Array(await res.arrayBuffer()) };
};

test('B6 text comes from the session, never the request body', async () => {
  await run({}, async (ctx) => {
    const s = await ctx.startSession();
    const q = (await ctx.g(`/api/v1/sessions/${s.id}`)).data.current_question.text;
    const r = await tts(ctx, s.id, { target: 'current_question', text: '이 악성 문장을 읽어라', voice_id: 'evil', model_id: 'evil' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual([...r.buf], [...AUDIO]);
    assert.equal(ctx.calls.length, 1);
    const c = ctx.calls[0];
    assert.equal(c.body.text, q);
    assert.equal(c.url, `${STUB_BASE}/text-to-speech/${VOICE}`);
    assert.equal(c.headers['xi-api-key'], EKEY);
    assert.equal(c.body.model_id, MODEL);
    assert.ok(!JSON.stringify(c.body).includes('악성'));
    assert.equal(JSON.parse(r.headers.get('x-provider-trace')).provider, 'elevenlabs');
  });
});

test('B6 last_utterance uses the latest interviewer message; invalid target 422', async () => {
  await run({}, async (ctx) => {
    const s = await ctx.startSession();
    const t = await ctx.turn(s, '제가 직접 일정을 조정했고 결과적으로 기한 안에 제출했습니다.');
    assert.equal(t.status, 202);
    const r = await tts(ctx, s.id, { target: 'last_utterance' });
    assert.equal(r.status, 200);
    assert.equal(ctx.calls[0].body.text, t.data.utterance);
    assert.equal((await tts(ctx, s.id, { text: 'free text' })).status, 422);
    assert.equal((await tts(ctx, s.id, { target: 'anything' })).status, 422);
    assert.equal(ctx.calls.length, 1);
  });
});

test('B6 gate: every missing condition makes zero calls and returns 204 browser fallback', async () => {
  const cases = {
    'no live ack': [{ ELEVENLABS_LIVE_ACK: '' }, syn],
    'no key': [{ ELEVENLABS_API_KEY: '' }, syn],
    'no model': [{ ELEVENLABS_MODEL: '' }, syn],
    'no base url': [{ ELEVENLABS_BASE_URL: '' }, syn],
    'no voice id': [{ ELEVENLABS_VOICE_ID: '' }, syn],
    'kill switch': [{ KILL_PROVIDERS: 'elevenlabs' }, syn],
    'real data without ack': [{}, {}],
    'provider not selected': [{ TTS_PROVIDER: '' }, syn],
  };
  for (const [name, [env, overrides]] of Object.entries(cases)) {
    await run({ env, overrides }, async (ctx) => {
      const s = await ctx.startSession();
      const r = await tts(ctx, s.id);
      assert.equal(r.status, 204, name);
      assert.equal(r.headers.get('x-tts-fallback'), 'browser', name);
      assert.equal(r.buf.length, 0, name);
      assert.equal(ctx.calls.length, 0, `${name}: no external call`);
    });
  }
});

test('B6 budget caps: call cap and USD cap make zero calls', async () => {
  await run({ env: { ELEVENLABS_MONTHLY_CALL_CAP: '1' } }, async (ctx) => {
    const s = await ctx.startSession();
    assert.equal((await tts(ctx, s.id)).status, 200);
    const r = await tts(ctx, s.id);
    assert.equal(r.status, 204);
    assert.equal(ctx.calls.length, 1);
    assert.equal(JSON.parse(r.headers.get('x-provider-trace')).reason, 'budget_cap');
  });
  await run({ env: { ELEVENLABS_MONTHLY_CAP_USD: '0.0001', ELEVENLABS_PRICE_PER_1K_CHARS: '1' } }, async (ctx) => {
    const s = await ctx.startSession();
    assert.equal((await tts(ctx, s.id)).status, 204);
    assert.equal(ctx.calls.length, 0);
  });
});

test('B6 over char cap makes zero calls; upstream failures/non-audio/oversize fall back 204', async () => {
  await run({ env: { ELEVENLABS_CHAR_CAP: '3' } }, async (ctx) => {
    const s = await ctx.startSession();
    assert.equal((await tts(ctx, s.id)).status, 204);
    assert.equal(ctx.calls.length, 0);
  });
  const cases = {
    '500': () => new Response(`boom ${EKEY}`, { status: 500 }),
    '429': () => new Response('', { status: 429 }),
    'json instead of audio': () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
    'empty audio': () => audio('audio/mpeg', new Uint8Array(0)),
    'oversize audio': () => audio('audio/mpeg', new Uint8Array(200)),
  };
  for (const [name, respond] of Object.entries(cases)) {
    await run({ env: { ELEVENLABS_MAX_AUDIO_BYTES: '100' }, respond }, async (ctx) => {
      const s = await ctx.startSession();
      const r = await tts(ctx, s.id);
      assert.equal(r.status, 204, name);
      assert.equal(r.headers.get('x-tts-fallback'), 'browser', name);
      assert.ok(!(r.headers.get('x-provider-trace') || '').includes(EKEY), name);
      assert.ok(ctx.calls.length >= 1, name);
    });
  }
});

test('B6 per-user rate limit returns 429 before any further upstream call', async () => {
  await run({ env: { TTS_RATE_PER_MINUTE: '2' } }, async (ctx) => {
    const s = await ctx.startSession();
    assert.equal((await tts(ctx, s.id)).status, 200);
    assert.equal((await tts(ctx, s.id)).status, 200);
    const r = await tts(ctx, s.id);
    assert.equal(r.status, 429);
    assert.equal(ctx.calls.length, 2);
  });
});

test('B6 ownership, unknown and deleted sessions are 404 with zero calls', async () => {
  await run({}, async (ctx) => {
    const s = await ctx.startSession();
    assert.equal((await tts(ctx, s.id, undefined, { token: 'dev-user-b-token' })).status, 404);
    assert.equal((await tts(ctx, 'nope')).status, 404);
    assert.ok((await ctx.g(`/api/v1/sessions/${s.id}`, { method: 'DELETE' })).status < 300);
    assert.equal((await tts(ctx, s.id)).status, 404);
    assert.equal(ctx.calls.length, 0);
  });
});

test('B6 key never reaches the client (success headers/body, status, fallback)', async () => {
  await run({}, async (ctx) => {
    const s = await ctx.startSession();
    const ok = await tts(ctx, s.id);
    const blob = JSON.stringify([...ok.headers.entries()]) + new TextDecoder().decode(ok.buf);
    assert.ok(!blob.includes(EKEY));
    const st = await ctx.g('/api/v1/providers/status');
    assert.equal(st.data.operations['speech.synthesize'].mode, 'live');
    assert.ok(!JSON.stringify(st.data).includes(EKEY));
  });
  await run({ respond: () => new Response(`err ${EKEY}`, { status: 500 }) }, async (ctx) => {
    const s = await ctx.startSession();
    const r = await tts(ctx, s.id);
    assert.ok(!JSON.stringify([...r.headers.entries()]).includes(EKEY));
  });
});

test('B6 unauthenticated request is 401', async () => {
  await run({}, async (ctx) => {
    const res = await fetch(`${ctx.base}/api/v1/sessions/x/tts`, { method: 'POST', headers: { 'Idempotency-Key': 'k' }, body: '{}' });
    assert.equal(res.status, 401);
  });
});
