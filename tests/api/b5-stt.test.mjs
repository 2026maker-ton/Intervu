// WP-B5 계약 시험: Groq Whisper 전사 경로. 스텁 fetch·가짜 키만 사용(실호출 없음). 실측은 tools/stt-smoke.mjs(수동, 미실행).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProviders, hang } from '../helpers/provider-stub.mjs';

const GKEY = 'gsk_fake_b5_secret_KEY_999';
const GROQ_BASE = 'https://stub.groq.test/v1';
const ENV = { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: GKEY, GROQ_BASE_URL: GROQ_BASE, GROQ_LIVE_ACK: 'true', GROQ_TIMEOUT_MS: '80' };
const syn = { syntheticTraffic: true };
const MARK = 'ZZ-B5-AUDIO-MARKER-ZZ';
const audio = (n = 4096) => Buffer.from(MARK.repeat(Math.ceil(n / MARK.length))).subarray(0, n);
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

function multipart(bytes, { type = 'audio/webm', filename = 'a.webm', field = 'file' } = {}) {
  const b = '----b5boundary';
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return { body, ctype: `multipart/form-data; boundary=${b}` };
}
const post = async (ctx, sid, mp) => {
  const res = await fetch(`${ctx.base}/api/v1/sessions/${sid}/transcriptions`, { method: 'POST', headers: { Authorization: 'Bearer dev-user-a-token', 'Content-Type': mp.ctype, 'Idempotency-Key': crypto.randomUUID() }, body: mp.body });
  const text = await res.text();
  return { status: res.status, text, data: JSON.parse(text || '{}') };
};
// 원음이 Store·원장 어디에도 남지 않는다(원문·base64·hex 모두 검색).
const assertNoAudio = (ctx) => {
  const dump = JSON.stringify(ctx.app.store._maps, (k, v) => (v instanceof Map ? [...v] : v)) + JSON.stringify(ctx.app.ledger.state);
  for (const needle of [MARK, Buffer.from(MARK).toString('base64').slice(0, 20), Buffer.from(MARK).toString('hex').slice(0, 20)]) assert.ok(!dump.includes(needle), `audio leaked into store: ${needle}`);
};
const noKey = (r) => { for (const x of [GKEY, 'upstream said', 'stub.groq.test']) assert.ok(!r.text.includes(x), `response leaks ${x}`); };
const run = (o, fn) => withProviders({ env: { ...ENV, ...(o.env || {}) }, overrides: o.overrides ?? syn, respond: o.respond || (() => ok({ text: '안녕하세요' })) }, async (ctx) => { const s = await ctx.startSession(); await fn(ctx, s); });

test('B5 happy path: multipart parsed, allowed mime forwarded, request shape, pii_warnings, no audio persisted, key hidden', async () => {
  let seen;
  await run({ respond: (c, n, opts) => { seen = { url: c.url, auth: c.headers.Authorization, form: opts.body }; return ok({ text: '제 연락처는 010-1234-5678 입니다.', language: 'ko', duration: 3.2 }); } }, async (ctx, s) => {
    const r = await post(ctx, s.id, multipart(audio(), { type: 'audio/webm;codecs=opus' }));
    assert.equal(r.status, 200, r.text);
    assert.equal(ctx.calls.length, 1);
    assert.equal(seen.url, `${GROQ_BASE}/audio/transcriptions`);
    assert.equal(seen.auth, `Bearer ${GKEY}`);
    assert.ok(seen.form instanceof FormData);
    assert.equal(seen.form.get('model'), 'whisper-large-v3-turbo');
    assert.equal(seen.form.get('language'), 'ko');
    const f = seen.form.get('file');
    assert.equal(f.size, 4096, 'audio bytes forwarded intact');
    assert.equal(f.type, 'audio/webm');
    assert.equal(r.data.text, '제 연락처는 010-1234-5678 입니다.');
    assert.deepEqual(r.data.pii_warnings, ['phone']);
    assert.match(r.data.note, /개인정보/);
    assert.equal(r.data.provider_trace[0].provider, 'groq');
    assert.equal(r.data.provider_trace[0].mode, 'live');
    noKey(r);
    assertNoAudio(ctx);
  });
});

