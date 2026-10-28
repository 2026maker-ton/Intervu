#!/usr/bin/env node
/**
 * Intervu project-direction guard.
 * Structural checks only — cannot prove code/UX compliance with PROJECT.md.
 * Standalone Node.js script; no external network requests or API keys.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  { path: 'PROJECT.md', tokens: ['## 1. 제품 전략', '## 2. 사용자 전체 여정', '## 3. UI/UX 정보 구조', '## 4. 시스템 아키텍처와 모델 전략', '## 5. 보안·개인정보·안전의 불변 조건', '## 6. 구현 단계 및 완료 기준', '## 7. 저장소의 실제 구현 상태', '## 8. 매 실행 시 에이전트 강제 작업 규칙', '지원서 주장 검증', '새 질문'] },
  { path: 'AGENTS.md', tokens: ['PROJECT.md', 'npm run check:project', 'npm test', 'provider', 'At the start'] },
];
let failed = false;
for (const item of required) {
  try {
    const file = resolve(root, item.path);
    const text = await readFile(file, 'utf8');
    const missing = item.tokens.filter((token) => !text.includes(token));
    if (missing.length) {
      console.error(`FAIL ${item.path}: missing required headings/terms: ${missing.join(', ')}`);
      failed = true;
    } else {
      console.log(`PASS ${item.path}: required headings/terms present`);
    }
  } catch (error) {
    console.error(`FAIL ${item.path}: ${error.message}`);
    failed = true;
  }
}
try {
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (!String(packageJson.scripts?.['check:project'] || '').includes('check-project.mjs')) {
    console.error('FAIL package.json: npm run check:project script missing');
    failed = true;
  } else console.log('PASS package.json: check:project script wired');
} catch (error) {
  console.error(`FAIL package.json: ${error.message}`);
  failed = true;
}

// UI structure guard: 9 screens, journey-only entry, no prompt()/confirm().
try {
  const html = await readFile(resolve(root, 'public/index.html'), 'utf8');
  const js = await readFile(resolve(root, 'public/app.js'), 'utf8');
  const screens = [...html.matchAll(/data-screen="([a-z]+)"/g)].map((m) => m[1]);
  const want = ['dashboard', 'application', 'evidence', 'setup', 'room', 'feedback', 'repractice', 'history', 'admin'];
  const problems = [];
  for (const s of want) if (!screens.includes(s)) problems.push(`missing screen ${s}`);
  if (/data-journey="(public|highschool)"/.test(html)) problems.push('generic org journey in main UI');
  if (/\b(?:window\.)?(?:prompt|confirm)\s*\(/.test(js.replace(/ask(?:Confirm|Input)/g, ''))) problems.push('prompt()/confirm() used');
  if (/synthetic\s*:\s*(?:true|freeTest)|free_test\s*:/.test(js)) problems.push('client sends synthetic/free_test flag');
  if (problems.length) { console.error(`FAIL public UI: ${problems.join('; ')}`); failed = true; }
  else console.log('PASS public UI: 9 screens, company/university journeys, no prompt/confirm');
} catch (error) {
  console.error(`FAIL public UI: ${error.message}`);
  failed = true;
}

// Fail only for absent/malformed project governance; semantic drift needs actual review/tests.
console.log('Note: project guard validates documentation structure, not AI output, UX, security or roadmap implementation.');
process.exitCode = failed ? 1 : 0;
