// npm run e2e 진입점: Playwright 모듈·브라우저를 찾아 tools/e2e-ui.mjs를 실행한다. (docs/e2e.md)
// 종료 코드: 0 통과 / 1 체크 실패(e2e-ui) / 3 Playwright 모듈 없음 / 4 사용 가능한 브라우저 없음 — 3·4는 "E2E 미실행"
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sub = (d) => { try { return fs.readdirSync(d).map((n) => path.join(d, n)); } catch { return []; } };

function moduleCandidates() {
  const c = [];
  if (process.env.PLAYWRIGHT_MODULE) c.push(process.env.PLAYWRIGHT_MODULE);
  c.push('playwright');
  try {
    const g = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    c.push(path.join(g, 'playwright'));
    // 전역 패키지 안에 중첩 설치된 경우(예: omniroute/node_modules/playwright)
    for (const d of sub(g)) c.push(path.join(d, 'node_modules', 'playwright'));
  } catch { /* npm 없음 */ }
  const npx = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : path.join(os.homedir(), '.npm', '_npx');
  for (const d of sub(npx)) c.push(path.join(d, 'node_modules', 'playwright'));
  return c;
}

function loadPlaywright() {
  for (const c of moduleCandidates()) {
    try {
      const pw = require(c);
      if (pw.chromium) return { pw, from: c };
    } catch { /* 다음 후보 */ }
  }
  return null;
}

function findBrowserExe() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  const names = new Set(['chrome-headless-shell.exe', 'headless_shell.exe', 'chrome.exe', 'chrome-headless-shell', 'headless_shell', 'chrome']);
  const walk = (d, depth, out) => {
    for (const p of sub(d)) {
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth > 0) walk(p, depth - 1, out); } else if (names.has(path.basename(p))) out.push(p);
    }
  };
  // headless-shell 우선, 최신 빌드 번호 우선
  for (const r of roots) {
    const dirs = sub(r).filter((x) => /chromium/.test(path.basename(x)))
      .sort((a, b) => (/headless/.test(path.basename(b)) - /headless/.test(path.basename(a))) || b.localeCompare(a));
    for (const d of dirs) { const out = []; walk(d, 3, out); if (out[0]) return out[0]; }
  }
  return null;
}

const found = loadPlaywright();
if (!found) {
  console.error('[E2E 미실행] Playwright 모듈을 찾지 못했습니다.\n  설치: npx --yes playwright@1.64.1 install chromium\n  이미 설치돼 있으면 PLAYWRIGHT_MODULE=<playwright 폴더 경로> 로 지정하세요. (docs/e2e.md)\nE2E NOT RUN');
  process.exit(3);
}
console.log(`playwright: ${found.from}`);
process.env.PLAYWRIGHT_MODULE = found.from; // e2e-ui.mjs가 같은 모듈(캐시 공유)을 로드하므로 아래 패치가 적용된다

const orig = found.pw.chromium.launch.bind(found.pw.chromium);
found.pw.chromium.launch = async (opts = {}) => {
  try { return await orig(opts); } catch (e) {
    const exe = process.env.CHROMIUM_EXECUTABLE || findBrowserExe();
    if (!exe) {
      console.error(`[E2E 미실행] 브라우저를 실행할 수 없고 ms-playwright 캐시에서 대체 브라우저도 찾지 못했습니다.\n  원인: ${String(e.message).split('\n')[0]}\n  설치: npx --yes playwright@1.64.1 install chromium (또는 CHROMIUM_EXECUTABLE=<실행파일>)\nE2E NOT RUN`);
      process.exit(4);
    }
    console.log(`기본 브라우저 실행 실패(빌드 불일치 추정) → 대체 사용: ${exe}`);
    return orig({ ...opts, executablePath: exe });
  };
};

await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e-ui.mjs')).href);
