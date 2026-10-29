// 요청 본문 읽기(Web 표준 Request 기반). Buffer·node:stream 의존 없음.
import { err } from './util.js';

// 본문을 limit 바이트까지만 읽는다. 초과하면 즉시 중단하고 413 에러 객체를 던진다.
export async function readLimited(request, limit, tooLarge) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { reader.cancel().catch(() => {}); throw tooLarge(); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// JSON 본문: { text, json }. 빈 본문이면 json={}.
export async function readJsonBody(request, limit = 1_000_000) {
  const bytes = await readLimited(request, limit, () => err('payload_too_large', '요청 본문이 너무 큽니다.', 413));
  if (!bytes.length) return { text: '', json: {} };
  const text = new TextDecoder().decode(bytes);
  try { return { text, json: JSON.parse(text) }; } catch { throw err('invalid_json', 'JSON 형식이 올바르지 않습니다.', 400); }
}

function indexOfBytes(buf, pat, from = 0) {
  outer: for (let i = from; i <= buf.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}
function lastIndexOfBytes(buf, pat) {
  outer: for (let i = buf.length - pat.length; i >= 0; i--) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

// multipart/form-data 파서(의존성 없음): 오디오 1개 필드만 추출한다.
export async function readMultipartAudio(request, maxBytes) {
  const ctype = String(request.headers.get('content-type') || '');
  const m = /boundary=(?:"([^"]+)"|([^\s;]+))/.exec(ctype);
  if (!m) throw err('validation_error', 'multipart/form-data 형식이 필요합니다.', 422);
  const enc = new TextEncoder();
  const boundary = enc.encode(`--${m[1] || m[2]}`);
  const buf = await readLimited(request, maxBytes + 65536, () => err('payload_too_large', `음성은 ${Math.round(maxBytes / 1024 / 1024)}MB 이하만 가능합니다.`, 413));
  try {
    // 첫 번째 파일 파트의 헤더 종료(\r\n\r\n) 이후 ~ 마지막 boundary 이전을 오디오로 취급
    const headerEnd = indexOfBytes(buf, enc.encode('\r\n\r\n'));
    const tailIdx = lastIndexOfBytes(buf, boundary);
    if (headerEnd === -1 || tailIdx === -1 || tailIdx <= headerEnd) throw err('validation_error', '음성 파일을 찾지 못했습니다.', 422);
    const headerText = new TextDecoder('latin1').decode(buf.subarray(0, headerEnd));
    const fnMatch = /filename="([^"]*)"/.exec(headerText);
    const typeMatch = /Content-Type:\s*([^\r\n;]+)/i.exec(headerText);
    let audio = buf.subarray(headerEnd + 4, tailIdx);
    if (audio.length >= 2 && audio[audio.length - 2] === 13 && audio[audio.length - 1] === 10) audio = audio.subarray(0, -2);
    return {
      audio,
      filename: (fnMatch?.[1] || 'answer.webm').slice(0, 100),
      mimeType: (typeMatch?.[1] || 'audio/webm').trim().slice(0, 100),
    };
  } catch (e) {
    if (e?.error) throw e;
    throw err('invalid_audio', '음성 데이터를 읽지 못했습니다.', 422);
  }
}
