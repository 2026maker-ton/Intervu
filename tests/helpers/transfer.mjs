// 전이 작업·내보내기 캐시를 만드는 공용 시나리오 헬퍼 (삭제 완전성 시험용)
import assert from 'node:assert/strict';
import { call, newSession } from './app.mjs';

export async function makeTransferJob(token) {
  const s = await newSession(token);
  let version = s.version;
  for (const text of ['제가 직접 일정을 조정했고 결과적으로 기한 안에 제출했습니다.', '대안을 비교한 기준은 비용이었고 그 이유는 예산 때문이었습니다.']) {
    const r = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', token, body: { command_id: crypto.randomUUID(), expected_version: version, type: 'turn.text', payload: { text } } });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    version = r.data.version;
    if (r.data.state === 'completed') break;
  }
  await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', token, body: { command_id: crypto.randomUUID(), expected_version: version, type: 'session.finish', payload: {} } });
  const rep = await call(`/api/v1/sessions/${s.id}/report`, { token });
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  const p = await call('/api/v1/practice-attempts', { method: 'POST', token, body: { evaluation_id: rep.data.evaluation_id, competency_id: 'reasoning' } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const job = await call(`/api/v1/transfer-comparisons/${p.data.transfer_id}`, { token });
  assert.equal(job.status, 200);
  assert.ok(job.data.baseline.excerpt, 'baseline excerpt stored before deletion');
  const exp = await call('/api/v1/exports', { method: 'POST', token, body: { session_id: s.id } });
  assert.equal(exp.status, 202, JSON.stringify(exp.data));
  assert.equal((await call(exp.data.download_url, { token })).status, 200);
  return { baselineId: s.id, retryId: p.data.id, transferId: p.data.transfer_id, exportUrl: exp.data.download_url };
}
