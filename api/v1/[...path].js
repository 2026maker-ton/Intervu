// Vercel 서버리스 함수: /api/v1/* 전체를 처리한다. 저장소는 Upstash Redis(src/vercel/handler.js). 정적 화면은 public/이 서빙한다.
import dns from 'node:dns/promises';
import { createVercelHandler } from '../../src/vercel/handler.js';
import { redisFromEnv } from '../../src/vercel/redis.js';
import { createFileTrendStore } from '../../src/node/trends-file.js';

const handle = createVercelHandler({
  env: process.env,
  redis: redisFromEnv(process.env),
  trends: createFileTrendStore({ filePath: '' }), // 월간 트렌드(관리자)는 서버리스에서 영속하지 않는다(UI 미사용)
  officialFetch: { resolveDns: async (h) => (await dns.lookup(h, { all: true })).map((r) => r.address) },
});

// Node 런타임의 표준 (req, res) 진입점: Request로 바꿔 handle에 넘기고 Response를 되돌려 쓴다(메서드별 export 방식에 의존하지 않는다).
export default async function handler(req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const hasBody = body && req.method !== 'GET' && req.method !== 'HEAD';
    const url = `${proto}://${req.headers.host || 'localhost'}${req.url}`;
    const r = await handle(new Request(url, { method: req.method, headers, body: hasBody ? body : undefined }));
    res.statusCode = r.status;
    for (const [k, v] of r.headers) if (k !== 'set-cookie') res.setHeader(k, v);
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) res.setHeader('set-cookie', sc);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('api_function_failed', e?.stack || e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'internal', message: '서버 오류가 발생했습니다.', retryable: true, details: null } }));
  }
}
