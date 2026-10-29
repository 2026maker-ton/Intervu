// Node 어댑터(WP-A1): http ↔ Request/Response 변환, 정적 파일 서빙, .env·process.env 로딩, 트렌드 파일 영속.
// 업무 로직은 src/app/(플랫폼 중립 코어)에 있다. process.env 직접 조회는 이 파일에서만 한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { loadDotEnv } from '../env.js';
import { createFileTrendStore } from './trends-file.js';
import { createFileStore } from '../store/file.js';
import { lookup as dnsLookup } from 'node:dns/promises';
import { createCore } from '../app/core.js';
import { randomUUID } from '../app/crypto.js';
import { withCors } from '../app/cors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const staticDir = path.join(root, 'public');
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};

function toRequest(req) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x); else if (v !== undefined) headers.set(k, v);
  }
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half'; }
  return new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), init);
}

export function createApp(overrides = {}) {
  const env = { ...loadDotEnv(root), ...process.env, ...(overrides.env || {}) };
  const config = loadConfig(env);
  // 트렌드 스토어: 영속 파일(TRENDS_FILE) 기반. 저장 실패 시 메모리로만 동작.
  const trendsFilePath = overrides.trendsFile || (config.trendsFile ? path.resolve(root, config.trendsFile) : '');
  const trends = overrides.trends || createFileTrendStore({ filePath: trendsFilePath });
  // STORE=file → 파일 영속(DATA_DIR, 단일 프로세스 가정). 기본은 memory.
  const store = overrides.store || (env.STORE === 'file'
    ? createFileStore({ dir: path.resolve(root, env.DATA_DIR || 'data/store'), ttlDays: config.limits.dataTtlDaysDefault })
    : undefined);
  const core = createCore({ env, store, ledger: overrides.ledger, trends, syntheticTraffic: overrides.syntheticTraffic === true, officialFetch: overrides.officialFetch || { resolveDns: async (h) => (await dnsLookup(h, { all: true })).map((r) => r.address) } });

  const coreFetch = async (request, e, ctx) => {
    const del = request.method === 'DELETE';
    try { return await core.fetch(request, e, ctx); } finally { core.store.afterRequest?.(del); }
  };
  const fetchApp = withCors(coreFetch, env); // CORS_ALLOW_ORIGINS 미설정이면 그대로(같은 오리진만)
  // 정적 페이지 CSP: connect-src는 'self' + API_BASE의 오리진(있을 때만)
  let apiOrigin = '';
  try { if (env.API_BASE) apiOrigin = new URL(env.API_BASE).origin; } catch { /* 잘못된 값은 무시 */ }
  const csp = `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'${apiOrigin ? ' ' + apiOrigin : ''}`;
  const server = http.createServer(async (req, res) => {
    try {
      const p = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
      // 정적 UI
      if (!p.startsWith('/api/')) {
        const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
        const file = path.join(staticDir, rel);
        if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found', retryable: false, request_id: randomUUID(), details: null } });
        }
        res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp });
        return fs.createReadStream(file).pipe(res);
      }
      // 본문을 다 읽지 않고 응답한 경우(예: 413): 남은 본문을 버리며 흘려보내고, 끝나지 않으면 2초 뒤 연결을 끊는다.
      res.on('finish', () => {
        if (req.complete) return;
        req.resume();
        setTimeout(() => req.destroy(), 2000).unref();
      });
      const response = await fetchApp(toRequest(req), env, {});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal_error', message: '서버 오류가 발생했습니다.', retryable: false, request_id: randomUUID(), details: null } });
      else res.end();
    }
  });

  return {
    server, config: core.config, store: core.store, ledger: core.ledger,
    providerInfo: core.providerInfo, providerName: core.providerName,
    providerStats: core.providerStats,
    fetch: fetchApp, // 핸들러 직접 호출(테스트·다른 어댑터용): (Request, env, ctx) => Response
  };
}

export function startServer() {
  const app = createApp();
  app.server.listen(app.config.port, () => {
    const p = app.providerInfo();
    console.log(`Intervu listening on http://localhost:${app.config.port}`);
    console.log(`Provider: ${p.selected} | Gemini key configured: ${p.configured} | paidAck: ${p.paidAck}`);
    const tokens = Object.keys(app.config.devTokens);
    if (!tokens.length) console.warn('WARNING: DEV_TOKEN_A/DEV_TOKEN_B가 없어 로그인 가능한 사용자가 없습니다.');
    if (tokens.some((t) => /^dev-user-[ab]-token$/.test(t))) console.warn('WARNING: 예시 토큰(dev-user-*-token)을 사용 중입니다. 외부에 공개하는 서버에서는 무작위 긴 토큰으로 바꾸세요.');
    if (!app.config.adminToken) console.warn('NOTE: ADMIN_TOKEN 미설정 — 관리자·지표·진단 기능이 꺼져 있습니다.');
  });
  return app;
}
