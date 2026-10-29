// 면접 유형 테스트 공용 시나리오 헬퍼
import assert from 'node:assert/strict';
import { call, cleanupAll } from './app.mjs';

export async function startTyped(body) {
  await cleanupAll();
  const s = await call('/api/v1/sessions', { method: 'POST', body });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const st = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  assert.equal(st.status, 202, JSON.stringify(st.data));
  return { s: s.data, start: st.data, version: st.data.version };
}

export async function say(sid, version, text) {
  const r = await call(`/api/v1/sessions/${sid}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'turn.text', payload: { text } } });
  return r;
}

export async function finishAndReport(sid, version) {
  await call(`/api/v1/sessions/${sid}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'session.finish', payload: {} } });
  return call(`/api/v1/sessions/${sid}/report`);
}

export const GOOD_ANSWER = '제가 예산과 인력을 먼저 표로 정리했습니다. 근거는 지난 3개월 관찰 기록이었고, 그 결과 주말 이용자가 늘었습니다. 다음에는 확인 주기를 먼저 합의하겠습니다.';
