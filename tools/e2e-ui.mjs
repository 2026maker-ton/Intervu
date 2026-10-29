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
  // WP-C6: 실데이터 프로필은 동의가 필요하다. UI 흐름 전에 시험 계정의 동의를 미리 기록한다(428 규칙은 그대로).
  await fetch(base + '/api/v1/consents', { method: 'POST', headers: { Authorization: 'Bearer e2e-user-a', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ age_19_confirmed: true, notice_version: 'e2e-1' }) });

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
    await page.click('#analyzeBtn');
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
    await page.screenshot({ path: path.join(OUT, '03-setup-1440.png'), fullPage: true });
    await page.click('#startBtn');
    await page.waitForSelector('#screen-room:not([hidden])', { timeout: 15000 });

    // ---------- 5. 실전 면접실 ----------
    console.log('\n[5] 실전 면접실');
    check((await page.locator('#roomTitle').innerText()).length > 5, '첫 질문 표시');
    check(/자기소개서에 “/.test(await page.locator('#roomTitle').innerText()), '첫 질문이 지원서 문장을 인용');
    check(/지원서 근거/.test(await page.locator('#roomHint').innerText()), '질문 근거(원문 위치) 표시');
    check(await page.locator('#clock').innerText().then((t) => /^\d{2}:\d{2}$/.test(t)), '타이머 표시');
    // 일시정지/재개
    await page.click('#pauseBtn');
    await page.waitForFunction(() => document.querySelector('#roomState')?.textContent === '일시정지');
    await page.click('#pauseBtn');
    await page.waitForFunction(() => document.querySelector('#roomState')?.textContent === 'LIVE');
    let answered = 0;
    for (let i = 0; i < 10; i += 1) {
      if (await page.locator('#screen-feedback:not([hidden])').count()) break;
      if (!(await page.locator('#screen-room:not([hidden])').count())) break;
      await page.fill('#answerText', answers[answered % answers.length]);
      answered += 1;
      await page.click('#answerBtn');
      await page.waitForTimeout(450);
    }
    if (await page.locator('#screen-room:not([hidden])').count()) await page.click('#finishBtn');
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
    await page.waitForFunction(() => /v\d+/.test(document.querySelector('#trendList')?.textContent || ''), null, { timeout: 15000 });
    check(/초안/.test(await page.locator('#trendList').innerText()), '초안 등록');
    await page.click('[data-publish]');
    await page.waitForSelector('[data-rollback]', { timeout: 15000 });
    check(await page.locator('[data-rollback]').count() > 0, '공개 후 롤백 버튼');
    await page.click('[data-rollback]');
    await page.waitForSelector('#confirmDialog[open]');
    await page.click('#confirmOk');
    await page.waitForTimeout(1200);
    check(/롤백/.test(await page.locator('#trendList').innerText()), '롤백 새 버전 기록');
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
      check(await page.locator(`#screen-${s}:not([hidden])`).count() === 1, `화면 도달: ${s}`);
    }

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
    const probes = badResponses.filter(isExpectedProbe);
    // 근거 화면의 선택 API(claims/plan, WP-C8 전)는 404면 섹션을 숨기는 기능 감지이므로 예상 실패로 분류한다.
    const isOptional404 = (b) => /^404 GET .*\/api\/v1\/profiles\/[^/]+\/(claims|plan)$/.test(b);
    const opt404 = badResponses.filter(isOptional404).length;
    const unexpected = badResponses.filter((b) => !isExpectedProbe(b) && !isOptional404(b));
    check(probes.length === 1, '의도된 관리자 403은 정확히 1회', `${probes.length}회`);
    const realConsole = consoleErrors.filter((t) => !/favicon/i.test(t) && !(/403 \(Forbidden\)/.test(t) && probes.length === 1) && !(/404 \(Not Found\)/.test(t) && opt404 > 0));
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
