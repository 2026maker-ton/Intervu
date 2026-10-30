# Intervu — 고입·대입 준비 학생용 AI 모의면접 코치 (작동형 데모 시제품)

**지원서 주장 검증 → 근거 기반 코칭 → 새 질문에서 재검증** 루프를 **고입·대입 면접 준비 학생**에게 적용하는 시제품이다. 학교·학과를 고르면 모집요강·인재상을 분석해(원문 인용, 확인 시점, 미확인 목록 표시) 맞춤 질문을 만든다. 제품 기준은 [`PROJECT.md`](PROJECT.md)(v1.3.0)가 최상위이며 에이전트 규칙은 [`AGENTS.md`](AGENTS.md), 전환 사양은 [`docs/plan/09-student-mvp.md`](docs/plan/09-student-mvp.md)다. 기업·취업은 현재 범위 밖이다(서버가 `company`/`public`을 레거시로 받아 회귀 테스트만 보존, UI 미노출).

> **현재 상태(2026-10-30, `feat/student-mvp`):** 자동 검증은 **Mock·합성 데이터·스텁 `fetch`** 로만 했다. Gemini·Groq **실호출은 이 문서 작업에서 확인하지 않았다**(`[UNVERIFIED]`; 합성 톤 음성으로 Groq 연결 확인 1건이 성공했다는 전달 사항이 있으나 재검증하지 않았고 실제 음성·Gemini 실호출 확인은 없다). Gemini 평가는 **"Gemini 분석 · 검증 전(참고용)"** 이며 검증된 AI 평가가 아니다. 합격 예측은 하지 않는다. 실제 로그인은 없다(환경변수 접속 토큰). 상세는 `PROJECT.md` §7.6·§10.

## 실행

외부 라이브러리 없이 Node.js 20+로 동작한다.

```powershell
npm install --ignore-scripts   # 의존성 없음(생략 가능)
copy .env.example .env         # DEV_TOKEN_A 등 접속 토큰을 설정
npm start                      # http://localhost:3000  (처음 접속 시 접속 토큰 입력)
npm test                       # 문서 가드 + 통합 테스트 286개 (외부 키·네트워크 불필요)
npm run check:project          # 문서·UI 구조 가드(4개). 제품 적합성 증명 아님
npm run e2e                    # 브라우저 E2E(Playwright 필요, Mock 전용) — docs/e2e.md
npm run rehearsal              # API 수준 데모 리허설 38단계(Mock) — docs/rehearsal.md
node tools/e2e-institution.mjs # 기관 맞춤 HTTP E2E 14개
```

참고: `npm test`는 부하에 따라 시험 1건이 간헐 실패하는 것이 관찰됐다(실행마다 다른 시험, 원인 미조사). `npm run e2e`도 1회 간헐 실패(포커스 링 체크)가 있었다. 상세 `PROJECT.md` §10·DEBT-16.

## 합성 샘플로 데모하기

1. 서버 실행 후 접속 토큰 입력 → 대시보드에서 `고입` 또는 `대입` 선택.
2. 지원 정보 화면에서 **합성 샘플 불러오기**(`DEMO_FIXTURES` 기본 켜짐, `off`면 숨김; 가상 학교 `가온고등학교(가상)`·`새봄대학교(가상)`) → 연령 2택 동의.
3. 근거 확인 화면에서 **학교 분석**(인재상·전형요소·면접 형식, 원문 인용, 확인 시점, 출처 상태, 미확인 목록)과 지원서 주장을 확인하고 승인.
4. 설정(기본 답변 방식은 서버 전사가 가능하면 `녹음 전사`, 아니면 텍스트) → 면접 → 보고서 → 새 질문 재연습 → 기록·삭제.

키가 없으면 전부 Mock/규칙 기반으로 동작하며 화면의 공급자 모드·평가기 칩에 그대로 표시된다.

## 무엇이 실제이고 무엇이 Mock/미검증인가

| 항목 | 상태 |
|---|---|
| 규칙 기반 주장 추출·질문 계획·평가·새 질문 비교·기록·삭제·관리자 | **실제로 동작**(Mock/규칙 경로, 자동 테스트·E2E 확인). 의미 기반 평가 아님 |
| 학교 탐색 | **데모 레지스트리(가상 학교 3곳)** 일치 시 자동 등록, 아니면 `discovery_failed` 후 URL·붙여넣기 안내. **실제 웹 검색 탐색은 미구현(향후)** |
| 학교 분석·질문 설계·트렌드 판단·꼬리질문·Gemini 평가 | 코드·스텁 시험만. Gemini 실호출 **미확인**. 막히거나 실패하면 규칙 기반 폴백(`provider_trace`로 표시) |
| 월간 트렌드 | **Mock 데이터**(2026-09~12만, 라벨 "Mock · 보조"), AI가 필요하다고 판단할 때만 조회. 실제 입시 이슈 아님 |
| 음성 | 전사=Groq Whisper(서버 키, 실음성 미검증), 낭독=브라우저 `SpeechSynthesis`. 고입 실음성은 서버 전사 차단 |
| Claude·DeepSeek·ElevenLabs | 어댑터 코드만 있고 **보류·기본 꺼짐** |
| 배포(Pages·Workers) | 코드·워크플로만, **실배포 미실행** |

