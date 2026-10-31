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

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const randomToken = (n = 32) => b64u(globalThis.crypto.getRandomValues(new Uint8Array(n)));

// 비밀번호 해시: PBKDF2-SHA256(Workers 상한 100,000회), 사용자별 16바이트 salt.
const PBKDF2_ITER = 100_000;
async function pbkdf2(password, salt, iter) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
export async function hashPassword(password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { alg: 'pbkdf2-sha256', iter: PBKDF2_ITER, salt: b64u(salt), hash: b64u(await pbkdf2(password, salt, PBKDF2_ITER)) };
}
export async function verifyPassword(password, rec) {
  if (!rec?.salt || !rec?.hash) return false;
  return timingSafeEqualBytes(await pbkdf2(password, unb64u(rec.salt), rec.iter || PBKDF2_ITER), unb64u(rec.hash));
}

// 비밀 문자열 비교: 양쪽을 SHA-256으로 길이를 맞춘 뒤 상수 시간 비교한다.
export async function safeEqual(a, b) {
  return timingSafeEqualBytes(await sha256Bytes(a), await sha256Bytes(b));
}
