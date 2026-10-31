// Upstash Redis REST 클라이언트(fetch만 사용). Vercel Marketplace의 Upstash를 연결하면 아래 환경변수 중 하나의 쌍이 자동 등록된다.
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  또는  KV_REST_API_URL / KV_REST_API_TOKEN
// 명령은 문자열 배열 하나(예: ['SET', key, value, 'EX', 60]). 키·토큰은 서버 환경변수에만 있고 로그에 남기지 않는다.
export function redisFromEnv(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '';
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  return url && token ? createRedis({ url, token }) : null;
}

export function createRedis({ url, token, fetchFn = (...a) => globalThis.fetch(...a), timeoutMs = 8000 }) {
  const base = String(url).replace(/\/+$/, '');
  async function call(path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchFn(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(`redis http ${res.status}`), { code: res.status >= 500 ? 503 : 502 });
      return j;
    } finally { clearTimeout(timer); }
  }
  return {
    async cmd(args) {
      const j = await call('', args.map(String));
      if (j?.error) throw Object.assign(new Error(`redis: ${String(j.error).slice(0, 120)}`), { code: 502 });
      return j?.result ?? null;
    },
    async pipeline(cmds) {
      const j = await call('/pipeline', cmds.map((c) => c.map(String)));
      return (Array.isArray(j) ? j : []).map((x) => { if (x?.error) throw Object.assign(new Error(`redis: ${String(x.error).slice(0, 120)}`), { code: 502 }); return x?.result ?? null; });
    },
  };
}
