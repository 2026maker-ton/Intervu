// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { sha256Hex } from '../crypto.js';
import { maskPii } from '../../domain/pii.js';
import { validateDocument, extractDocumentText } from '../../domain/documents.js';

export function createDocumentHandlers(d) {
  const { err, store, checkRate } = d;
  async function extractDocument(owner, body) {
    const limited = checkRate(owner, 'documents');
    if (limited) return limited;
    const filename = String(body.filename || '');
    const mimeType = String(body.mime_type || body.mimeType || '');
    const b64 = String(body.content_base64 || '');
    if (!b64) return err('validation_error', 'content_base64가 필요합니다.', 422);
    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      return err('validation_error', 'base64를 해석하지 못했습니다.', 422);
    }
    const v = validateDocument({ filename, mimeType, bytes: buffer.length });
    if (!v.ok) return err(v.code === 'oversized_document' ? 'payload_too_large' : 'validation_error', v.message, v.code === 'oversized_document' ? 413 : 422);
    const out = await extractDocumentText({ ext: v.ext, buffer });
    if (!out.ok) return err('validation_error', out.message, 422, { details: { code: out.code } });
    return { status: 200, body: { filename: filename.slice(0, 100), ext: v.ext, char_count: out.char_count, truncated: out.truncated, warnings: out.warnings, text: out.text, note: '서버에서 추출한 텍스트입니다. 제출 전 확인·수정하세요. 원문 파일은 저장하지 않습니다.' } };
  }

  const KINDS = ['posting', 'cover_letter', 'resume', 'other'];
  const MAX_DOCS_PER_PROFILE = 20;
  const STATUS = { non_extractable_scanned: 'scanned', unsupported_font_encoding: 'unsupported' };
  const publicDoc = (doc, revision, extra = {}) => ({ id: doc.id, profile_id: doc.profile_id, kind: doc.kind, filename: doc.filename, sha256: doc.sha256, extract_status: doc.extract_status, failure_code: doc.failure_code, created_at: doc.created_at, revision, ...extra });

  // 업로드 → 서버 추출 → 마스킹본 revision 1. 원본 바이너리는 저장하지 않고 sha256만 남긴다.
  async function uploadDocument(owner, profileId, body) {
    if (!store.getProfile(owner, profileId)) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const kind = String(body.kind || '');
    if (!KINDS.includes(kind)) return err('validation_error', `kind는 ${KINDS.join('|')} 중 하나여야 합니다.`, 422);
    if (store.listDocuments(owner, profileId).length >= MAX_DOCS_PER_PROFILE) return err('quota_exceeded', `프로필당 문서는 ${MAX_DOCS_PER_PROFILE}개까지입니다.`, 429);
    const filename = String(body.filename || '').slice(0, 100);
    const b64 = String(body.content_base64 || '');
    if (!b64) return err('validation_error', 'content_base64가 필요합니다.', 422);
    const buffer = Buffer.from(b64, 'base64');
    const v = validateDocument({ filename, mimeType: String(body.mime_type || ''), bytes: buffer.length });
    if (!v.ok) return err(v.code === 'oversized_document' ? 'payload_too_large' : 'validation_error', v.message, v.code === 'oversized_document' ? 413 : 422, { details: { code: v.code } });
    const sha256 = await sha256Hex(new Uint8Array(buffer));
    const out = await extractDocumentText({ ext: v.ext, buffer });
    const doc = store.createDocument(owner, {
      profile_id: profileId, kind, filename, sha256,
      extract_status: out.ok ? 'ok' : (STATUS[out.code] || 'failed'), failure_code: out.ok ? null : out.code,
    });
    const rev = out.ok ? store.addDocumentRevision(owner, doc.id, { text_masked: maskPii(out.text).normalize('NFC'), origin: 'extracted' }) : null;
    return { status: 201, body: publicDoc(doc, rev, out.ok
      ? { truncated: out.truncated, warnings: out.warnings, note: '개인정보(이메일·전화·주민번호)는 마스킹해 저장합니다. 원문 파일은 저장하지 않습니다. 제출 전 확인·수정하세요.' }
      : { message: out.message }) };
  }

  function editDocument(owner, id, body) {
    const doc = store.getDocument(owner, id);
    if (!doc) return err('not_found', '문서를 찾을 수 없습니다.', 404);
    const text = typeof body.text === 'string' ? body.text.normalize('NFC').trim() : '';
    if (!text) return err('validation_error', 'text가 필요합니다.', 422);
    if ([...text].length > 20000) return err('validation_error', '문서 본문은 20,000자 이하여야 합니다.', 422);
    const rev = store.addDocumentRevision(owner, id, { text_masked: maskPii(text), origin: 'user_edit' });
    return { status: 200, body: publicDoc(doc, rev) };
  }

  function listRevisions(owner, id) {
    const revisions = store.getDocumentRevisions(owner, id);
    if (!revisions) return err('not_found', '문서를 찾을 수 없습니다.', 404);
    return { status: 200, body: { document_id: id, revisions } };
  }

  return { extractDocument, uploadDocument, editDocument, listRevisions };
}
