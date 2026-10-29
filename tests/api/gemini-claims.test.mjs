// Gemini 지원서 주장 추출(무료 키 데모용): Claude 어댑터와 같은 계약. 스텁 fetch·가짜 키만 사용(실호출 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withProviders, statusReply, rawReply } from '../helpers/provider-stub.mjs';
import { extractApplicantClaims } from '../../src/domain/claims.js';

const LIVE = { GEMINI_LIVE_ACK: 'true' };
const syn = { syntheticTraffic: true };
const S1 = '저는 동아리 앱 개발 프로젝트에서 팀장을 맡아 일정을 조율했습니다.';
const S2 = '이 과정에서 로그인 오류를 해결하기 위해 직접 테스트 코드를 작성했습니다.';
const EXTRA = '동아리에서 신입 부원 교육 자료를 직접 만들어 배포한 경험이 있습니다.';
const APP = `${S1} ${S2} ${EXTRA} 연락처는 010-1234-5678, dev.person@example.com 입니다.`;
const isApplicantCall = (c) => JSON.stringify(c.body).includes('APPLICANT_TEXT_UNTRUSTED');
const post = (ctx, application_text = APP) => ctx.g('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', role: 'PM', source_text: '문제 해결 협업', application_text } });
const claimsReply = (quotes) => rawReply(JSON.stringify({ claims: quotes.map((quote) => ({ quote })) }));
const postingReply = () => rawReply(JSON.stringify({ claims: [{ kind: 'competency', value: '문제 해결' }], missing_fields: [] }));

test('Gemini claims: verbatim model quote accepted, fabricated discarded, masked text only', async () => {
  const respond = (c) => (isApplicantCall(c) ? claimsReply([EXTRA, '원문에 없는 가짜 성과 문장 매출 300퍼센트 달성', S1]) : postingReply());
  await withProviders({ env: LIVE, overrides: syn, respond }, async (ctx) => {
    const r = await post(ctx);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.ok(r.data.provider_trace.some((t) => t.operation === 'claims.extract' && t.provider === 'gemini' && t.mode === 'live'));
    const p = await ctx.g(`/api/v1/profiles/${r.data.id}`);
    const claims = p.data.current_version.extracted.applicant_claims;
    assert.ok(claims.some((c) => c.quote === EXTRA), 'verbatim model quote accepted');
    assert.ok(!claims.some((c) => c.quote.includes('가짜')), 'fabricated quote discarded');
    assert.equal(p.data.current_version.extracted.rejected_model_quotes, 2, "fabricated + duplicate of a rule claim");
    assert.ok(extractApplicantClaims(APP).every((rc) => claims.some((c) => c.quote === rc.quote)), 'rule results are the floor');
    const out = JSON.stringify(ctx.calls.map((c) => c.body));
    assert.ok(!out.includes('010-1234-5678') && !out.includes('dev.person@example.com'), 'only masked text leaves the server');
  });
});

test('Gemini claims: gate closed (no LIVE_ACK) -> zero outbound calls, rule claims remain', async () => {
  await withProviders({ env: {}, overrides: syn, respond: () => postingReply() }, async (ctx) => {
    const r = await post(ctx);
    assert.equal(r.status, 201);
    assert.equal(ctx.calls.length, 0);
    assert.equal(r.data.applicant_claims_count, extractApplicantClaims(APP).length);
  });
});

test('Gemini claims: non-synthetic data never reaches the model even with LIVE_ACK', async () => {
  await withProviders({ env: LIVE, respond: () => postingReply() }, async (ctx) => {
    const r = await post(ctx);
    assert.equal(r.status, 201);
    assert.equal(ctx.calls.length, 0, 'real (non-fixture) data stays local');
  });
});

test('Gemini claims: 429 falls back to rule claims with a fallback trace', async () => {
  const respond = (c) => (isApplicantCall(c) ? statusReply(429, { 'retry-after': '0.01' }) : postingReply());
  await withProviders({ env: LIVE, overrides: syn, respond }, async (ctx) => {
    const r = await post(ctx);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.applicant_claims_count, extractApplicantClaims(APP).length);
    assert.ok(r.data.provider_trace.some((t) => t.mode === 'fallback'));
  });
});
