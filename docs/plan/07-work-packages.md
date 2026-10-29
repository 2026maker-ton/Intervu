# 07. 작업 패키지(WP)·의존성·병렬 실행 규칙

난이도: S(≈반나절) / M(1~2일) / L(3일+) — 대략 추정이며 일정이 아니다. 컷라인: **M**ust / **S**hould / **C**ould (01 §2.2).
각 WP는 **독립 브랜치/워크트리**에서 수행하고 `README.md §3`의 공통 규칙·보고 형식을 따른다.

## 1. 병렬 실행 규칙 (충돌 방지)

### 1.1 충돌 핫스팟과 소유
| 파일 | 위험 | 규칙 |
|---|---|---|
| `src/server.js` | 거의 모든 백엔드 WP가 수정 | **WP-A1 전에는 백엔드 WP 중 A1만 server.js 수정.** A1 완료 후 리소스별 핸들러 파일을 WP가 소유 |
| `tests/run.mjs` | 모든 WP가 테스트 추가 | **WP-A0 전에는 신규 테스트를 별도 파일 `tests/<wp>.test.mjs`로 추가**(스크립트가 모두 실행하도록 A0이 설정). A0 이후 도메인별 파일 |
| `public/app.js`, `index.html`, `styles.css` | 모든 UI WP | **WP-D1 전에는 UI WP 착수 금지**(D1과 병행 가능한 것은 백엔드뿐). D1 이후 화면별 모듈 소유 |
| `PROJECT.md` | 상태 갱신 충돌 | 각 WP는 **자기 행만**(§7.2 해당 행, §11 자기 BUG/DEBT, §12 자기 WP, §17에 한 줄) 수정. 병합 충돌은 통합 담당이 해결 |
| `package.json` | 의존성·스크립트 | 의존성 추가 금지(승인 필요). 스크립트 변경은 A0·E1만 |
| `.env.example` | 변수 추가 | 변수를 추가한 WP가 같은 변경에서 갱신(키 이름만) |

### 1.2 브랜치·병합
- 브랜치 이름: `wp/<ID>-<slug>` (예: `wp/B1-provider-routing`). 한 WP = 여러 커밋 가능, 병합 단위는 WP.
- 병합 순서는 아래 웨이브·의존성을 따른다. **통합 담당(개발자 또는 지정 세션)만 main 병합.** 하위 에이전트는 push·병합하지 않는다.
- 병합 전 필수: `npm run check:project`, `npm test`(개수 감소 금지), UI 변경 시 E2E.
- 에이전트 간 직접 파일 공유 금지. 인터페이스는 `03-api-and-data.md`·`04`의 계약으로만 소통하고, 계약 변경이 필요하면 **계약 문서 수정을 먼저 보고**한다.

### 1.3 에이전트 브리프 템플릿 (통합 담당이 WP마다 채워 하위 에이전트에 전달)
```
너는 Intervu의 WP-<ID> <이름> 담당이다.
먼저 읽을 것: PROJECT.md 전체, AGENTS.md, docs/plan/README.md §3, docs/plan/<관련 문서>, 07의 WP-<ID> 항목.
목표: <WP 목표 한 문장>
소유 파일: <목록>   금지: <다른 WP 파일, 의존성 추가, 외부 API 실호출>
선행 완료 확인: <선행 WP와 확인 방법>
작업: <핵심 작업 목록>
수용 기준: <테스트 이름·명령>
Decision Gate: <관련 DG와 기본값>
끝나면 README.md §3.4 형식으로 보고. 실행하지 못한 검사는 "미실행".
```

## 2. 웨이브(병렬 단위)와 임계 경로

```
W0 (병렬):  A0 테스트 분리 ┐
            D1 UI 모듈화    ├→ 둘 다 끝나면 W1
            E1 E2E 인프라   ┘ (DG-11)
W1:         A1 핸들러 추출·Store 인터페이스  (임계 경로 시작)
            D2 디자인 시스템·컴포넌트        (D1 후, 백엔드와 병렬)
W2 (A1 후): A2 영속 저장 · B1 라우팅/게이트/래퍼 · C1 문서 · C3 트렌드 · C4 전이 · C5 PII · C6 샘플·동의 (파일 분리되므로 병렬)
W3:         B2 DeepSeek · B3 Claude 주장 · C8 질문 계획 · C7 주장 확장
            D3 지원 정보 · D4 근거 확인 · D5 설정·면접실 · D6 보고서·재연습 · D7 기록·관리자 · D9 대시보드/복원
W4:         A3 Workers · A4 Pages/CI (DG-1) · B5 STT 검증 · B6 TTS · B7 골든 하니스 · C2 수집기(Could) · B4 Claude 평가(Could)
W5:         D8 접근성·반응형·카피 QA · E2 사람 평가 설계 · E4 문서 정합 · E3 데모 리허설
```
**임계 경로:** A0/D1 → A1 → B1 → B2·B3 → D5 → D8 → E3. A1·B1이 늦어지면 전체가 늦어지므로 우선 배정한다.

