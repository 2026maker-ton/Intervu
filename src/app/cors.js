// WP-A4: CORS 허용 목록. 기본은 비활성(같은 오리진만). 허용 목록에 없는 오리진에는 CORS 헤더를 붙이지 않는다.
// '*'는 무시한다(Authorization 헤더를 쓰므로 와일드카드를 허용하지 않는다).
const ALLOW_HEADERS = 'Authorization, Content-Type, Idempotency-Key, x-admin-token';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export const parseOrigins = (s) => String(s || '').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter((x) => x && x !== '*');

export function withCors(handler, env) {
  const allowed = new Set(parseOrigins(env.CORS_ALLOW_ORIGINS));
  if (!allowed.size) return handler;
  return async (request, e, ctx) => {
    const origin = request.headers.get('origin');
    const ok = !!origin && allowed.has(origin);
    const isApi = new URL(request.url).pathname.startsWith('/api/');
    if (request.method === 'OPTIONS' && request.headers.has('access-control-request-method') && isApi) {
      const h = new Headers({ Vary: 'Origin' });
      if (ok) {
        h.set('Access-Control-Allow-Origin', origin);
        h.set('Access-Control-Allow-Methods', ALLOW_METHODS);
        h.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
        h.set('Access-Control-Max-Age', '600');
      }
      return new Response(null, { status: ok ? 204 : 403, headers: h });
    }
    const res = await handler(request, e, ctx);
    const headers = new Headers(res.headers);
    headers.append('Vary', 'Origin');
    if (ok) headers.set('Access-Control-Allow-Origin', origin);
    return new Response(res.body, { status: res.status, headers });
  };
}
