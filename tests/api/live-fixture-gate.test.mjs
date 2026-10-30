// 실연동 데모 규칙: 실제 API 호출은 '서버 fixture 샘플 데이터'일 때만 나간다(답변 텍스트별 판정). 스텁 fetch·가짜 키만 사용.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProviders, okReply, rawReply } from '../helpers/provider-stub.mjs';
import { FIXTURES } from '../../src/domain/fixtures.js';

const LIVE = { GEMINI_LIVE_ACK: 'true', GROQ_WHISPER_KEY: 'gsk_fake_groq_key', GROQ_BASE_URL: 'https://stub.groq.test/v1', GROQ_LIVE_ACK: 'true', ROUTE_TRENDS_DECIDE: 'mock', ROUTE_QUESTIONS_DESIGN: 'mock', ROUTE_SCHOOL_ANALYZE: 'mock', ROUTE_CLAIMS_EXTRACT: 'mock', ROUTE_EVALUATION_GENERATE: 'mock' };
const isDialogue = (c) => !JSON.stringify(c.body).includes('APPLICANT_TEXT_UNTRUSTED');

async function fixtureSession(ctx, fx) {
  const pr = await ctx.g('/api/v1/profiles', { method: 'POST', body: { org_type: fx.kind, fixture_id: fx.id, school_name: fx.school_name, department: fx.department, target_name: fx.school_name, role: fx.department, source_text: fx.posting_text, application_text: fx.application_text } });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  assert.equal(pr.data.synthetic, true);
  assert.equal((await ctx.g(`/api/v1/profiles/${pr.data.id}/approve`, { method: 'POST', body: { version_id: pr.data.version_id } })).status, 200);
  const s = await ctx.g('/api/v1/sessions', { method: 'POST', body: { profile_version_id: pr.data.version_id, interview_type: 'general', duration_minutes: 10 } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const st = await ctx.g(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  return { id: s.data.id, version: st.data.version };
}

for (const fx of FIXTURES.filter((f) => f.kind === 'highschool' || f.kind === 'university')) {
  test(`live gate (${fx.kind}): sample answer goes to Gemini, typed real text in the same session stays local`, async () => {
    await withProviders({ env: LIVE, respond: () => okReply('그 선택을 한 판단 기준은 무엇이었나요?') }, async (ctx) => {
      const sess = await fixtureSession(ctx, fx);
      const t1 = await ctx.turn(sess, fx.answers[0]);
      assert.equal(t1.status, 202, JSON.stringify(t1.data));
      assert.equal(t1.data.provider_trace[0].mode, 'live', 'fixture sample answer is mock data -> real API call');
      const before = ctx.calls.length;
      const t2 = await ctx.turn(sess, '제가 직접 쓴 진짜 답변입니다. 이 문장은 샘플이 아닙니다.');
      assert.equal(t2.status, 202, JSON.stringify(t2.data));
      assert.notEqual(t2.data.provider_trace[0].mode, 'live', 'non-sample text is never sent');
      assert.equal(ctx.calls.length, before, 'zero outbound calls for non-sample text');
    });
  });
}

test('live gate: evaluation goes live only when every answer is a sample answer', async () => {
  const fx = FIXTURES.find((f) => f.kind === 'university');
  const evalReply = () => rawReply(JSON.stringify({ dimensions: [], next_actions: [] }));
  await withProviders({ env: { ...LIVE, ROUTE_EVALUATION_GENERATE: 'gemini' }, respond: (c) => (JSON.stringify(c.body).includes('evaluation') || JSON.stringify(c.body).includes('dimensions') ? evalReply() : okReply('근거를 하나 더 말씀해 주시겠어요?')) }, async (ctx) => {
    const sess = await fixtureSession(ctx, fx);
    await ctx.turn(sess, fx.answers[0]);
    await ctx.turn(sess, '샘플이 아닌 진짜 답변입니다. 외부로 나가면 안 됩니다.');
    const fin = await ctx.g(`/api/v1/sessions/${sess.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: sess.version, type: 'session.finish', payload: {} } });
    assert.equal(fin.status, 202, JSON.stringify(fin.data));
    const rep = await ctx.g(`/api/v1/sessions/${sess.id}/report`);
    const ev = rep.data.provider_trace.find((t) => t.operation === 'evaluation.generate');
    assert.notEqual(ev?.mode, 'live', 'mixed (sample + real) answers: evaluation stays local');
    assert.equal(rep.data.evaluator.kind, 'rule_based');
  });
});

test('live gate: Groq STT is allowed in a server-judged sample session (read the sample aloud) but not in a normal session', async () => {
  const fx = FIXTURES.find((f) => f.kind === 'highschool');
  const audio = new Blob([new Uint8Array(4096).fill(7)], { type: 'audio/webm' });
  const send = async (ctx, id) => {
    const fd = new FormData(); fd.append('file', audio, 'a.webm');
    const h = { Authorization: 'Bearer dev-user-a-token', 'Idempotency-Key': crypto.randomUUID() };
    const r = await fetch(`${ctx.base}/api/v1/sessions/${id}/transcriptions`, { method: 'POST', headers: h, body: fd });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  await withProviders({ env: LIVE, respond: (c) => (c.url.includes('stub.groq.test') ? new Response(JSON.stringify({ text: '샘플 답변을 읽었습니다', language: 'ko' }), { status: 200 }) : okReply()) }, async (ctx) => {
    const sample = await fixtureSession(ctx, fx);
    const r1 = await send(ctx, sample.id);
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    assert.ok(ctx.calls.some((c) => c.url.includes('stub.groq.test')), 'sample session reaches the (stub) Groq endpoint');
    const before = ctx.calls.length;
    await ctx.g(`/api/v1/sessions/${sample.id}`, { method: 'DELETE' }); // 사용자당 활성 세션 1개
    const normal = await ctx.startSession();
    const r2 = await send(ctx, normal.id);
    assert.notEqual(r2.status, 200, 'normal (real-data) session without REAL_DATA_ACK is blocked');
    assert.equal(ctx.calls.length, before, 'no outbound audio for a normal session');
  });
});