## 3. Track A — 플랫폼

### WP-A0 테스트 분리 `S · Must`
- **목표:** `tests/run.mjs`를 `02 §6` 구조로 **동작 불변** 분리(병렬 충돌 제거).
- **범위:** `tests/helpers/*`, `tests/api/*`, `tests/domain/*`, `package.json`의 `test` 스크립트(모든 `*.test.mjs` 실행 + 가드).
- **수용:** 분리 전후 **테스트 개수·이름 동일(77)**, `npm test` 통과, 테스트 간 공유 상태 의존 제거(순서 무관), 신규 테스트가 별도 파일에 추가 가능.
- **선행:** 없음. **병렬:** D1, E1.

### WP-A1 핸들러 추출·Store 인터페이스 `L · Must · 임계`
- **목표:** `server.js`를 `app/router.js` + 리소스별 핸들러로 분해하고 `Request→Response` 형태로 만든다. Node 어댑터(`node/server.js`)가 감싼다. 인메모리 `Store` 구현을 인터페이스 뒤로 이동. **동작 불변.**
- **작업:** 핸들러 분리(profiles, sessions, commands, reports, transfer, history, admin 등) · `Idempotency-Key` 응답 저장·재생(24h, 같은 키 다른 본문 409) · 세션별 쓰기 직렬화 · `node:crypto`→Web Crypto 래퍼 · env 주입 통일(`GEMINI_FREE_ONLY` 직접 `process.env` 제거) · 전역 `Map`(transferJobs/exports/tickets/ledger)을 `Store`로.
- **수용:** 기존 77 테스트가 **핸들러 직접 호출과 HTTP 두 경로**에서 통과. 신규: idempotent 재생/충돌, 동시 `commands` 직렬화, `Store` 계약 테스트(memory).
- **선행:** A0 권장(필수 아님). **병렬 불가:** 이 WP 동안 server.js를 건드리는 다른 WP 금지.

### WP-A2 영속 저장·원장·만료 정리 `M-L · Must`
- **목표:** 재시작 후에도 프로필·세션·보고서·전이 작업·원장이 유지(`STORE=file`). 삭제·만료 정리 동작.
- **작업:** 파일 `Store`(원자적 쓰기, 단일 프로세스 가정 명시) · 원장 월 경계·공급자별 합계 영속 · 만료(`expires_at`) 정리 작업 · 삭제가 모든 저장 사본을 지움(P0-2 의미 확장).
- **수용:** 서버 재시작 후 기록·비교 조회, 삭제 후 파일에서도 본문 제거 확인, 만료 정리 테스트, 손상 파일 처리(빈 상태로 시작+경고).
- **선행:** A1. **병렬:** B1, C1, C3~C6.

### WP-A3 Workers 어댑터·DO 저장 `L · Should · DG-1 선행`
- **목표:** 같은 핸들러를 Cloudflare Workers에서 실행. 세션 상태는 DO(SQLite) 등 단일 작성자 저장.
- **작업:** `worker/index.js`, DO 클래스, `wrangler` 설정(루트), `documents.js`의 `node:zlib`→`DecompressionStream` 대체 검토·구현, 비밀값 바인딩, 정적 파일 서빙 제거(Pages 담당).
- **수용:** 핸들러 계약 테스트가 Worker 진입점(`fetch(Request)`)으로도 통과, 로컬 `wrangler dev` 스모크는 **개발자 승인·환경 확인 후** 수동. 한도(요청 크기·CPU·저장)는 공식 문서 확인 결과를 보고에 첨부(미확인이면 `[UNVERIFIED]`).
- **선행:** A1, A2, DG-1 확정. 의존성(wrangler) 설치는 승인 필요.

