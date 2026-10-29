import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, call, app } from '../helpers/app.mjs';
import { docx, cidPdf, scannedPdf, b64 } from '../helpers/doc-fixtures.mjs';

useSharedApp();

async function profile(token = A) {
  const r = await call('/api/v1/profiles', { method: 'POST', token, body: { org_type: 'company', target_name: '테스트기업', role: '개발' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.id || r.data.profile_id || r.data.profile?.id;
}
const up = (pid, body, token = A, headers = {}) => call(`/api/v1/profiles/${pid}/documents`, { method: 'POST', token, body, headers });

test('C1 업로드: revision 1(extracted, 마스킹) + sha256, 원본 비저장', async () => {
  const pid = await profile();
  const text = '연락처 010-1234-5678 test@example.com 에서 동아리 회장 경험';
  const r = await up(pid, { kind: 'resume', filename: 'r.docx', mime_type: 'application/octet-stream', content_base64: b64(docx(text)) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.extract_status, 'ok');
  assert.equal(r.data.revision.revision, 1);
  assert.equal(r.data.revision.origin, 'extracted');
  assert.doesNotMatch(r.data.revision.text_masked, /010-1234|example\.com/);
  assert.match(r.data.sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(app.store.getDocument(A, r.data.id)).includes(b64(docx(text)).slice(0, 40)), false);
});

test('C1 수정 → revision n+1(user_edit, 마스킹), 목록, 소유권', async () => {
  const pid = await profile();
  const d = (await up(pid, { kind: 'cover_letter', filename: 'c.txt', mime_type: 'text/plain', content_base64: b64(Buffer.from('자소서 원문 문장입니다.')) })).data;
  const e = await call(`/api/v1/documents/${d.id}`, { method: 'PATCH', body: { text: '수정본 a@b.co 포함' } });
  assert.equal(e.status, 200);
  assert.equal(e.data.revision.revision, 2);
  assert.equal(e.data.revision.origin, 'user_edit');
  assert.doesNotMatch(e.data.revision.text_masked, /a@b\.co/);
  const l = await call(`/api/v1/documents/${d.id}/revisions`);
  assert.deepEqual(l.data.revisions.map((x) => x.origin), ['extracted', 'user_edit']);
  assert.equal((await call(`/api/v1/documents/${d.id}/revisions`, { token: B })).status, 404);
  assert.equal((await call(`/api/v1/documents/${d.id}`, { method: 'PATCH', token: B, body: { text: 'x y z w' } })).status, 404);
  assert.equal((await up(pid, { kind: 'other', filename: 'c.txt', content_base64: b64(Buffer.from('abcdef')) }, B)).status, 404);
  assert.equal((await call(`/api/v1/documents/${d.id}`, { method: 'PATCH', body: { text: '  ' } })).status, 422);
});

test('C1 실패 문서는 상태·코드 기록(스캔·CID), kind 검증, 후속 붙여넣기로 revision 1', async () => {
  const pid = await profile();
  const bad = await up(pid, { kind: 'diary', filename: 'a.txt', content_base64: b64(Buffer.from('abcdef')) });
  assert.equal(bad.status, 422);
  const cid = await up(pid, { kind: 'resume', filename: 'a.pdf', mime_type: 'application/pdf', content_base64: b64(cidPdf()) });
  assert.equal(cid.status, 201);
  assert.equal(cid.data.extract_status, 'unsupported');
  assert.equal(cid.data.failure_code, 'unsupported_font_encoding');
  assert.equal(cid.data.revision, null);
  const sc = await up(pid, { kind: 'resume', filename: 's.pdf', content_base64: b64(scannedPdf()) });
  assert.equal(sc.data.extract_status, 'scanned');
  const fix = await call(`/api/v1/documents/${cid.data.id}`, { method: 'PATCH', body: { text: '직접 붙여넣은 이력서 내용' } });
  assert.equal(fix.data.revision.revision, 1);
});

test('C1 계정 삭제는 문서·revision을 파기', async () => {
  const pid = await profile(B);
  const d = (await up(pid, { kind: 'posting', filename: 'p.txt', content_base64: b64(Buffer.from('공고 본문 내용입니다')) }, B)).data;
  assert.equal((await call('/api/v1/account', { method: 'DELETE', token: B })).status, 202);
  assert.equal(app.store.getDocument(B, d.id), null);
  assert.equal(app.store.getDocumentRevisions(B, d.id), null);
});

test('C1 BUG-9: 약 4MB 파일은 업로드 가능, 5MB 초과는 413, 다른 경로는 1MB 유지', async () => {
  const pid = await profile();
  const big = Buffer.concat([Buffer.from('긴 텍스트 문서 '), Buffer.alloc(4 * 1024 * 1024, 0x61)]);
  const ok = await up(pid, { kind: 'other', filename: 'big.txt', mime_type: 'text/plain', content_base64: b64(big) });
  assert.equal(ok.status, 201, JSON.stringify(ok.data).slice(0, 200));
  assert.equal(ok.data.truncated, true);
  const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
  assert.equal((await up(pid, { kind: 'other', filename: 'h.txt', content_base64: b64(huge) })).status, 413);
  const legacy = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'big.txt', mime_type: 'text/plain', content_base64: b64(big) } });
  assert.equal(legacy.status, 200);
  // 소켓 대신 핸들러 직접 호출(어댑터의 413 연결 정리와 무관하게 한도만 검증)
  const other = await app.fetch(new Request('http://x/api/v1/profiles', { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' }, body: JSON.stringify({ org_type: 'company', target_name: 'x'.repeat(1_100_000) }) }));
  assert.equal(other.status, 413);
});
