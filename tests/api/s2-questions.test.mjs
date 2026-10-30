// WP-S2: 트렌드 조회 판단(trends.decide) + 질문 설계(questions.design). 스텁 fetch·가짜 키만 사용(실호출 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProviders, okReply, rawReply, statusReply } from '../helpers/provider-stub.mjs';
import { createStore } from '../../src/store/memory.js';
import { FIXTURES } from '../../src/domain/fixtures.js';
import { lookupTrends, trendCatalog } from '../../src/domain/trend-mock.js';

const fx = FIXTURES.find((f) => f.id === 'fx-company-1');
const LIVE = { GEMINI_LIVE_ACK: 'true', TREND_MOCK_MONTH: '2026-10' };
const TRAITS = [{ label: '탐구 역량', quote: '탐구 역량을 중시합니다' }, { label: '공동체 역량', quote: '공동체 역량을 중시합니다' }];
const isDecide = (c) => JSON.stringify(c.body).includes('트렌드 조회가 필요한지');
const isDesign = (c) => JSON.stringify(c.body).includes('질문 설계기');
const json = (o) => rawReply(JSON.stringify(o));
const Q_OK = { text: '탐구 역량과 관련해 본인이 직접 맡은 역할은 무엇이었나요?', target_competency: 'evidence_specificity', evidence_ids: ['trait-1'] };

// respond 조립: decide/design 각각의 응답을 지정한다.
const stub = ({ decide, design }) => (c) => (isDecide(c) ? json(decide) : isDesign(c) ? json(design) : okReply());

