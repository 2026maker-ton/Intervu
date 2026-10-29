# Intervu — 한국어 AI 모의면접 코치 (작동형 데모 시제품)

**지원서 주장 검증 → 근거 기반 코칭 → 새 질문에서 재검증** 루프를 기업·대학 면접 준비에 적용하는 시제품이다. 제품 기준은 [`PROJECT.md`](PROJECT.md)가 최상위이며 에이전트 규칙은 [`AGENTS.md`](AGENTS.md)다. 구현 작업 단위·UI 명세는 [`docs/plan/README.md`](docs/plan/README.md).

> **현재 상태(2026-10-29, `fix/p0-1-provider-gate`):** 모든 검증은 **Mock·합성 데이터·스텁 `fetch`** 로만 했다. 평가는 **규칙 기반 참고 관찰**이며 검증된 AI 평가가 아니다. Gemini·Groq·DeepSeek·Claude·ElevenLabs **실호출은 한 번도 실행하지 않았고**, Pages·Workers **실배포도 하지 않았다**(`[UNVERIFIED]`). 실제 로그인은 없다(환경변수 접속 토큰). 상세 상태·한계는 `PROJECT.md` §7·§10·§11.

## 실행

외부 라이브러리 없이 Node.js 20+로 동작한다.

```powershell
npm install --ignore-scripts   # 의존성 없음(필요하면 생략 가능)
copy .env.example .env         # 그리고 DEV_TOKEN_A 등 접속 토큰을 설정
npm start                      # http://localhost:3000  (처음 접속 시 접속 토큰을 입력)
npm test                       # 문서 가드 + 통합 테스트 251개 (외부 키·네트워크 불필요, Mock/스텁)
npm run check:project          # 문서·UI 구조 가드(4개). 제품 적합성 증명 아님
npm run e2e                    # 브라우저 E2E(Playwright 필요, Mock 전용) — docs/e2e.md
node tools/e2e-institution.mjs # 기관 맞춤 HTTP E2E 14개
node tools/verify-design.mjs   # 설계 fixture 검사
```

`npm run rehearsal`은 **없다**(데모 리허설 WP-E3 미착수). 수동 스모크 도구(`tools/*-smoke.mjs`, `stt-smoke`, `gemini-e2e`)는 **실호출이므로 개발자가 승인한 합성 데이터로만** 직접 실행하며, 저장소의 어떤 자동 검사도 이를 실행하지 않는다.

## 환경 변수(이름만; 전체는 `.env.example`)

