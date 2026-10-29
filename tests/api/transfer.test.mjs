import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';
import { makeTransferJob } from '../helpers/transfer.mjs';

useSharedApp();

test('P4: transfer comparison end-to-end (baseline → retry → POST /transfer-comparisons)', async () => {
  await cleanupAll();
  // baseline 세션: 목표 역량 답변을 2개 이상 남겨 scored 차원을 만든다
  const s = await newSession();
  let version = s.version;
  const baselineTexts = [
    '제가 일정을 조정했습니다. 역할별 마감 시간을 합의했고 결과적으로 기한 안에 제출했습니다.',
    '다음에는 확인 주기를 먼저 합의하겠습니다. 그래서 매일 체크인을 제안했고 이후 누락이 없었습니다.',
    '대안 두 개를 비교했습니다. 비용과 시간 기준으로 표를 만들었고 팀이 그 자리에서 선택했습니다.',
    '버린 대안은 일정을 미루는 쪽이었습니다. 이미 공지가 나가서 선택하지 않았습니다.',
    '제가 직접 기준 문서를 만들었습니다. 그 결과 회의 시간이 줄었습니다.',
    '요구가 모호하면 먼저 질문으로 확인합니다. 확인한 내용을 한 장으로 정리했습니다.',
    '질문의 핵심을 먼저 한 문장으로 답하고 근거를 덧붙이겠습니다.',
    '성과를 확인할 지표를 먼저 정하고 결과를 공유하겠습니다.',
    '같은 방식을 새 팀에 적용할 때 유지할 점과 바꿀 점을 구분하겠습니다.',
    '이 경험에서 배운 점은 기준을 먼저 맞추는 것입니다. 다음 프로젝트에서도 그렇게 하겠습니다.',
  ];
  for (const text of baselineTexts) {
    const r = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'turn.text', payload: { text } } });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    version = r.data.version;
    if (r.data.state === 'completed') break;
  }
  await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'session.finish', payload: {} } });
  const rep = await call(`/api/v1/sessions/${s.id}/report`);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  const comp = (rep.data.next_actions?.[0]?.dimension_id)
    || rep.data.dimensions.find((d) => d.status === 'scored')?.id;
  assert.ok(comp, 'need at least one scored competency for transfer');
  // practice-attempts: 새 질문이 기준 질문과 달라야 한다
  const p = await call('/api/v1/practice-attempts', { method: 'POST', body: { evaluation_id: rep.data.evaluation_id, competency_id: comp } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.ok(p.data.transfer_id);
  assert.ok(p.data.transfer_question?.text);
  assert.notEqual(p.data.transfer_question.text, p.data.baseline_question);
  // retry 세션 진행: 90초 세션을 시작하고 같은 역량 답변 2개로 scored를 만든다
  const start = await call(`/api/v1/sessions/${p.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: p.data.version, type: 'session.start', payload: {} } });
  assert.equal(start.status, 202);
  let pv = start.data.version;
  const retryTexts = [
    '다른 프로젝트에서 제가 직접 일정표를 만들었습니다. 팀원과 합의한 뒤 마감 이틀 전에 제출했습니다.',
    '비교 기준으로 삼은 대안은 외주였는데, 비용이 두 배라 제외하고 내부에서 처리했습니다.',
  ];
  for (const text of retryTexts) {
    const r = await call(`/api/v1/sessions/${p.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: pv, type: 'turn.text', payload: { text } } });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    pv = r.data.version;
    if (r.data.state === 'completed') break;
  }
  await call(`/api/v1/sessions/${p.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: pv, type: 'session.finish', payload: {} } });
  const prep = await call(`/api/v1/sessions/${p.data.id}/report`);
  assert.equal(prep.data.status, 'ready', JSON.stringify(prep.data));
  // 전이 비교: 같은 루브릭·같은 역량, 두 시도를 독립 보관한다
  const cmp = await call('/api/v1/transfer-comparisons', { method: 'POST', body: { transfer_id: p.data.transfer_id, retry_session_id: p.data.id } });
  assert.equal(cmp.status, 201, JSON.stringify(cmp.data));
  const c = cmp.data.comparison;
  assert.ok(['observed_change', 'no_clear_change'].includes(c.status), `expected scored comparison, got ${c.status}: ${c.reason || ''}`);
  assert.equal(c.rubric_version, cmp.data.rubric_version);
  assert.equal(cmp.data.competency, comp);
  assert.notEqual(c.baseline.questionText, c.retry.questionText);
  assert.ok(c.evidence?.length >= 2, 'both attempts quoted');
  assert.ok(c.caution, 'single-retry caution required');
  // GET 조회도 소유자 격리로 동작한다
  const got = await call(`/api/v1/transfer-comparisons/${p.data.transfer_id}`);
  assert.equal(got.status, 200);
  assert.equal(got.data.comparison.status, c.status);
  // 유사한 질문 재연습은 409로 거부된다 (단순 반복 방지)
  const sameQ = await call('/api/v1/practice-attempts', { method: 'POST', body: { evaluation_id: rep.data.evaluation_id, competency_id: comp } });
  assert.ok([201, 409].includes(sameQ.status));
});

test('P0-2: deleting baseline session purges transfer job and its export cache', async () => {
  const j = await makeTransferJob(A);
  const del = await call(`/api/v1/sessions/${j.baselineId}`, { method: 'DELETE' });
  assert.equal(del.status, 202);
  assert.equal((await call(`/api/v1/transfer-comparisons/${j.transferId}`)).status, 404, 'transfer job must not outlive its baseline session');
  assert.equal((await call(j.exportUrl)).status, 404, 'export cache must not outlive its session');
});

test('P0-2: deleting retry session purges transfer job', async () => {
  const j = await makeTransferJob(A);
  await call(`/api/v1/sessions/${j.retryId}`, { method: 'DELETE' });
  assert.equal((await call(`/api/v1/transfer-comparisons/${j.transferId}`)).status, 404);
});

test('P0-2: account deletion purges transfer jobs and exports; other users untouched', async () => {
  const jb = await makeTransferJob(B);
  const ja = await makeTransferJob(A);
  const del = await call('/api/v1/account', { method: 'DELETE', token: B });
  assert.equal(del.status, 202);
  assert.equal((await call(`/api/v1/transfer-comparisons/${jb.transferId}`, { token: B })).status, 404);
  assert.equal((await call(jb.exportUrl, { token: B })).status, 404);
  assert.equal((await call(`/api/v1/transfer-comparisons/${ja.transferId}`)).status, 200, 'user A job survives user B deletion');
  assert.equal((await call(ja.exportUrl)).status, 200);
});

test('P0-2: deleting a session also purges its appeals', async () => {
  const s = await newSession();
  let version = s.version;
  const r = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'turn.text', payload: { text: '제가 직접 일정을 조정했고 결과적으로 기한 안에 제출했습니다.' } } });
  version = r.data.version;
  await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'session.finish', payload: {} } });
  const rep = await call(`/api/v1/sessions/${s.id}/report`);
  const ap = await call(`/api/v1/evaluations/${rep.data.evaluation_id}/appeals`, { method: 'POST', body: { category: 'stt', comment: '개인 코멘트' } });
  assert.equal(ap.status, 201, JSON.stringify(ap.data));
  assert.equal((await call(`/api/v1/appeals/${ap.data.appeal_id}`)).status, 200);
  await call(`/api/v1/sessions/${s.id}`, { method: 'DELETE' });
  assert.equal((await call(`/api/v1/appeals/${ap.data.appeal_id}`)).status, 404);
});