## 환경 변수(이름만; 전체는 `.env.example`)

| 구분 | 변수 | 설명 |
|---|---|---|
| 인증 | `DEV_TOKEN_A`, `DEV_TOKEN_B` | 접속 토큰 2개. 내장 기본값 없음. 실제 로그인 아님 |
| 관리자 | `ADMIN_TOKEN` | `x-admin-token` 헤더와 일치할 때만 관리 기능·`/metrics`·`/diagnostics` 허용. 미설정이면 꺼짐 |
| 저장 | `STORE=file`, `DATA_DIR`, `TRENDS_FILE` | 기본 인메모리(재시작 시 소실). `file`은 단일 프로세스 가정 |
| 공급자 키 | `GEMINI_API_KEY`, `GROQ_WHISPER_KEY`/`GROQ_API_KEY` (보류: `DEEPSEEK_*`, `CLAUDE_*`, `ELEVENLABS_*`) | 서버 전용 |
| 게이트 | `GEMINI_LIVE_ACK`, `GEMINI_REAL_DATA_ACK`, `GROQ_LIVE_ACK`, `GROQ_REAL_DATA_ACK`, `KILL_PROVIDERS` | 키만으로는 호출되지 않는다. `*_LIVE_ACK`는 서버가 fixture로 판정한 합성 데이터만, 실데이터는 `*_REAL_DATA_ACK`+동의+`age_19_confirmed`(고입은 항상 Mock) |
| 라우팅 | `LLM_DIALOGUE_PROVIDER`, `LLM_ANALYSIS_PROVIDER`, `LLM_EVALUATION_PROVIDER`(기본 `gemini`), `ROUTE_DIALOGUE_NEXT`·`ROUTE_CLAIMS_EXTRACT`·`ROUTE_SCHOOL_ANALYZE`·`ROUTE_TRENDS_DECIDE`·`ROUTE_QUESTIONS_DESIGN`·`ROUTE_EVALUATION_GENERATE`·`ROUTE_SPEECH_TRANSCRIBE`·`ROUTE_SPEECH_SYNTHESIZE` | operation별 공급자. `mock`으로 바꾸면 외부 호출이 없다 |
| 트렌드 | `TREND_MOCK_MONTH` | Mock 트렌드 조회 월(`YYYY-MM`, 비우면 현재 월; 데모 시계 고정용) |
| 예산·제한 | `SESSION_HARD_CAP_USD`, `MONTHLY_API_BUDGET_USD`, `*_RATE_PER_MINUTE/DAY` | 인메모리 |
| 수집 | `OFFICIAL_FETCH_ALLOW`(기본 비어 있음=수집 꺼짐) | 허용 도메인 접미사 |
| 기타 | `DEMO_FIXTURES=off`, `GEMINI_FREE_ONLY`, `CORS_ALLOW_ORIGINS` | 합성 샘플 끄기, 무료 전용 모드, CORS |

## 구성

- `public/` — 순수 HTML/CSS/JS, 네이티브 ES 모듈, 9화면 해시 라우터.
- `src/app/` 핸들러·라우터, `src/node/` Node 어댑터, `src/worker/` Workers 어댑터(**미검증**), `src/store/`, `src/providers/`(registry·gate·call·prompts·어댑터), `src/domain/`(규칙 로직, `school-directory.js`·`school-analysis.js`·`trend-mock.js`·`question-design.js`·`llm-eval.js`).
- `tests/`(`api/`·`domain/`·`eval/`), `tools/`(가드·E2E·리허설·수동 스모크).
- `.github/workflows/` — CI, Pages 배포(개발자 실행). `docs/deploy-*.md`.

## 안전 경계(요약)

실제 학생 입력은 외부 AI로 자동 전송하지 않는다. **고입(미성년자) 실입력은 어떤 키·ACK가 있어도 규칙 기반/Mock으로만 처리**한다. 클라이언트의 `synthetic`/`free_test`는 무시하고 합성 판정은 서버 fixture 일치로만 한다. 합격 예측·성격 진단을 하지 않는다. 자세한 내용은 `PROJECT.md` §5.

## 과거 연구·설계 문서(이력)

2026-10-23~24 연구·설계 문서는 이력으로 보존하며 현재 방향(기업·대학, Gemini 우선 결정 등)과 다를 수 있다. 충돌하면 `PROJECT.md`를 따른다.

- [종합 설계서](docs/master-plan.md) · [구현 명세](docs/implementation-spec.md) · [AI 계약](docs/ai-contracts.md) · [Gemini 우선 결정 기록](docs/decisions/2026-10-24-gemini-first.md)
- [시장·경쟁·면접 유형 연구](docs/research-market.md) · [실시간 AI·모델·원가 연구](docs/research-technology.md) · [평가·법률·개인정보 연구](docs/research-evaluation-legal.md)
- [평가 JSON Schema](docs/contracts/evaluation.schema.json) · [합성 보고서](docs/fixtures/evaluation.valid.json) · [원가 가정(레거시)](docs/cost-assumptions.json) · [Gemini 원가 가정](docs/cost-assumptions.gemini.json)
- [validation-results](docs/validation-results.md): 설계 fixture 검증 기록(제품 품질 검증 아님)
