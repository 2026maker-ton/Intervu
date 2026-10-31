// 7화면 UI E2E (Mock 전용, 외부 키 없음, 2026-10-31)
// - 실제 서버를 임시 포트로 띄우고 Chromium으로 가입→대시보드→지원 정보(샘플)→근거 확인(렌치)→면접 준비→면접실(텍스트)→결과→로그아웃을 검증한다.
// - window.prompt/confirm 이 호출되면 실패한다. 1440 / 768 / 390 폭에서 가로 오버플로가 없어야 한다.
//
// 실행: node tools/e2e-ui.mjs   (playwright 미설치 시 npx 캐시에서 자동 탐색)

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

function resolvePlaywright() {
  const envPath = process.env.PLAYWRIGHT_MODULE;
  const candidates = [];
  if (envPath) candidates.push(envPath);
  candidates.push('playwright');
  const cache = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null;
  if (cache && fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache)) {
      const p = path.join(cache, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'package.json'))) candidates.push(p);
    }
  }
  for (const c of candidates) {
    try { return require(c); } catch { /* 다음 후보 */ }
  }
  return null;
}

const pw = resolvePlaywright();
if (!pw) {
  console.error('playwright를 찾을 수 없습니다. `npx --yes playwright@1.64.1 install chromium` 후 다시 실행하세요.');
  process.exit(2);
}