test('B5 no PII in transcript -> empty pii_warnings', async () => {
  await run({}, async (ctx, s) => {
    const r = await post(ctx, s.id, multipart(audio()));
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.pii_warnings, []);
  });
});

test('B5 rejected inputs make zero outbound calls: non-audio mime, missing file part, too short, over size cap', async () => {
  await run({ env: { GROQ_MAX_AUDIO_BYTES: '2048' } }, async (ctx, s) => {
    assert.equal((await post(ctx, s.id, multipart(audio(), { type: 'text/plain', filename: 'a.txt' }))).status, 422, 'mime');
    assert.equal((await post(ctx, s.id, { body: Buffer.from('--b\r\nContent-Disposition: form-data; name="x"\r\n\r\nhi\r\n--b--\r\n'), ctype: 'multipart/form-data; boundary=b' })).status, 422, 'no file part');
    assert.equal((await post(ctx, s.id, multipart(audio(200)))).status, 422, 'too short');
    const big = await post(ctx, s.id, multipart(audio(200000)));
    assert.equal(big.status, 413, 'size cap');
    assert.equal(ctx.calls.length, 0);
    assertNoAudio(ctx);
  });
});

test('B5 429 -> quota_exceeded with text-input guidance, no retry, key hidden', async () => {
  await run({ respond: () => new Response(JSON.stringify({ error: { message: `upstream said ${GKEY}` } }), { status: 429, headers: { 'retry-after': '0.01' } }) }, async (ctx, s) => {
    const r = await post(ctx, s.id, multipart(audio()));
    assert.equal(r.status, 429);
    assert.equal(r.data.code, 'quota_exceeded');
    assert.match(r.data.message, /텍스트/);
    assert.equal(ctx.calls.length, 1, 'free-quota 429 is not retried');
    noKey(r);
    assertNoAudio(ctx);
  });
});

test('B5 timeout and 5xx -> stt_failed with text guidance, key hidden', async () => {
  for (const [name, respond] of [['timeout', (c, n, o) => hang(o)], ['500', () => new Response(JSON.stringify({ error: { message: `upstream said ${GKEY}` } }), { status: 500 })]]) {
    await run({ respond }, async (ctx, s) => {
      const r = await post(ctx, s.id, multipart(audio()));
      assert.equal(r.status, 502, `${name}: ${r.text}`);
      assert.equal(r.data.code, 'stt_failed');
      assert.match(r.data.message, /텍스트/);
      noKey(r);
      assertNoAudio(ctx);
      // 실패 뒤에도 같은 세션에서 텍스트 답변을 계속 낼 수 있다
      const t = await ctx.turn(s, '제가 직접 일정을 조정했고 결과적으로 기한 안에 제출했습니다.');
      assert.equal(t.status, 202, name);
    });
  }
});

test('B5 empty transcription -> 200 empty:true with re-record guidance, no pii fields', async () => {
  await run({ respond: () => ok({ text: '   ' }) }, async (ctx, s) => {
    const r = await post(ctx, s.id, multipart(audio()));
    assert.equal(r.status, 200);
    assert.equal(r.data.text, '');
    assert.equal(r.data.empty, true);
    assert.match(r.data.note, /다시 녹음|텍스트/);
    assert.equal(r.data.pii_warnings, undefined);
  });
});

test('B5 gate closed (no key / no LIVE_ACK / real data without ack) -> 503 or blocked, zero outbound calls', async () => {
  for (const [name, env, overrides] of [['no key', { GROQ_WHISPER_KEY: '' }, syn], ['no live ack', { GROQ_LIVE_ACK: '' }, syn], ['real data, no real-data ack', {}, {}]]) {
    await run({ env, overrides }, async (ctx, s) => {
      const r = await post(ctx, s.id, multipart(audio()));
      assert.ok([503, 502].includes(r.status), `${name}: ${r.status} ${r.text}`);
      assert.match(r.data.message || '', /텍스트/);
      assert.equal(ctx.calls.length, 0, `${name}: no external call`);
      noKey(r);
    });
  }
});

test('B5 stt status never exposes the key or base URL', async () => {
  await run({}, async (ctx) => {
    const r = await ctx.g('/api/v1/stt/status');
    assert.equal(r.status, 200);
    const t = JSON.stringify(r.data);
    assert.ok(!t.includes(GKEY) && !t.includes('stub.groq.test'));
  });
});
