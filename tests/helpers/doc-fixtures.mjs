// 합성 문서 픽스처(프로그램 생성). 실제 개인 문서 없음.
import { deflateRawSync, deflateSync } from 'node:zlib';

export function docx(text) {
  const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`, 'utf8');
  const comp = deflateRawSync(xml);
  const name = Buffer.from('word/document.xml', 'utf8');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
  head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(xml.length, 22); head.writeUInt16LE(name.length, 26);
  return Buffer.concat([head, name, comp]);
}

export function textPdf(text, { flate = false } = {}) {
  const content = `BT /F1 12 Tf (${text}) Tj ET`;
  if (!flate) return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer`, 'utf8');
  const comp = deflateSync(Buffer.from(content, 'utf8'));
  return Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`), comp, Buffer.from('\nendstream\nendobj\ntrailer')]);
}

// 글리프 ID만 있는 CID(Type0/Identity-H) PDF. 16진 문자열이 우연히 영문 바이트로 읽혀도 글자가 아니다.
export function cidPdf({ toUnicode = false } = {}) {
  const content = 'BT /F1 12 Tf <4142434445464748494A4B4C> Tj ET';
  return Buffer.from(`%PDF-1.5\n1 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /MalgunGothic /Encoding /Identity-H${toUnicode ? ' /ToUnicode 9 0 R' : ''} >>\nendobj\n2 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer`, 'latin1');
}

export function scannedPdf() {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /Filter /DCTDecode /Length 4 >>\nstream\n\xff\xd8\xff\xd9\nendstream\nendobj\ntrailer', 'latin1');
}

export const b64 = (buf) => Buffer.from(buf).toString('base64');
