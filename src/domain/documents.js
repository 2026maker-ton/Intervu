// Document extraction: TXT direct, PDF/DOCX text pull with deflate support, no external calls.
// PROJECT.md §2.1: 확장자·MIME·크기 검증, 추출 텍스트 미리보기, 실패 상태 표시, revision 분리.
import { inflateRawSync, inflateSync } from 'node:zlib';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_INFLATED = 10 * 1024 * 1024; // zip-bomb guard
const ALLOWED = new Map([
  ['.txt', ['text/plain']],
  ['.pdf', ['application/pdf']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
]);

export function validateDocument({ filename = '', mimeType = '', bytes = 0 }) {
  const lower = String(filename || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (!ALLOWED.has(ext)) {
    return { ok: false, code: 'unsupported_file', message: `지원하지 않는 파일 형식입니다: ${ext || '(확장자 없음)'} — PDF/DOCX/TXT만 가능합니다.` };
  }
  if (!bytes) return { ok: false, code: 'empty_document', message: '빈 문서입니다. 내용을 확인한 뒤 다시 올리세요.' };
  if (bytes > MAX_BYTES) {
    return { ok: false, code: 'oversized_document', message: `파일이 너무 큽니다 (${Math.round(bytes / 1024 / 1024)}MB). 5MB 이하로 줄이세요.` };
  }
  const allowedMimes = ALLOWED.get(ext);
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (base && !allowedMimes.includes(base) && base !== 'application/octet-stream') {
    return { ok: false, code: 'mime_mismatch', message: `확장자(${ext})와 파일 형식(${base || 'unknown'})이 일치하지 않습니다.` };
  }
  return { ok: true, ext };
}

export function extractDocumentText({ ext, buffer }) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!buf.length) return { ok: false, code: 'empty_document', message: '빈 문서입니다.' };
  try {
    if (ext === '.txt') {
      const text = buf.toString('utf8');
      return finishExtract(text, { encoding: 'utf8' });
    }
    if (ext === '.docx') {
      const text = extractDocxText(buf);
      if (!text) return { ok: false, code: 'non_extractable', message: 'DOCX에서 텍스트를 찾지 못했습니다. 텍스트를 직접 붙여넣으세요.' };
      return finishExtract(text, { container: 'docx' });
    }
    if (ext === '.pdf') {
      const { text, cid } = extractPdfText(buf);
      if (!text && cid) {
        return {
          ok: false, code: 'unsupported_font_encoding',
          message: '이 PDF는 글꼴 인코딩(CID/Type0) 때문에 글자를 안전하게 읽을 수 없습니다. 텍스트를 직접 붙여넣거나 DOCX/TXT로 올리세요.',
        };
      }
      if (!text) {
        return {
          ok: false, code: 'non_extractable_scanned',
          message: '스캔/이미지 PDF이거나 텍스트 추출이 불가합니다. 텍스트를 직접 붙여넣으세요.',
        };
      }
      return finishExtract(text, { container: 'pdf' });
    }
    return { ok: false, code: 'unsupported_file', message: '지원하지 않는 형식입니다.' };
  } catch (e) {
    return { ok: false, code: 'corrupted_document', message: `문서를 읽지 못했습니다: ${String(e?.message || e).slice(0, 120)}` };
  }
}