| 구분 | 변수 | 설명 |
|---|---|---|
| 인증 | `DEV_TOKEN_A`, `DEV_TOKEN_B` | 접속 토큰 2개. 내장 기본값 없음(미설정이면 로그인 가능한 사용자가 없음). 실제 로그인 아님 |
| 관리자 | `ADMIN_TOKEN` | `x-admin-token` 헤더와 일치할 때만 관리 기능·`/metrics`·`/diagnostics` 허용. 미설정이면 **꺼짐** |
| 저장 | `STORE=file`, `DATA_DIR`(기본 `data/store`), `TRENDS_FILE` | 기본은 인메모리(재시작 시 소실). `file`은 단일 프로세스 가정 |
| CORS | `CORS_ALLOW_ORIGINS` | 쉼표 구분 허용 오리진. 비우면 같은 오리진만. `*`는 무시 |
| 공급자 키 | `GEMINI_API_KEY`, `GROQ_WHISPER_KEY`/`GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `CLAUDE_API_KEY`, `ELEVENLABS_API_KEY` | 서버 전용. 번들·로그·응답에 나가지 않음 |
| 공급자 설정 | `*_BASE_URL`, `*_MODEL`, `ELEVENLABS_VOICE_ID` | DeepSeek·Claude·ElevenLabs는 **기본값 없음**(직접 공식 문서 확인 후 설정, 미설정이면 Mock) |
| 게이트 | `<P>_LIVE_ACK`, `<P>_REAL_DATA_ACK`, `KILL_PROVIDERS` | 키만으로는 호출되지 않는다. LIVE_ACK는 합성 데이터만 허용, 실데이터는 REAL_DATA_ACK+동의+만 19세 필요 |
| 라우팅 | `ROUTE_<OP>`, `LLM_DIALOGUE_PROVIDER`(deepseek), `LLM_ANALYSIS_PROVIDER`(claude), `TTS_PROVIDER`(elevenlabs) | operation별 공급자 선택(기본 Mock/게이트 통과 시 Gemini) |
| 예산·제한 | `SESSION_HARD_CAP_USD`, `MONTHLY_API_BUDGET_USD`, `*_MONTHLY_CAP_USD`, `*_MONTHLY_CALL_CAP`, `*_RATE_PER_MINUTE/DAY` | 공급자별 월 상한·속도 제한은 인메모리 |
| 수집 | `OFFICIAL_FETCH_ALLOW`(기본 비어 있음=수집 꺼짐) | 허용 도메인 접미사 |
| 기타 | `DEMO_FIXTURES=off`, `GEMINI_FREE_ONLY`, `GEMINI_ALLOW_UNPAID` | 합성 샘플 끄기, 무료 전용 모드 |

## 구성

- `public/` — 순수 HTML/CSS/JS, 네이티브 ES 모듈(`core/`, `screens/`, `ui/`), 9화면 해시 라우터. `public/config.js`의 `API_BASE`(기본 빈 값=같은 오리진).
- `src/app/` — 플랫폼 중립 `(Request, env, ctx)=>Response` 핸들러·라우터, `src/node/` Node 어댑터, `src/worker/` Workers 어댑터(**미검증**), `src/store/`(memory/file), `src/providers/`(registry·gate·call·어댑터), `src/domain/`(규칙 로직).
- `tests/` — `api/`·`domain/`·`eval/`(골든 불변식)·`helpers/`. `tools/` — 가드·E2E·수동 스모크.
- `.github/workflows/` — `project-guard.yml`(CI), `pages.yml`(Pages 배포, 개발자 실행). 배포 가이드: `docs/deploy-pages.md`, `docs/deploy-workers.md`.

## 안전 경계(요약)

실제 지원서·답변은 외부 AI로 자동 전송하지 않는다. 클라이언트가 보내는 `synthetic`/`free_test`는 무시하며 합성 판정은 서버 fixture 해시로만 한다. 합격 예측·성격 진단을 하지 않는다. 키가 있어도 게이트 조건(키·BASE_URL·MODEL·LIVE_ACK·데이터 등급·동의·킬 스위치·예산)을 모두 충족해야 외부 호출이 일어난다. 자세한 내용은 `PROJECT.md` §5.

## 과거 연구·설계 문서(이력)

2026-10-23~24에 작성한 연구·설계 문서는 **이력으로 보존**하며 현재 제품 방향과 다를 수 있다(Gemini 우선 결정, 31개 테스트 시점, 토론 베타 등). 충돌하면 `PROJECT.md`를 따른다.

- [종합 설계서](docs/master-plan.md) · [구현 명세](docs/implementation-spec.md) · [AI 계약](docs/ai-contracts.md) · [Gemini 우선 결정 기록](docs/decisions/2026-10-24-gemini-first.md)
- [시장·경쟁·면접 유형 연구](docs/research-market.md) · [실시간 AI·모델·원가 연구](docs/research-technology.md) · [평가·법률·개인정보 연구](docs/research-evaluation-legal.md)
- [평가 JSON Schema](docs/contracts/evaluation.schema.json) · [합성 보고서](docs/fixtures/evaluation.valid.json) · [원가 가정(레거시 Groq/Luna)](docs/cost-assumptions.json) · [Gemini 원가 가정](docs/cost-assumptions.gemini.json)
- [validation-results](docs/validation-results.md): 설계 fixture 검증 기록(제품 품질 검증 아님)
