// 9화면 UI E2E (Mock 전용, 외부 키 없음)
// - 실제 서버를 임시 포트로 띄우고 Chromium으로 대시보드→지원정보→근거→설정→면접실→피드백→재연습→기록→관리자 흐름을 검증한다.
// - window.prompt/confirm 이 호출되면 실패한다(대화상자로 대체되었는지 확인).
// - 1440 / 768 / 390 폭에서 가로 오버플로가 없어야 한다.
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
      GEMINI_API_KEY: '', GROQ_WHISPER_KEY: '', GROQ_API_KEY: '',
      DEV_TOKEN_A: 'e2e-user-a', DEV_TOKEN_B: 'e2e-user-b',
      ADMIN_TOKEN, TRENDS_FILE, PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100',
    },
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  console.log(`server ${base} · provider ${app.providerInfo().selected}`);
  // WP-D3: 동의는 UI의 연령·처리 안내 대화상자로 기록한다(사전 POST 없음).

  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

  await page.addInitScript(() => {
    localStorage.setItem('intervu.token', 'e2e-user-a');
    window.prompt = () => { throw new Error('window.prompt must not be used'); };
    window.confirm = () => { throw new Error('window.confirm must not be used'); };
  });

  try {
    // ---------- 1. 대시보드 ----------
    console.log('\n[1] 대시보드');
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-dashboard:not([hidden])');
    const screenCount = await page.locator('[data-screen]').count();
    check(screenCount === 9, '9개 화면 컨테이너', `found ${screenCount}`);
    const journeys = await page.locator('.journey-card').evaluateAll((els) => els.map((e) => e.dataset.journey));
    check(journeys.length === 2 && journeys.includes('company') && journeys.includes('university'), '기업/대학 여정만 노출', journeys.join(','));
    const bodyText = await page.locator('body').innerText();
    check(!/고등학교|공공기관/.test(bodyText), '일반 기관 유형이 주 흐름에 없음');
    check(await page.locator('#modeChip').innerText().then((t) => /Mock/.test(t)), 'Mock 모드 표시');
    await page.screenshot({ path: path.join(OUT, '01-dashboard-1440.png'), fullPage: true });

    // ---------- 2. 지원 정보 ----------
    console.log('\n[2] 지원 정보');
    await page.click('#journeyCompany');
    await page.waitForSelector('#screen-application:not([hidden])');
    check(await page.locator('#applicationTitle').innerText() === '기업 지원 정보', '기업 지원 정보 제목');
    await page.fill('#applicationForm [name=target_name]', '한빛테크');
    await page.fill('#applicationForm [name=role]', '서비스 기획');
    await page.fill('#sourceText', '핵심가치: 고객 중심, 문제 해결, 협업. 면접은 10분 직무·인성 면접으로 진행합니다.');
    await page.fill('#applicationForm [name=experiences]', '팀 프로젝트에서 일정 조정\n고객 인터뷰 정리');
    await page.fill('#applicationText', '저는 동아리 회장을 맡아 행사를 운영했습니다. 팀 프로젝트에서 갈등을 해결했습니다.');
    check(await page.locator('#appStepper [aria-current=step]').innerText().then((t) => /지원 정보/.test(t)), '스테퍼 1단계 표시');
    await page.screenshot({ path: path.join(OUT, '02-application-1440.png'), fullPage: true });
    await page.click('#analyzeBtn');
    await page.waitForSelector('#consentDialog[open]', { timeout: 10000 });
    check(/30일/.test(await page.locator('#consentDialog').innerText()), '동의 대화상자 30일 보존 안내');
    check(await page.locator('#consentOk').isDisabled(), '연령 체크 전 동의 버튼 비활성');
    await page.check('#consentAge');
    await page.click('#consentOk');
    await page.waitForSelector('#screen-evidence:not([hidden])', { timeout: 15000 });

    // ---------- 3. 근거 확인 ----------
    console.log('\n[3] 근거 확인');
    const evText = await page.locator('#evidenceBody').innerText();
    check(evText.length > 10, '근거 본문 렌더');
    check(/지원서 주장/.test(evText) && /팀 프로젝트에서 갈등을 해결했습니다/.test(evText), '지원서 주장 원문 인용 표시');
    check(/문장에 없는 정보/.test(evText), '지원서 문장 공백 표시');
    check(await page.locator('#evidenceState').innerText() === '확인 필요', '승인 전 상태 표시');
    await page.fill('#evidenceNote', '핵심가치 3개 확인, 면접 형식 확인');
    await page.screenshot({ path: path.join(OUT, '02-evidence-1440.png'), fullPage: true });
    check(/거짓 여부를 판정하지 않습니다/.test(evText), '근거 화면 고정 문구(거짓 여부 미판정)');
    check(/월간 트렌드\(보조\)/.test(evText) && /공식·출처/.test(evText) && /공고 키워드·핵심 가치/.test(evText), '근거 화면 섹션 라벨');
    check(await page.locator('#evidenceBody .stepper li.current').innerText() === '2. 근거 확인', '근거 화면 스테퍼 ②');
    await page.setViewportSize({ width: 390, height: 844 });
    const evOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(evOverflow <= 1, '근거 화면 오버플로 없음 @390px', `overflow ${evOverflow}px`);
    await page.screenshot({ path: path.join(OUT, '02-evidence-390.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('#approveBtn');
    await page.waitForSelector('#screen-setup:not([hidden])');

    // ---------- 4. 면접 설정 ----------
    console.log('\n[4] 면접 설정');
    await page.check('#setupForm input[name=duration_minutes][value="5"]', { force: true });
    await page.check('#setupForm input[name=persona][value=supportive]', { force: true });
    await page.check('#setupForm input[name=input_mode][value=text]', { force: true });
    await page.check('#setupForm input[name=blind]');
    check(await page.locator('#setupSummary').innerText().then((t) => /근거 승인 완료/.test(t)), '승인 요약 표시');
    await page.waitForFunction(() => /꼬리질문/.test(document.querySelector('#setupSummary')?.textContent || ''), null, { timeout: 5000 });
    const sum = await page.locator('#setupSummary').innerText();
    check(/꼬리질문\s*Mock/.test(sum) && /외부 AI가 설정되지 않아|Mock으로 동작/.test(sum), '설정 요약: operation별 Mock + 차단 사유(한국어)', sum.replace(/\s+/g, ' ').slice(0, 160));
    check(/사용할 근거: 지원서 주장/.test(sum), '설정 요약: 사용할 근거 수');
    check(await page.locator('#modeChip').innerText() === 'Mock 모드 · 외부 전송 없음', '앱바 모드 칩 문구(/providers/status 기반)');
    check(!(await page.locator('#interviewTypeSelect').isVisible()), '면접 유형은 고급(실험) 접힘 안에 있음');
    check(/고급\(실험\)/.test(await page.locator('#advancedBox summary').innerText()), '고급(실험) 라벨');
    check(await page.locator('#interviewTypeSelect').inputValue() === 'general', '면접 유형 기본값 일반·인성');
    check(await page.locator('#blindNote').isVisible(), '블라인드 고지 표시');
    await page.screenshot({ path: path.join(OUT, '03-setup-1440.png'), fullPage: true });
    await page.click('#startBtn');
    await page.waitForSelector('#screen-room:not([hidden])', { timeout: 15000 });

    // ---------- 5. 실전 면접실 ----------
    console.log('\n[5] 실전 면접실');
    check((await page.locator('#roomTitle').innerText()).length > 5, '첫 질문 표시');
    check(/자기소개서에 “/.test(await page.locator('#roomTitle').innerText()), '첫 질문이 지원서 문장을 인용');
    check(/지원서 근거/.test(await page.locator('#roomHint').innerText()), '질문 근거(원문 위치) 표시');
    check(await page.locator('#clock').innerText().then((t) => /^\d{2}:\d{2}$/.test(t)), '타이머 표시');
    check(await page.locator('#providerBanner').isHidden(), 'Mock 정상 동작 중에는 폴백 배너 없음');
    check(await page.locator('#roomHint .ev-toggle').count() === 1, '근거 칩(펼침 버튼)');
    await page.click('#roomHint .ev-toggle');
    check(await page.locator('#roomHint blockquote q').isVisible(), '근거 칩 클릭 시 원문 인용 펼침');
    check(await page.locator('#roomProgressText').innerText().then((t) => /^질문 1 \/ \d+$/.test(t)), '질문 진행 n/N');
    // 새로고침 복원: 서버 상태에서 질문·남은 시간을 되살린다
    const titleBefore = await page.locator('#roomTitle').innerText();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-room:not([hidden])', { timeout: 10000 });
    await page.waitForFunction((t) => document.querySelector('#roomTitle')?.textContent === t, titleBefore, { timeout: 10000 });
    check(await page.locator('#clock').innerText().then((t) => /^0[0-5]:\d{2}$/.test(t)), '새로고침 후 세션·타이머 복원');
    // 일시정지/재개 (오버레이)
    await page.click('#pauseBtn');
    await page.waitForFunction(() => document.querySelector('#roomState')?.textContent === '일시정지');
    check(await page.locator('#pauseOverlay').isVisible(), '일시정지 오버레이');
    await page.screenshot({ path: path.join(OUT, '03b-room-paused-1440.png'), fullPage: true });
    await page.click('#resumeBtn');
    await page.waitForFunction(() => document.querySelector('#roomState')?.textContent === 'LIVE');
    check(await page.locator('#pauseOverlay').isHidden(), '재개 시 오버레이 닫힘');
    // 빈 답변 안내(입력 보존·행동 안내)
    await page.fill('#answerText', '');
    await page.click('#answerBtn');
    check(/답변을 입력해 주세요/.test(await page.locator('#roomError').innerText()), '빈 답변 안내');
    // 종료 확인 다이얼로그: 기본 포커스는 취소, 취소하면 면접 유지
    await page.click('#finishBtn');
    await page.waitForSelector('#confirmDialog[open]');
    check(/지금까지의 답변으로 보고서를 만듭니다/.test(await page.locator('#confirmMessage').innerText()), '종료 확인 문구');
    await page.waitForFunction(() => document.activeElement?.id === 'confirmCancel', null, { timeout: 2000 }).catch(() => {});
    check(await page.evaluate(() => document.activeElement?.id) === 'confirmCancel', '종료 확인 기본 포커스는 취소');
    await page.click('#confirmCancel');
    check(await page.locator('#screen-room:not([hidden])').count() === 1, '종료 취소 시 면접 유지');
    await page.screenshot({ path: path.join(OUT, '03c-room-1440.png'), fullPage: true });
    // 모바일: 하단 고정 행동 바가 화면 안에 보이고 가로 오버플로가 없다
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForTimeout(150);
    const bar = await page.locator('#roomActions').boundingBox();
    check(bar && bar.y + bar.height <= 700 + 1, '모바일 행동 바가 뷰포트 하단에 고정', JSON.stringify(bar));
    check((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, '면접실 가로 오버플로 없음 @390px');
    await page.screenshot({ path: path.join(OUT, '03d-room-390.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    let answered = 0;
    for (let i = 0; i < 10; i += 1) {
      if (await page.locator('#screen-feedback:not([hidden])').count()) break;
      if (!(await page.locator('#screen-room:not([hidden])').count())) break;
      await page.fill('#answerText', answers[answered % answers.length]);
      answered += 1;
      await page.click('#answerBtn');
      await page.waitForTimeout(450);
    }
    if (await page.locator('#screen-room:not([hidden])').count()) { await page.click('#finishBtn'); await page.click('#confirmOk'); }
    await page.waitForSelector('#screen-feedback:not([hidden])', { timeout: 20000 });
    await page.waitForSelector('#feedbackBody .report', { timeout: 20000 });
    check(answered >= 2, '답변 제출', `${answered}회`);

    // ---------- 6. 피드백 ----------
    console.log('\n[6] 피드백');
    const reportText = await page.locator('#feedbackBody').innerText();
    check(/규칙 기반 참고 관찰/.test(reportText), '규칙 기반 고지');
    check(!/합격 확률|합격률/.test(reportText), '합격 예측 문구 없음');
    check(/지원서 주장과 실제 답변/.test(reportText), '지원서 주장↔답변 연결 표시');
    check(/판단 보류|\/ 4/.test(reportText), '수준 또는 판단 보류 표시');
    const evidenceQuotes = await page.locator('#feedbackBody .evidence q').count();
    check(evidenceQuotes > 0, '실제 발언 인용', `${evidenceQuotes}개`);
    check(/가장 먼저 바꿀 것/.test(reportText) && /사실 여부를 판정하지 않습니다/.test(reportText), '히어로 카드·판정 안 함 문구');
    await page.screenshot({ path: path.join(OUT, '04-feedback-1440.png'), fullPage: true });

    // ---------- 7. 재연습 비교 ----------
    console.log('\n[7] 재연습 비교');
    const practiceCount = await page.locator('[data-practice]').count();
    check(practiceCount > 0, '재연습 버튼 존재');
    if (practiceCount > 0) {
      await page.locator('[data-practice]').first().click();
      await page.waitForSelector('#screen-repractice:not([hidden])', { timeout: 15000 });
      const cmpText = await page.locator('#repracticeBody').innerText();
      check(/이전 질문/.test(cmpText) && /지금 질문/.test(cmpText), '두 질문 병렬 표시');
      await page.screenshot({ path: path.join(OUT, '05-repractice-1440.png'), fullPage: true });
      await page.click('#startRepracticeBtn');
      await page.waitForSelector('#screen-room:not([hidden])', { timeout: 15000 });
      const rq = await page.locator('#roomTitle').innerText();
      check(rq.length > 0, '새 질문 표시');
      await page.fill('#answerText', '다른 협업 상황에서 제가 먼저 확인 질문을 정리해 공유했고, 합의된 기준으로 역할을 다시 나눴습니다. 결과적으로 재작업이 줄었습니다.');
      await page.click('#answerBtn');
      await page.waitForTimeout(600);
      await page.click('#finishBtn');
      await page.click('#confirmOk');
      await page.waitForSelector('#comparisonBox .comparison', { timeout: 30000 });
      await page.waitForSelector('#screen-repractice:not([hidden])');
      const comparison = await page.locator('.comparison').innerText();
      check(/비교 결과/.test(comparison), '비교 결과 렌더');
      check(/판단 보류|관찰된 변화|뚜렷한 변화 없음/.test(comparison), '비교 상태 라벨');
      check(/학습 효과를 입증하지 않습니다/.test(comparison), '과장 방지 고지');
      await page.screenshot({ path: path.join(OUT, '06-comparison-1440.png'), fullPage: true });
    }

    // ---------- 8. 기록·데이터 ----------
    console.log('\n[8] 기록·데이터');
    await page.click('.navbtn[data-go=history]');
    await page.waitForSelector('#screen-history:not([hidden])');
    await page.waitForFunction(() => !/불러오는 중/.test(document.querySelector('#historyBody')?.textContent || ''));
    const historyText = await page.locator('#historyBody').innerText();
    check(/면접/.test(historyText), '기록 목록 표시');
    check(/Mock/.test(await page.locator('#providerDetail').innerText()), '공급자 상세 표시');
    check(/재시작/.test(await page.locator('#restartNote').innerText()), '재시작 시 기록 소실 안내');
    await page.screenshot({ path: path.join(OUT, '07-history-1440.png'), fullPage: true });

    // ---------- 9. 관리자 ----------
    console.log('\n[9] 관리자');
    await page.evaluate(() => { location.hash = '#/admin'; });
    await page.waitForSelector('#screen-admin:not([hidden])');
    await page.waitForSelector('#adminGate:not([hidden])');
    await page.fill('#adminTokenInput', 'wrong-token');
    await page.click('#adminUnlockBtn');
    await page.waitForFunction(() => /올바르지 않습니다|인증/.test(document.querySelector('#adminError')?.textContent || ''), null, { timeout: 10000 });
    check(await page.locator('#adminPanel').isHidden(), '잘못된 토큰은 관리자 패널 차단');
    check(await page.locator('#adminError').innerText().then((t) => /관리자 토큰이 올바르지 않습니다/.test(t)), '잘못된 토큰 오류 안내');

    await page.fill('#adminTokenInput', ADMIN_TOKEN);
    await page.click('#adminUnlockBtn');
    await page.waitForSelector('#adminPanel:not([hidden])', { timeout: 15000 });
    const month = await page.locator('#trendForm [name=yyyy_mm]').inputValue();
    check(/^\d{4}-\d{2}$/.test(month), '관리자 연월 기본값', month);
    await page.fill('#trendItems .trend-competency', '문제 해결');
    await page.fill('#trendItems .trend-comment', '최근 공고에서 문제 해결 요구가 늘었습니다.');
    await page.fill('#trendForm [name=sources]', 'https://example.com/trend-source');
    await page.click('#trendForm button[type=submit]');
    check(/체크리스트/.test(await page.locator('#trendError').innerText()), '체크리스트 미확인 시 저장 차단');
    for (const c of await page.locator('#reviewChecklist .review-check').all()) await c.check();
    await page.click('#trendForm button[type=submit]');
    await page.waitForFunction(() => /v\d+/.test(document.querySelector('#trendList')?.textContent || ''), null, { timeout: 15000 });
    check(/초안/.test(await page.locator('#trendList').innerText()), '초안 등록');
    await page.click('[data-publish]');
    await page.waitForSelector('#confirmDialog[open]');
    await page.click('#confirmOk');
    await page.waitForSelector('[data-rollback]', { timeout: 15000 });
    check(await page.locator('[data-rollback]').count() > 0, '공개 후 롤백 버튼');
    await page.click('[data-rollback]');
    await page.waitForSelector('#confirmDialog[open]');
    await page.click('#confirmOk');
    await page.waitForTimeout(1200);
    check(/롤백/.test(await page.locator('#trendList').innerText()), '롤백 새 버전 기록');
    check(/현재 공개/.test(await page.locator('#trendList').innerText()), '현재 공개 버전 표시');
    check(/사용자에게는 이렇게 보입니다/.test(await page.locator('#adminPanel').innerText()), '공개본 미리보기 문구');
    await page.screenshot({ path: path.join(OUT, '08-admin-1440.png'), fullPage: true });

    // 공개된 월간 자료가 사용자 조회에 노출되는지
    const trendRes = await page.evaluate(async (m) => {
      const seg = 'company';
      const r = await fetch(`/api/v1/trends/${seg}/${m}`, { headers: { Authorization: 'Bearer e2e-user-a' } });
      return { status: r.status, body: await r.json() };
    }, month);
    check(trendRes.status === 200 && trendRes.body.status === 'monthly_trend', '공개 트렌드 사용자 노출', JSON.stringify(trendRes.body).slice(0, 120));

    // ---------- 해시 라우팅: 9개 화면 도달 ----------
    console.log('\n[10] 라우팅·반응형');
    const screens = ['dashboard', 'application', 'evidence', 'setup', 'room', 'feedback', 'repractice', 'history', 'admin'];
    for (const s of screens) {
      await page.evaluate((n) => { location.hash = `#/${n}`; }, s);
      await page.waitForTimeout(120);
      // 가드: 진행 중 세션이 없으면 면접실은 대시보드로 되돌려진다
      const expected = s === 'room' ? 'dashboard' : s;
      check(await page.locator(`#screen-${expected}:not([hidden])`).count() === 1, `화면 도달: ${s}`, expected !== s ? `→ ${expected}` : '');
      if (s === 'application') check((await page.title()).includes('지원 정보'), '화면별 document.title');
      if (s === 'history') check(await page.evaluate(() => document.activeElement?.tagName) === 'H1', '화면 전환 시 h1 포커스');
    }

    // WP-D8 1단계: 면접실을 뺀 8화면 감사(진행 중 세션이 생기면 가드가 코칭 등을 면접실로 되돌리므로 먼저 수행)
    const { containsBannedExpression } = await import(pathToFileURL(path.resolve('public/core/copy.js')).href);
    const AGG = {};
    for (const w of [1440, 768, 390]) AGG[w] = { overflow: [], labels: [], buttons: [], contrast: [], tap: [], banned: [], h1: [], skipped: 0 };
    async function auditScreens(list, width, agg) {
      for (const s of list) {
        await page.evaluate((n) => { location.hash = `#/${n}`; }, s);
        await page.waitForTimeout(250);
        const shown = await page.evaluate(() => [...document.querySelectorAll('[data-screen]')].find((e) => !e.hidden)?.id);
        if (shown !== `screen-${s}`) { agg.overflow.push(`${s}(도달 실패:${shown})`); continue; }
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(ov <= 1, `가로 오버플로 없음 ${s} @${width}px`, `overflow ${ov}px`);
        if (ov > 1) agg.overflow.push(s);
        if (width !== 768) await page.screenshot({ path: path.join(OUT, `12-${s}-${width}.png`), fullPage: true });
        const r = await page.evaluate(A11Y_AUDIT, { tap: width === 390 });
        for (const k of ['labels', 'buttons', 'contrast', 'tap']) r[k].forEach((x) => agg[k].push(`${s}:${x}`));
        agg.skipped += r.skipped;
        if (containsBannedExpression(r.text)) agg.banned.push(`${s}:${r.text.split(/\n/).filter((l) => containsBannedExpression(l)).join('/').slice(0, 120)}`);
        if (await page.evaluate(() => document.activeElement?.tagName) !== 'H1') agg.h1.push(s);
      }
    }
    for (const w of [1440, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await auditScreens(screens.filter((s) => s !== 'room'), w, AGG[w]);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 새로고침 복원: 완료 세션 → 코칭, 승인된 프로필 → 설정
    console.log('\n[10a] 새로고침 복원·가드');
    await page.evaluate(() => { location.hash = '#/setup'; });
    await page.waitForSelector('#screen-setup:not([hidden])');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-setup:not([hidden])');
    check(true, '새로고침 후 승인된 프로필로 설정 복원');
    await page.evaluate(() => { location.hash = '#/feedback'; });
    await page.waitForSelector('#screen-feedback:not([hidden])');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-feedback:not([hidden])');
    check(await page.locator('#feedbackBody .evidence, #feedbackBody q, #feedbackBody blockquote').count() > 0 || /인용|관찰|판단 보류/.test(await page.locator('#feedbackBody').innerText()), '새로고침 후 코칭 복원');
    // 진행 중 세션: 대시보드 "이어서 하기" → 면접실, 새로고침해도 면접실 복원
    const made = await page.evaluate(async () => {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('intervu.token')}`, 'Idempotency-Key': crypto.randomUUID() };
      const r = await fetch('/api/v1/sessions', { method: 'POST', headers: h, body: JSON.stringify({ interview_type: 'general', persona: 'standard', blind: false, duration_minutes: 5, input_mode: 'text', consent_version: 'mvp-2026-10' }) });
      return r.status;
    });
    check(made === 201 || made === 200, '진행 중 세션 준비', `status ${made}`);
    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#continueCard:not([hidden])', { timeout: 8000 });
    check(true, '대시보드에 이어서 하기 카드');
    check(await page.locator('#recentList .list-item').count() <= 3, '최근 연습 최대 3건');
    await page.click('#continueBtn');
    await page.waitForSelector('#screen-room:not([hidden])', { timeout: 8000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#screen-room:not([hidden])', { timeout: 8000 });
    check((await page.locator('#roomTitle').innerText()).length > 3 && !/불러오는 중/.test(await page.locator('#roomTitle').innerText()), '새로고침 후 면접실 복원(질문 표시)');
    // 가드: 상태 없는 새 컨텍스트에서 증거 화면 직접 진입 → 지원 정보로 안내
    const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
    await ctx3.addInitScript(() => localStorage.setItem('intervu.token', 'e2e-user-a'));
    const p3 = await ctx3.newPage();
    await p3.goto(`${base}/#/evidence`, { waitUntil: 'networkidle' });
    await p3.waitForSelector('#screen-application:not([hidden])');
    check(/먼저|입력/.test(await p3.locator('#toast').innerText()), '가드 안내 토스트');
    await p3.goto(`${base}/#/room`, { waitUntil: 'networkidle' });
    await p3.waitForSelector('#screen-dashboard:not([hidden])');
    check(true, '면접실 직접 진입 시 대시보드로 이동');
    await ctx3.close();

    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { location.hash = '#/dashboard'; });
      await page.waitForSelector('#screen-dashboard:not([hidden])');
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 1, `가로 오버플로 없음 @${width}px`, `overflow ${overflow}px`);
      await page.screenshot({ path: path.join(OUT, `09-dashboard-${width}.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { location.hash = '#/application'; });
    await page.waitForSelector('#screen-application:not([hidden])');
    await page.waitForTimeout(200);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(mobileOverflow <= 1, '지원 정보 화면 오버플로 없음 @390px', `overflow ${mobileOverflow}px`);
    await page.screenshot({ path: path.join(OUT, '10-application-390.png'), fullPage: true });

    // ---------- 합성 샘플 경로 (동의 없이 fixture_id로 진행) ----------
    console.log('\n[2b] 합성 샘플 경로');
    {
      const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
      const pf = await ctxF.newPage();
      await pf.addInitScript(() => localStorage.setItem('intervu.token', 'e2e-user-b'));
      await pf.goto(base + '/#/dashboard', { waitUntil: 'networkidle' });
      await pf.click('#journeyCompany');
      await pf.click('#loadFixtureBtn');
      await pf.waitForSelector('#fixtureBadge:not([hidden])');
      check(await pf.locator('#fixtureBadge').innerText() === '합성 샘플', '합성 샘플 배지');
      await pf.click('#analyzeBtn');
      await pf.waitForSelector('#screen-evidence:not([hidden])', { timeout: 15000 });
      check(!(await pf.locator('#consentDialog[open]').count()), '합성 샘플은 동의 대화상자 없이 진행');
      await ctxF.close();
    }

    // ---------- 12. 접근성·반응형·카피 QA (WP-D8) ----------
    console.log('\n[12] 접근성·반응형·카피');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const agg = AGG[width];
      await auditScreens(['room'], width, agg);
      const uniq = (a) => [...new Set(a)];
      console.log(`  (대비 자동 계산 제외 ${agg.skipped}건: 그라데이션·이미지 배경 위 텍스트) @${width}px`);
      check(agg.overflow.every((x) => !x.includes('도달')), `9화면 모두 도달 @${width}px`, agg.overflow.join(','));
      check(agg.labels.length === 0, `모든 입력에 접근 가능한 이름 @${width}px`, uniq(agg.labels).slice(0, 4).join(' | '));
      check(agg.buttons.length === 0, `모든 버튼에 접근 가능한 이름 @${width}px`, uniq(agg.buttons).slice(0, 4).join(' | '));
      check(agg.contrast.length === 0, `텍스트 대비 4.5:1(큰 글자 3:1) @${width}px`, uniq(agg.contrast).slice(0, 5).join(' | ') + ` (자동 계산 제외 ${agg.skipped})`);
      if (width === 390) check(agg.tap.length === 0, '모바일 터치 영역 ≥44px(버튼·입력·요약)', uniq(agg.tap).slice(0, 8).join(' | '));
      check(agg.banned.length === 0, `금지 표현 없음(렌더 텍스트 9화면) @${width}px`, agg.banned.join(','));
      check(agg.h1.length === 0, `화면 전환 시 h1 포커스(9화면) @${width}px`, agg.h1.join(','));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    check(await page.locator('[aria-live=polite], [role=status]').count() >= 1 && await page.locator('[aria-live=assertive], [role=alert]').count() >= 1, 'aria-live polite·assertive 영역 존재');

    // 다이얼로그: 포커스 트랩·ESC·반환 포커스
    await page.evaluate(() => { location.hash = '#/room'; });
    await page.waitForSelector('#screen-room:not([hidden])');
    await page.focus('#finishBtn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#confirmDialog[open]');
    // 네이티브 showModal은 뒤 페이지를 inert로 만든다: 포커스는 대화상자 안이거나 브라우저 UI(body)에만 있어야 한다.
    let trapped = true;
    const inDialogOrChrome = () => page.evaluate(() => { const a = document.activeElement; return !!a?.closest('#confirmDialog') || a === document.body || a === document.documentElement; });
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      if (!(await inDialogOrChrome())) trapped = false;
    }
    await page.keyboard.press('Shift+Tab');
    if (!(await inDialogOrChrome())) trapped = false;
    check(trapped, '다이얼로그 포커스 트랩(Tab/Shift+Tab 이탈 없음)');
    const dlgAudit = await page.evaluate(A11Y_AUDIT, { tap: false });
    check(dlgAudit.contrast.length === 0 && dlgAudit.labels.length === 0 && dlgAudit.buttons.length === 0, '열린 다이얼로그 대비·이름', [...dlgAudit.contrast, ...dlgAudit.labels, ...dlgAudit.buttons].slice(0, 3).join(' | '));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#confirmDialog[open]'));
    check(await page.evaluate(() => document.activeElement?.id) === 'finishBtn', '다이얼로그 ESC 후 호출 버튼으로 포커스 반환');

    // 키보드만으로 지원 정보 → 근거 → 설정 (마우스 없음, 합성 샘플)
    console.log('\n[12b] 키보드 전용 순회');
    {
      const ctxK = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
      const pk = await ctxK.newPage();
      await pk.addInitScript(() => localStorage.setItem('intervu.token', 'e2e-user-b'));
      await pk.goto(base + '/#/dashboard', { waitUntil: 'networkidle' });
      await pk.waitForSelector('#screen-dashboard:not([hidden])');
      const allRings = [];
      const step = async (id, label) => { const t = await tabTo(pk, id); allRings.push(...t.rings); check(t.found, `키보드: Tab으로 ${label} 도달`, `${t.steps}회`); };
      await step('journeyCompany', '기업 여정 버튼');
      await pk.keyboard.press('Enter');
      await pk.waitForSelector('#screen-application:not([hidden])');
      await step('loadFixtureBtn', '합성 샘플 버튼');
      await pk.keyboard.press('Enter');
      await pk.waitForSelector('#fixtureBadge:not([hidden])');
      await step('analyzeBtn', '분석 버튼');
      await pk.keyboard.press('Enter');
      await pk.waitForSelector('#screen-evidence:not([hidden])', { timeout: 15000 });
      await step('approveBtn', '근거 승인 버튼');
      await pk.keyboard.press('Enter');
      await pk.waitForSelector('#screen-setup:not([hidden])', { timeout: 15000 });
      await step('startBtn', '면접 시작 버튼(설정)');
      const noRing = allRings.filter((r) => !r.ring);
      check(noRing.length === 0, '키보드 포커스 링 항상 표시', noRing.slice(0, 4).map((r) => `${r.tag}#${r.id}`).join(' | '));
      await ctxK.close();
    }

    // ---------- 접속 토큰 (내장 토큰 없음) ----------
    console.log('\n[10b] 접속 토큰');
    {
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
      const p2 = await ctx2.newPage();
      await p2.goto(base);
      await p2.waitForSelector('#confirmDialog[open]', { timeout: 10000 });
      check(/접속 토큰/.test(await p2.locator('#confirmTitle').innerText()), '토큰 없으면 접속 토큰 입력 대화상자');
      await p2.fill('#confirmInput', 'e2e-user-a');
      await p2.click('#confirmOk');
      await p2.waitForFunction(() => !/실패/.test(document.querySelector('#modeChip')?.textContent || '') && !!localStorage.getItem('intervu.token'), null, { timeout: 10000 });
      check(await p2.evaluate(() => localStorage.getItem('intervu.token')) === 'e2e-user-a', '입력한 토큰 저장');
      await ctx2.close();
    }

    // ---------- 오류 로그 ----------
    console.log('\n[11] 브라우저 오류');
    // 잘못된 관리자 토큰 시도는 의도된 403이므로 예상 실패로 분류한다.
    const isExpectedProbe = (b) => /^403 \w+ .*\/api\/v1\/admin\//.test(b);
    const isConsent428 = (b) => /^428 POST .*\/api\/v1\/profiles$/.test(b); // 동의 전 첫 제출의 의도된 428
    const probes = badResponses.filter(isExpectedProbe);
    // 근거 화면의 선택 API(claims/plan, WP-C8 전)는 404면 섹션을 숨기는 기능 감지이므로 예상 실패로 분류한다.
    const isOptional404 = (b) => /^404 GET .*\/api\/v1\/profiles\/[^/]+\/(claims|plan)$/.test(b);
    const opt404 = badResponses.filter(isOptional404).length;
    check(badResponses.filter(isConsent428).length === 1, '동의 전 428은 정확히 1회');
    const unexpected = badResponses.filter((b) => !isExpectedProbe(b) && !isOptional404(b) && !isConsent428(b));
    check(probes.length === 1, '의도된 관리자 403은 정확히 1회', `${probes.length}회`);
    const realConsole = consoleErrors.filter((t) => !/favicon/i.test(t) && !(/403 \(Forbidden\)/.test(t) && probes.length === 1) && !(/404 \(Not Found\)/.test(t) && opt404 > 0) && !/428 \(Precondition/.test(t));
    check(realConsole.length === 0, '콘솔 오류 없음', realConsole.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, '페이지 예외 없음', pageErrors.slice(0, 3).join(' | '));
    check(unexpected.length === 0, '예상 외 실패 응답 없음', unexpected.slice(0, 4).join(' | '));
  } finally {
    await browser.close();
    await new Promise((r) => app.server.close(r));
  }

  console.log(`\n스크린샷: ${OUT}`);
  if (failures.length) {
    console.error(`\nE2E 실패 ${failures.length}건:`);
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log('\nE2E 통과');
}

main().catch((e) => { console.error(e); process.exit(1); });
