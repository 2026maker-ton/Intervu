# 브라우저 E2E 실행 (WP-E1)

`npm run e2e` → `tools/run-e2e.mjs` → `tools/e2e-ui.mjs` (Mock 전용, 외부 API 호출 없음).

## 준비
- 의존성 추가 없음. Playwright를 아래 순서로 자동 탐색: `PLAYWRIGHT_MODULE` 환경변수 → 로컬 `playwright` → 전역 npm root(중첩 설치 포함) → npx 캐시.
- 없으면 `npx --yes playwright@1.64.1 install chromium` 후 재실행. 이미 있으면 `PLAYWRIGHT_MODULE=<playwright 폴더>`.

## 버전 불일치 문제
전역 Playwright(예: 1.61.1)가 기대하는 브라우저 빌드가 `ms-playwright` 캐시에 없으면 기본 실행이 실패한다. 러너는 이때 `LOCALAPPDATA`(Windows) 또는 `~/.cache/ms-playwright`의 `chromium_headless_shell-*`/`chromium-*` 실행 파일을 찾아 `executablePath`로 넘겨 재시도한다. 직접 지정: `CHROMIUM_EXECUTABLE=<경로>`. 저장소 파일 수정은 필요 없다.

## 종료 코드
0 통과 · 1 체크 실패 · 3 Playwright 모듈 없음 · 4 브라우저 없음 (3·4는 "E2E NOT RUN").

## 산출물
스크린샷·임시 프로필: `%TEMP%/intervu-e2e` (없으면 OS 임시 폴더). 저장소에 커밋하지 않는다.

## 보고 규칙
E2E를 돌리지 못했으면(코드 3·4 포함) 보고서에 반드시 **"E2E 미실행"**과 사유를 적는다. 실행하지 않은 E2E를 통과로 기록하지 않는다.