function finishExtract(text, meta = {}) {
  const normalized = String(text || '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if ([...normalized].length < 4) return { ok: false, code: 'empty_document', message: '추출된 텍스트가 너무 짧습니다. 직접 붙여넣으세요.' };
  const chars = [...normalized].length;
  return {
    ok: true,
    text: normalized.slice(0, 20000),
    truncated: chars > 20000,
    char_count: Math.min(chars, 20000),
    warnings: chars > 20000 ? ['20,000자 초과분은 잘렸습니다.'] : [],
    meta,
  };
}

// ---- DOCX: ZIP 로컬 헤더를 직접 파싱하고 deflate(raw)를 inflate한다 ----
// 외부 의존성 없이 동작한다. 매크로·외부 참조는 실행하지 않고 word/document.xml의 <w:t>만 수집한다.
function extractDocxText(buf) {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return '';
  const files = new Map();
  let off = 0;
  let guard = 0;
  while (off + 30 <= buf.length && guard < 2000) {
    guard += 1;
    if (buf[off] !== 0x50 || buf[off + 1] !== 0x4b || buf[off + 2] !== 0x03 || buf[off + 3] !== 0x04) break;
    const method = buf.readUInt16LE(off + 8);
    const flags = buf.readUInt16LE(off + 6);
    const compSize = buf.readUInt32LE(off + 18);
    const fnameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const nameStart = off + 30;
    const dataStart = nameStart + fnameLen + extraLen;
    if (dataStart > buf.length) break;
    const name = buf.slice(nameStart, nameStart + fnameLen).toString('utf8');
    let dataEnd;
    let data;
    if ((flags & 0x08) || compSize === 0) {
      // data descriptor 사용본: 다음 로컬 헤더까지를 데이터로 간주하고 시도한다.
      const next = findNextLocalHeader(buf, dataStart);
      dataEnd = next === -1 ? buf.length : next;
      const slice = buf.slice(dataStart, Math.min(dataEnd, dataStart + MAX_INFLATED));
      data = tryInflate(slice);
      off = dataEnd;
    } else {
      if (compSize > MAX_INFLATED) break;
      dataEnd = dataStart + compSize;
      if (dataEnd > buf.length) break;
      const slice = buf.slice(dataStart, dataEnd);
      if (method === 8) data = tryInflate(slice);
      else if (method === 0) data = slice;
      else data = null;
      off = dataEnd;
    }
    if (data && data.length && data.length < MAX_INFLATED && name) {
      files.set(name, data);
    }
    if (off <= dataStart && compSize === 0) break;
  }
  const xmlBuf = files.get('word/document.xml');
  if (!xmlBuf) {
    // 헤더 파싱 실패 시 구버전 호환: 버퍼 전체에서 평문 <w:t> 조각 수집
    return extractWts(buf.toString('utf8'));
  }
  return extractWts(xmlBuf.toString('utf8'));
}

function findNextLocalHeader(buf, from) {
  for (let i = from; i + 4 <= buf.length; i += 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) return i;
  }
  return -1;
}

function tryInflate(slice) {
  if (!slice || !slice.length) return null;
  try {
    const out = inflateRawSync(slice, { windowBits: 15 });
    if (out.length > MAX_INFLATED) return null;
    return out;
  } catch { /* raw 실패 → zlib wrapper 시도 */ }
  try {
    const out = inflateSync(slice);
    if (out.length > MAX_INFLATED) return null;
    return out;
  } catch {
    return null;
  }
}

function extractWts(xml) {
  const parts = [];
  const re = /<w:t[^>]*>([^<]{1,2000})<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) && parts.join(' ').length < 20000) {
    parts.push(decodeEntities(m[1]));
  }
  // 줄바꿈·탭 태그는 공백으로
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ''; }
    });
}

// ---- PDF: 평문 Tj/TJ + FlateDecode 스트림 inflate + hex 문자열 ----
function extractPdfText(buf) {
  const head = buf.slice(0, 5).toString('latin1');
  if (head !== '%PDF-') return { text: '', cid: false };
  const streams = inflatePdfStreams(buf).map((b) => b.toString('utf8'));
  const whole = buf.toString('utf8');
  // CID/Type0(Identity-H) 글꼴: 문자열이 글리프 ID라 ToUnicode CMap 없이는 글자가 아니다.
  // ponytail: ToUnicode CMap 파싱 미구현 → 있어도 명시적 실패. 필요하면 bfchar/bfrange 파서 추가.
  const cid = [whole, ...streams].some((t) => /\/Identity-H|\/Type0\b/.test(t));
  const parts = [];
  // 1) FlateDecode 스트림을 inflate해서 모은다 (UTF-8 디코딩: 한글 보존)
  for (const t8 of streams) {
    const t = collectPdfStrings(t8, !cid);
    if (t) parts.push(t);
  }
  // 2) 파일 전체 평문도 수집 (비압축 PDF 호환)
  const plain = collectPdfStrings(whole, !cid);
  if (plain) parts.push(plain);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!/[가-힣A-Za-z]{4,}/.test(text)) return { text: '', cid };
  return { text, cid: false };
}

