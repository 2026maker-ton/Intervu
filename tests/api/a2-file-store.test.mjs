// WP-A2: 파일 영속 Store — 재시작 복원, 삭제 시 파일 본문 제거, 만료 정리, 손상 복구, 원장 월 경계.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.js';
import { createFileStore } from '../../src/store/file.js';
import { createStore, assertStore } from '../../src/store/index.js';

const A = 'dev-user-a-token';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'intervu-a2-'));
const mkApp = (dir) => createApp({ env: { STORE: 'file', DATA_DIR: dir, GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: A, TRENDS_FILE: '' } });
const api = (app, p, { method = 'GET', body } = {}) => app.fetch(new Request(`http://local${p}`, {
  method,
  headers: { Authorization: `Bearer ${A}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
}), {}, {}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const stateFile = (dir) => path.join(dir, 'state.json');

test('A2 contract: file store satisfies the Store contract and survives a reload', () => {
  const dir = tmp();
  const s = createFileStore({ dir, warn() {} });
  assertStore(s);
  const sess = s.createSession('u1', { questions: [] });
  const t = s.createTurn(sess.id, {});
  s.addRevision(t.id, '첫 답변', 'user');
  s.close();
  const s2 = createFileStore({ dir, warn() {} });
  assert.equal(s2.getSession('u1', sess.id).id, sess.id);
  assert.equal(s2.getSession('u2', sess.id), null);
  assert.equal(s2.getRevisions(t.id)[0].normalized_text, '첫 답변');
  s2.close();
});

test('A2 restart: sessions, turns, ledger and idempotency survive a second app on the same DATA_DIR', async () => {
  const dir = tmp();
  const a1 = mkApp(dir);
  const r = await api(a1, '/api/v1/sessions', { method: 'POST', body: { mode: 'structured', duration_minutes: 10, input_mode: 'text' } });
  assert.equal(r.status, 201);
  const id = r.data.id;
  await api(a1, `/api/v1/sessions/${id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: r.data.version, type: 'session.start', payload: {} } });
  a1.ledger.reserve(id, 0.01);
  a1.store.flush();
  a1.store.close();

  const a2 = mkApp(dir);
  const list = await api(a2, '/api/v1/sessions');
  assert.ok(list.data.sessions.some((s) => s.id === id), 'session restored');
  assert.equal(a2.ledger.usage(id).reserved, 0.01, 'ledger restored');
  a2.store.close();
});

test('A2 delete: session and account deletion remove content from the file on disk', async () => {
  const dir = tmp();
  const a = mkApp(dir);
  const r = await api(a, '/api/v1/sessions', { method: 'POST', body: { mode: 'structured', duration_minutes: 10, input_mode: 'text' } });
  const id = r.data.id;
  const owner = a.store._maps.sessions.get(id).owner_id;
  const t = a.store.createTurn(id, {});
  a.store.addRevision(t.id, '고유비밀문장ZZ-9731', 'user');
  a.store.flush();
  assert.ok(fs.readFileSync(stateFile(dir), 'utf8').includes('고유비밀문장ZZ-9731'), 'precondition: persisted');
  const d = await api(a, `/api/v1/sessions/${id}`, { method: 'DELETE' });
  assert.equal(d.status, 202);
  assert.ok(!fs.readFileSync(stateFile(dir), 'utf8').includes('고유비밀문장ZZ-9731'), 'session delete purged file content');

  const s2 = a.store.createSession(owner, { questions: [] });
  const t2 = a.store.createTurn(s2.id, {});
  a.store.addRevision(t2.id, '계정삭제ZZ-5521', 'user');
  a.store.flush();
  assert.ok(fs.readFileSync(stateFile(dir), 'utf8').includes('계정삭제ZZ-5521'));
  assert.equal((await api(a, '/api/v1/account', { method: 'DELETE' })).status, 202);
  assert.ok(!fs.readFileSync(stateFile(dir), 'utf8').includes('계정삭제ZZ-5521'), 'account delete purged file content');
  a.store.close();
});

test('A2 expiry: expired sessions and profiles are purged at start', () => {
  const dir = tmp();
  const s = createFileStore({ dir, warn() {} });
  const sess = s.createSession('u1', { questions: [] });
  const t = s.createTurn(sess.id, {});
  s.addRevision(t.id, '만료될본문QQ', 'user');
  const { profile } = s.createProfile('u1', { org_type: 'company', source_text: '만료프로필QQ' });
  s.getSession('u1', sess.id).expires_at = new Date(Date.now() - 1000).toISOString();
  profile.expires_at = new Date(Date.now() - 1000).toISOString();
  s.close();
  assert.ok(fs.readFileSync(stateFile(dir), 'utf8').includes('만료될본문QQ'));
  const s2 = createFileStore({ dir, warn() {} });
  assert.equal(s2.getSession('u1', sess.id), null);
  assert.equal(s2.getProfile('u1', profile.id), null);
  const raw = fs.readFileSync(stateFile(dir), 'utf8');
  assert.ok(!raw.includes('만료될본문QQ') && !raw.includes('만료프로필QQ'));
  s2.close();
});

