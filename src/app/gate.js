// 사이트 입장 비밀번호(데모 잠금). SITE_PASSWORD가 설정돼 있으면 /api 전체가 이 잠금을 통과한 브라우저에서만 열린다(화면 가림이 아니라 서버가 강제).
// - 비밀번호는 코드·문서에 쓰지 않고 환경변수 SITE_PASSWORD로만 둔다. 비교는 SHA-256 후 상수 시간 비교(길이·일부 일치 노출 없음).
// - 통과하면 HttpOnly·SameSite=Strict(HTTPS면 Secure) 쿠키를 준다. 값은 만료시각 + HMAC(비밀번호·GATE_SECRET 포함)이라 비밀번호나 비밀값이 바뀌면 기존 쿠키는 모두 무효가 된다.
// - 실패는 느리게(300ms) 응답하고, 시도는 IP당 분당 5회·일 30회로 제한한다(라우터가 store.recordRate, Vercel은 Redis).
// Web Crypto만 사용한다(Node·Workers·Vercel 공통).
import { safeEqual } from './crypto.js';

const enc = new TextEncoder();
const COOKIE = 'intervu_gate';
const TTL_S = 12 * 3600;
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(key, msg) {
  const k = await globalThis.crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', k, enc.encode(msg))));
}

export function createGate({ password = '', secret = '', nowMs = () => Date.now() } = {}) {
  const enabled = !!password;
  const key = `${secret}\u0000${password}`;
  const sign = (exp) => hmac(key, `gate.v1.${exp}`);

  async function verify(request) {
    if (!enabled) return true;
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get('cookie') || '');
    if (!m) return false;
    const [exp, sig] = m[1].split('.');
    if (!/^\d{10,14}$/.test(exp || '') || Number(exp) < Math.floor(nowMs() / 1000) || !sig) return false;
    return safeEqual(sig, await sign(exp));
  }

  // 비밀번호가 맞으면 Set-Cookie 문자열을, 아니면 null을 돌려준다.
  async function attempt(input, { secure }) {
    if (!enabled) return null;
    if (!(await safeEqual(String(input ?? '').slice(0, 200), password))) { await new Promise((r) => setTimeout(r, 300)); return null; }
    const exp = Math.floor(nowMs() / 1000) + TTL_S;
    return `${COOKIE}=${exp}.${await sign(exp)}; Path=/; Max-Age=${TTL_S}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }
  const clear = (secure) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  return { enabled, verify, attempt, clear };
}
