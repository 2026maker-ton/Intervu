// WP-A1: 같은 세션의 동시 명령은 도착 순서대로 직렬 실행된다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, app, A, newSession, call } from '../helpers/app.mjs';
import { createKeyedMutex } from '../../src/app/mutex.js';

useSharedApp();

test('A1: keyed mutex runs same-key tasks one at a time in order, different keys in parallel', async () => {
  const m = createKeyedMutex();
  const log = [];
  const task = (name, ms) => async () => { log.push(`${name}:start`); await new Promise((r) => setTimeout(r, ms)); log.push(`${name}:end`); return name; };
  const out = await Promise.all([m.run('s1', task('a', 30)), m.run('s1', task('b', 1)), m.run('s2', task('c', 1))]);
  assert.deepEqual(out, ['a', 'b', 'c']);
  assert.ok(log.indexOf('a:end') < log.indexOf('b:start'), 'same key must not interleave');
  assert.ok(log.indexOf('c:start') < log.indexOf('a:end'), 'other keys are not blocked');
});

test('A1: concurrent turn commands on one session do not interleave (followup then next question)', async () => {
  const s = await newSession(A);
  const send = (text) => app.fetch(new Request(`http://local/api/v1/sessions/${s.id}/commands`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ command_id: crypto.randomUUID(), type: 'turn.text', payload: { text } }),
  }), {}, {});
  // 직렬화가 없으면 두 명령이 같은 질문 상태를 읽어 둘 다 꼬리질문이 된다.
  const [r1, r2] = await Promise.all([
    send('첫 번째 답변입니다. 제가 맡은 역할은 일정 조율이었습니다.'),
    send('두 번째 답변입니다. 결과적으로 마감을 이틀 앞당겼습니다.'),
  ]);
  assert.equal(r1.status, 202);
  assert.equal(r2.status, 202);
  const [b1, b2] = [await r1.json(), await r2.json()];
  assert.equal(b1.action, 'ask_followup');
  assert.equal(b2.action, 'next_question');
  assert.ok(b2.version > b1.version, 'versions advance monotonically');
  const got = await call(`/api/v1/sessions/${s.id}`);
  assert.equal(got.data.q_index, 1);
  assert.equal(got.data.followups_used, 0);
});
