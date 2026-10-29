// Gemini 스텁 fetch 헬퍼 (게이트 시험용)
import assert from 'node:assert/strict';
import { createApp } from '../../src/server.js';
import { A, ensureConsent, needsConsent } from './app.mjs';

export async function withGeminiStub(env, overrides, fn) {
  const realFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      outbound.push(String(opts?.body || ''));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"utterance":"STUB 꼬리질문?","claims":[],"missing_fields":[]}' }] } }], usageMetadata: {} }), { status: 200 });
    }
    return realFetch(url, opts);
  };
  const gated = createApp({ env: { GEMINI_API_KEY: 'fake-key', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: A, TRENDS_FILE: '', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100', ...env }, ...overrides });
  await new Promise((r) => gated.server.listen(0, r));
  const gbase = `http://127.0.0.1:${gated.server.address().port}`;
  const gcall = async (path, { method = 'GET', body, noConsent = false } = {}) => {
    if (needsConsent(method, path, noConsent)) await ensureConsent(gbase, A, realFetch);
    const h = { Authorization: `Bearer ${A}` };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
    const res = await realFetch(gbase + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try { await fn({ gcall, outbound, app: gated }); } finally { globalThis.fetch = realFetch; gated.server.close(); }
}
export const FORGED = { synthetic: true, _synthetic: true, _synthetic_fixture: true, synthetic_fixture: '__fixture__', free_test: true };
export const REAL_TEXT = '저는 한빛고 학생회장 김철수로서 팀 갈등을 직접 조율했고 기준을 세워 대안을 비교했습니다.';

export async function runForgedFlow(gcall, extra = {}) {
  const pr = await gcall('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', target_name: 'X', role: 'PM', source_text: '문제 해결 협업 인재상', ...FORGED, ...extra } });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  const s = await gcall('/api/v1/sessions', { method: 'POST', body: { duration_minutes: 10, ...FORGED } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const st = await gcall(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  // 위조 플래그를 본문 최상위와 payload 양쪽에 싣는다
  const turn = await gcall(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: st.data.version, type: 'turn.text', ...FORGED, payload: { text: REAL_TEXT, ...FORGED } } });
  assert.equal(turn.status, 202, JSON.stringify(turn.data));
  return { pr, turn };
}
