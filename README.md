# Intervu — 대입 면접 연습 AI 코치 (작동형 데모 시제품)

만 18세 이상 **대학 입시 지원자**가 지원서와 학교 자료로 **일반 면접 5단계**(도입·학업 적합성·경험 검증·문제 해결·성찰·마무리)를 음성으로 연습하는 웹 서비스다. 질문은 지원서 속 주장과 학교의 인재상·역량에서 만들고, 결과 화면은 질문·답변을 중심으로 근거(지원서 인용·학교 자료)와 함께 보여 준다. 제품 기준은 [`PROJECT.md`](PROJECT.md)(v1.4.0)가 최상위이고, 에이전트 규칙은 [`AGENTS.md`](AGENTS.md)다.

> **현재 상태(2026-10-31, `feat/student-mvp`):** 자동 검증은 Mock·합성 데이터·스텁 `fetch`로 한다. 개발자 키로 Claude 호출과 Gemini 학교 검색(Google Search grounding)은 실제로 확인했다. **미확인:** 실제 마이크 녹음의 자동 시작·정적 감지·잡음 판별, Groq 한국어 전사 품질, Sonnet 평가·주장 분석의 품질, Vercel 배포 동작. 평가는 "검증 전(참고용)"이며 합격 예측은 하지 않는다. 상세는 `PROJECT.md` §7.7·§10.
>
> 기업·취업, 고입(미성년), 특수 면접(압박·블라인드·인성·기술·상황), 재연습·전이 비교·기록·관리자·파일 업로드·도움말은 **UI에서 숨겼다**(서버 API·테스트는 일부 유지). 특수 면접은 계획만 있고 서버가 422로 거절한다.

## 실행

외부 라이브러리 없이 Node.js 20+로 동작한다.

```powershell
copy .env.example .env         # 필요한 키·설정을 채운다(키가 없으면 전부 Mock·규칙 기반)
npm start                      # http://localhost:3000  (저장소 기본값: 파일, data/store/)
npm test                       # 문서 가드 + 통합 테스트 323개 (외부 키·네트워크 불필요)
npm run check:project          # 문서·UI 구조 가드(4개). 제품 적합성 증명 아님
npm run e2e                    # 브라우저 E2E(Playwright 필요, Mock 전용) — docs/e2e.md
npm run rehearsal              # API 수준 데모 리허설 38단계(Mock) — docs/rehearsal.md
node tools/e2e-institution.mjs # 기관 맞춤 HTTP E2E 14개
```

`.env`에 `SITE_PASSWORD`를 넣으면 사이트 입장 비밀번호 화면이 먼저 뜬다(서버가 `/api`를 잠근다). 비우면 잠금이 없다. `GATE_SECRET`은 입장 쿠키 서명용 임의 문자열이다.

## 사용 흐름

1. (입장 비밀번호가 켜져 있으면 입력) → 이메일·비밀번호로 가입(이름, 만 18세 이상 확인, 처리 안내 동의) 또는 로그인.
2. 대시보드에서 **샘플 불러오기**(실제 대학명 10곳 + 예시 설명, 공식 모집요강 아님)를 쓰거나 학교·학과·전형·자료·지원서를 직접 입력.
3. **근거 확인**: 지원서 분석 직후 학교 자료 분석과 학교·전형 검색(Gemini)이 자동으로 돈다(분석 중에는 "검색 중…", 못 찾으면 직접 등록 안내). 핵심 역량·인재상과 면접 형태는 렌치 버튼으로 직접 고치고, 새로고침 아이콘으로 다시 분석·검색한다. 각 단계의 뒤로가기는 화면 위쪽에 있고, 입력을 바꾸지 않고 돌아오면 이미 분석한 결과를 그대로 쓴다. 승인하면 질문 5개와 연결 문장이 고정된다.
4. **면접 준비**: 마이크 확인, 음성/텍스트 선택 → **면접**: 질문 음성이 끝나면 자동 녹음, 말한 뒤 3초 정적 + 문장이 끝나면 답변 완료, 질문당 60초 제한 → **결과**: 질문별 점수·역량 적합성·차원 레이더·음성 지표(답변별 음량 그래프와 답변·정적 구간)·질문과 답변 본문(`i` 버튼으로 근거), 맨 뒤에 세부 정보(지원서 근거·질문 목록, 읽기 전용).

