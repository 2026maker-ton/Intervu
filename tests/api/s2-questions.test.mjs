// 일반 면접 5단계(2026-10-31): 승인 시 질문·근거·연결 문장 동결, 면접 중 꼬리질문 결정·완료 판단·제한시간.
// 스텁 fetch·가짜 키만 사용(실호출 없음). 이전 WP-S2(트렌드·모델 질문 3개) 동작은 이 계획으로 대체됐다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProviders, okReply, rawReply } from '../helpers/provider-stub.mjs';
import { createStore } from '../../src/store/memory.js';
import { getFixture } from '../../src/domain/fixtures.js';
import { GENERAL_STAGES, SPOKEN, limitationSentences, competencyFit } from '../../src/domain/interview-format.js';
import { endsSentence } from '../../public/core/sentence.js';

const fx = getFixture('smp-snu-bio');
const LIVE = { GEMINI_LIVE_ACK: 'true' };
const TRAITS = [{ label: '탐구 역량', quote: '탐구 역량을 중시합니다' }, { label: '공동체 역량', quote: '공동체 역량을 중시합니다' }];
const isDesign = (c) => JSON.stringify(c.body).includes('면접 질문 설계기');
const isTurn = (c) => JSON.stringify(c.body).includes('대학 입학 면접관');

const json = (o) => rawReply(JSON.stringify(o));
const STAGES_OK = (claimId) => ({ stages: [
  { stage: 'intro', question: '생명과학부에 지원한 이유는 무엇인가요?', evidence_ids: [], bridge: '지원 이유는 잘 들었습니다.' },
  { stage: 'academic', question: '탐구 역량을 기르기 위해 어떤 공부를 했나요?', evidence_ids: ['trait-1'], bridge: '이제 활동 이야기를 들어 보겠습니다.' },
  { stage: 'experience', question: '효소 실험에서 직접 맡은 일은 무엇이었나요?', evidence_ids: [claimId], bridge: '그 과정의 어려움도 묻겠습니다.' },
  { stage: 'reflection', question: '실험에서 1000번 반복한 이유는 무엇인가요?', evidence_ids: [claimId], bridge: '좋습니다.' }, // 근거에 없는 숫자 → 이 단계만 폐기
  { stage: 'closing', question: '입학 후 계획은 무엇인가요?', evidence_ids: ['trait-1'], bridge: '' }, // 마무리는 근거 없이: 허용 접두사 밖 id → 폐기
] });
const stub = ({ design = { stages: [] }, turn = { action: 'next', turn_score: { relevance: 3, specificity: 3, reasoning: 3 } } } = {}) =>
  (c) => (isDesign(c) ? json(typeof design === 'function' ? design(c) : design) : isTurn(c) ? json(turn) : okReply());