### WP-A4 Pages 배포·API 기본 URL·CORS·CI `M · Should`
- **목표:** 정적 UI를 GitHub Pages로, API 기본 URL을 설정 가능하게, CORS 허용 목록 적용, 배포 워크플로.
- **작업:** `public/config.js`(또는 meta)로 `API_BASE` 주입 · CORS(허용 오리진 목록, `Authorization`·`Idempotency-Key`·`x-admin-token` 헤더) · 번들·저장소에 비밀 없음 검사 · `.github/workflows/pages.yml`(배포 자체는 개발자 실행).
- **수용:** 배포 산출물에 키 패턴 없음(스크립트 검사), CORS 사전 요청 테스트, 로컬에서 `API_BASE` 변경 동작.
- **선행:** D1, DG-1.

## 4. Track B — AI

### WP-B1 공급자 라우팅·게이트·호출 래퍼 `L · Must · 임계`
- **목표:** `04 §2~3`을 구현한다. 새 공급자 없이 Gemini·Mock으로 검증 가능해야 한다.
- **작업:** `providers/{registry,gate,call}.js` · `config.registry` 실사용 · `provider_trace` 필드(세션·턴·보고서) · `GET /providers/status` · 429→폴백 계속+원장 정산(BUG-8) · 보고서 `evaluator` 추가·`badge` 제거(BUG-6) · fixture 해시 기반 합성 판정(DG-4, 03 §5) · 사용자별 속도 제한 확대(문서 추출·STT·TTS·턴) · 예산 사전 확인 키 수정.
- **수용:** `04 §7`의 1~8번 항목을 **Gemini 어댑터와 Mock**으로 먼저 통과, 위조 플래그 회귀 유지, 라벨 일치 테스트, 기존 테스트 전부 통과.
- **선행:** A1. **후속:** B2, B3, B6.

### WP-B2 DeepSeek 꼬리질문 어댑터 `M · Must · DG-2`
- **작업:** `adapters/deepseek.js`(fetch, 모델·URL은 env) · `prompts/followup.js` · 출력 검증기(04 §1 `dialogue.next`) · 스텁 계약 테스트 · 스모크 도구(수동).
- **수용:** `04 §7` 전 항목(스텁). 환경변수 미설정 시 Mock. **실호출은 승인된 합성 스모크에서만.**
- **선행:** B1, DG-2.

### WP-B3 Claude 지원서 주장 추출 어댑터 `M-L · Must · DG-2`
- **작업:** `adapters/claude.js` · `prompts/claims.js` · 모델 결과→서버 위치 재계산·원문 불일치 폐기·규칙 결과 하한선 병합 · 골든 케이스.
- **수용:** 원문에 없는 인용 폐기, 규칙 결과보다 나빠지지 않음, 인젝션 문장 무영향, 마스킹된 텍스트만 외부 전송(스텁에서 확인).
- **선행:** B1, DG-2. **병렬:** B2.

### WP-B4 Claude 평가(옵션) `M · Could · DG-8`
- **작업:** `evaluation.generate`를 모델로 생성하되 `validateEvaluation` 통과분만 채택, `evaluator.kind='llm'`. 사람 평가(E2) 전에는 UI에서 "Claude 분석 · 검증 중"으로만.
- **선행:** B3, E2 설계. **금지:** 검증 없이 "정확한 AI 평가" 표기.

### WP-B5 Groq STT 실검증 `S-M · Should · DG-2`
- **작업:** 합성 음성으로 실호출 스모크(승인 후), 오류율·지연 기록, 전사 PII 경고·교정 흐름 점검, 실패 경로(무음·짧음·한도·권한)를 UI 상태 머신(06 §10)과 맞춤.
- **수용:** `docs/validation-results.md`에 실측 기록(표본 수·방법 포함), 실측이 없으면 "미실행".
- **선행:** DG-2, D5(UI 연결).

### WP-B6 ElevenLabs TTS 프록시 `M · Should · DG-2`
- **작업:** `POST /sessions/:id/tts`(세션 문장만 합성, 임의 텍스트 거부), 오디오 스트림, 실패 시 `fallback:'browser'`, 속도 제한, 비용 상한. UI `질문 듣기` 연동.
- **수용:** 세션 외 텍스트 요청 거부 테스트, 게이트·예산 0건 호출 테스트, 폴백.
- **선행:** B1, D5.

