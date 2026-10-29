# 02. 목표 아키텍처

## 1. 원칙

1. **플랫폼 중립 코어:** 도메인·API 핸들러·공급자 어댑터는 Web 표준(`Request`/`Response`/`fetch`/Web Crypto/`TextEncoder`)만 쓴다. Node/Workers 특화 코드는 얇은 어댑터에만 둔다.
2. **Node 서버는 기준 구현이다.** 같은 핸들러를 Node(`http`)와 Workers가 호출하고, **같은 테스트 스위트**가 핸들러 직접 호출로 두 환경 공통 계약을 검증한다.
3. **상태는 `Store` 인터페이스 뒤에 둔다.** memory(테스트) / Node 파일(로컬 데모) / Workers DO(배포).
4. **UI는 무빌드 ES 모듈**(DG-7). 서버 API만 호출하며 키·비밀은 브라우저에 없다.
5. **안전 불변 조건은 구조로 강제한다.** 외부 호출은 단일 호출 래퍼를 통과해야 하고, 래퍼가 게이트·예산·검증·폴백·라벨을 수행한다(`04`).

## 2. 목표 디렉터리

```
src/
  domain/                 # 순수 로직(현 위치 유지). Node 내장 import 금지(아래 §4 이식 과제 제외 후)
    claims.js documents.js evaluation*.js institution.js questions.js
    transfer.js trends.js pii.js sources.js rubrics.js ...
  providers/              # fetch 기반 어댑터 + 레지스트리 + 호출 래퍼
    registry.js           # operation → provider 라우팅(config.registry 실사용)
    call.js               # 게이트·타임아웃·재시도·예산·검증·폴백·라벨
    gate.js               # selectProvider 일반화(키·LIVE_ACK·REAL_DATA_ACK·킬스위치·합성)
    adapters/{mock,gemini,deepseek,claude,groq-whisper,elevenlabs}.js
  store/                  # Store 인터페이스 + 구현
    index.js (interface/contract) memory.js file.js(do-store는 worker/)
  app/                    # 플랫폼 중립 API
    router.js             # (Request, env, ctx) => Response
    handlers/{profiles,documents,claims,sessions,commands,reports,transfer,history,admin,providers,fixtures,consents}.js
    auth.js errors.js idempotency.js
  node/                   # server.js(http 어댑터), env.js, 정적 파일 서빙
  worker/                 # index.js(fetch 핸들러), do-session.js, wrangler 설정은 루트
public/                   # 무빌드 ES 모듈 UI(§06 §9 모듈 구조)
tests/                    # 아래 §6 분리 구조
tools/                    # check-project, e2e, smoke(수동·승인 후), eval 하니스
docs/plan/                # 이 기획서
```

> 현재 `src/server.js`·`src/store.js`·`src/providers/adapters.js`를 한 번에 옮기지 않는다. **WP-A1**(핸들러 추출)에서 동작 불변 리팩터링으로 단계적으로 옮기고, 매 단계 `npm test`가 통과해야 한다.

## 3. 요청 흐름

```
Browser(Pages 정적 UI)
   │ fetch /api/v1/*  (Authorization: Bearer <접속 토큰>, Idempotency-Key)
   ▼
[Node http 어댑터 | Workers fetch 핸들러]  → app/router.js
   │  auth → 입력 검증 → handler
   ├─ domain/*            (순수 규칙: 주장 추출, 평가, 전이 비교 …)
   ├─ store.*             (세션 상태·문서·평가·원장; 세션 단위 직렬 처리)
   └─ providers/call.js   (외부 호출 단일 관문)
         gate → budget reserve → adapter(fetch) → validate → settle → label
                                  └─ 실패/차단 시 mock 폴백 + 사유 기록
```

세션 쓰기(`commands`)는 **세션별 단일 작성자**로 직렬화한다(Node: 인메모리 뮤텍스/큐, Workers: DO). 낙관적 버전 잠금(`expected_version`)·`command_id` 재생은 유지한다.

## 4. 이식 과제 (Workers 대비, WP-A1/A3에서 처리)

