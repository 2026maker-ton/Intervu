// Vercel(서버리스) 진입 로직. 요청마다 새 코어를 만들고, Upstash Redis에서 "이 사용자의 데이터"만 불러와 메모리 저장소에 올린 뒤 처리하고 다시 저장한다.
// 핸들러·저장소 코드는 동기식이라 그대로 두고, 이 파일이 요청 앞뒤에서 불러오기/저장하기만 맡는다.
//
// Redis 키
//   user:{id}        계정 JSON                      email:{이메일}   → user id (SET NX로 중복 가입 방지)
//   sess:{해시}      로그인 세션 JSON(만료 EX)        usess:{id}       그 계정의 세션 해시 집합(계정 삭제 때 함께 지움)
//   own:{id}         그 사용자의 나머지 전부(프로필·세션·턴·평가·동의·멱등 키 등)를 gzip+base64로 한 덩어리
//   lock:{id}        사용자별 요청 직렬화 잠금(같은 사용자의 요청이 겹쳐 서로 덮어쓰지 않게)
//   ledger:{YYYY-MM} 월 AI 비용 합계(증감분만 HINCRBYFLOAT)  rl:*  가입·로그인 시도 제한
// ponytail: 월 Claude 호출 상한(CLAUDE_MONTHLY_CALL_CAP)은 호출기 메모리 카운트라 서버리스에서는 요청마다 초기화된다. 지출 한도는 공급자 콘솔에서도 건다.
import { createCore } from '../app/core.js';
import { createStore } from '../store/memory.js';
import { loadConfig } from '../config.js';
import { sha256Hex, randomUUID, safeEqual } from '../app/crypto.js';
import { createGate } from '../app/gate.js';

