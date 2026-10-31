// 이메일+비밀번호 로그인(2026-10-31). 대상은 만 18세 이상: 가입 때 연령 확인·Groq 음성 전송 고지 동의를 함께 기록한다.
// 비밀번호·해시·토큰 원문은 응답·로그에 넣지 않는다. 서버는 토큰의 SHA-256만 저장한다.
import { hashPassword, verifyPassword, randomToken, sha256Hex } from '../crypto.js';

export const SIGNUP_NOTICE_VERSION = 'signup-2026-10-31';
const TOKEN_TTL_MS = 7 * 864e5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const BAD_LOGIN = '이메일 또는 비밀번호가 올바르지 않습니다.';

export function createAuthHandlers(d) {
  const { store, err, now } = d;
  // 이메일+IP 단위 시도 제한(분당 5회·일 50회). 실패·성공 모두 센다.
  const limited = (email, ip) => {
    const c = store.recordRate(`${email}|${ip}`, 'auth');
    return c.minute > 5 || c.day > 50 ? err('rate_limited', '시도가 너무 잦습니다. 잠시 후 다시 시도하세요.', 429, { retryable: true }) : null;
  };
  async function issue(owner) {
    const token = randomToken();
    store.putAuthSession(await sha256Hex(token), { owner, expires_at: Date.now() + TOKEN_TTL_MS, created_at: now() });
    return token;
  }
  const me = (u) => ({ id: u.id, email: u.email, name: u.name });

  async function signup(body, ip) {
    const email = String(body?.email || '').trim().toLowerCase();
    const name = String(body?.name || '').trim();
    const password = String(body?.password || '');
    if (!EMAIL_RE.test(email) || email.length > 254) return err('validation_error', '이메일 형식을 확인해 주세요.', 422);
    if (!name || [...name].length > 20) return err('validation_error', '이름은 1~20자로 입력해 주세요.', 422);
    if (password.length < 8 || password.length > 128) return err('validation_error', '비밀번호는 8~128자로 입력해 주세요.', 422);
    if (body?.age_18_confirmed !== true) return err('age_restricted', '만 18세 이상만 이용할 수 있습니다.', 403);
    if (body?.notice_ack !== true) return err('validation_error', '처리 안내에 동의해 주세요.', 422);
    const rl = limited(email, ip);
    if (rl) return rl;
    if (store.getUserByEmail(email)) return err('signup_unavailable', '이 이메일로는 가입할 수 없습니다. 로그인해 주세요.', 409);
    const u = store.createUser({ email, name, pass: await hashPassword(password) });
    store.addConsent(u.id, { age_18_confirmed: true, notice_version: SIGNUP_NOTICE_VERSION });
    return { status: 201, body: { token: await issue(u.id), user: me(u) } };
  }

  async function login(body, ip) {
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const rl = limited(email, ip);
    if (rl) return rl;
    const u = store.getUserByEmail(email);
    // 없는 이메일도 같은 비용·같은 문구로 실패시킨다(계정 존재 여부 노출 방지).
    const ok = await verifyPassword(password, u?.pass || { salt: 'AAAAAAAAAAAAAAAAAAAAAA', hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    if (!u || !ok) return err('invalid_credentials', BAD_LOGIN, 401);
    return { status: 200, body: { token: await issue(u.id), user: me(u) } };
  }

  async function logout(token) {
    if (token) store.deleteAuthSession(await sha256Hex(token));
    return { status: 200, body: { ok: true } };
  }

  function getMe(owner) {
    const u = store.getUser(owner);
    return u ? { status: 200, body: me(u) } : { status: 200, body: { id: owner, email: null, name: null } };
  }

  return { signup, login, logout, getMe };
}
