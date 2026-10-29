import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentText, validateDocument } from '../../src/domain/documents.js';
import { docx, textPdf, cidPdf, scannedPdf } from '../helpers/doc-fixtures.mjs';

test('C1 DOCX(deflate) 한글 추출 성공', () => {
  const r = extractDocumentText({ ext: '.docx', buffer: docx('동아리 회장으로 행사 운영') });
  assert.equal(r.ok, true);
  assert.match(r.text, /동아리 회장/);
});

test('C1 텍스트 PDF(평문·Flate) 추출 성공', () => {
  for (const flate of [false, true]) {
    const r = extractDocumentText({ ext: '.pdf', buffer: textPdf('Project leader experience summary', { flate }) });
    assert.equal(r.ok, true, `flate=${flate}`);
    assert.match(r.text, /Project leader/);
  }
});

test('C1 CID 16진 전용 PDF는 unsupported_font_encoding, 쓰레기 텍스트를 성공으로 내지 않는다', () => {
  for (const toUnicode of [false, true]) {
    const r = extractDocumentText({ ext: '.pdf', buffer: cidPdf({ toUnicode }) });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'unsupported_font_encoding');
    assert.equal(r.text, undefined);
  }
});

test('C1 스캔형 PDF는 non_extractable_scanned', () => {
  const r = extractDocumentText({ ext: '.pdf', buffer: scannedPdf() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'non_extractable_scanned');
});

test('C1 zip bomb(과대 inflate)은 텍스트로 새지 않는다', () => {
  const r = extractDocumentText({ ext: '.docx', buffer: docx('a'.repeat(11 * 1024 * 1024)) });
  assert.equal(r.ok, false);
});

test('C1 크기·형식 검증', () => {
  assert.equal(validateDocument({ filename: 'a.pdf', mimeType: 'application/pdf', bytes: 5 * 1024 * 1024 + 1 }).code, 'oversized_document');
  assert.equal(validateDocument({ filename: 'a.pdf', mimeType: 'application/pdf', bytes: 5 * 1024 * 1024 }).ok, true);
});