const SKIP_MAPS = new Set(['users', 'authSessions']);
const LOCK_MS = 30_000;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const apiErr = (status, code, message, retryable = false) => json(status, { error: { code, message, retryable, details: null } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gzip(str) {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(str)); w.close();
  return Buffer.from(await new Response(cs.readable).arrayBuffer()).toString('base64');
}
async function gunzip(b64) {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter(); w.write(Buffer.from(b64, 'base64')); w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

// 메모리 저장소 → 사용자 덩어리 문자열
export async function packOwner(store) {
  const maps = {};
  for (const [name, m] of Object.entries(store._maps)) if (!SKIP_MAPS.has(name) && m.size) maps[name] = [...m];
  return gzip(JSON.stringify({ v: 1, maps, ledger_sessions: [...store.ledgerState().sessions] }));
}
export async function unpackOwner(store, b64) {
  const d = JSON.parse(await gunzip(b64));
  for (const [name, rows] of Object.entries(d.maps || {})) { const m = store._maps[name]; if (m) for (const [k, v] of rows) m.set(k, v); }
  const l = store.ledgerState(); l.sessions = new Map(d.ledger_sessions || []);
}

export function createVercelHandler({ env = process.env, redis, trends, officialFetch, nowMs = () => Date.now() } = {}) {
  const config = loadConfig(env);
  const gate = createGate({ password: config.sitePassword, secret: config.gateSecret });
  const month = () => new Date(nowMs()).toISOString().slice(0, 7);
  const bearer = (req) => /^Bearer\s+(.+)$/.exec(req.headers.get('authorization') || '')?.[1] || null;

  async function lock(owner) {
    const token = randomUUID();
    for (let i = 0; i < 150; i++) { // 최대 약 15초 대기
      if (await redis.cmd(['SET', `lock:${owner}`, token, 'NX', 'PX', LOCK_MS])) return async () => { try { await redis.cmd(['EVAL', "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, `lock:${owner}`, token]); } catch { /* 잠금은 PX로 스스로 풀린다 */ } };
      await sleep(100);
    }
    return null;
  }

  // 가입·로그인 시도 제한: 이메일+IP 분당 5회·일 50회, IP 단독 분당 20회(서버리스는 메모리 카운트가 초기화되므로 Redis로 센다).
  async function authRate(email, ip) {
    const keys = [[`rl:m:${email}|${ip}`, 60, 5], [`rl:d:${email}|${ip}`, 86400, 50], [`rl:ip:${ip}`, 60, 20]];
    const out = await redis.pipeline(keys.flatMap(([k, ttl]) => [['INCR', k], ['EXPIRE', k, ttl, 'NX']]));
    return keys.some(([, , max], i) => Number(out[i * 2]) > max);
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const p = url.pathname; const method = request.method;
    if (!p.startsWith('/api/')) return apiErr(404, 'not_found', 'Not found');
    // Vercel 배포에서는 입장 비밀번호가 없으면 열지 않는다(환경변수를 빠뜨린 채 공개되는 사고 방지).
    if (!config.sitePassword && env.VERCEL) return apiErr(503, 'gate_unconfigured', '입장 비밀번호(SITE_PASSWORD)가 설정되지 않아 서비스를 열지 않았습니다.');
    // 잠금을 통과하지 않은 요청은 Redis를 건드리기 전에 막는다(gate 경로만 예외).
    if (gate.enabled && p !== '/api/v1/gate' && !(await gate.verify(request))) return apiErr(401, 'gate_required', '입장 비밀번호가 필요합니다.');
    if (!redis) return apiErr(503, 'store_unconfigured', '저장소(Upstash Redis)가 연결되지 않았습니다. 환경변수를 확인하세요.');

    // AI 스위치: 상태는 Redis(flag:ai_off)에 둔다. 켜고 끄려면 스위치 비밀번호가 필요하고 시도는 IP당 분당 5·일 30회(Redis)로 센다.
    const aiOff = (await redis.cmd(['GET', 'flag:ai_off']).catch(() => null)) === '1';
    if (p === '/api/v1/ai-switch') {
      if (method === 'GET') return Response.json({ on: !aiOff, configured: !!config.aiSwitchPassword });
      if (method !== 'POST') return apiErr(405, 'method_not_allowed', '지원하지 않는 요청입니다.');
      if (!config.aiSwitchPassword) return apiErr(503, 'switch_disabled', 'AI 스위치 비밀번호가 설정되지 않았습니다.');
      const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
      const out = await redis.pipeline([['INCR', `rl:sw:m:${ip}`], ['EXPIRE', `rl:sw:m:${ip}`, 60, 'NX'], ['INCR', `rl:sw:d:${ip}`], ['EXPIRE', `rl:sw:d:${ip}`, 86400, 'NX']]);
      if (Number(out[0]) > 5 || Number(out[2]) > 30) return apiErr(429, 'rate_limited', '시도가 너무 잦습니다. 잠시 후 다시 시도하세요.', true);
      const b = await request.json().catch(() => ({}));
      if (typeof b?.on !== 'boolean') return apiErr(422, 'validation_error', 'on 값이 필요합니다.');
      if (!(await safeEqual(String(b?.password ?? '').slice(0, 200), config.aiSwitchPassword))) { await sleep(300); return apiErr(401, 'switch_denied', '비밀번호가 올바르지 않습니다.'); }
      await redis.cmd(b.on ? ['DEL', 'flag:ai_off'] : ['SET', 'flag:ai_off', '1']);
      return Response.json({ on: b.on });
    }

    const store = createStore({ ttlDays: config.limits.dataTtlDaysDefault });
    const loaded = { users: new Map(), sess: new Set(), ownerRaw: null, ledger: null };
    const isAuthEntry = method === 'POST' && (p === '/api/v1/auth/signup' || p === '/api/v1/auth/login');
    let owner = null; let unlock = null; let entryEmail = '';
    try {
      if (isAuthEntry) {
        const body = await request.clone().json().catch(() => ({}));
        entryEmail = String(body?.email || '').trim().toLowerCase();
        const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
        if (await authRate(entryEmail || '-', ip)) return apiErr(429, 'rate_limited', '시도가 너무 잦습니다. 잠시 후 다시 시도하세요.', true);
        const uid = entryEmail ? await redis.cmd(['GET', `email:${entryEmail}`]) : null;
        if (uid) { const u = JSON.parse((await redis.cmd(['GET', `user:${uid}`])) || 'null'); if (u) { store._maps.users.set(u.id, u); loaded.users.set(u.id, u); } }
      } else if (p === '/api/v1/gate' && method === 'POST') {
        // 입장 비밀번호 시도 제한(IP당 분당 5·일 30): 서버리스는 메모리 카운트가 초기화되므로 Redis로 센다.
        const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
        const out = await redis.pipeline([['INCR', `rl:gate:m:${ip}`], ['EXPIRE', `rl:gate:m:${ip}`, 60, 'NX'], ['INCR', `rl:gate:d:${ip}`], ['EXPIRE', `rl:gate:d:${ip}`, 86400, 'NX']]);
        if (Number(out[0]) > 5 || Number(out[2]) > 30) return apiErr(429, 'rate_limited', '시도가 너무 잦습니다. 잠시 후 다시 시도하세요.', true);
      } else if (p !== '/api/v1/health' && p !== '/api/v1/interview-types' && p !== '/api/v1/gate') {
        const t = bearer(request);
        if (t) {
          const hash = await sha256Hex(t);
          owner = config.devTokens[t] || null;
          if (!owner) {
            const s = JSON.parse((await redis.cmd(['GET', `sess:${hash}`])) || 'null');
            if (s && s.expires_at > nowMs()) { owner = s.owner; store._maps.authSessions.set(hash, s); loaded.sess.add(hash); }
          }
          if (owner) {
            unlock = await lock(owner);
            if (!unlock) return apiErr(503, 'busy', '같은 계정의 요청이 처리 중입니다. 잠시 후 다시 시도하세요.', true);
            const [raw, uraw] = await redis.pipeline([['GET', `own:${owner}`], ['GET', `user:${owner}`]]);
            if (uraw) { const u = JSON.parse(uraw); store._maps.users.set(u.id, u); loaded.users.set(u.id, u); }
            if (raw) { loaded.ownerRaw = raw; await unpackOwner(store, raw); }
            store.purgeExpired(); // 30일 보관 기한이 지난 프로필·세션을 불러온 직후 지운다
          }
        }
      }
      // 월 AI 비용 합계(전역)
      const lg = store.ledgerState();
      if (owner || isAuthEntry) {
        const [sp, rs] = await redis.cmd(['HMGET', `ledger:${month()}`, 'spent', 'reserved']);
        lg.monthlySpent = Number(sp) || 0; lg.monthlyReserved = Number(rs) || 0;
        loaded.ledger = { spent: lg.monthlySpent, reserved: lg.monthlyReserved };
      }

      const core = createCore({ env, store, trends, officialFetch });
      core.aiSwitch.set(aiOff);
      const response = await core.fetch(request, env, {});
      const ownerNow = owner || [...store._maps.users.keys()].find((id) => !loaded.users.has(id)) || null;

      // ---- 저장 ----
      const writes = [];
      const users = [...store._maps.users.values()];
      // 새 계정: 이메일 점유(SET NX). 동시에 같은 이메일로 가입했으면 늦은 쪽을 거절한다.
      for (const u of users) {
        if (loaded.users.has(u.id)) continue;
        const ok = await redis.cmd(['SET', `email:${u.email}`, u.id, 'NX']);
        if (!ok) return apiErr(409, 'signup_unavailable', '이 이메일로는 가입할 수 없습니다. 로그인해 주세요.');
        writes.push(['SET', `user:${u.id}`, JSON.stringify(u)]);
      }
      // 계정 삭제: 계정·세션·데이터 덩어리를 모두 지운다.
      for (const [id, u] of loaded.users) {
        if (store._maps.users.has(id)) continue;
        const sessions = (await redis.cmd(['SMEMBERS', `usess:${id}`])) || [];
        writes.push(['DEL', `user:${id}`], ['DEL', `email:${u.email}`], ['DEL', `own:${id}`], ['DEL', `usess:${id}`], ...sessions.map((h) => ['DEL', `sess:${h}`]));
      }
      // 로그인 세션: 새로 생긴 것은 저장(만료 EX), 사라진 것(로그아웃)은 삭제
      for (const [hash, s] of store._maps.authSessions) {
        if (loaded.sess.has(hash)) continue;
        writes.push(['SET', `sess:${hash}`, JSON.stringify(s), 'EX', Math.max(1, Math.ceil((s.expires_at - nowMs()) / 1000))], ['SADD', `usess:${s.owner}`, hash]);
      }
      for (const hash of loaded.sess) if (!store._maps.authSessions.has(hash)) writes.push(['DEL', `sess:${hash}`]);
      // 사용자 데이터 덩어리(계정이 남아 있을 때만)
      if (ownerNow && store._maps.users.has(ownerNow)) {
        const raw = await packOwner(store);
        if (raw !== loaded.ownerRaw) writes.push(['SET', `own:${ownerNow}`, raw]);
      }
      // 월 AI 비용: 이 요청이 쓴 증감분만 더한다(동시 요청이 서로 덮어쓰지 않게)
      if (loaded.ledger) {
        const dS = lg.monthlySpent - loaded.ledger.spent; const dR = lg.monthlyReserved - loaded.ledger.reserved;
        if (Math.abs(dS) > 1e-12) writes.push(['HINCRBYFLOAT', `ledger:${month()}`, 'spent', dS]);
        if (Math.abs(dR) > 1e-12) writes.push(['HINCRBYFLOAT', `ledger:${month()}`, 'reserved', dR]);
        if (writes.some((w) => w[0] === 'HINCRBYFLOAT')) writes.push(['EXPIRE', `ledger:${month()}`, 60 * 86400]);
      }
      if (writes.length) await redis.pipeline(writes);
      return response;
    } catch (e) {
      if (env.VERCEL_DEBUG) console.error(e);
      return apiErr(e?.code === 503 ? 503 : 500, e?.code === 503 ? 'store_unavailable' : 'internal_error', e?.code === 503 ? '저장소에 연결하지 못했습니다. 잠시 후 다시 시도하세요.' : '서버 오류가 발생했습니다.', e?.code === 503);
    } finally { if (unlock) await unlock(); }
  };
}