### WP-B7 골든 케이스·불변식 하니스 `M · Should`
- **작업:** `tests/eval/golden/*`, 불변식 러너(인용 원문 일치·신규 숫자 없음·질문 1개·금지 어휘). 공급자 어댑터 출력과 규칙 출력 모두에 적용.
- **선행:** B1.

## 5. Track C — 제품 로직

### WP-C1 문서 종류·revision·한글 PDF `M-L · Should(문서 모델은 Must)`
- **작업:** `SourceDocument/DocumentRevision` 저장, `POST /profiles/:id/documents`·`PATCH /documents/:id`·revisions, 종류(공고/자소서/이력서/기타), 업로드 한도 정합(BUG-9), 실제 **합성 한국어 PDF/DOCX 샘플**(한글 폰트 임베디드 포함) 시험·실패 시 붙여넣기 안내 유지. PDF CID/ToUnicode 지원 여부 판단(미지원이면 명시적 실패 코드).
- **수용:** 원본 바이너리 비저장, revision 분리, 샘플 N종 추출 성공/실패율 기록, zip bomb 방어 유지.
- **선행:** A1(핸들러), A2 권장.

### WP-C2 공식 자료 수집기 `L · Could`
- **작업:** `domain/fetcher.js`: 허용 도메인 목록, **DNS 해석 후 사설 IP 재검사**, 리디렉션 재검증, 크기·시간·타입 제한, robots·약관 고려, 상태 분리(`official_verified/unavailable/stale/conflict`), 발췌 위치 저장. `POST /profiles/:id/sources/:sid/fetch`.
- **수용:** `05` #5 시험 전부. 미구현 시 대안: 큐레이션 fixture를 `user_supplied`/"데모 fixture"로 표기(공식 확인으로 표기 금지).
- **선행:** A1, C1.

### WP-C3 월간 트렌드 규칙 강화·반영 `M · Must(규칙)/Should(반영)`
- **작업:** BUG-5(출처 ≥1·코멘트 필수·최대 3), `unpublish`, 목록 API, `approved_by`, 이전 버전 보존·롤백 유지, 공개 항목을 **보조 기준 라벨로** 질문 계획에 반영(미승인·없음은 반영 금지). 기존 잘못된 데이터(`competency:"a"`) 정리 절차.
- **수용:** 출처 없는 공개 422, 공개본만 반영, 롤백 시 새 버전.

### WP-C4 전이 질문 확대 `M · Should`
- **작업:** BUG-7: 전 루브릭 역량 템플릿 또는 모델 생성(B3 이후 선택)+유사도·역량 일치·기준 답변 재사용 금지 검사. `practiceText` 미사용 코드 제거.
- **수용:** 루브릭 6종 모두 같은 역량·다른 질문(유사도 <0.55) 테스트.

### WP-C5 PII 탐지 보강 `M · Should`
- **작업:** 이름·학교·주소 후보 탐지(휴리스틱), `이유/이번/이해/21세기` 오탐 회귀 유지, 블라인드 패턴 보강, 오탐 코퍼스.
- **수용:** 정/오탐 코퍼스 테스트, 완전 익명화를 주장하지 않는 문구.

### WP-C6 합성 샘플(fixtures)·동의 API `M · Must · DG-4,9`
- **작업:** 합성 지원자 샘플(기업 1·대학 1: 공고·자소서·샘플 답변) 코드/정적 JSON, `GET /fixtures`, `POST /consents`, `consent_required`(428), 해시 일치 판정(03 §5), 합성 판정 회귀 테스트.
- **수용:** 위조·불일치 시 합성 취급 안 함, 일치 시에만 합성, 동의 없는 실데이터 프로필 428.
- **선행:** A1.

### WP-C7 주장 추출 확장 `M · Could`
- **작업:** 자소서/이력서 구분 반영, 다중 문서, 패널·기술 유형 적용, 질문 선택 개선, 규칙 정확도 측정용 코퍼스(미탐·오탐).
- **선행:** C1.

### WP-C8 질문 계획 API `M · Should`
- **작업:** `GET /profiles/:id/plan`: 질문별 `application_evidence_ids`/`institution_evidence_ids`/`trend_ids`/`source_status`/`generator`. 세션 생성이 이 계획을 사용(주장 제외 반영).
- **선행:** C3, C1.

## 6. Track D — UI/UX (명세: 06)

