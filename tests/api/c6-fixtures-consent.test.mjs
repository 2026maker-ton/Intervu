// WP-C6: 합성 fixture + 동의 API + 서버측 합성 판정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp, A, B } from '../helpers/app.mjs';
import { FIXTURES, isSyntheticText, isSyntheticTurn } from '../../src/domain/fixtures.js';

const fx = FIXTURES[0];
const fxBody = (extra = {}) => ({ org_type: 'company', target_name: '새벽물류', role: '기획', source_text: fx.posting_text, application_text: fx.application_text, fixture_id: fx.id, ...extra });
const real = { org_type: 'company', role: 'PM', source_text: '문제 해결 협업 인재상', application_text: '저는 프로젝트를 맡아 운영했습니다.' };
const P = (c, body, token = A) => c('/api/v1/profiles', { method: 'POST', token, body, noConsent: true });

test('C6: profile without consent and without fixture -> 428 consent_required', () => withApp({}, async (c) => {
  const r = await P(c, real);
  assert.equal(r.status, 428);
  assert.equal(r.data.code, 'consent_required');
}));

test('C6: consent is validated and stored with notice_version; profile then ok', () => withApp({}, async (c) => {
  assert.equal((await c('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: false, notice_version: 'v1' } })).status, 422);
  assert.equal((await c('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true } })).status, 422);
  const ok = await c('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.notice_version, 'v1');
  assert.equal(ok.data.age_19_confirmed, true);
  assert.equal((await P(c, real)).status, 201);
  assert.equal((await P(c, real, B)).status, 428); // 동의는 소유자별
}));

test('C6: matching fixture needs no consent and is judged synthetic by the server', () => withApp({}, async (c) => {
  const r = await P(c, fxBody());
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.synthetic, true);
  assert.ok(r.data.applicant_claims_count >= 1);
}));

test('C6: mismatching fixture text is non-synthetic (428 without consent, synthetic=false with)', () => withApp({}, async (c) => {
  const bad = fxBody({ application_text: fx.application_text + ' 저는 실제 지원서를 덧붙였습니다.' });
  assert.equal((await P(c, bad)).status, 428);
  await c('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
  const r = await P(c, bad);
  assert.equal(r.status, 201);
  assert.equal(r.data.synthetic, false);
  assert.equal((await P(c, fxBody({ fixture_id: 'nope' }))).data.synthetic, false);
}));

test('C6: whitespace-only differences still match; DEMO_FIXTURES=off disables synthetic path', async () => {
  await withApp({}, async (c) => {
    const r = await P(c, fxBody({ application_text: `  ${fx.application_text.replace(/ /g, '  ')} \n` }));
    assert.equal(r.status, 201);
    assert.equal(r.data.synthetic, true);
  });
  await withApp({ DEMO_FIXTURES: 'off' }, async (c) => {
    assert.equal((await P(c, fxBody())).status, 428);
    assert.equal((await c('/api/v1/fixtures')).status, 404);
  });
});

test('C6: forged synthetic/free_test flags are ignored', () => withApp({}, async (c) => {
  const forged = { synthetic: true, _synthetic: true, _synthetic_fixture: true, free_test: true };
  assert.equal((await P(c, { ...real, ...forged })).status, 428);
  await c('/api/v1/consents', { method: 'POST', body: { age_19_confirmed: true, notice_version: 'v1' } });
  assert.equal((await P(c, { ...real, ...forged })).data.synthetic, false);
  assert.equal((await P(c, { ...fxBody({ application_text: '다른 글' }), ...forged })).data.synthetic, false);
}));

test('C6: fixtures list/detail require auth and expose fictional content only', () => withApp({}, async (c) => {
  assert.equal((await c('/api/v1/fixtures', { token: null })).status, 401);
  assert.equal((await c('/api/v1/fixtures', { token: 'nope' })).status, 401);
  const l = await c('/api/v1/fixtures');
  assert.equal(l.status, 200);
  assert.deepEqual(l.data.fixtures.map((f) => f.kind).sort(), ['highschool', 'university']); // company는 레거시: 목록에서 숨기고 id로만 조회
  assert.equal((await c('/api/v1/fixtures/fx-company-1')).status, 200);
  assert.ok(!('application_text' in l.data.fixtures[0]));
  const d = await c(`/api/v1/fixtures/${fx.id}`);
  assert.equal(d.status, 200);
  assert.equal(d.data.application_text, fx.application_text);
  assert.ok(d.data.answers.length >= 2);
  assert.equal((await c('/api/v1/fixtures/zzz')).status, 404);
}));

test('C6: turn is synthetic only when text equals a fixture sample answer', () => withApp({}, async (c) => {
  assert.equal(isSyntheticText(fx.answers[0]), true);
  assert.equal(isSyntheticText(`  ${fx.answers[0]} `), true);
  assert.equal(isSyntheticText(fx.answers[0] + ' 추가'), false);
  const { createStore } = await import('../../src/store/index.js');
  const st = createStore();
  const t1 = st.createTurn('s1', {}); st.addRevision(t1.id, fx.answers[0]);
  const t2 = st.createTurn('s1', {}); st.addRevision(t2.id, '직접 쓴 답변입니다.');
  assert.equal(isSyntheticTurn(st, t1.id), true);
  assert.equal(isSyntheticTurn(st, t2.id), false);
}));
