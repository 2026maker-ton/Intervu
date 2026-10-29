import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, call, cleanupAll } from '../helpers/app.mjs';
import { APPLICATION } from '../helpers/fixtures.mjs';

useSharedApp();

async function profile(token = A) {
  const pr = await call('/api/v1/profiles', { method: 'POST', token, body: { org_type: 'company', target_name: '한빛테크', role: '서비스 기획', source_text: '핵심가치: 문제 해결, 협업', application_text: APPLICATION } });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  return pr.data;
}
const approve = (p, token = A) => call(`/api/v1/profiles/${p.id}/approve`, { method: 'POST', token, body: { version_id: p.version_id } });
// 세션 질문을 읽고 바로 삭제한다(사용자당 활성 세션 1개).
const session = async (p, seed = 7) => {
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.version_id, interview_type: 'general', duration_minutes: 15, seed } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const got = await call(`/api/v1/sessions/${s.data.id}`);
  await call(`/api/v1/sessions/${s.data.id}`, { method: 'DELETE' });
  return got.data.questions;
};
const planIds = (qs) => qs.flatMap((q) => q.application_evidence_ids || []);
const sessionIds = (qs) => qs.flatMap((q) => (q.application_evidence || []).map((e) => e.id));

test('C8: claims list has gaps + excluded flag; unknown claim / other owner -> 404', async () => {
  await cleanupAll();
  const p = await profile();
  const l = await call(`/api/v1/profiles/${p.id}/claims`);
  assert.equal(l.status, 200);
  assert.equal(l.data.claims.length, 4);
  assert.ok(l.data.claims.every((c) => c.excluded === false && Array.isArray(c.gaps)));
  assert.equal((await call(`/api/v1/profiles/${p.id}/claims/claim-999`, { method: 'PATCH', body: { excluded: true } })).status, 404);
  assert.equal((await call(`/api/v1/profiles/${p.id}/claims/claim-1`, { method: 'PATCH', body: { excluded: 'yes' } })).status, 422);
  assert.equal((await call(`/api/v1/profiles/${p.id}/claims`, { token: B })).status, 404);
  assert.equal((await call(`/api/v1/profiles/${p.id}/claims/claim-1`, { method: 'PATCH', token: B, body: { excluded: true } })).status, 404);
  assert.equal((await call(`/api/v1/profiles/${p.id}/plan`, { token: B })).status, 404);
  assert.equal((await call('/api/v1/profiles/nope/plan')).status, 404);
});

test('C8: excluded claim never becomes a question; plan equals session questions', async () => {
  await cleanupAll();
  const p = await profile();
  const before = await call(`/api/v1/profiles/${p.id}/plan?duration_minutes=15&seed=7`);
  assert.equal(before.status, 200);
  const picked = planIds(before.data.questions);
  assert.equal(picked.length, 2);
  const it = before.data.questions[0];
  assert.deepEqual(Object.keys(it).sort(), ['application_evidence_ids', 'generator', 'institution_evidence_ids', 'prompt_version', 'provider_trace', 'question_id', 'source_status', 'target_competency', 'text', 'trend_ids']);
  assert.equal(it.generator, 'rule');
  const ex = await call(`/api/v1/profiles/${p.id}/claims/${picked[0]}`, { method: 'PATCH', body: { excluded: true } });
  assert.equal(ex.status, 200);
  assert.equal(ex.data.claim.excluded, true);
  assert.equal((await approve(p)).status, 200);
  const plan = await call(`/api/v1/profiles/${p.id}/plan?duration_minutes=15&seed=7`);
  assert.equal(plan.data.frozen, true);
  assert.ok(!planIds(plan.data.questions).includes(picked[0]));
  const sq = await session(p, 7);
  assert.ok(!sessionIds(sq).includes(picked[0]));
  assert.deepEqual(sq.map((q) => [q.id, q.text]), plan.data.questions.map((q) => [q.question_id, q.text]));
});

test('C8: plan is frozen at approve; later exclusions need re-approve', async () => {
  await cleanupAll();
  const p = await profile();
  assert.equal((await approve(p)).status, 200);
  const frozen = (await call(`/api/v1/profiles/${p.id}/plan?seed=7`)).data;
  const picked = planIds(frozen.questions);
  const ex = await call(`/api/v1/profiles/${p.id}/claims/${picked[0]}`, { method: 'PATCH', body: { excluded: true } });
  assert.equal(ex.data.needs_reapproval, true);
  const still = (await call(`/api/v1/profiles/${p.id}/plan?seed=7`)).data;
  assert.deepEqual(still.questions.map((q) => q.text), frozen.questions.map((q) => q.text));
  assert.ok(sessionIds(await session(p, 7)).includes(picked[0]), 'session still uses the frozen plan');
  assert.equal((await approve(p)).status, 200);
  const re = (await call(`/api/v1/profiles/${p.id}/plan?seed=7`)).data;
  assert.ok(!planIds(re.questions).includes(picked[0]));
  assert.equal((await call(`/api/v1/profiles/${p.id}/claims`)).data.needs_reapproval, false);
});