function inflatePdfStreams(buf) {
  const out = [];
  const streamMark = Buffer.from('stream');
  const endMark = Buffer.from('endstream');
  let pos = 0;
  let count = 0;
  while (count < 200) {
    const sIdx = buf.indexOf(streamMark, pos);
    if (sIdx === -1) break;
    const eIdx = buf.indexOf(endMark, sIdx + 6);
    if (eIdx === -1) break;
    // dict 구간에서 FlateDecode 여부 확인 (앞 4KB)
    const dictProbe = buf.slice(Math.max(0, sIdx - 4000), sIdx).toString('latin1');
    const isFlate = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.test(dictProbe)
      ? /FlateDecode/.test(dictProbe.slice(dictProbe.lastIndexOf('<<')))
      : false;
    // stream 키워드 뒤 개행 스킵
    let dataStart = sIdx + 6;
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) dataStart += 2;
    else if (buf[dataStart] === 0x0a || buf[dataStart] === 0x0d) dataStart += 1;
    let dataEnd = eIdx;
    // endstream 앞 개행 제거
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0d) dataEnd -= 1;
    const slice = buf.slice(dataStart, dataEnd);
    if (isFlate && slice.length && slice.length < MAX_INFLATED) {
      const inflated = tryInflate(slice);
      if (inflated) out.push(inflated);
    }
    pos = eIdx + 9;
    count += 1;
  }
  return out;
}

function collectPdfStrings(latin, allowHex = true) {
  const parts = [];
  // ( ... ) Tj / TJ — TJ 배열 안의 여러 조각도 함께 수집
  const reParen = /\((?:[^()\\]|\\.|\\\n)*\)\s*T[jJ]/g;
  let m;
  while ((m = reParen.exec(latin)) && parts.join(' ').length < 20000) {
    const raw = m[0].slice(0, m[0].lastIndexOf(')'));
    const inner = raw.slice(1).replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\n', t: ' ', b: ' ', f: ' ', '(': '(', ')': ')', '\\': '\\' }[c] || c));
    if (inner.trim()) parts.push(inner.trim());
  }
  // TJ 배열: [ (a) 12 (b) ] TJ
  const reArr = /\[\s*(?:\((?:[^()\\]|\\.)*\)\s*-?\d*\.?\d*\s*)+\)?\s*\]\s*TJ/g;
  // 배열 파싱이 깨질 수 있어 단순 추출로 보완: TJ 앞 800자 내 모든 (...) 조각
  const reTjCtx = /(\((?:[^()\\]|\\.){1,400}\))\s*[-\d.\s]*TJ/g;
  while ((m = reTjCtx.exec(latin)) && parts.join(' ').length < 20000) {
    const inner = m[1].slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\n', t: ' ', b: ' ', f: ' ', '(': '(', ')': ')', '\\': '\\' }[c] || c));
    if (inner.trim()) parts.push(inner.trim());
  }
  void reArr;
  // hex 문자열: <4D616E> Tj — UTF-16BE(BOM FEFF) 대응
  const reHex = /<([0-9A-Fa-f\s]{4,4000})>\s*T[jJ]/g;
  while (allowHex && (m = reHex.exec(latin)) && parts.join(' ').length < 20000) {
    const t = decodeHexString(m[1]);
    if (t.trim()) parts.push(t.trim());
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!/[가-힣A-Za-z]{4,}/.test(text)) return '';
  return text;
}

function decodeHexString(hexSrc) {
  const hex = String(hexSrc).replace(/\s+/g, '');
  if (hex.length % 2) return '';
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE
    const noBom = bytes.slice(2);
    const swapped = Buffer.alloc(noBom.length);
    for (let i = 0; i + 1 < noBom.length; i += 2) { swapped[i] = noBom[i + 1]; swapped[i + 1] = noBom[i]; }
    return swapped.toString('utf16le');
  }
  // 대부분 WinAnsi/UTF-8 평문
  const asUtf8 = bytes.toString('utf8');
  if (/[가-힣A-Za-z]{2,}/.test(asUtf8)) return asUtf8;
  return bytes.toString('latin1');
}
