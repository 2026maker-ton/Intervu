import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';
import { withGeminiStub, FORGED, REAL_TEXT, runForgedFlow } from '../helpers/stub-fetch.mjs';
import { APPLICATION } from '../helpers/fixtures.mjs';

useSharedApp();

test('P0-3: profile → approved session asks claim questions first; report links claim to answer', async () => {
  await cleanupAll();
  const pr = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', target_name: '한빛테크', role: '서비스 기획', source_text: '핵심가치: 문제 해결, 협업', application_text: APPLICATION } });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  assert.equal(pr.data.applicant_claims_count, 4);
  const detail = await call(`/api/v1/profiles/${pr.data.id}`);
  assert.equal(detail.data.current_version.extracted.applicant_claims.length, 4);
  assert.equal((await call(`/api/v1/profiles/${pr.data.id}/approve`, { method: 'POST', body: { version_id: pr.data.version_id } })).status, 200);
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: pr.data.version_id, interview_type: 'general', duration_minutes: 10 } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.match(s.data.question_basis, /^지원서 주장 검증 2건/);
  const got = await call(`/api/v1/sessions/${s.data.id}`);
  const [q1, q2] = got.data.questions;
  for (const q of [q1, q2]) {
    assert.ok(q.application_evidence?.length === 1, 'claim question carries evidence');
    assert.ok(APPLICATION.includes(q.application_evidence[0].quote));
    assert.equal(q.source_status, 'user_supplied');
  }
  const st = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  assert.equal(st.data.question.id, q1.id);
  const r = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: st.data.version, type: 'turn.text', payload: { text: '제가 직접 행사 일정과 예산을 맡았고, 결과적으로 참가자가 늘었습니다.' } } });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: r.data.version, type: 'session.finish', payload: {} } });
  const rep = await call(`/api/v1/sessions/${s.data.id}/report`);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  assert.equal(rep.data.claim_links.length, 2);
  const l1 = rep.data.claim_links.find((l) => l.question_id === q1.id);
  assert.equal(l1.answered, true);
  assert.match(l1.answers[0].excerpt, /행사 일정/);
  assert.equal(l1.quote, q1.application_evidence[0].quote);
  assert.equal(rep.data.claim_links.find((l) => l.question_id === q2.id).answered, false);
});

test('P0-3: without application text the question set has no claim questions', async () => {
  await cleanupAll();
  const pr = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', role: '기획', source_text: '핵심가치: 문제 해결' } });
  assert.equal(pr.data.applicant_claims_count, 0);
  await call(`/api/v1/profiles/${pr.data.id}/approve`, { method: 'POST', body: { version_id: pr.data.version_id } });
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: pr.data.version_id, interview_type: 'general', duration_minutes: 10 } });
  assert.ok(!/지원서 주장/.test(s.data.question_basis));
  const got = await call(`/api/v1/sessions/${s.data.id}`);
  assert.ok(got.data.questions.every((q) => !q.application_evidence));
});

test('P0-3: application text is stored masked, size-limited and wiped on account deletion', async () => {
  const pr = await call('/api/v1/profiles', { method: 'POST', token: B, body: { org_type: 'university', role: '경영학과', application_text: '저는 학생회 부회장을 맡아 행사를 운영했습니다. 연락처는 010-1234-5678 입니다.' } });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  assert.ok(pr.data.pii_warnings.includes('phone'));
  const got = await call(`/api/v1/profiles/${pr.data.id}`, { token: B });
  assert.ok(got.data.application_text.includes('[전화번호]'));
  assert.ok(!got.data.application_text.includes('010-1234'));
  const tooLong = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', role: '기획', application_text: '가'.repeat(20001) } });
  assert.equal(tooLong.status, 422);
  await call('/api/v1/account', { method: 'DELETE', token: B });
  const after = await call(`/api/v1/profiles/${pr.data.id}`, { token: B });
  assert.equal(after.data.application_text, '[삭제됨]');
});

test('P0-3: applicant text is never sent to Gemini even when the provider gate is open', async () => {
  await withGeminiStub({ GEMINI_PAID_ACK: 'true' }, {}, async ({ gcall, outbound }) => {
    const pr = await gcall('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', role: '기획', source_text: '핵심가치: 문제 해결, 협업 인재상', application_text: '저는 유니크마커프로젝트를 담당해 운영했습니다.' } });
    assert.equal(pr.status, 201, JSON.stringify(pr.data));
    assert.equal(pr.data.applicant_claims_count, 1);
    assert.equal(outbound.length, 1, 'only the posting text is extracted by the model');
    assert.ok(outbound[0].includes('인재상'));
    assert.ok(!outbound.join('').includes('유니크마커'), 'applicant text stays server-side in this slice');
  });
});
