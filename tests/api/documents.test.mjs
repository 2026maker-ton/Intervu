import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';

useSharedApp();

test('P1: document extract rejects unsupported and accepts TXT', async () => {
  const bad = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'a.exe', content_base64: Buffer.from('x').toString('base64') } });
  assert.equal(bad.status, 422);
  const ok = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'a.txt', mime_type: 'text/plain', content_base64: Buffer.from('지원서 요약 문장입니다.').toString('base64') } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.text, /지원서/);
});

function buildDocxBuffer(text) {
  const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`, 'utf8');
  const { deflateRawSync } = require('node:zlib');
  const comp = deflateRawSync(xml);
  // minimal local-file-header ZIP (no central directory needed for our parser)
  const name = Buffer.from('word/document.xml', 'utf8');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0, 6);
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt32LE(comp.length, 18);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28);
  return Buffer.concat([head, name, comp]);
}

function buildPdfBuffer(text, flate = false) {
  const { deflateSync } = require('node:zlib');
  const bodyText = `(${text}) Tj`;
  if (!flate) {
    return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${bodyText.length} >>\nstream\n${bodyText}\nendstream\nendobj\ntrailer`, 'utf8');
  }
  const comp = deflateSync(Buffer.from(bodyText, 'utf8'));
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`, 'utf8'),
    comp,
    Buffer.from('\nendstream\nendobj\ntrailer', 'utf8'),
  ]);
}

test('P1: document extract handles compressed DOCX + Flate PDF + scanned failure', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  globalThis.require = globalThis.require || require;
  const docxBuf = buildDocxBuffer('압축 DOCX 추출 검증 문장입니다');
  const docx = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content_base64: docxBuf.toString('base64') } });
  assert.equal(docx.status, 200, JSON.stringify(docx.data));
  assert.match(docx.data.text, /압축 DOCX/);
  const pdfBuf = buildPdfBuffer('Flate 압축 PDF 본문입니다', true);
  const pdf = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'a.pdf', mime_type: 'application/pdf', content_base64: pdfBuf.toString('base64') } });
  assert.equal(pdf.status, 200, JSON.stringify(pdf.data));
  assert.match(pdf.data.text, /Flate/);
  // 스캔/이미지 PDF: 텍스트 스트림이 없으면 붙여넣기 안내(422)로 실패한다
  const scan = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Length 10 >>\nstream\n0123456789\nendstream', 'utf8');
  const scanned = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'scan.pdf', mime_type: 'application/pdf', content_base64: scan.toString('base64') } });
  assert.equal(scanned.status, 422);
  assert.match(JSON.stringify(scanned.data), /붙여넣/);
  // oversize / empty
  const big = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'big.txt', content_base64: Buffer.alloc(10).toString('base64') } });
  assert.equal(big.status, 200); // 10바이트 유효 TXT
  const empty = await call('/api/v1/documents/extract', { method: 'POST', body: { filename: 'e.txt', content_base64: Buffer.from('').toString('base64') } });
  assert.equal(empty.status, 422);
});