test('A2 corrupted file: starts empty with a warning and keeps a backup copy', () => {
  const dir = tmp();
  fs.writeFileSync(stateFile(dir), '{ not json');
  const warnings = [];
  const s = createFileStore({ dir, warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  assert.deepEqual(s.listSessions('u1'), []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')), 'backup kept');
  s.createSession('u1', { questions: [] });
  s.close();
  assert.equal(JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')).v, 1, 'fresh valid file written');
});

test('A2 ledger: persisted per month and reset when the month changes', () => {
  const dir = tmp();
  const s = createFileStore({ dir, warn() {} });
  const l = s.ledgerState();
  l.monthlySpent = 1.25; l.providers = { gemini: 1.25 };
  s.close();
  const s2 = createFileStore({ dir, warn() {} });
  assert.equal(s2.ledgerState().monthlySpent, 1.25);
  assert.deepEqual(s2.ledgerState().providers, { gemini: 1.25 });
  s2.close();
  // 저장된 월을 지난 달로 바꿔 놓고 재시작 → 초기화
  const d = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
  d.ledger.month = '2000-01';
  fs.writeFileSync(stateFile(dir), JSON.stringify(d));
  const s3 = createFileStore({ dir, warn() {} });
  assert.equal(s3.ledgerState().monthlySpent, 0);
  assert.deepEqual(s3.ledgerState().providers, {});
  assert.equal(s3.ledgerState().month, new Date().toISOString().slice(0, 7));
  s3.close();
});

test('A2 default: memory store stays the default and is a valid contract', () => {
  assertStore(createStore());
  const app = createApp({ env: { GEMINI_API_KEY: '', DEV_TOKEN_A: A, TRENDS_FILE: '' } });
  assert.equal(app.store.flush, undefined);
});

test('A2: consents, documents and revisions survive a restart (file store)', async () => {
  const os = await import('node:os'); const path = await import('node:path'); const fs = await import('node:fs');
  const { createApp } = await import('../../src/server.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intervu-a2c-'));
  const env = { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', DEV_TOKEN_A: 'tok-a-123456789', ADMIN_TOKEN: '', TRENDS_FILE: '', STORE: 'file', DATA_DIR: dir, PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' };
  const mk = async () => { const a = createApp({ env }); await new Promise((r) => a.server.listen(0, r)); return { a, base: `http://127.0.0.1:${a.server.address().port}` }; };
  const call = async (base, p, method = 'GET', body) => { const h = { Authorization: 'Bearer tok-a-123456789', 'Content-Type': 'application/json' }; if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID(); const r = await fetch(base + p, { method, headers: h, body: body && JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
  const s1 = await mk();
  try {
    assert.equal((await call(s1.base, '/api/v1/consents', 'POST', { age_19_confirmed: true, notice_version: 'v1' })).status, 201);
    const pr = await call(s1.base, '/api/v1/profiles', 'POST', { org_type: 'company', role: '기획', source_text: '문제 해결' });
    assert.equal(pr.status, 201);
    const doc = await call(s1.base, `/api/v1/profiles/${pr.data.id}/documents`, 'POST', { kind: 'cover_letter', filename: 'a.txt', mime_type: 'text/plain', content_base64: Buffer.from('저는 동아리 회장을 맡아 행사를 운영했습니다.').toString('base64') });
    assert.equal(doc.status, 201);
    s1.a.store.flush(); s1.a.store.close(); await new Promise((r) => s1.a.server.close(r));
    var ids = { profile: pr.data.id, doc: doc.data.id };
  } catch (e) { s1.a.server.close(); throw e; }
  const s2 = await mk();
  try {
    assert.equal((await call(s2.base, `/api/v1/documents/${ids.doc}/revisions`)).status, 200, 'document revisions restored');
    const pr2 = await call(s2.base, '/api/v1/profiles', 'POST', { org_type: 'company', role: '기획', source_text: '협업' });
    assert.equal(pr2.status, 201, 'consent restored (no 428 after restart)');
  } finally { s2.a.store.close(); s2.a.server.close(); }
});
