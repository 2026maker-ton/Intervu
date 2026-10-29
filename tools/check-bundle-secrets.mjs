// WP-A4: 배포 산출물(기본 dist/)에 키·토큰 패턴이 있는지 검사. 발견하면 종료 코드 1.
// 사용: node tools/check-bundle-secrets.mjs [dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PATTERNS = [
  ['Google API key', /AIza[0-9A-Za-z_-]{20,}/],
  ['sk- key', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['Groq key', /\bgsk_[A-Za-z0-9]{16,}/],
  ['Bearer token', /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ['*_API_KEY with value', /[A-Z][A-Z0-9_]*_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}/],
  ['ADMIN_TOKEN with value', /ADMIN_TOKEN\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}/],
];

export function scanDir(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      const text = fs.readFileSync(f, 'utf8');
      for (const [name, re] of PATTERNS) if (re.test(text)) hits.push({ file: f, pattern: name });
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || 'dist');
  const hits = scanDir(dir);
  for (const h of hits) console.error(`SECRET PATTERN (${h.pattern}): ${h.file}`);
  if (hits.length) process.exit(1);
  console.log(`check-bundle-secrets: clean (${dir})`);
}
