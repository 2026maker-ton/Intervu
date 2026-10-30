// WP-S1: 동의 API(미성년 확인)·학교 입력 정규화·데모 학교 탐색·학교 분석(school.analyze). 스텁 fetch·가짜 키만 사용(실호출 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/app.mjs';
import { withProviders, rawReply, statusReply } from '../helpers/provider-stub.mjs';
import { getFixture } from '../../src/domain/fixtures.js';
import { SCHOOLS } from '../../src/domain/school-directory.js';

const uni = getFixture('fx-university-1');
const hs = getFixture('fx-highschool-1');
const LIVE = { GEMINI_LIVE_ACK: 'true' };
const fxBody = (f, extra = {}) => ({ org_type: f.kind, school_name: f.school_name, department: f.department, source_text: f.posting_text, application_text: f.application_text, fixture_id: f.id, ...extra });
const isSchoolCall = (c) => JSON.stringify(c.body).includes('SCHOOL_TEXT_UNTRUSTED');
const claimsStub = () => rawReply(JSON.stringify({ claims: [] }));
const reply = (o) => rawReply(JSON.stringify(o));
const post = (c, body) => c('/api/v1/profiles', { method: 'POST', body, noConsent: true }).then((r) => { if (r.status !== 201) console.log('POSTFAIL', r.status, JSON.stringify(r.data)); return r; });
const analyze = (c, id, body = {}) => c(`/api/v1/profiles/${id}/school-analysis`, { method: 'POST', body });