| 현재 코드 | 문제 | 대응 |
|---|---|---|
| `node:http` (`server.js`) | Workers 미지원 | 핸들러를 `Request→Response`로 추출, Node는 어댑터 |
| `node:crypto` (`randomUUID`, `createHash`, `timingSafeEqual`) | 동기 API | `crypto.randomUUID()`(Web), `crypto.subtle.digest`(async), 상수시간 비교는 해시 후 바이트 비교 함수로 직접 구현 |
| `node:zlib` (`documents.js` DOCX/PDF inflate) | `nodejs_compat` 범위 미확인 | `DecompressionStream('deflate-raw'|'deflate')` 기반 async 구현으로 교체 후보. **확인 후 결정(DG-1)** |
| `node:fs` (`trends.js` 영속, `env.js`) | Workers 미지원 | `Store`로 이동, env는 어댑터에서 주입 |
| 정적 서빙(`server.js`) | Pages가 담당 | Node 어댑터에만 유지 |
| 전역 인메모리 `Map`(store·ledger·transferJobs·exports·tickets) | 재시작·다중 인스턴스에서 소실 | 모두 `Store` 또는 DO 상태로 |
| `process.env` 직접 접근(`adapters.js`의 `GEMINI_FREE_ONLY`) | 설정 경로 불일치 | `config`로 통일(`createApp({env})`) |

## 5. 환경변수 (목표)

실제 키는 서버 측(`.env`/Workers 비밀값)에만 둔다. **모델 ID·BASE URL에는 기본값을 두지 않는다**(DG-2).

| 그룹 | 변수 | 비고 |
|---|---|---|
| 접속 | `DEV_TOKEN_A`, `DEV_TOKEN_B`(→ 목록형 `ACCESS_TOKENS` 검토), `ADMIN_TOKEN` | 현재 구현됨. 미설정=사용자 없음/관리 꺼짐 |
| 라우팅 | `LLM_DIALOGUE_PROVIDER`, `LLM_ANALYSIS_PROVIDER`, `LLM_EVAL_PROVIDER`, `STT_PROVIDER`, `TTS_PROVIDER` | 값: 공급자 이름 또는 `mock`. 기본 `mock` |
| 공급자별 | `<P>_API_KEY`, `<P>_BASE_URL`, `<P>_MODEL`, `<P>_TIMEOUT_MS`, `<P>_LIVE_ACK`, `<P>_REAL_DATA_ACK`, `<P>_MONTHLY_CAP_USD`, `<P>_PRICE_IN/OUT`(선택) | `P` = `DEEPSEEK`/`CLAUDE`/`GEMINI`/`GROQ`/`ELEVENLABS` |
| 기존 | `GEMINI_*`, `GROQ_WHISPER_KEY`, `KILL_PROVIDERS`, `SESSION_HARD_CAP_USD`, `MONTHLY_API_BUDGET_USD` 등 | 호환 유지, 신규 변수로 단계 이행 |
| 저장 | `STORE=memory|file`, `DATA_DIR`, `DATA_TTL_DAYS_DEFAULT` | Workers는 DO 바인딩 |
| 데모 | `DEMO_FIXTURES=on|off`(합성 샘플 제공) | 기본 on(로컬), 공개 배포에서는 명시 |

`.env.example`은 변수 추가와 **같은 변경**에서 갱신한다. 키 값은 로그·오류·보고서·내보내기에 넣지 않는다.

## 6. 테스트 구조 (WP-A0에서 분리)

`tests/run.mjs`(약 1,420줄)는 병렬 작업의 최대 충돌 지점이다. 동작 불변으로 아래처럼 나눈다.

```
tests/
  helpers/{app.mjs,http.mjs,stub-fetch.mjs}   # createApp, call, withGeminiStub 등 공용
  api/*.test.mjs        # 엔드포인트 계약(프로필·세션·보고서·삭제·관리자·게이트)
  domain/*.test.mjs     # claims, documents, transfer, trends, pii, evaluation
  providers/*.test.mjs  # 스텁 fetch 계약(요청 형태·타임아웃·429·잘못된 JSON·상한)
  e2e/                  # 브라우저(현 tools/e2e-ui.mjs 이전 또는 유지)
  eval/                 # 골든 케이스(프롬프트·규칙 회귀), 사람 평가 입력/결과 양식
```
`npm test`는 모든 `*.test.mjs`를 실행하고 기존 개수(77)를 **줄이지 않는다.**

## 7. 관측·운영 (데모 수준)

- 요청 로그: `request_id`, 경로, 상태, 지연(본문 제외).
- 공급자 호출 통계: 호출 수·실패·429·폴백 수·평균 지연(`/api/v1/metrics`, 관리자 전용).
- 오류 응답 규격 유지: `{ code, message, retryable, request_id, details }`.
- 만료 데이터 정리 작업(DG-10): 서버 시작 시 + 주기 실행.