const OUT = path.join(process.env.TEMP || os.tmpdir(), 'intervu-e2e');
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
function check(ok, label, detail = '') {
  if (ok) { console.log(`  ok  ${label}`); return; }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

const ADMIN_TOKEN = `e2e-admin-${Date.now()}`;
const TRENDS_FILE = path.join(OUT, `trends-${Date.now()}.json`);
const ws = fs.mkdtempSync(path.join(OUT, 'profile-'));
const answers = [
  '팀 프로젝트에서 일정이 밀린 원인을 먼저 확인했습니다. 제가 직접 담당자별 진행 상황을 표로 정리해 공유했고, 그 결과 마감 전에 검토를 마쳤습니다.',
  '갈등이 생겼을 때 저는 상대의 요구를 먼저 확인하고, 제가 양보할 수 있는 부분과 지킬 기준을 나눠 설명했습니다. 그 결과 역할을 다시 나눠 진행했습니다.',
  '아쉬웠던 점은 중간 점검을 미룬 것입니다. 다음에는 첫 주에 확인 기준을 정하고, 매주 금요일에 짧게 점검하는 절차를 만들었습니다.',
  '새로운 업무를 맡았을 때 먼저 선례와 데이터를 찾아보고, 이해관계자에게 확인한 뒤 실행 순서를 정했습니다. 시행 후에는 지표로 결과를 확인했습니다.',
];

// ---------- WP-D8: 페이지 내 접근성 감사 (의존성 없음, axe 대체) ----------
// 보이는 요소만 검사해 { labels, buttons, contrast, tap } 문제 목록을 돌려준다.
const A11Y_AUDIT = (opts) => {
  const vis = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`;
  const name = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
    if (el.labels && el.labels.length) { const t = [...el.labels].map(txt).join(' ').trim(); if (t) return t; }
    if (el.getAttribute('title')?.trim()) return el.getAttribute('title').trim();
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') return txt(el);
    return '';
  };
  const out = { labels: [], buttons: [], contrast: [], tap: [], skipped: 0 };
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (el.type === 'hidden' || !vis(el)) continue;
    if (!name(el)) out.labels.push(desc(el));
  }
  for (const el of document.querySelectorAll('button, [role=button]')) {
    if (!vis(el)) continue;
    if (!name(el)) out.buttons.push(desc(el));
  }
  const parse = (c) => {
    let m = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/);
    if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [+m[1], +m[2], +m[3], a]; }
    m = c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/);
    if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [m[1] * 255, m[2] * 255, m[3] * 255, a]; }
    return null;
  };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a === 0 ? [255, 255, 255, 1] : [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      // 그라데이션·이미지 위 텍스트는 자동 계산 불가. 단 body/html의 은은한 장식 배경은 배경색으로 근사한다(ponytail: 근사치).
      if (cs.backgroundImage !== 'none' && n !== document.body && n !== document.documentElement) return null;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let acc = [255, 255, 255, 1];
    for (const l of layers.reverse()) acc = over(l, acc);
    return acc;
  };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.disabled || el.closest('[disabled], [aria-disabled=true]')) continue;
    const cs = getComputedStyle(el);
    if (el.matches('.toast') && parseFloat(cs.opacity) < 1) continue; // 페이드 전환 중 토스트는 제외
    const fg = parse(cs.color); const bg = bgOf(el);
    if (!fg || !bg) { out.skipped += 1; continue; }
    const f = over([fg[0], fg[1], fg[2], fg[3] * (parseFloat(cs.opacity) || 1)], bg);
    const l1 = lum(f); const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) { const k = `${desc(el)}|${cs.color}|${need}`; if (!seen.has(k)) { seen.add(k); out.contrast.push(`${desc(el)} ${ratio.toFixed(2)}<${need}`); } }
  }
  if (opts.tap) {
    for (const el of document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href], summary')) {
      if (!vis(el)) continue;
      let t = el;
      if (el.matches('input[type=radio], input[type=checkbox]')) t = el.closest('label') || el; // 라벨 전체가 터치 영역
      const r = t.getBoundingClientRect();
      if (r.height + 0.5 < 44) out.tap.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  out.text = document.body.innerText;
  return out;
};

async function tabTo(page, id, max = 150) {
  const rings = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const st = await page.evaluate(() => {
      const el = document.activeElement; const cs = getComputedStyle(el);
      const lab = el.closest('label');
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none'
        || (!!lab && getComputedStyle(lab).outlineStyle !== 'none');
      return { id: el.id, tag: el.tagName, ring };
    });
    rings.push(st);
    if (st.id === id) return { found: true, steps: i + 1, rings };
  }
  return { found: false, steps: max, rings };
}

async function main() {
  const { createApp } = await import(pathToFileURL(path.resolve('src/server.js')).href);
  const app = createApp({
    env: {
      GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '', DEV_TOKEN_A: '', DEV_TOKEN_B: '',
      ADMIN_TOKEN, TRENDS_FILE, AI_SWITCH_PASSWORD: 'e2e-switch', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100',
    },
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  console.log(`server ${base} · provider ${app.providerInfo().selected}`);

  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
  const page = await context.newPage();
  const consoleErrors = []; const pageErrors = []; const badResponses = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.prompt = () => { throw new Error('window.prompt must not be used'); };
    window.confirm = () => { throw new Error('window.confirm must not be used'); };
    // 헤드리스 음성 합성은 끝 이벤트가 늦거나 없다: 즉시 끝난 것으로 처리하고 말한 문장을 기록한다.
    window.__spoken = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 5); };
  });
  const overflow = async (label) => {
    for (const w of [1440, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(o <= 1, `${label}: ${w}px 가로 오버플로 없음`, `+${o}px`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  const audit = async (label) => {
    const r = await page.evaluate(A11Y_AUDIT, { tap: false });
    check(!r.labels.length, `${label}: 입력 이름`, r.labels.join(', '));
    check(!r.buttons.length, `${label}: 버튼 이름`, r.buttons.join(', '));
    check(!r.contrast.length, `${label}: 대비`, r.contrast.slice(0, 5).join(', '));
    const banned = /합격\s*(가능성|확률|예측)|정확(히|한)\s*(AI\s*)?(평가|채점)|순위|백분위/;
    check(!banned.test(r.text.replace(/합격 예측이 아닙니다/g, '')), `${label}: 금지 표현 없음`);
  };

  try {
    console.log('\n[1] 로그인·가입');
    await page.goto(base, { waitUntil: 'networkidle' });
    check(page.url().endsWith('#/login'), '토큰 없으면 로그인 화면');
    check(await page.locator('#screen-login').isVisible(), '로그인 화면 보임');
    await page.click('#tabSignup');
    await page.fill('#signupForm [name=name]', '이투이');
    await page.fill('#signupForm [name=email]', `e2e-${Date.now()}@intervu.test`);
    await page.fill('#signupForm [name=password]', 'e2e-local-only-1');
    await page.click('#signupBtn');
    check(await page.locator('#authError').innerText() !== '', '연령·고지 미확인 가입은 막힘');
    await page.check('#signupForm [name=age_18_confirmed]');
    await page.check('#signupForm [name=notice_ack]');
    await page.click('#signupBtn');
    await page.waitForURL(/#\/dashboard/);
    check(await page.locator('#userName').innerText() === '이투이님', '상단에 사용자 이름');
    await audit('로그인 후 대시보드');

    console.log('\n[2] 대시보드');
    const screens = await page.locator('[data-screen]').evaluateAll((els) => els.map((e) => e.dataset.screen));
    check(screens.join(',') === 'login,dashboard,application,evidence,setup,room,feedback', '화면 7개(부가기능 없음)', screens.join(','));
    check(await page.locator('[data-journey]').count() === 1, '대입 여정 하나');
    check(!(await page.locator('text=자료 없이').count()), '자료 없이 일반 연습 없음');
    // AI 스위치: 비밀번호가 맞아야 바뀐다
    check(await page.locator('#aiSwitch').getAttribute('aria-checked') === 'true', 'AI 스위치 기본 켜짐');
    await page.click('#aiSwitch');
    check(await page.locator('#confirmInput').getAttribute('type') === 'password', '스위치 비밀번호는 가려서 입력');
    await page.fill('#confirmInput', 'wrong');
    await page.click('#confirmOk');
    await page.waitForTimeout(800);
    check(await page.locator('#aiSwitch').getAttribute('aria-checked') === 'true', '틀린 비밀번호면 스위치가 바뀌지 않음');
    await page.click('#aiSwitch');
    await page.fill('#confirmInput', 'e2e-switch');
    await page.click('#confirmOk');
    await page.waitForFunction(() => document.querySelector('#aiSwitch').getAttribute('aria-checked') === 'false');
    check(true, '맞는 비밀번호로 AI 끔');
    await page.click('#aiSwitch');
    await page.fill('#confirmInput', 'e2e-switch');
    await page.click('#confirmOk');
    await page.waitForFunction(() => document.querySelector('#aiSwitch').getAttribute('aria-checked') === 'true');
    check(true, '맞는 비밀번호로 AI 켬');
    await page.click('#journeyUniversity');

    console.log('\n[3] 지원 정보');
    await page.waitForURL(/#\/application/);
    await page.waitForFunction(() => document.querySelectorAll('#fixtureSelect option').length >= 11);
    check(await page.locator('#fixtureSelect option').count() === 11, '샘플 10건');
    check(await page.locator('[name=experiences]').count() === 0 && !(await page.locator('text=경험 메모').count()), '경험 메모 입력 없음');
    check(await page.locator('#screen-application .back-btn').count() === 1 && await page.locator('#applicationForm .sticky-actions .ghost').count() === 0, '지원 정보: 위쪽 뒤로가기, 아래에는 다음 버튼만');
    check(!(await page.locator('#docFile').count()), '파일 업로드 숨김');
    await page.selectOption('#fixtureSelect', 'smp-snu-bio');
    await page.click('#loadFixtureBtn');
    await page.waitForFunction(() => document.querySelector('[name=school_name]').value === '서울대학교');
    check(await page.locator('#fixtureBadge').isVisible(), '샘플 배지');
    await overflow('지원 정보');
    await page.click('#analyzeBtn');

    console.log('\n[4] 근거 확인');
    await page.waitForURL(/#\/evidence/);
    await page.waitForFunction(() => { const t = document.querySelector('#ev-comp')?.innerText || ''; return t.length > 10 && !t.includes('검색 중'); }, null, { timeout: 15000 });
    check(await page.locator('#evDetail, #detailToggle').count() === 0, '근거 확인에는 세부 조정(지원서 근거·질문 목록)이 없다(결과 뒤로 이동)');
    check(await page.locator('#screen-evidence .back-btn').count() === 1 && await page.locator('#evidenceCard > .actions .ghost').count() === 0, '뒤로가기는 위쪽 버튼 하나, 아래에는 다음(승인) 버튼만');
    check((await page.locator('#ev-search').innerText()).includes('서울대학교'), '학교·전형 정보 표시');
    check(await page.locator('#editCompBtn[aria-label="직접 수정"]').count() === 1 && await page.locator('#editFormatBtn').count() === 1, '렌치 버튼 2개');
    // 뒤로 갔다가 수정 없이 다시 다음: 이미 분석한 결과를 그대로 쓴다(새 프로필·분석 요청 없음)
    let created = 0;
    const onReq = (r) => { if (r.method() === 'POST' && new RegExp('/api/v1/profiles(/[^/]+/school-analysis)?$').test(r.url())) created++; };
    page.on('request', onReq);
    await page.click('#screen-evidence .back-btn');
    await page.waitForURL(/#\/application/);
    await page.click('#analyzeBtn');
    await page.waitForURL(/#\/evidence/);
    page.off('request', onReq);
    check(created === 0, '수정 없이 뒤로 갔다 오면 다시 분석하지 않음', String(created));
    await page.click('#editCompBtn');
    await page.fill('#confirmText', '과학적 추론\n탐구 논리성');
    await page.click('#confirmOk');
    await page.waitForFunction(() => document.querySelector('#ev-comp').innerText.includes('과학적 추론'));
    await page.click('#editFormatBtn');
    const disabled = await page.locator('#confirmChoice option[disabled]').count();
    check(disabled === 5, '특수 면접 5종 선택 불가', String(disabled));
    await page.click('#confirmCancel');
    // 지원서 분석 직후 검색이 자동으로 한 번 실행된다(서버가 꺼 두면 사유 표시). 버튼은 다시 검색.
    await page.waitForFunction(() => document.querySelector('#searchNote')?.textContent.includes('꺼져'));
    
    check((await page.locator('#searchNote').innerText()).includes('검색 기능이 꺼져'), '검색 꺼짐 사유 표시');
    await audit('근거 확인');
    await overflow('근거 확인');
    await page.click('#approveBtn');

    console.log('\n[5] 면접 준비');
    await page.waitForURL(/#\/setup/);
    check(await page.locator('#setupForm input[value=groq]').isDisabled(), '서버 전사 없으면 음성 선택 불가');
    check(await page.locator('#setupForm input[value=text]').isChecked(), '텍스트로 시작');
    await page.click('#startBtn');

    console.log('\n[6] 면접실');
    await page.waitForURL(/#\/room/);
    check(!(await page.locator('#roomHint, #sttRecBtn, #progressWrap').count()), '근거·녹음 버튼·진행률 없음');
    let turns = 0;
    while (page.url().includes('#/room') && turns < 12) {
      await page.waitForFunction(() => !document.querySelector('#textAnswer').hidden || !location.hash.includes('room'), null, { timeout: 15000 });
      if (!page.url().includes('#/room')) break;
      if (turns === 0) {
        check(/0[01]:[0-9]{2}/.test(await page.locator('#clock').innerText()), '답변 제한 1분 시계');
        await audit('면접실');
        await overflow('면접실');
      }
      await page.fill('#answerText', answers[turns % answers.length]);
      await page.click('#answerBtn');
      turns += 1;
      await page.waitForTimeout(300);
    }
    const spoken = await page.evaluate(() => window.__spoken);
    check(spoken.some((t) => t.includes('지금부터 면접을 시작하겠습니다')), '시작 인사');
    check(spoken.includes('네 답변 잘 들었습니다.'), '답변 확인 문장');
    check(spoken.some((t) => t.includes('면접을 마치겠습니다')), '마무리 문장');

    console.log('\n[7] 결과');
    await page.waitForURL(/#\/feedback/, { timeout: 20000 });
    await page.waitForSelector('.qa');
    check(await page.locator('.report-charts svg').count() >= 2, '차트 SVG(점수·차원)');
    check(await page.locator('.report-charts .hbar').count() >= 1, '역량 적합성 막대');
    await page.waitForFunction(() => !document.querySelector('#reportDetail')?.hidden, null, { timeout: 8000 });
    check(await page.locator('#reportDetail .claims li').count() >= 1 && await page.locator('#reportDetail .plan-list li').count() === 5, '세부 정보(지원서 근거·질문 5개)는 결과 맨 뒤');
    check(await page.evaluate(() => { const d = document.querySelector('#reportDetail'); const last = document.querySelector('#feedbackBody').lastElementChild; return d === last; }), '세부 정보가 결과 화면의 마지막 요소');
    check(await page.locator('.qa:not(.followup)').count() === 5, '본질문 5개');
    const info = page.locator('.qa .icon-btn.info').first();
    await info.click();
    check(await info.getAttribute('aria-expanded') === 'true' && await page.locator('.qa-evidence:not([hidden])').count() === 1, 'i 버튼으로 근거 열림');
    check(!(await page.locator('text=재연습').count()), '재연습 없음');
    await audit('결과');
    await overflow('결과');

    console.log('\n[8] 로그아웃');
    await page.click('#logoutBtn');
    await page.waitForURL(/#\/login/);
    check(await page.locator('#screen-login').isVisible(), '로그아웃 후 로그인 화면');
    check(await page.evaluate(() => !localStorage.getItem('intervu.token')), '토큰 삭제');
  } catch (e) {
    failures.push(`예외: ${e.message}`);
    await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
  } finally {
    check(!pageErrors.length, '페이지 오류 없음', pageErrors.join(' | '));
    check(!consoleErrors.filter((m) => !/Failed to load resource/.test(m)).length, '콘솔 오류 없음', consoleErrors.join(' | '));
    const unexpected = badResponses.filter((r) => !/\/auth\/signup|^401 POST .*\/ai-switch/.test(r)); // 가입 중복 확인·틀린 스위치 비밀번호는 의도된 거절
    check(!unexpected.length, '예상하지 않은 4xx/5xx 없음', unexpected.join(' | '));
    await browser.close();
    app.server.close();
  }
  console.log(failures.length ? `\nE2E FAIL ${failures.length}건` : '\nE2E OK');
  process.exitCode = failures.length ? 1 : 0;
}

main();