### WP-D1 UI 모듈화 `M-L · Must · 먼저`
- **작업:** `app.js`(≈1,830줄)를 `06 §11.1` 구조로 **동작 불변** 분리. `<script type="module">`, CSP 유지, 번들러·의존성 금지.
- **수용:** E2E 54개 그대로 통과, 가드(`check-project`) 통과, 기능 변경 0.

### WP-D2 디자인 시스템·컴포넌트·상태·카피 `M · Must`
- **작업:** 토큰 확장, `06 §4` 컴포넌트 모듈, 7상태 패턴, `core/copy.js`(고정 문구·`reason`→한국어 매핑·금지 표현 린트), 모드 칩 개편(`/providers/status`).
- **선행:** D1.

### WP-D3 S2 지원 정보 재설계 `L · Must`
- **작업:** 06 §S2 전체(문서 카드·종류·편집·샘플·연령·처리 안내 오버레이·동의). API 미구현 구간은 계약 기반 스텁으로 개발하고 보고서에 표기.
- **선행:** D2, C1·C6(또는 계약 스텁).

### WP-D4 S3 근거 확인 재설계 `M · Must`
- **작업:** 06 §S3(주장·공백·제외 토글, 출처 상태 칩, 트렌드, 질문 계획 미리보기).
- **선행:** D2, C8(또는 스텁).

### WP-D5 S4·S5 설정·면접실 `L · Must`
- **작업:** 06 §S4·S5·§10(음성 상태 머신, TTS 버튼, 폴백 배너, 일시정지·종료 다이얼로그, 모바일 하단 행동 바, 세션 복원).
- **선행:** D2, B1(`provider_trace`).

### WP-D6 S6·S7 보고서·재연습 `M · Must`
- **작업:** 06 §S6·S7(먼저 바꿀 것 1개 강조, 주장↔답변, 평가기 칩, 비교 라벨·고정 문구).
- **선행:** D2, B1(evaluator).

### WP-D7 S8·S9 기록·관리자 `M · Must`
- **작업:** 06 §S8·S9(삭제 범위 UI, 데이터 처리 패널, 관리자 편집기·검토 체크리스트·공개 중단).
- **선행:** D2, C3.

### WP-D9 S1 대시보드·복원·라우트 가드 `M · Must`
- **작업:** 이어하기, 새로고침 복원, 가드 메시지, 문서 타이틀·포커스 이동.
- **선행:** D2, A2(영속).

### WP-D8 접근성·반응형·카피 QA `M · Must · 마지막`
- **작업:** 06 §8~9·§12 점검표 수행, E2E에 가능한 검사 추가(가로 오버플로, 라벨, 금지 표현, 포커스 이동), 수동 점검 결과 기록(미수행 항목 명시).
- **선행:** D3~D7, D9.

## 7. Track E — 품질·운영

### WP-E1 E2E 인프라 `S-M · Must · DG-11`
- **작업:** Playwright 버전 고정·실행 가이드(`08 §2`), `npm run e2e`, CI(가능 시), 산출 스크린샷 경로 규약, 브라우저 빌드 불일치 문제 해결.
- **수용:** 깨끗한 환경에서 문서만 보고 E2E 실행 가능.

### WP-E2 사람 평가 실험 설계 `M · Should`
- **작업:** `08 §4`의 실험 양식·채점 가이드·입력 데이터 형식·결과 기록 템플릿. **실험 수행은 사람이 한다.** 결과 없이 "검증됨" 표기 금지.

### WP-E3 데모 리허설 `S-M · Must · 마지막`
- **작업:** `08 §1` 시나리오 대본·체크리스트·장애 대응(공급자 다운 시 Mock 폴백 시연), 리허설 로그.

### WP-E4 문서 정합 `S · Must`
- **작업:** README·IMPLEMENTATION_CHECKLIST·docs 갱신, PROJECT.md §7·§10~§12·§17 최종 동기, 남은 불일치 목록.

## 8. 컷라인별 구성

| 컷라인 | WP |
|---|---|
| **Must** | A0, A1, A2, B1, B2, B3, C1(문서 모델), C3(규칙), C6, D1~D7, D9, D8, E1, E3, E4 |
| **Should** | A3, A4(배포 선택 시), B5, B6, B7, C1(한글 PDF), C3(반영), C4, C5, C8, E2 |
| **Could** | B4, C2(수집기), C7 |

배포를 하지 않기로 하면(DG-1 대안 B) A3·A4는 제외하고 `STORE=file` Node 서버로 시연한다.
