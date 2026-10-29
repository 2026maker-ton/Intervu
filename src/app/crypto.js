// Web Crypto 래퍼(Node·Workers 공통). node:crypto 의존 없음.
const enc = new TextEncoder();

export const randomUUID = () => globalThis.crypto.randomUUID();

export async function sha256Bytes(value) {
  const data = value instanceof Uint8Array ? value : enc.encode(String(value));
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
}

export async function sha256Hex(value) {
  return [...(await sha256Bytes(value))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 길이가 같은 두 바이트열을 상수 시간으로 비교한다(조기 반환 없음).
export function timingSafeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 비밀 문자열 비교: 양쪽을 SHA-256으로 길이를 맞춘 뒤 상수 시간 비교한다.
export async function safeEqual(a, b) {
  return timingSafeEqualBytes(await sha256Bytes(a), await sha256Bytes(b));
}
