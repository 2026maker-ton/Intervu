// Cloudflare Workers 진입점(WP-A3, DG-1 A안). 코드는 런타임 미검증이다: 계약 테스트는 worker.fetch(Request, env)를
// 직접 호출해 확인하고, 실제 Workers API 세부는 [UNVERIFIED — docs not checked].
// 정적 UI는 Pages가 서빙한다(여기서는 /api/*만 처리, 그 외 404).
import { createCore } from '../app/core.js';
import { toConfigEnv, ownerOf } from './env.js';
export { SessionDO } from './do-session.js';

let isolateCore = null; // 바인딩이 없을 때(로컬 계약 테스트·단일 isolate 데모)만 쓰는 isolate당 1회 코어. 상태는 isolate와 함께 소실.

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default {
  async fetch(request, env = {}, ctx) {
    const p = new URL(request.url).pathname;
    if (!p.startsWith('/api/')) return json(404, { error: { code: 'not_found', message: 'Not found', retryable: false, details: null } });
    // 소유자별 DO 한 개로 라우팅 → 같은 소유자의 쓰기는 한 객체에서 직렬 처리. 비인증·관리자 요청은 'public' DO.
    // ponytail: 'public'·소유자 DO가 원장(예산)을 각자 가진다 → 전역 월 예산 상한이 아님. 전역 원장 DO는 필요 시 추가.
    if (env.SESSION_DO) {
      const name = `owner:${ownerOf(request, env) || 'public'}`;
      return env.SESSION_DO.get(env.SESSION_DO.idFromName(name)).fetch(request);
    }
    isolateCore ||= createCore({ env: toConfigEnv(env) });
    return isolateCore.fetch(request, env, ctx);
  },
};