화면 상단의 **AI 스위치**로 외부 AI 기능을 잠깐 끌 수 있다(스위치 비밀번호 필요). 끄면 Mock을 따로 두지 않고 규칙 기반 기본 동작만 가능하다.

키가 없으면 전부 Mock·규칙 기반으로 동작하며 화면의 평가기 칩에 그대로 표시된다.

## 무엇이 실제이고 무엇이 Mock/미검증인가

| 항목 | 상태 |
|---|---|
| 이메일 로그인(PBKDF2, 토큰 해시 저장), 입장 비밀번호 잠금, 5단계 질문 계획·동결, 규칙 기반 폴백 | **동작**(자동 테스트·E2E 확인) |
| 지원서 주장·학교 자료 분석·질문 설계·문장 작성·최종 평가(Claude: Sonnet 5.5 + Haiku 5.5) | 코드·스텁 시험 + 개발자 키 실호출 일부. 모델 출력은 서버가 다시 검증하고, 실패하면 규칙 기반 폴백(`provider_trace`). 품질은 **미검증** |
| 학교·전형 검색(Gemini + Google Search grounding) | 유료 티어 필요(`GEMINI_FREE_ONLY=false`, `GEMINI_GROUNDING_ACK=true`). 결과는 사용자 프로필에만 150일 보관, 질문 근거로 쓰지 않음 |
| 꼬리질문 판단(Gemini) | 합성·샘플 답변에서만. 실제 답변은 규칙 기반(`GEMINI_REAL_DATA_ACK=false`) |
| 음성 | 전사=Groq Whisper(서버 키), 낭독=브라우저 `SpeechSynthesis`, 자동 녹음·정적 감지·잡음 판별=브라우저 규칙. **실마이크 미검증** |
| 월간 트렌드·공식 수집기 | 코드·스텁 시험만. UI 미사용 |
| 배포 | Vercel(정적 `public/` + 함수 `api/handler.js` + Upstash Redis) — 코드와 문서만, **실배포 확인 미완**([`docs/deploy-vercel.md`](docs/deploy-vercel.md)). Pages·Workers는 코드만, 로그인 미연결 |

## 환경 변수(이름만; 전체는 `.env.example`)

| 구분 | 변수 | 설명 |
|---|---|---|
| 입장 잠금 | `SITE_PASSWORD`, `GATE_SECRET` | 비우면 잠금 없음. Vercel(`VERCEL=1`)에서 `SITE_PASSWORD`가 없으면 `/api`가 503으로 닫힌다 |
| AI 스위치 | `AI_SWITCH_PASSWORD` | 화면 상단 AI 스위치의 비밀번호. 비우면 스위치를 쓸 수 없다(503). 끄면 모든 외부 AI 호출을 막고 규칙 기반 기본 동작만 남긴다(Node는 서버 재시작 시 켜짐, Vercel은 Redis에 저장) |
| 로그인 | `DEV_TOKEN_A`, `DEV_TOKEN_B` | 테스트·개발용 토큰(비우면 이메일 로그인만). 공개 서버에서는 비워 둔다 |
| 관리자 | `ADMIN_TOKEN` | 관리 API 전용. 미설정이면 꺼짐(UI 미노출) |
| 저장 | `STORE=file\|memory`, `DATA_DIR`, `TRENDS_FILE` | `npm start`는 파일이 기본, 테스트는 메모리. Vercel은 Upstash Redis(`KV_REST_API_URL/TOKEN` 또는 `UPSTASH_REDIS_REST_URL/TOKEN`) |
| 공급자 키 | `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`(`GROQ_WHISPER_KEY`) | 서버 전용 |
| 모델 | `CLAUDE_MODEL`(Sonnet), `CLAUDE_WRITER_MODEL`(Haiku), `GEMINI_TEXT_MODEL`, `GEMINI_FALLBACK_MODEL` | `.env.example` 참고 |
| 비용 | `CLAUDE_THINKING`(기본 `off`), `GEMINI_THINKING_LEVEL`, `CLAUDE_MONTHLY_CALL_CAP`, `SESSION_HARD_CAP_USD`, `MONTHLY_API_BUDGET_USD` | 서버리스에서는 앱의 월 상한이 작동하지 않으니 공급자 콘솔에서 지출 한도를 건다 |
| 게이트 | `CLAUDE_LIVE_ACK`, `CLAUDE_REAL_DATA_ACK`, `GEMINI_LIVE_ACK`, `GEMINI_REAL_DATA_ACK`, `GEMINI_FREE_ONLY`, `GEMINI_GROUNDING_ACK`, `GROQ_LIVE_ACK`, `GROQ_REAL_DATA_ACK`, `KILL_PROVIDERS` | 키만으로는 호출되지 않는다. 실데이터는 `*_REAL_DATA_ACK` + 만 18세 이상 가입 확인 + 동의가 필요하다 |
| 라우팅 | `ROUTE_CLAIMS_EXTRACT`, `ROUTE_SCHOOL_ANALYZE`, `ROUTE_QUESTIONS_DESIGN`, `ROUTE_QUESTIONS_WRITE`, `ROUTE_EVALUATION_GENERATE`, `ROUTE_SCHOOL_SEARCH`, `ROUTE_DIALOGUE_NEXT`, `ROUTE_SPEECH_TRANSCRIBE`, `ROUTE_SPEECH_SYNTHESIZE` | operation별 공급자. `mock`으로 바꾸면 외부 호출이 없다 |
| 기타 | `ANSWER_SECONDS`(기본 60), `DEMO_FIXTURES=off`, `OFFICIAL_FETCH_ALLOW`, `CORS_ALLOW_ORIGINS` | 질문당 답변 시간, 샘플 끄기, 수집 허용 도메인, CORS |

