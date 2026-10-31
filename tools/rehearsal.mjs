// WP-E3: 데모 12단계 API 리허설 (Mock, 외부 호출 없음, 의존성 없음). `npm run rehearsal`.
// 임시 DATA_DIR(STORE=file)의 프로세스 내 앱에 서버 fixture만 사용한다. 브라우저 클릭 리허설이 아니다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { FIXTURES } from '../src/domain/fixtures.js';

const TOKEN = 'rehearsal-user-token';
const ADMIN = 'rehearsal-admin-token';
const STUB = 'https://stub.rehearsal.test/v9';
const realFetch = globalThis.fetch;
const BASE_ENV = { GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: TOKEN, DEV_TOKEN_B: '', ADMIN_TOKEN: ADMIN, TRENDS_FILE: '', DEMO_FIXTURES: 'on', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' };
const ALLOWED = ['observed_change', 'no_clear_change', 'insufficient_evidence'];

async function open(env, overrides = {}) {
  const app = createApp({ env: { ...BASE_ENV, ...env }, ...overrides });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (p, { method = 'GET', body, admin } = {}) => {
    const h = { Authorization: `Bearer ${TOKEN}` };
    if (admin) h['x-admin-token'] = ADMIN;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
    const res = await realFetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { app, call, close: async () => { app.store.close?.(); await new Promise((r) => app.server.close(r)); } }; // 정상 종료: 파일 저장소를 즉시 기록
}

const cmd = (c, id, version, type, payload = {}) => c(`/api/v1/sessions/${id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type, payload } });

// 세션 시작 → fixture 답변 제출(완료될 때까지, 최대 8회) → 종료. 마지막 version 반환.
async function runSession(c, fx, sessionId, version, { startFirst = true } = {}) {
  let v = version;
  if (startFirst) { const st = await cmd(c, sessionId, v, 'session.start'); assert.equal(st.status, 202, JSON.stringify(st.data)); v = st.data.version; }
  for (let i = 0; i < 8; i++) {
    const r = await cmd(c, sessionId, v, 'turn.text', { text: fx.answers[i % fx.answers.length] });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    v = r.data.version;
    if (r.data.state === 'completed') break;
    if (i >= 1 && r.data.state !== 'in_progress' && r.data.state !== 'active') { /* 상태 이름과 무관하게 종료 명령으로 마무리 */ }
    if (i >= 3) break;
  }
  const fin = await cmd(c, sessionId, v, 'session.finish');
  assert.ok([202, 409].includes(fin.status), JSON.stringify(fin.data));
  return fin.data.version ?? v;
}

// 한 경로(fixture) 12단계. rows에 {scenario, step, ok, detail}를 쌓는다. 실패하면 그 경로는 중단한다.
async function scenario(fx, rows, dir) {
  const tag = fx.kind;
  let o = await open({ STORE: 'file', DATA_DIR: dir });
  const S = {};
  const step = async (n, name, fn) => {
    try { const detail = await fn(o.call); rows.push({ scenario: tag, step: `${n} ${name}`, ok: true, detail: detail || '' }); return true; }
    catch (e) { rows.push({ scenario: tag, step: `${n} ${name}`, ok: false, detail: String(e?.message || e).slice(0, 240) }); return false; }
  };
  const steps = [
    [1, '프로필(fixture)', async (c) => {
      const r = await c('/api/v1/profiles', { method: 'POST', body: { org_type: fx.kind, target_name: fx.title, role: '지원자', source_text: fx.posting_text, application_text: fx.application_text, fixture_id: fx.id } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.synthetic, true);
      S.p = r.data; return `synthetic=true claims=${r.data.applicant_claims_count}`;
    }],
    [3, '주장 추출', async (c) => {
      const r = await c(`/api/v1/profiles/${S.p.id}/claims`);
      assert.equal(r.status, 200);
      assert.ok(r.data.claims.length >= 1);
      const bad = r.data.claims.filter((x) => !fx.application_text.includes(x.quote || x.text || ''));
      assert.equal(bad.length, 0, '원문에 없는 주장 문장');
      return `claims=${r.data.claims.length}`;
    }],
    [5, '승인', async (c) => {
      const r = await c(`/api/v1/profiles/${S.p.id}/approve`, { method: 'POST', body: { version_id: S.p.version_id } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const pl = await c(`/api/v1/profiles/${S.p.id}/plan`);
      assert.equal(pl.status, 200); assert.equal(pl.data.frozen, true);
      return `plan questions=${pl.data.questions.length}`;
    }],
    [6, '세션 생성', async (c) => {
      const r = await c('/api/v1/sessions', { method: 'POST', body: { profile_version_id: S.p.version_id, duration_minutes: 15, input_mode: 'text' } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      S.s = r.data; return `session ok`;
    }],
    [7, '답변·종료', async (c) => {
      S.v = await runSession(c, fx, S.s.id, S.s.version);
      return 'fixture 답변 제출 후 종료';
    }],
    [9, '보고서', async (c) => {
      const r = await c(`/api/v1/sessions/${S.s.id}/report`);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const rep = r.data;
      assert.equal(rep.evaluator.kind, 'rule_based');
      assert.ok(Array.isArray(rep.claim_links) && rep.claim_links.length >= 1, 'claim_links 없음');
      assert.ok(rep.claim_links.every((l) => l.quote), 'claim_links quote 없음');
      assert.ok(rep.next_actions?.length >= 1, 'next_actions 없음');
      S.rep = rep; return `evaluator=${rep.evaluator.kind} claim_links=${rep.claim_links.length}`;
    }],
  ];
  for (const [n, name, fn] of steps) if (!(await step(n, name, fn))) { await o.close(); return; }

  // 재시작: 같은 DATA_DIR로 새 앱. 세션·보고서가 남아 있어야 한다.
  await o.close();
  o = await open({ STORE: 'file', DATA_DIR: dir });
  const rest = [
    ['9r', '재시작 후 복원', async (c) => {
      const r = await c(`/api/v1/sessions/${S.s.id}/report`);
      assert.equal(r.status, 200, `재시작 후 보고서 status=${r.status}`);
      assert.equal(r.data.evaluation_id, S.rep.evaluation_id);
      assert.equal(r.data.claim_links.length, S.rep.claim_links.length);
      return '같은 evaluation_id 복원';
    }],
    [10, '새 질문 재연습', async (c) => {
      const comp = S.rep.next_actions[0].dimension_id || S.rep.dimensions.find((d) => d.status === 'scored')?.id;
      const p = await c('/api/v1/practice-attempts', { method: 'POST', body: { evaluation_id: S.rep.evaluation_id, competency_id: comp } });
      assert.equal(p.status, 201, JSON.stringify(p.data));
      assert.notEqual(p.data.transfer_question.text, p.data.baseline_question, '새 질문이 같음');
      S.pa = p.data; S.comp = comp;
      S.rv = await runSession(c, fx, p.data.id, p.data.version);
      return `competency=${comp}`;
    }],
    [11, '변화 비교', async (c) => {
      const r = await c('/api/v1/transfer-comparisons', { method: 'POST', body: { transfer_id: S.pa.transfer_id, retry_session_id: S.pa.id } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      const st = r.data.comparison.status;
      assert.ok(ALLOWED.includes(st), `status=${st}`);
      assert.ok(r.data.comparison.caution, '주의문 없음');
      return `status=${st}`;
    }],
    [12, '기록·내보내기', async (c) => {
      const h = await c('/api/v1/sessions');
      assert.ok(h.data.sessions.some((x) => x.id === S.s.id), '기록에 세션 없음');
      const ex = await c('/api/v1/exports', { method: 'POST', body: { session_id: S.s.id } });
      assert.equal(ex.status, 202, JSON.stringify(ex.data));
      const dl = await c(ex.data.download_url);
      assert.equal(dl.status, 200);
      assert.ok(!/key|secret|token/i.test(JSON.stringify(dl.data).replace(/token_count|tokens/gi, '')), '내보내기에 키 흔적');
      S.exportUrl = ex.data.download_url; return `sessions=${h.data.sessions.length}`;
    }],
    ['12d', '세션 삭제 후 404', async (c) => {
      const d = await c(`/api/v1/sessions/${S.s.id}`, { method: 'DELETE' });
      assert.equal(d.status, 202, JSON.stringify(d.data));
      const codes = [(await c(`/api/v1/sessions/${S.s.id}/report`)).status, (await c(`/api/v1/transfer-comparisons/${S.pa.transfer_id}`)).status, (await c(S.exportUrl)).status];
      assert.deepEqual(codes, [404, 404, 404], `report/transfer/export=${codes}`);
      return 'report/transfer/export=404';
    }],
    ['12a', '운영자 트렌드 초안→공개→비공개', async (c) => {
      const ym = new Date().toISOString().slice(0, 7);
      const seg = fx.kind;
      const d = await c('/api/v1/admin/trends', { method: 'POST', admin: true, body: { segment: seg, yyyy_mm: ym, items: [{ competency: '문제 해결', comment: '리허설 합성 초안', sources: ['https://example.com/rehearsal'] }] } });
      assert.equal(d.status, 201, JSON.stringify(d.data));
      const noSrc = await c('/api/v1/admin/trends', { method: 'POST', admin: true, body: { segment: seg, yyyy_mm: ym, items: [{ competency: 'x', comment: 'y' }] } });
      assert.equal(noSrc.status, 422, '출처 없는 초안이 허용됨');
      const id = encodeURIComponent(`${seg}|${ym}`);
      const pub = await c(`/api/v1/admin/trends/${id}/publish`, { method: 'POST', admin: true, body: { version: d.data.version ?? 1 } });
      assert.equal(pub.status, 200, JSON.stringify(pub.data));
      const view = await c(`/api/v1/trends/${seg}/${ym}`);
      assert.equal(view.data.status, 'monthly_trend', JSON.stringify(view.data));
      const un = await c(`/api/v1/admin/trends/${id}/unpublish`, { method: 'POST', admin: true, body: {} });
      assert.equal(un.status, 200, JSON.stringify(un.data));
      const after = await c(`/api/v1/trends/${seg}/${ym}`);
      assert.equal(after.data.status, 'unavailable', '비공개 후에도 공개 조회됨');
      return `draft→publish→view(monthly_trend)→unpublish→view(${after.data.status})`;
    }],
  ];
  for (const [n, name, fn] of rest) if (!(await step(n, name, fn))) break;
  await o.close();
}

// 공급자 다운: 합성 인스턴스 + Gemini 구성 + 스텁 fetch가 500/429. 폴백으로 계속되고 mode=fallback이어야 한다.
async function providerDown(rows) {
  const fx = FIXTURES[0]; // company 레거시 샘플
  for (const status of [500, 429]) {
    const tag = `provider-down-${status}`;
    let calls = 0;
    globalThis.fetch = async (url, opts) => {
      if (String(url).startsWith(STUB)) { calls++; return new Response(JSON.stringify({ error: { message: 'down' } }), { status, headers: status === 429 ? { 'retry-after': '0.01' } : {} }); }
      return realFetch(url, opts);
    };
    let o;
    try {
      o = await open({ GEMINI_API_KEY: 'fake-rehearsal-key', GEMINI_BASE_URL: STUB, GEMINI_TEXT_MODEL: 'stub-model', GEMINI_FALLBACK_MODEL: 'stub-model', GEMINI_LIVE_ACK: 'true' }, { syntheticTraffic: true });
      const c = o.call;
      const p = await c('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', target_name: fx.title, role: '지원자', source_text: fx.posting_text, application_text: fx.application_text, fixture_id: fx.id } });
      assert.equal(p.status, 201, JSON.stringify(p.data));
      assert.equal((await c(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', body: { version_id: p.data.version_id } })).status, 200);
      const s = await c('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.data.version_id, duration_minutes: 10, input_mode: 'text' } });
      assert.equal(s.status, 201, JSON.stringify(s.data));
      const st = await cmd(c, s.data.id, s.data.version, 'session.start');
      const t = await cmd(c, s.data.id, st.data.version, 'turn.text', { text: fx.answers[0] });
      assert.equal(t.status, 202, JSON.stringify(t.data));
      assert.ok(calls >= 1, '스텁 공급자가 호출되지 않음(시험이 무의미)');
      assert.equal(t.data.provider_trace[0].mode, 'fallback', `mode=${t.data.provider_trace[0].mode}`);
      assert.equal(t.data.provider, 'mock', '폴백이 live로 표기됨');
      const fin = await cmd(c, s.data.id, t.data.version, 'session.finish');
      assert.equal(fin.status, 202, JSON.stringify(fin.data));
      const rep = await c(`/api/v1/sessions/${s.data.id}/report`);
      assert.equal(rep.status, 200);
      assert.equal(rep.data.evaluator.kind, 'rule_based');
      rows.push({ scenario: tag, step: '폴백 지속', ok: true, detail: `스텁 호출 ${calls}회, mode=fallback, 보고서 rule_based` });
    } catch (e) {
      rows.push({ scenario: tag, step: '폴백 지속', ok: false, detail: String(e?.message || e).slice(0, 240) });
    } finally { globalThis.fetch = realFetch; await o?.close(); }
  }
}

export async function runRehearsal() {
  const rows = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intervu-rehearsal-'));
  try {
    // 레거시 API 경로(유형별 팩·재연습·전이 비교) 리허설: 가상 fixture 3종만. 일반 면접 5단계는 tests/api/s2-questions.test.mjs가 다룬다.
    for (const fx of [FIXTURES.find((f) => f.kind === 'company'), ...FIXTURES.filter((f) => f.ui).slice(0, 2)]) await scenario(fx, rows, path.join(root, fx.kind));
    await providerDown(rows);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  return { ok: rows.length > 0 && rows.every((r) => r.ok), rows };
}

export function formatTable(rows) {
  const lines = ['scenario | step | result | detail', '--- | --- | --- | ---'];
  for (const r of rows) lines.push(`${r.scenario} | ${r.step} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail}`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, rows } = await runRehearsal();
  console.log(formatTable(rows));
  console.log(`\nREHEARSAL ${ok ? 'PASS' : 'FAIL'} (${rows.filter((r) => r.ok).length}/${rows.length}) provider=Mock(외부 호출 없음) node=${process.version} ${new Date().toISOString()}`);
  process.exit(ok ? 0 : 1);
}
