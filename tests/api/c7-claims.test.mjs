import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, call, cleanupAll } from '../helpers/app.mjs';
import { verifyClaimSpan } from '../../src/domain/pii.js';

useSharedApp();

const COVER = '동아리 회장으로서 신입 부원 모집 캠페인을 기획하고 운영했습니다.';
const RESUME = '경력\n- 앱 로그인 기능 개발 담당\n- 영어 회화 가능\n1. 일정 조율 주도';

async function setup() {
  await cleanupAll();
  const pr = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', target_name: '한빛테크', role: '개발', source_text: '핵심가치: 문제 해결', application_text: '학교 축제에서 부스 운영을 총괄하며 팀원 8명의 일정을 조율하였습니다.' } });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  return pr.data;
}
const upload = (pid, kind, text) => call(`/api/v1/profiles/${pid}/documents`, { method: 'POST', body: { kind, filename: `${kind}.txt`, mime_type: 'text/plain', content_base64: Buffer.from(text, 'utf8').toString('base64') } });

test('C7: 문서별 주장 — document_id·revision, span은 해당 문서 revision 텍스트 기준, id 유일', async () => {
  const p = await setup();
  const cl = await upload(p.id, 'cover_letter', COVER);
  const rs = await upload(p.id, 'resume', RESUME);
  assert.equal(cl.status, 201); assert.equal(rs.status, 201);
  const l = await call(`/api/v1/profiles/${p.id}/claims`);
  const claims = l.data.claims;
  assert.equal(new Set(claims.map((c) => c.id)).size, claims.length);
  const fromCl = claims.find((c) => c.document_id === cl.data.id);
  assert.ok(fromCl && fromCl.revision === 1 && fromCl.quote.startsWith('동아리 회장'));
  const resumeClaims = claims.filter((c) => c.document_id === rs.data.id);
  assert.ok(resumeClaims.some((c) => c.quote.startsWith('- 앱 로그인')), 'short resume bullet is a claim');
  assert.ok(!resumeClaims.some((c) => c.quote.includes('영어 회화')));
  assert.ok(claims.some((c) => !c.document_id), 'application_text claims are kept');
  for (const c of resumeClaims) {
    const text = (await call(`/api/v1/documents/${rs.data.id}/revisions`)).data.revisions.at(-1).text_masked;
    assert.ok(verifyClaimSpan(text, c));
    assert.ok(c.gaps.length > 0);
  }
});

test('C7: 문서 수정 시 최신 revision 기준으로 다시 계산, 제외 id 정리', async () => {
  const p = await setup();
  const cl = await upload(p.id, 'cover_letter', COVER);
  await call(`/api/v1/documents/${cl.data.id}`, { method: 'PATCH', body: { text: '재고 관리 시스템을 도입해 발주 오류를 줄였습니다.' } });
  const l = await call(`/api/v1/profiles/${p.id}/claims`);
  const c = l.data.claims.find((x) => x.document_id === cl.data.id);
  assert.equal(c.revision, 2);
  assert.ok(c.quote.startsWith('재고 관리'));
});

test('C7: panel·technical 세션도 주장 질문을 앞에 두고 질문 수는 그대로', async () => {
  const p = await setup();
  await upload(p.id, 'cover_letter', COVER);
  await call(`/api/v1/profiles/${p.id}/approve`, { method: 'POST', body: { version_id: p.version_id } });
  for (const type of ['panel', 'technical']) {
    const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.version_id, interview_type: type, duration_minutes: 10, seed: 3 } });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    const got = await call(`/api/v1/sessions/${s.data.id}`);
    const qs = got.data.questions;
    assert.ok(qs[0].application_evidence?.[0]?.quote, `${type} first question quotes a claim`);
    assert.equal(qs.length, 4, `${type} count unchanged`);
    await call(`/api/v1/sessions/${s.data.id}`, { method: 'DELETE' });
  }
});