async function setup(ctx, store, { traits = TRAITS, body = {} } = {}) {
  const r = await ctx.g('/api/v1/profiles', { method: 'POST', body: { org_type: 'university', school_name: fx.school_name, department: fx.department, source_text: fx.posting_text, application_text: fx.application_text, fixture_id: fx.id, ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const inst = store.getInstitution(r.data.id);
  store.setInstitution(r.data.id, { ...inst.profile, school_analysis: { talent_traits: traits.map((t, i) => ({ id: `trait-${i + 1}`, ...t })), admission_elements: [] } }, 'review');
  const claims = (await ctx.g(`/api/v1/profiles/${r.data.id}/claims`)).data.claims;
  return { p: r.data, claims };
}
const approve = async (ctx, p) => { const r = await ctx.g(`/api/v1/profiles/${p.id}/approve`, { method: 'POST', body: { version_id: p.version_id } }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r; };
const run = (env, respond, fn, overrides = {}) => { const store = createStore({}); return withProviders({ env: { ...LIVE, ...env }, overrides: { store, syntheticTraffic: true, ...overrides }, respond }, (ctx) => fn(ctx, store)); };
const planOf = async (ctx, p) => (await ctx.g(`/api/v1/profiles/${p.id}/plan`)).data;
const general = async (ctx, p, input_mode = 'text') => ctx.g('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.version_id, interview_format: 'general', input_mode } });

test('5-stage plan: model stages validated per stage; invalid stages fall back to rule templates; bridges kept', () => {
  let claimId = null;
  return run({}, stub({ design: () => STAGES_OK(claimId) }), async (ctx, store) => {
    const { p, claims } = await setup(ctx, store);
    claimId = claims[0].id;
    const a = await approve(ctx, p);
    assert.equal(a.data.plan.generator, 'gemini');
    const plan = await planOf(ctx, p);
    assert.equal(plan.format, 'general');
    assert.deepEqual(plan.stages.map((s) => s.stage), GENERAL_STAGES.map((s) => s.id));
    const by = Object.fromEntries(plan.stages.map((s) => [s.stage, s]));
    assert.equal(by.intro.generator, 'gemini');
    assert.equal(by.intro.evidence.length, 0);
    assert.equal(by.academic.evidence[0].id, 'trait-1');
    assert.equal(by.experience.evidence[0].kind, 'application');
    assert.equal(by.reflection.generator, 'rule', 'fabricated number -> rule template');
    assert.equal(by.closing.generator, 'rule', 'closing with evidence id -> rule template');
    assert.equal(by.intro.bridge, '지원 이유는 잘 들었습니다.');
    assert.equal(by.closing.bridge, null);
    assert.ok(!ctx.calls.some((c) => JSON.stringify(c.body).includes('트렌드 조회가 필요한지')), 'trends.decide is not used by the general plan');
  });
});

test('5-stage plan: gate closed -> zero outbound calls and rule plan (no LIVE_ACK / real data / killed); highschool real -> 422', async () => {
  await run({ GEMINI_LIVE_ACK: '' }, stub(), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const a = await approve(ctx, p);
    assert.equal(ctx.calls.length, 0);
    assert.equal(a.data.plan.generator, 'rule');
    const plan = await planOf(ctx, p);
    assert.equal(plan.stages.length, 5);
    assert.ok(plan.stages.every((s) => s.generator === 'rule' && s.text && (s.stage === 'closing' || s.bridge)));
  });
  await run({}, stub(), async (ctx, store) => {
    const { p } = await setup(ctx, store, { body: { fixture_id: undefined, application_text: '저는 동아리에서 프로젝트를 맡아 일정을 조율했습니다.' } });
    await approve(ctx, p);
    assert.equal(ctx.calls.length, 0);
  }, { syntheticTraffic: false });
  await run({ KILL_PROVIDERS: 'gemini' }, stub(), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    await approve(ctx, p);
    assert.equal(ctx.calls.length, 0);
  });
  await run({ GEMINI_REAL_DATA_ACK: 'true' }, stub(), async (ctx) => {
    await ctx.g('/api/v1/consents', { method: 'POST', body: { age_18_confirmed: true, notice_version: 'v1' } });
    const r = await ctx.g('/api/v1/profiles', { method: 'POST', body: { org_type: 'highschool', school_name: '가온고', department: '자연', application_text: '저는 동아리에서 일정을 조율했습니다.' } });
    assert.equal(r.status, 422);
    assert.equal(ctx.calls.length, 0);
  }, { syntheticTraffic: false });
});

test('5-stage session: frozen plan == session questions; special formats and missing profile rejected; edits after approval need re-approval', () =>
  run({ GEMINI_LIVE_ACK: '' }, stub(), async (ctx, store) => {
    const { p, claims } = await setup(ctx, store);
    await approve(ctx, p);
    const plan = await planOf(ctx, p);
    assert.equal((await ctx.g('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.version_id, interview_format: 'pressure' } })).status, 422);
    assert.equal((await ctx.g('/api/v1/sessions', { method: 'POST', body: { interview_format: 'general' } })).status, 422);
    const s = await general(ctx, p);
    assert.equal(s.status, 201, JSON.stringify(s.data));
    assert.equal(s.data.limits.answer_seconds, 60);
    const got = (await ctx.g(`/api/v1/sessions/${s.data.id}`)).data.questions;
    assert.deepEqual(got.map((q) => q.text), plan.stages.map((q) => q.text));
    await ctx.g(`/api/v1/profiles/${p.id}/claims/${claims[0].id}`, { method: 'PATCH', body: { excluded: true } });
    assert.deepEqual((await planOf(ctx, p)).stages.map((q) => q.text), plan.stages.map((q) => q.text), 'frozen until re-approval');
    const c = await ctx.g(`/api/v1/profiles/${p.id}/customization`, { method: 'PATCH', body: { competencies: ['과학적 추론'] } });
    assert.equal(c.data.needs_reapproval, true);
  }));

test('5-stage turn flow: opening + ack, intro never follows up, model follow-up validated, cut_off flagged, report has transcript and fit only', () =>
  run({}, stub({ turn: { action: 'followup', utterance: '그 실험에서 본인이 직접 정한 기준은 무엇이었나요?', turn_score: { relevance: 4, specificity: 2, reasoning: 3 } } }), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    await approve(ctx, p);
    const s = await general(ctx, p);
    let v = s.data.version;
    const cmd = async (type, payload = {}) => { const r = await ctx.g(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: v, type, payload } }); if (r.data?.version) v = r.data.version; return r; };
    const st = await cmd('session.start');
    assert.equal(st.data.opening, SPOKEN.opening);
    assert.deepEqual(Object.keys(st.data.question).sort(), ['id', 'stage', 'text'], 'room question carries no evidence');
    const t1 = await cmd('turn.text', { text: fx.answers[0] });
    assert.equal(t1.data.ack, SPOKEN.ack);
    assert.equal(t1.data.action, 'next_question', 'intro stage has no follow-up even if the model asks');
    assert.ok(t1.data.utterance.startsWith(t1.data.bridge) && t1.data.bridge);
    const t2 = await cmd('turn.text', { text: '탐구 역량을 기르려고 실험 보고서를 꾸준히 썼습니다.' });
    assert.equal(t2.data.action, 'ask_followup');
    const t3 = await cmd('turn.text', { text: '제가 측정 시간을 고정하는 기준을 정했습니다.', cut_off: true, voice_metrics: { speech_ratio: 0.7, pitch_jitter: 9, silence_count: 2 } });
    assert.equal(t3.data.action, 'next_question', 'one follow-up per question');
    assert.equal(t3.data.cut_off, true);
    for (let i = 0; i < 6 && (await ctx.g(`/api/v1/sessions/${s.data.id}`)).data.state === 'active'; i++) await cmd('turn.text', { text: fx.answers[i % fx.answers.length] });
    const rep = (await ctx.g(`/api/v1/sessions/${s.data.id}/report`)).data;
    assert.equal(rep.format, 'general');
    assert.ok(rep.transcript.length >= 6);
    assert.ok(rep.transcript.some((t) => t.is_followup && t.question_text.includes('기준')));
    const cut = rep.transcript.find((t) => t.cut_off);
    assert.ok(cut && cut.voice_metrics.speech_ratio === 0.7 && !('pitch_jitter' in cut.voice_metrics), 'out-of-range voice metric dropped');
    assert.ok(rep.transcript.every((t) => t.turn_score && t.turn_score.relevance >= 1));
    assert.ok(Array.isArray(rep.competency_fit) && rep.competency_fit.some((c) => c.label === '탐구 역량' && c.answers >= 1));
    assert.ok(!('claim_links' in rep) && !('institution_link' in rep), 'duplicate sections removed');
    assert.ok(rep.next_actions.length <= 3);
  }));

test('answer end: browser rule is the Korean sentence-final ending (다/요/죠/까); no server AI call for it', async () => {
  for (const t of ['지원했습니다.', '관심이 있어요', '그렇죠?', '궁금합니다…', '“배웠다”', '수행했습니다. ']) assert.equal(endsSentence(t), true, t);
  for (const t of ['저는 그리고', '먼저,', '', '실험을 했고', 'OK.', '네']) assert.equal(endsSentence(t), false, t);
  await run({}, stub(), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    await approve(ctx, p);
    const s = await general(ctx, p);
    assert.equal((await ctx.g(`/api/v1/sessions/${s.data.id}/answer-check`, { method: 'POST', body: { transcript: 'x' } })).status, 404, 'answer-check endpoint removed');
  });
});

test('school.search (grounding): blocked without GROUNDING_ACK or with free-only; text stored without links/suggestions; never fed into questions', async () => {
  const isSearch = (c) => JSON.stringify(c.body).includes('google_search');
  const grounded = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '전형 확인: 확인 안 됨\n면접 유무: 있음\n면접 방식: 제시문 구술\n면접 분류: 기술\n평가 요소: 학업역량\n인재상: 수리탐구' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.ac.kr/guide', title: '모집요강' } }], searchEntryPoint: { renderedContent: '<div>chips</div>' } } }], usageMetadata: {} }), { status: 200 });
  await run({ GEMINI_GROUNDING_ACK: 'true' }, stub(), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const r = await ctx.g(`/api/v1/profiles/${p.id}/school-search`, { method: 'POST', body: {} });
    assert.equal(r.data.status, 'blocked');
    assert.equal(r.data.reason, 'grounding_ack_missing', 'free-only (default) keeps the paid feature off');
    assert.ok(!ctx.calls.some(isSearch));
  });
  await run({ GEMINI_GROUNDING_ACK: 'true', GEMINI_FREE_ONLY: 'false' }, (c) => (isSearch(c) ? grounded() : stub()(c)), async (ctx, store) => {
    const { p } = await setup(ctx, store);
    const r = await ctx.g(`/api/v1/profiles/${p.id}/school-search`, { method: 'POST', body: {} });
    assert.equal(r.data.status, 'ok', JSON.stringify(r.data));
    assert.ok(r.data.entry.text.includes('면접 분류: 기술'));
    assert.equal(r.data.entry.sources[0].url, 'https://example.ac.kr/guide');
    assert.ok(r.data.entry.suggestions_html);
    const saved = store.getInstitution(p.id).profile.search_history[0];
    assert.ok(saved.text && !('sources' in saved) && !('suggestions_html' in saved), 'links and suggestions are not stored');
    assert.ok(Date.parse(saved.expires_at) - Date.now() <= 150 * 864e5 + 1000);
    await approve(ctx, p);
    const plan = await planOf(ctx, p);
    assert.ok(!JSON.stringify(plan.stages).includes('수리탐구'), 'grounded text is not used as question evidence');
    saved.expires_at = new Date(Date.now() - 1).toISOString();
    assert.equal((await ctx.g(`/api/v1/profiles/${p.id}`)).data.institution.search_history.length, 0, 'expired history hidden');
    assert.equal((await ctx.g(`/api/v1/profiles/${p.id}/school-search`, { method: 'POST', body: {}, token: 'dev-user-b-token' })).status, 404);
  });
});

test('domain: limitation sentences keep exact spans; competency fit is keyword-based and zero when uncovered', () => {
  const lim = limitationSentences(fx.application_text);
  assert.ok(lim.length >= 1);
  for (const l of lim) assert.equal([...fx.application_text].slice(l.start_cp, l.end_cp).join(''), l.quote);
  const fit = competencyFit([{ id: 'a', label: '과학적 추론' }, { id: 'b', label: '공동체 역량' }], [{ turn_id: 't1', text: '생명과학 실험을 했습니다.', turn_score: { relevance: 3, specificity: 3, reasoning: 3 } }]);
  assert.equal(fit[0].answers, 1);
  assert.equal(fit[1].answers, 0);
  assert.equal(fit[1].avg_score, 0);
});
