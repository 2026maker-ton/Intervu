import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDir } from '../../tools/check-bundle-secrets.mjs';

const publicDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..', 'public');

test('A4 secrets scan: clean public/ passes', () => {
  assert.deepEqual(scanDir(publicDir), []);
});

test('A4 secrets scan: planted keys are detected', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-'));
  const cases = ['AIza' + 'A'.repeat(30), 'sk-' + 'a1'.repeat(12), 'gsk_' + 'b2'.repeat(12), 'Bearer ' + 'x'.repeat(30), 'GEMINI_API_KEY="abcdefgh12345"', 'ADMIN_TOKEN=supersecret99'];
  cases.forEach((c, i) => fs.writeFileSync(path.join(d, `f${i}.js`), `const x = '${c}';`));
  const hits = scanDir(d);
  assert.equal(new Set(hits.map((h) => h.file)).size, cases.length);
  fs.rmSync(d, { recursive: true, force: true });
});
