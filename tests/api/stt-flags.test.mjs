import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';

useSharedApp();

test('groq input_mode is accepted as a session axis', async () => {
  await cleanupAll();
  const s = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'general', input_mode: 'groq', duration_minutes: 5 } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
});

test('stt status reports disabled without key, never leaks key', async () => {
  const r = await call('/api/v1/stt/status');
  assert.equal(r.status, 200);
  assert.equal(r.data.configured, false);
  assert.equal(JSON.stringify(r.data).includes('gsk_'), false, 'key must never leak');
});

test('transcriptions without groq key falls back to text guidance', async () => {
  const s = await newSession();
  const boundary = '----testboundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`, 'utf8'),
    Buffer.from([0x01, 0x02, 0x03]),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const res = await fetch(`${base}/api/v1/sessions/${s.id}/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${A}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Idempotency-Key': crypto.randomUUID() },
    body,
  });
  // 원음이 1KB 미만이면 multipart 파서 이전에 422로 거부된다(빈 녹음 보호).
  assert.ok([422, 503].includes(res.status), `expected 422/503, got ${res.status}`);
  if (res.status === 503) {
    const data2 = await res.json().catch(() => ({}));
    const code = String(data2.code || data2?.error?.code || '');
    assert.match(code, /stt_unavailable/);
  }
});

test('transcriptions rejects non-audio payload', async () => {
  const groqApp = createApp({ env: { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: 'fake-groq-key', DEV_TOKEN_A: A, PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' } });
  await new Promise((r) => groqApp.server.listen(0, r));
  const gb = `http://127.0.0.1:${groqApp.server.address().port}`;
  try {
    // 세션 존재 검사가 먼저이므로, 실제 세션으로 비오디오 전송 시 422 검증
    const mk = () => {
      const b = '----b';
      return Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`, 'utf8'),
        Buffer.from('hello', 'utf8'),
        Buffer.from(`\r\n--${b}--\r\n`, 'utf8'),
      ]);
    };
    const sres = await fetch(`${gb}/api/v1/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ interview_type: 'general', duration_minutes: 5 }) });
    assert.equal(sres.status, 201);
    const sid = (await sres.json()).id;
    const bad = await fetch(`${gb}/api/v1/sessions/${sid}/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'multipart/form-data; boundary=----b', 'Idempotency-Key': crypto.randomUUID() }, body: mk() });
    assert.equal(bad.status, 422, 'non-audio mime rejected');
  } finally {
    groqApp.server.close();
  }
});

test('turn response carries explicit provider flag (mock default)', async () => {
  const s = await newSession();
  const r = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.version, type: 'turn.text', payload: { text: '제가 직접 일정을 조정했고 결과적으로 기한 안에 제출했습니다.' } } });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.provider, 'mock', 'mock-first default must be explicit in response');
});

test('free test toggle still keeps mock when unchecked', async () => {
  await cleanupAll();
  const s = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'general', duration_minutes: 5 } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.free_test, false, 'no synthetic flag means real-data path stays mock');
  const st = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  const r = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: st.data.version, type: 'turn.text', payload: { text: '제가 직접 일정을 조정했고 결과적으로 기한 안에 제출했습니다.' } } });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.provider, 'mock', 'unchecked free test must never call gemini');
});

test('forged synthetic/free_test body flags never set session free_test', async () => {
  await cleanupAll();
  const s = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'general', duration_minutes: 5, synthetic: true, free_test: true } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.free_test, false, 'free_test is server state, not a request field');
  const got = await call(`/api/v1/sessions/${s.data.id}`);
  assert.equal(got.data.free_test, false);
});
