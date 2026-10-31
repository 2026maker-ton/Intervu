# Workers 배포 (WP-A3, DG-1 A안) — 런타임 미검증

> **2026-10-31:** 현재 배포 경로는 Vercel([deploy-vercel.md](deploy-vercel.md))이다. Workers 어댑터는 이메일 로그인·입장 비밀번호가 연결되지 않았고(아래 `DEV_TOKEN_*` 방식은 이전 기준) 런타임 미검증이다.

코드(`src/worker/*`, `wrangler.toml`)는 Node에서 `worker.fetch(new Request(...), env)` 직접 호출로만 시험했다. Workers 런타임·wrangler는 실행하지 않았다. 아래 `[UNVERIFIED]`는 공식 문서를 확인하지 않은 가정이다.

## 개발자 절차
1. `wrangler.toml`의 `compatibility_date`를 배포일로 채운다(현재 주석 처리).
2. 비밀값 설정(저장소·vars에 넣지 않는다): `wrangler secret put DEV_TOKEN_A`, `DEV_TOKEN_B`, `ADMIN_TOKEN`, (선택) `GEMINI_API_KEY`, `GROQ_API_KEY`, `CLAUDE_API_KEY`, `DEEPSEEK_API_KEY`. 토큰은 무작위 긴 값.
3. 로컬 스모크: `npx wrangler dev` (wrangler는 의존성으로 설치하지 않았다. 설치·실행은 개발자 승인 후).
4. 배포: `npx wrangler deploy`. 정적 UI는 Pages(WP-A4)에서 서빙하고 `API_BASE`로 이 Worker를 가리킨다.
5. 배포 후 `/api/v1/health`, 동의 → 프로필 생성 시나리오를 수동 확인한다.

## 구조
- `src/worker/index.js`: `/api/*`만 처리, 그 외 404. `SESSION_DO` 바인딩이 있으면 소유자(토큰→`owner:<id>`, 비인증·관리자는 `owner:public`)별 DO로 전달. 바인딩이 없으면 isolate당 1개 코어(상태는 isolate와 함께 소실, 시험용).
- `src/worker/do-session.js`: DO 1개 = 소유자 1명. 요청을 Promise 체인으로 직렬 처리, 메모리 Store를 요청마다 DO 저장소에 JSON 스냅샷(30,000자 조각)으로 저장, 생성 시 복원. 트렌드도 같은 스냅샷.
- Store 계약이 동기식이라 메모리 작업본 + 영속 스냅샷 방식이다. 데이터가 커지면 행 단위 SQLite로 교체한다.

## 확인할 가정·한계 `[UNVERIFIED — docs not checked]`
- `nodejs_compat`: `documents.js`가 `Buffer`를 쓴다(`node:` 임포트는 없음). 플래그 필요 여부·`Buffer` 범위 확인. 없애려면 `Uint8Array`/`atob`로 교체.
- `DecompressionStream('deflate-raw'|'deflate')`가 Workers에서 지원되는지. 실패 시 DOCX/PDF 추출이 `corrupted_document`/추출 실패로 떨어진다.
- DO 저장소 API: `ctx.storage.get(string|string[])`/`put(object)`/`delete(string[])` 시그니처, `ctx.blockConcurrencyWhile`, 값당 크기 한도(조각 30,000자는 임의 안전값), 총 저장 한도, 무료 플랜의 DO·SQLite 사용 가능 여부.
- `wrangler.toml` 키: `new_sqlite_classes` 마이그레이션, `durable_objects.bindings`, `compatibility_flags`.
- 요청 본문 한도: 문서 업로드는 base64 JSON 최대 약 7.5MB를 받는다. Workers 요청 크기 한도와 비교.
- CPU/실행 시간: 공급자 호출(최대 20초 타임아웃)·스냅샷 직렬화가 플랜 한도 안인지.
- 원장(예산)은 DO(소유자)별이라 **전역 월 예산 상한이 아니다**. 공개 배포 전 전역 원장 DO 필요.
- DO 직렬화는 DO 안의 입력 게이트가 아닌 자체 Promise 체인으로 보장한다(외부 호출 중 다른 요청 인터리브 방지). 만료 정리(DG-10)·월 롤오버는 DO에서 미구현.
- CORS·Pages 연동은 WP-A4 범위(이 Worker는 CORS 헤더를 붙이지 않는다).
