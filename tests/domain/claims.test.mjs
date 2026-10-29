import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPLICATION } from '../helpers/fixtures.mjs';

test('P0-3: applicant claims are exact spans with gaps; non-claims are skipped', async () => {
  const { extractApplicantClaims } = await import('../../src/domain/claims.js');
  const { verifyClaimSpan } = await import('../../src/domain/pii.js');
  const claims = extractApplicantClaims(APPLICATION);
  assert.equal(claims.length, 4, claims.map((c) => c.quote).join(' | '));
  for (const c of claims) {
    assert.ok(APPLICATION.includes(c.quote), 'quote is verbatim');
    assert.ok(verifyClaimSpan(APPLICATION, c), `span valid: ${c.quote}`);
    assert.equal(c.status, 'user_supplied');
  }
  assert.deepEqual(claims[1].gaps, ['role', 'result', 'reason', 'number'], '갈등을 해결했다 — 역할·결과·근거·수치 공백');
  assert.deepEqual(claims[2].gaps, ['role', 'reason'], '수치·결과는 있으나 역할·근거 공백');
  assert.ok(!claims.some((c) => c.quote.includes('성실합니다')), '소개 문장은 주장 아님');
  assert.ok(!claims.some((c) => c.quote.includes('최고 점수')), '경험 서술이 아닌 문장은 주장 아님');
  assert.deepEqual(extractApplicantClaims('   \n  '), []);
});

test('P0-3: claim questions quote the sentence verbatim and add no new facts', async () => {
  const { extractApplicantClaims, buildClaimQuestions } = await import('../../src/domain/claims.js');
  const claims = extractApplicantClaims(APPLICATION);
  const qs = buildClaimQuestions(claims, { max: 4 });
  assert.equal(qs.length, 4);
  for (const q of qs) {
    const ev = q.application_evidence[0];
    assert.ok(q.text.includes(ev.quote), 'question embeds the exact claim sentence');
    assert.ok(q.text.startsWith('자기소개서에 “'), 'fixed template, quote cannot change policy');
    assert.equal(q.text.split(ev.quote).join('').match(/\d/g), null, 'template adds no numbers beyond the quote');
    assert.deepEqual(q.application_evidence_ids, [ev.id]);
    assert.equal(q.source_status, 'user_supplied');
    assert.equal(q.prompt_version, 'claim-probe-v1');
    assert.ok(['evidence_specificity', 'reasoning'].includes(q.primary));
  }
  assert.equal(buildClaimQuestions(claims).length, 2, 'default max is 2');
  assert.deepEqual(buildClaimQuestions([]), []);
});