async function setup(ctx, store, { traits = TRAITS, orgType = 'university', body = {} } = {}) {
  const r = await ctx.g('/api/v1/profiles', { method: 'POST', body: { org_type: orgType, target_name: '새봄대학교', role: '환경공학과', source_text: fx.posting_text, application_text: fx.application_text, fixture_id: fx.id, ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const inst = store.getInstitution(r.data.id);
  store.setInstitution(r.data.id, { ...inst.profile, school_analysis: { talent_traits: traits, admission_elements: [] } }, 'review');
  const claims = (await ctx.g(`/api/v1/profiles/${r.data.id}/claims`)).data.claims;
  return { p: r.data, claims };
}
const approve = async (ctx, p) => { const r = await ctx.g(`/api/v1/profiles/${p.id}/approve`, { method: 'POST', body: { version_id: p.version_id } }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r; };
const run = (env, respond, fn, overrides = {}) => { const store = createStore({}); return withProviders({ env: { ...LIVE, ...env }, overrides: { store, syntheticTraffic: true, ...overrides }, respond }, (ctx) => fn(ctx, store)); };
const planOf = async (ctx, p, q = '') => (await ctx.g(`/api/v1/profiles/${p.id}/plan?duration_minutes=15&seed=7${q}`)).data;

test('S2: decision false -> no Mock lookup, model questions still designed from school analysis', () => run({}, stub({ decide: { use_trend: false, trend_ids: [], reason: '불필요' }, design: { questions: [Q_OK] } }), async (ctx, store) => {
  const { p } = await setup(ctx, store);
  const a = await approve(ctx, p);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.plan.generator, 'gemini');
  assert.equal(a.data.plan.trend_used, false);
  const design = ctx.calls.find(isDesign);
  assert.ok(design, 'questions.design called');
  assert.ok(!JSON.stringify(design.body).includes('가상 이슈'), 'Mock trend body not fetched before a true decision');
  assert.ok(!JSON.stringify(ctx.calls.find(isDecide).body).includes('가상 이슈'), 'decision input has index only (no title/summary)');
  const plan = await planOf(ctx, p);
  const gq = plan.questions.find((q) => q.generator === 'gemini');
  assert.deepEqual(gq.institution_evidence_ids, ['trait-1']);
  assert.deepEqual(gq.trend_ids, []);
  assert.equal(plan.questions[0].generator, 'rule');
}));

test('S2: decision true + valid id -> Mock lookup, label and monthly_trend_mock on the question', () => {
  const t = lookupTrends('university', '2026-10', ['mock-2026-10-un-1']).items[0];
  const q = { text: '학업 과정에서 문제를 정의하고 해결한 경험을 설명해 주시겠어요?', target_competency: 'reasoning', evidence_ids: ['trait-1', t.id] };
  return run({}, stub({ decide: { use_trend: true, trend_ids: [t.id], reason: '필요' }, design: { questions: [q] } }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const a = await approve(ctx, p);
    assert.equal(a.data.plan.trend_used, true);
    assert.ok(JSON.stringify(ctx.calls.find(isDesign).body).includes(t.summary.slice(0, 10)), 'lookup result passed to design');
    const gq = (await planOf(ctx, p)).questions.find((x) => x.generator === 'gemini');
    assert.deepEqual(gq.trend_ids, [t.id]);
    assert.equal(gq.source_status, 'monthly_trend_mock');
    assert.equal(gq.trend_label, '월간 트렌드(Mock · 보조) — 실제 입시·교육 이슈 아님');
  });
});

test('S2: invalid / unknown / mixed trend ids and unavailable month -> trend ignored (conservative)', async () => {
  for (const ids of [['mock-nope'], ['mock-2026-10-un-1', 'mock-nope'], []]) {
    await run({}, stub({ decide: { use_trend: true, trend_ids: ids, reason: 'x' }, design: { questions: [Q_OK] } }), async (ctx, store) => {
      const { p } = await setup(ctx, store);
      const a = await approve(ctx, p);
      assert.equal(a.data.plan.trend_used, false, JSON.stringify(ids));
      assert.ok(!JSON.stringify(ctx.calls.find(isDesign).body).includes('가상 이슈'));
    });
  }
  // use_trend가 문자열 'true'이면 무효(엄격 불리언)
  await run({}, stub({ decide: { use_trend: 'true', trend_ids: ['mock-2026-10-un-1'] }, design: { questions: [Q_OK] } }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    assert.equal((await approve(ctx, p)).data.plan.trend_used, false);
  });
  // 현재 월 데이터 없음 -> 가까운 월로 대체하지 않고 판단 호출 자체가 없다
  assert.equal(trendCatalog('university', '2027-03'), null);
  await run({ TREND_MOCK_MONTH: '2027-03' }, stub({ decide: { use_trend: true, trend_ids: ['mock-2026-12-un-1'] }, design: { questions: [Q_OK] } }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const a = await approve(ctx, p);
    assert.equal(a.data.plan.trend_used, false);
    assert.ok(!ctx.calls.some(isDecide), 'no decision call when month has no data');
  });
});

test('S2: invalid questions dropped one by one; fabricated number / proper noun dropped', () => {
  const design = { questions: [
    Q_OK,
    { text: '탐구 역량 점수를 어떻게 올리셨나요?', target_competency: 'reasoning', evidence_ids: ['trait-1'] }, // 점수 어휘
    { text: '탐구 활동을 설명해 주세요.', target_competency: 'reasoning', evidence_ids: ['trait-1'] }, // '?' 없음
    { text: '탐구 활동에서 몰랐던 점은 무엇인가요?', target_competency: 'reasoning', evidence_ids: ['trait-99'] }, // 알 수 없는 근거
    { text: '탐구 활동에서 97퍼센트 성과를 낸 이유는 무엇인가요?', target_competency: 'reasoning', evidence_ids: ['trait-1'] }, // 지어낸 숫자
    { text: '한빛대학교 연구실에서 한 일은 무엇인가요?', target_competency: 'reasoning', evidence_ids: ['trait-1'] }, // 지어낸 고유명사
    { text: '탐구와 공동체 중 무엇이 먼저인가요? 이유는요?', target_competency: 'reasoning', evidence_ids: ['trait-1'] }, // 물음표 2개
    { text: `${'긴'.repeat(201)}?`, target_competency: 'reasoning', evidence_ids: ['trait-1'] }, // 200자 초과
  ] };
  return run({}, stub({ decide: { use_trend: false, trend_ids: [] }, design }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const a = await approve(ctx, p);
    assert.equal(a.data.plan.model_question_count, 1);
    const gen = (await planOf(ctx, p)).questions.filter((q) => q.generator === 'gemini');
    assert.deepEqual(gen.map((q) => q.text), [Q_OK.text]);
  });
});

test('S2: model question cap and claim questions stay first and unchanged', () => {
  const many = { questions: Array.from({ length: 6 }, (_, i) => ({ text: `탐구 역량을 보여 준 경험 ${['하나', '둘', '셋', '넷', '다섯', '여섯'][i]}를 설명해 주시겠어요?`, target_competency: 'reasoning', evidence_ids: ['trait-1'] })) };
  return run({}, stub({ decide: { use_trend: false, trend_ids: [] }, design: many }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const ruleBefore = await planOf(ctx, p); // 승인 전: 규칙 기반
    assert.ok(ruleBefore.questions.every((q) => q.generator === 'rule'));
    const a = await approve(ctx, p);
    assert.equal(a.data.plan.model_question_count, 3);
    const plan = await planOf(ctx, p);
    const claimBefore = ruleBefore.questions.filter((q) => q.question_id.startsWith('claim-q-'));
    const claimAfter = plan.questions.filter((q) => q.question_id.startsWith('claim-q-'));
    assert.ok(claimAfter.length > 0);
    assert.deepEqual(claimAfter, claimBefore.map((q) => ({ ...q })), 'claim questions unchanged');
    assert.equal(plan.questions.slice(0, claimAfter.length).every((q) => q.question_id.startsWith('claim-q-')), true, 'claim questions first');
    assert.ok(plan.questions.length <= 5);
  });
});

test('S2: all model questions dropped -> existing rule-based plan', () => {
  const bad = { questions: [{ text: '합격 점수는 몇 점인가요?', target_competency: 'reasoning', evidence_ids: ['trait-1'] }] };
  return run({}, stub({ decide: { use_trend: false, trend_ids: [] }, design: bad }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const before = await planOf(ctx, p);
    const a = await approve(ctx, p);
    assert.equal(a.data.plan.generator, 'rule');
    const after = await planOf(ctx, p);
    assert.equal(after.generator, 'rule');
    assert.deepEqual(after.questions.map((q) => q.text), before.questions.map((q) => q.text));
  });
});

test('S2: provider failure (429) on design -> rule plan with fallback trace, approve still 200', () =>
  run({}, (c) => (isDecide(c) ? json({ use_trend: false, trend_ids: [] }) : statusReply(429, { 'retry-after': '0.01' })), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const a = await approve(ctx, p);
    assert.equal(a.status, 200);
    assert.equal(a.data.plan.generator, 'rule');
    assert.ok(a.data.plan.provider_trace.some((t) => t.operation === 'questions.design' && t.mode === 'fallback'));
  }));

test('S2: frozen plan == session questions; later re-approval/claim edits do not leak', () =>
  run({}, stub({ decide: { use_trend: false, trend_ids: [] }, design: { questions: [Q_OK] } }), async (ctx, store) => {
    const { p, claims } = await setup(ctx, store);
    await approve(ctx, p);
    const plan = await planOf(ctx, p);
    const s = await ctx.g('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.version_id, interview_type: 'general', duration_minutes: 15, seed: 7 } });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    const got = (await ctx.g(`/api/v1/sessions/${s.data.id}`)).data.questions;
    assert.deepEqual(got.map((q) => q.text), plan.questions.map((q) => q.text));
    assert.ok(got.some((q) => q.text === Q_OK.text), 'model question is in the session');
    // 승인 후 주장 제외: needs_reapproval이고 계획은 동결 그대로
    await ctx.g(`/api/v1/profiles/${p.id}/claims/${claims[0].id}`, { method: 'PATCH', body: { excluded: true } });
    assert.deepEqual((await planOf(ctx, p)).questions.map((q) => q.text), plan.questions.map((q) => q.text));
    await ctx.g(`/api/v1/sessions/${s.data.id}`, { method: 'DELETE' });
  }));

test('S2: followup prompt carries school_context (<=5 trait labels), validators unchanged', () => {
  const traits = Array.from({ length: 7 }, (_, i) => ({ label: `인재상${i + 1}`, quote: `인재상${i + 1} 원문` }));
  return run({}, (c) => (isDecide(c) ? json({ use_trend: false, trend_ids: [] }) : isDesign(c) ? json({ questions: [] }) : okReply('그 선택을 한 판단 기준은 무엇이었나요?')), async (ctx, store) => {
    const { p } = await setup(ctx, store, { traits });
    await approve(ctx, p);
    const sess = await ctx.startSession({ profile_version_id: p.version_id, interview_type: 'general' });
    const t = await ctx.turn(sess, '제가 직접 일정을 조정했습니다.');
    assert.equal(t.status, 202, JSON.stringify(t.data));
    const dial = ctx.calls.filter((c) => JSON.stringify(c.body).includes('면접관'));
    assert.ok(dial.length >= 1);
    const txt = JSON.stringify(dial[0].body);
    assert.ok(txt.includes('인재상1') && txt.includes('인재상5') && !txt.includes('인재상6'));
  });
});

test('S2: gate closed -> zero outbound calls, rule plan (no LIVE_ACK / real data / highschool real / killed)', async () => {
  // LIVE_ACK 없음
  await run({ GEMINI_LIVE_ACK: '' }, stub({ decide: {}, design: {} }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const a = await approve(ctx, p);
    assert.equal(ctx.calls.length, 0);
    assert.equal(a.data.plan.generator, 'rule');
  });
  // 실데이터(비합성) + LIVE_ACK만: 호출 0건
  await run({}, stub({ decide: {}, design: {} }), async (ctx, store) => {
    const { p } = await setup(ctx, store, { body: { fixture_id: undefined, application_text: '저는 동아리에서 프로젝트를 맡아 일정을 조율했습니다.' } });
    await approve(ctx, p);
    assert.equal(ctx.calls.length, 0);
  }, { syntheticTraffic: false });
  // 고입 실제 입력: 모든 확인이 있어도 호출 0건(미성년자)
  await run({ GEMINI_REAL_DATA_ACK: 'true' }, stub({ decide: {}, design: {} }), async (ctx, store) => {
    await ctx.g('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
    const { p } = await setup(ctx, store, { orgType: 'highschool', body: { fixture_id: undefined, application_text: '저는 동아리에서 프로젝트를 맡아 일정을 조율했습니다.' } });
    await approve(ctx, p);
    assert.equal(ctx.calls.length, 0);
  }, { syntheticTraffic: false });
  // 킬 스위치
  await run({ KILL_PROVIDERS: 'gemini' }, stub({ decide: {}, design: {} }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    await approve(ctx, p);
    assert.equal(ctx.calls.length, 0);
  });
});

test('S2: fixture-judged synthetic profile uses the model without syntheticTraffic', () =>
  run({}, stub({ decide: { use_trend: false, trend_ids: [] }, design: { questions: [Q_OK] } }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const a = await approve(ctx, p);
    assert.equal(a.data.plan.generator, 'gemini');
    assert.ok(ctx.calls.length >= 2);
  }, { syntheticTraffic: false }));
