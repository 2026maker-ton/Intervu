// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { validateDocument, extractDocumentText } from '../../domain/documents.js';

export function createDocumentHandlers(d) {
  const { err } = d;
  function extractDocument(owner, body) {
    void owner;
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
    const out = extractDocumentText({ ext: v.ext, buffer });
    if (!out.ok) return err('validation_error', out.message, 422, { details: { code: out.code } });
    return { status: 200, body: { filename: filename.slice(0, 100), ext: v.ext, char_count: out.char_count, truncated: out.truncated, warnings: out.warnings, text: out.text, note: '서버에서 추출한 텍스트입니다. 제출 전 확인·수정하세요. 원문 파일은 저장하지 않습니다.' } };
  }

  return { extractDocument };
}