test('S1 consent: age_19_confirmed=false needs minor_notice_ack; both fields stored; boolean required', () => withApp({}, async (c) => {
  const url = '/api/v1/consents';
  assert.equal((await c(url, { method: 'POST', body: { notice_version: 'v1' } })).status, 422);
  assert.equal((await c(url, { method: 'POST', body: { age_19_confirmed: false, notice_version: 'v1' } })).status, 422);
  assert.equal((await c(url, { method: 'POST', body: { age_19_confirmed: false, minor_notice_ack: false, notice_version: 'v1' } })).status, 422);
  const ok = await c(url, { method: 'POST', body: { age_19_confirmed: false, minor_notice_ack: true, notice_version: 'v1' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.age_19_confirmed, false);
  assert.equal(ok.data.minor_notice_ack, true);
  const adult = await c(url, { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
  assert.equal(adult.status, 201);
  assert.equal(adult.data.age_19_confirmed, true);
  assert.equal(adult.data.minor_notice_ack, false);
}));

test('S1 consent: minor consent unlocks POST /profiles but never opens the external gate (age19 stays false)', async () => {
  await withProviders({ env: { ...LIVE, GEMINI_REAL_DATA_ACK: 'true' }, respond: () => claimsStub() }, async (ctx) => {
    await ctx.g('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: false, minor_notice_ack: true, notice_version: 'v1' } });
    const r = await post(ctx.g, { org_type: 'university', school_name: '임의대학교', department: '국문과', source_text: '인재상: 탐구 역량. 면접: 개별 면접.', application_text: '저는 동아리에서 행사를 기획했습니다.' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.synthetic, false);
    const a = await analyze(ctx.g, r.data.id);
    assert.equal(a.status, 200);
    assert.equal(a.data.analysis_mode, 'rule_based');
    assert.equal(ctx.calls.length, 0, 'minor consent: nothing leaves the server');
  });
});

test('S1 profile: default org_type is university; school fields normalize to target_name/role; demo school auto-discovered', () => withApp({}, async (c) => {
  const r = await post(c, fxBody(uni, { org_type: undefined }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.synthetic, true);
  assert.equal(r.data.institution.org_type, 'university');
  assert.equal(r.data.institution.target_name, uni.school_name);
  assert.equal(r.data.institution.role, uni.department);
  assert.equal(r.data.school_discovery.status, 'found');
  const p = await c(`/api/v1/profiles/${r.data.id}`);
  assert.equal(p.data.school_name, uni.school_name);
  assert.equal(p.data.target_name, uni.school_name);
  const src = p.data.sources.find((s) => s.kind === 'demo_fixture');
  assert.ok(src && src.status === 'demo_fixture' && src.retrieved_at && src.confirmed_at && src.publisher.includes('실제 학교 아님'));
  assert.equal(p.data.school_discovery.status, 'found');
}));

test('S1 profile: unknown school -> discovery_failed with guidance, no guessed source', () => withApp({}, async (c) => {
  await c('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
  const r = await post(c, { org_type: 'university', school_name: '존재하지않는대학교', department: '철학과', source_text: '' , application_text: '저는 독서 토론 동아리 활동을 했습니다.' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.school_discovery.status, 'discovery_failed');
  assert.match(r.data.school_discovery.message, /입학처 URL을 입력하거나 모집요강을 붙여넣어/);
  const p = await c(`/api/v1/profiles/${r.data.id}`);
  assert.equal(p.data.sources.length, 0);
  // 자료가 하나도 없으면 분석은 추측하지 않고 422로 안내한다.
  assert.equal((await analyze(c, r.data.id)).status, 409);
  assert.equal((await c(`/api/v1/profiles/${r.data.id}`)).data.school_analysis, null);
  assert.ok('school_analysis' in (await c(`/api/v1/profiles/${r.data.id}`)).data);
}));

test('S1 directory: only fictional schools; fixture posting_text equals directory text; GET /fixtures lists highschool/university only', () => withApp({}, async (c) => {
  assert.ok(SCHOOLS.length >= 3 && SCHOOLS.every((s) => s.label.includes('실제 학교 아님') && s.name.includes('(가상)')));
  assert.equal(SCHOOLS.filter((s) => s.kind === 'highschool').length, 1);
  assert.equal(SCHOOLS.find((s) => s.name === uni.school_name).text, uni.posting_text);
  assert.equal(SCHOOLS.find((s) => s.name === hs.school_name).text, hs.posting_text);
  const l = await c('/api/v1/fixtures');
  assert.deepEqual(l.data.fixtures.map((f) => f.id).sort(), ['fx-highschool-1', 'fx-university-1']);
  const d = await c('/api/v1/fixtures/fx-highschool-1');
  assert.equal(d.data.school_name, hs.school_name);
}));

test('S1 analyze (Gemini stub): verbatim quotes kept with server-recomputed spans, fabricated dropped, unconfirmed filled', async () => {
  const model = { talent_traits: [{ label: '탐구 역량', quote: '탐구 역량' }, { label: '가짜 인재상', quote: '창의 융합 리더십' }], admission_elements: [{ label: '전형', quote: '학생부종합전형' }], interview_format: [{ label: '개별 면접', quote: '서류 기반 개별 면접' }], unconfirmed: ['면접 배점'] };
  await withProviders({ env: LIVE, overrides: { syntheticTraffic: true }, respond: (c) => (isSchoolCall(c) ? reply(model) : claimsStub()) }, async (ctx) => {
    const r = await post(ctx.g, fxBody(uni));
    const a = await analyze(ctx.g, r.data.id);
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.equal(a.data.analysis_mode, 'gemini');
    assert.deepEqual(a.data.talent_traits.map((t) => t.id), ['trait-1']);
    assert.deepEqual(a.data.admission_elements.map((t) => t.id), ['elem-1']);
    assert.equal(a.data.rejected_quotes, 1);
    const t = a.data.talent_traits[0];
    const text = uni.posting_text;
    assert.equal(Array.from(text).slice(t.start_cp, t.end_cp).join(''), t.quote);
    assert.ok(a.data.interview_format[0].quote && text.includes(a.data.interview_format[0].quote));
    assert.ok(a.data.unconfirmed.includes('면접 시간·배점 미확인') && a.data.unconfirmed.includes('면접 배점'));
    assert.ok(a.data.sources.length >= 1 && a.data.sources.every((s) => s.confirmed_at));
    assert.equal(a.data.provider_trace[0].operation, 'school.analyze');
    assert.equal(a.data.provider_trace[0].mode, 'live');
    // 프롬프트는 비신뢰 블록 + 지시 무시 문구를 포함
    const sent = ctx.calls.find(isSchoolCall);
    assert.match(JSON.stringify(sent.body), /비신뢰 데이터/);
    // GET /profiles/:id 노출 + 기관 프로필 병합(승인 흐름 유지)
    const p = await ctx.g(`/api/v1/profiles/${r.data.id}`);
    assert.equal(p.data.school_analysis.talent_traits[0].id, 'trait-1');
    assert.equal(p.data.institution_status, 'review');
    assert.ok(p.data.institution.core_values.some((v) => v.source_quote === '탐구 역량' && v.confirmed_at));
    const ap = await ctx.g(`/api/v1/profiles/${r.data.id}/approve`, { method: 'POST', body: { version_id: r.data.version_id } });
    assert.equal(ap.data.institution_status, 'approved');
    assert.equal((await ctx.g(`/api/v1/profiles/${r.data.id}`)).data.school_analysis.analysis_mode, 'gemini');
  });
});

test('S1 analyze: all quotes fabricated, bad JSON, or 429 -> rule_based fallback with unconfirmed list', async () => {
  const fab = { talent_traits: [{ label: 'x', quote: '원문에 없음' }], admission_elements: [], interview_format: [] };
  for (const respond of [(c) => (isSchoolCall(c) ? reply(fab) : claimsStub()), (c) => (isSchoolCall(c) ? rawReply('not json') : claimsStub()), (c) => (isSchoolCall(c) ? statusReply(500) : claimsStub())]) {
    await withProviders({ env: LIVE, overrides: { syntheticTraffic: true }, respond }, async (ctx) => {
      const r = await post(ctx.g, fxBody(uni));
      const a = await analyze(ctx.g, r.data.id);
      assert.equal(a.status, 200);
      assert.equal(a.data.analysis_mode, 'rule_based');
      assert.ok(a.data.talent_traits.length >= 1, 'rule-based keywords from source text');
      assert.ok(a.data.talent_traits.every((t) => uni.posting_text.includes(t.quote)));
    });
  }
});

test('S1 analyze: school without 면접 text -> 면접 형식 미확인 (no guessing)', () => withApp({}, async (c) => {
  await c('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
  const r = await post(c, { org_type: 'university', school_name: '푸른강대학교(가상)', department: '컴퓨터공학과', application_text: '저는 코딩 동아리에서 앱을 만들었습니다.' });
  assert.equal(r.data.school_discovery.status, 'found');
  const a = await analyze(c, r.data.id);
  assert.equal(a.status, 200);
  assert.equal(a.data.analysis_mode, 'rule_based');
  assert.ok(a.data.unconfirmed.includes('면접 형식 미확인'));
  assert.equal(a.data.interview_format.length, 0);
}));

test('S1 highschool: real (non-fixture) data forced to Mock even with every ack; fixture-synthetic may call', async () => {
  await withProviders({ env: { ...LIVE, GEMINI_REAL_DATA_ACK: 'true' }, respond: (c) => (isSchoolCall(c) ? reply({ talent_traits: [{ label: '탐구', quote: '탐구 역량' }], admission_elements: [], interview_format: [] }) : claimsStub()) }, async (ctx) => {
    await ctx.g('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
    const real = await post(ctx.g, { org_type: 'highschool', school_name: '가온고등학교(가상)', department: '자연계열', source_text: '직접 붙여넣은 요강: 탐구 역량을 봅니다.', application_text: '저는 실제 학생 지원서 내용을 적었습니다.' });
    assert.equal(real.data.synthetic, false);
    const a = await analyze(ctx.g, real.data.id);
    assert.equal(a.data.analysis_mode, 'rule_based');
    assert.equal(ctx.calls.length, 0, 'real highschool data never leaves');
    // 붙여넣은 본문 override는 합성 프로필이어도 신뢰하지 않는다.
    const syn = await post(ctx.g, fxBody(hs));
    assert.equal(syn.data.synthetic, true);
    const n = ctx.calls.length;
    const o = await analyze(ctx.g, syn.data.id, { source_text: '다른 학교 실제 요강 원문: 탐구 역량 평가' });
    assert.equal(o.data.analysis_mode, 'rule_based');
    assert.equal(ctx.calls.length, n);
  });
  await withProviders({ env: LIVE, respond: (c) => (isSchoolCall(c) ? reply({ talent_traits: [{ label: '탐구 역량', quote: '탐구 역량' }], admission_elements: [], interview_format: [] }) : claimsStub()) }, async (ctx) => {
    const syn = await post(ctx.g, fxBody(hs));
    assert.equal(syn.data.synthetic, true);
    const a = await analyze(ctx.g, syn.data.id);
    assert.equal(a.data.analysis_mode, 'gemini');
    assert.equal(ctx.calls.filter(isSchoolCall).length, 1);
    // 이후 사용자가 실제 요강을 붙여넣으면 서버가 합성으로 보지 않고 외부로 보내지 않는다.
    const before = ctx.calls.length;
    const o = await analyze(ctx.g, syn.data.id, { source_text: '실제 학교 요강를 붙여넣음: 공동체 역량 평가.' });
    assert.equal(o.data.analysis_mode, 'rule_based');
    assert.equal(ctx.calls.length, before);
  });
});

test('S1 analyze: gate closed (no LIVE_ACK) -> zero calls, rule_based, trace explains', async () => {
  await withProviders({ env: {}, overrides: { syntheticTraffic: true }, respond: () => claimsStub() }, async (ctx) => {
    const r = await post(ctx.g, fxBody(uni));
    const a = await analyze(ctx.g, r.data.id);
    assert.equal(a.data.analysis_mode, 'rule_based');
    assert.equal(ctx.calls.length, 0);
    assert.equal(a.data.provider_trace[0].mode, 'blocked');
    const st = await ctx.g('/api/v1/providers/status');
    assert.ok('school.analyze' in st.data.operations);
  });
});

test('S1 delete: account deletion removes school analysis; other owner cannot analyze', () => withApp({}, async (c) => {
  const r = await post(c, fxBody(uni));
  assert.equal((await analyze(c, r.data.id)).status, 200);
  assert.equal((await analyze(c, r.data.id, {})).status, 200);
  assert.equal((await c(`/api/v1/profiles/${r.data.id}/school-analysis`, { method: 'POST', token: 'dev-user-b-token', body: {} })).status, 404);
  assert.equal((await c('/api/v1/account', { method: 'DELETE' })).status < 300, true);
  const p = await c(`/api/v1/profiles/${r.data.id}`);
  assert.ok(p.status === 404 || (p.data.school_analysis == null && p.data.institution == null));
}));