## 구성

- `public/` — 순수 HTML/CSS/JS, 네이티브 ES 모듈, 7화면 해시 라우터(로그인·대시보드·지원 정보·근거 확인·면접 준비·면접실·결과). 입장 비밀번호 화면은 별도 오버레이.
- `src/app/` 핸들러·라우터(`gate.js` 입장 잠금), `src/node/` Node 어댑터, `src/vercel/` Vercel 어댑터(Redis), `src/worker/` Workers 어댑터(**미검증**), `src/store/`, `src/providers/`(registry·gate·call·prompts·어댑터), `src/domain/`(규칙 로직: `interview-format.js` 5단계, `school-analysis.js`, `claims.js`, `llm-eval.js` 등).
- `api/handler.js` — Vercel 함수 진입점(`vercel.json`의 리라이트가 `/api/v1/*`를 보낸다).
- `tests/`(`api/`·`domain/`·`eval/`), `tools/`(가드·E2E·리허설·수동 스모크).
- `.github/workflows/` — CI 가드, Pages 배포(개발자 실행). `docs/deploy-*.md`.

## 안전 경계(요약)

서비스 대상은 만 18세 이상이다(Gemini 약관 때문에 가입 때 확인한다). 실제 지원자 입력은 키가 있어도 게이트(`*_REAL_DATA_ACK`)와 동의 없이는 외부 AI로 보내지 않고, 개인정보 후보(전화·이메일·주민번호 등)는 마스킹한다. 클라이언트의 `synthetic` 값은 무시하고 합성 판정은 서버가 샘플과 일치하는지로만 한다. 합격 예측·성격 진단은 하지 않으며, 유료 공급자로 조용히 바꾸지 않고, Mock을 실제 AI로 표시하지 않는다. 자세한 내용은 `PROJECT.md` §5.

## 문서

- [AI 사용처 한눈에 보기](docs/ai-overview.md) · [Vercel 배포](docs/deploy-vercel.md) · [일반 면접 설계](docs/plan/11-general-interview.md) · [결정 기록](docs/decisions/)
- [면접 형태 검증 기록](docs/verification/2026-10-31-interview-format-check.md)
- 과거 연구·설계 문서(이력, 현재 방향과 다를 수 있음 — 충돌하면 `PROJECT.md`): [종합 설계서](docs/master-plan.md) · [구현 명세](docs/implementation-spec.md) · [AI 계약](docs/ai-contracts.md) · [시장·경쟁 연구](docs/research-market.md) · [실시간 AI·원가 연구](docs/research-technology.md) · [평가·법률·개인정보 연구](docs/research-evaluation-legal.md) · [프로젝트 소개서](docs/project-intro.md)
