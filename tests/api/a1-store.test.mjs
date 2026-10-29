// WP-A1: Store 계약(memory 구현)과 구 전역 상태의 Store 이동.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, assertStore, STORE_METHODS } from '../../src/store/index.js';
import { createLedger } from '../../src/domain/ledger.js';
import { createApp } from '../../src/server.js';

test('A1 store: memory store satisfies the Store contract', () => {
  const store = createStore();
  assert.equal(assertStore(store), store);
  assert.ok(STORE_METHODS.length >= 25);
  assert.throws(() => assertStore({ getSession() {} }), /Store 계약 위반/);
});

test('A1 store: sessions are owner-scoped and turns/revisions are append-only', () => {
  const s = createStore();
  const sess = s.createSession('u1', { questions: [] });
  assert.equal(s.getSession('u1', sess.id).id, sess.id);
  assert.equal(s.getSession('u2', sess.id), null);
  const t = s.createTurn(sess.id, { speaker_id: 'user' });
  s.addRevision(t.id, '첫 답', 'user');
  s.addRevision(t.id, '교정 답', 'stt_correction');
  assert.deepEqual(s.getRevisions(t.id).map((r) => r.revision), [1, 2]);
});

test('A1 store: tickets are single-use and expire', () => {
  const s = createStore();
  s.putTicket('t1', { session_id: 'x', owner: 'u1', expires_at: Date.now() + 30_000 });
  assert.equal(s.takeTicket('t1').session_id, 'x');
  assert.equal(s.takeTicket('t1'), null, 'second use must fail');
  s.putTicket('t2', { session_id: 'x', owner: 'u1', expires_at: Date.now() - 1 });
  assert.equal(s.takeTicket('t2'), null, 'expired ticket must fail');
});

test('A1 store: exports, transfer jobs and idempotency records are purged per session / per owner', () => {
  const s = createStore();
  s.putExport('e1', { owner_id: 'u1', session_id: 'sA', expires_at: Date.now() + 1000, payload: {} });
  s.putExport('e2', { owner_id: 'u1', session_id: 'sB', expires_at: Date.now() + 1000, payload: {} });
  s.putExport('e3', { owner_id: 'u2', session_id: 'sA', expires_at: Date.now() + 1000, payload: {} });
  s.putTransferJob('j1', { owner_id: 'u1', baseline_session_id: 'sA', retry_session_id: 'sC' });
  s.putTransferJob('j2', { owner_id: 'u1', baseline_session_id: 'sB', retry_session_id: 'sD' });
  s.putIdem('u1', 'k', { fp: 'h', status: 201, text: '{}', expires_at: Date.now() + 1000 });
  s.putIdem('u2', 'k', { fp: 'h', status: 201, text: '{}', expires_at: Date.now() + 1000 });
  s.purgeOwned('u1', 'sA');
  assert.equal(s.getExport('e1'), null);
  assert.ok(s.getExport('e2'), 'other session of same owner kept');
  assert.ok(s.getExport('e3'), 'other owner untouched');
  assert.equal(s.getTransferJob('j1'), null);
  assert.ok(s.getTransferJob('j2'));
  assert.equal(s.getIdem('u1', 'k'), null, 'owner idempotency copies are purged');
  assert.ok(s.getIdem('u2', 'k'));
  s.purgeOwned('u1');
  assert.equal(s.getExport('e2'), null);
  assert.equal(s.getTransferJob('j2'), null);
});

test('A1 store: idempotency records expire after their TTL', () => {
  const s = createStore();
  s.putIdem('u1', 'old', { fp: 'h', status: 201, text: '{}', expires_at: Date.now() - 1 });
  assert.equal(s.getIdem('u1', 'old'), null);
});

test('A1 store: ledger state lives in the Store and the app ledger shares it', () => {
  const s = createStore();
  const ledger = createLedger({ sessionHardCap: 1, monthlyApiBudget: 10, state: s.ledgerState() });
  ledger.reserve('session:x', 0.1);
  assert.equal(s.ledgerState().monthlyReserved, 0.1);
  const app = createApp({ env: { GEMINI_API_KEY: '', GROQ_API_KEY: '', GROQ_WHISPER_KEY: '', TRENDS_FILE: '' } });
  assert.equal(app.ledger.state, app.store.ledgerState());
});
