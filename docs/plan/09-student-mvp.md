# 09. 학생 대상 데모 MVP 전환 명세 (2026-10-30)

> **지위:** 이 문서는 `PROJECT.md`가 갱신되기 전까지 하위 에이전트의 구현 기준이다. 충돌하면 `PROJECT.md`의 보안·개인정보 불변 조건(§5)이 우선한다. "목표"는 구현 완료가 아니다.
> **2026-10-30 구현 상태:** WP-S1·S2·E·U가 `feat/student-mvp`에 병합됨(커밋은 `PROJECT.md` §17). `PROJECT.md` v1.3.0이 갱신되어 이 문서는 구현 사양 이력이 되었다. 구현/향후 구분·검증 상태는 `PROJECT.md` §7.6. Gemini·Groq 실호출은 확인되지 않았다 `[UNVERIFIED]`.
> **목표:** 고도화 이전의 **데모 MVP**. 불필요한 기능 확장 금지. 기존에 정상 동작하는 기능(재연습·전이 비교·기록·삭제·관리자 등)은 **유지**한다(삭제·재설계 금지).

## 1. 범위 변경

| # | 변경 | 구현 원칙 |
|---|---|---|
| 1 | 타깃: **고입·대입 면접 준비 학생**. 기업·취업은 이번 범위에서 제외 | UI 진입점은 `고입`(org_type `highschool`)과 `대입`(`university`)만. 서버는 `company`/`public`을 **레거시로 계속 받되**(기존 테스트·회귀 보존) UI에서 노출하지 않고 문서에 "범위 밖(레거시)"로 표기. 기본 org_type은 `university`. |
| 2 | 학교별 맞춤: 학교·학과의 **모집요강·인재상 탐색·분석 → 질문 생성 반영** | §3. 출처·**확인 시점(`confirmed_at`)** 기록, 확인되지 않은 정보는 `unconfirmed`로 남기고 **추측하지 않는다**. |
| 3 | 월간 트렌드: 설계 + **Mock 데이터**. **AI가 필요하다고 판단할 때만** 조회·활용 | §4. |
| 4 | AI: Claude·DeepSeek **보류**. **Gemini**로 질문 생성·면접 진행(꼬리질문)·평가 통합 | §5. 기존 Claude/DeepSeek/ElevenLabs 어댑터 코드는 **삭제하지 않고** 환경변수로 꺼진 채 유지(보류). |
| 5 | TTS는 현재 기본 내장(브라우저 `SpeechSynthesis`) 유지. 음성 인식은 **Groq Whisper**(기존 어댑터·UI 재사용) | §6. |
| 6 | MVP 우선순위: 학교·학과 선택 → 정보·인재상 분석 → 맞춤 질문·꼬리질문 → **음성 면접** → 근거 기반 피드백 | 이후(재연습·고급 분석)는 유지만 하고 신규 확장 금지. |

## 2. 미성년자 제약 (변경 불가)

고입 지원자는 **미성년자**다. `PROJECT.md` §1.3·§5 #2의 제약을 **완화하지 않는다.**
- 고입 경로에서 **실제 학생 입력(지원서·답변·음성)은 외부 AI(Gemini·Groq)로 전송하지 않는다**(규칙 기반/Mock으로만 처리). 서버가 **fixture 일치로 합성 판정**한 데이터만 외부 호출 가능.
- 대입 경로도 `age_19_confirmed=true`가 아니면 실데이터 외부 전송 불가(기존 게이트 유지).
- 동의 API 변경: `POST /api/v1/consents {age_19_confirmed:boolean, minor_notice_ack?:boolean, notice_version}`. `age_19_confirmed=false`이면 `minor_notice_ack=true` 필수(= "만 19세 미만은 외부 AI 없이 연습함을 이해"). 기록은 둘 다 저장. 게이트의 `age19`는 `age_19_confirmed`만 본다.
- `highschool`은 **합성(fixture) 요청이 아닐 때만** Mock 강제(`providerConstraintForOrg`): 서버 fixture 데이터는 외부 호출 허용.
- 음성(STT)은 실제 음성이라 위와 동일 게이트(미성년·무동의면 서버 전사 차단 → 텍스트 입력 안내). Groq 전사에는 만 19세 확인과 별도 음성 전송 고지 동의가 필요하다(`notice_version=stt-groq-2026-10`); 개발자 로컬 설정은 `GROQ_LIVE_ACK`+`GROQ_REAL_DATA_ACK`로만 연다. Groq는 안정성·악용 조사 목적으로 입력·출력을 최대 30일 임시 보관할 수 있고 미국에서 처리될 수 있으므로, UI는 Zero Data Retention 설정 확인도 안내한다.
- UI 문구의 "만 19세 이상 대상"은 "고입·대입 준비 학생 대상, 미성년자는 외부 AI로 전송되지 않는 모드로만 실데이터 사용"으로 바꾼다.

## 3. 학교별 맞춤 분석 (WP-S)

### 3.1 입력
프로필 생성 본문에 필드 추가(기존 `target_name`/`role`은 그대로 호환): `school_name`(학교명), `department`(학과·계열), `track`(전형, 선택). 서버는 `target_name=school_name`, `role=department`로 정규화해 기존 로직과 호환한다.

### 3.2 탐색(discovery) — 추측 금지
- `src/domain/school-directory.js`: **데모용 합성 학교 레지스트리**(가상 학교 2~3곳: 고교 1·대학 2, 각 `official_url_demo`, 모집요강·인재상 원문 합성 텍스트, `label:"데모 fixture(실제 학교 아님)"`). 실제 학교명은 레지스트리에 **만들어 넣지 않는다.**
- 학교명이 레지스트리와 일치하면 해당 합성 자료를 소스로 자동 등록(`kind:'demo_fixture'`, `status:'demo_fixture'`).
- 일치하지 않으면 **자동 탐색 실패**로 처리: "공식 자료를 찾지 못했습니다. 입학처 URL을 입력하거나 모집요강을 붙여넣어 주세요"(추측으로 URL·내용을 만들지 않는다). 실제 웹 검색 기반 탐색은 **향후 계획**(문서에 명시).
- 사용자가 URL을 주면 기존 수집기(`OFFICIAL_FETCH_ALLOW`, 기본 꺼짐)로 수집한다. 꺼져 있으면 `unavailable`/`fetch_disabled`로 표시하고 붙여넣기를 안내한다.

### 3.3 분석 (`POST /api/v1/profiles/:id/school-analysis`)
- 입력 텍스트 = 수집/등록된 소스 본문(+붙여넣은 `source_text`). 각 소스: `{id,url,title,kind,status,retrieved_at,confirmed_at,published_at?}`. `confirmed_at`은 서버가 분석에 사용한 시점(ISO).
- Gemini operation `school.analyze`(게이트·예산·폴백은 기존 호출 래퍼): 출력 JSON
  `{ talent_traits:[{label, quote}], admission_elements:[{label, quote}], interview_format:[{label, quote}] , unconfirmed:[string] }`.
  **모든 항목의 `quote`는 입력 원문의 부분 문자열이어야 한다**(서버가 위치를 재계산, 불일치 항목은 폐기). `label`은 12자 이내 요약. 모델 출력에 없는 항목(예: 면접 시간·배점)은 `unconfirmed`에 "면접 형식 미확인" 식으로 서버가 채운다. 수치·일정은 원문에 있을 때만 인용.
- 폴백(게이트 닫힘·실패·합성 아님): 기존 규칙 기반(`buildInstitutionProfile` 키워드) 결과 + `analysis_mode:'rule_based'`. 응답에 `provider_trace`.
- 결과는 기존 `institution` 프로필 구조에 병합해 저장(`core_values[].source_quote`, `source_title`, `confirmed_at` 포함)하고 **사용자 승인 흐름(approve)을 유지**한다. 응답/저장 필드: `school_analysis:{talent_traits, admission_elements, interview_format, unconfirmed, sources[], analysis_mode, analyzed_at}`.
- 삭제·내보내기 정책: 소스·분석은 프로필과 함께 삭제된다(기존 삭제 경로에 포함).

## 4. 월간 트렌드 — Mock + AI 선택적 조회 (WP-S)

- `src/domain/trend-mock.js`: 월별 Mock 데이터(`YYYY-MM` × segment `highschool`|`university`, 각 3개 이내, `{id,title,summary,topic_tags}`), **모든 항목에 `mock:true`, 라벨 "Mock 데이터(실제 입시·교육 이슈 아님)"**. 현재 월 데이터가 없으면 가장 가까운 월 사용하지 않고 `unavailable`.
- Gemini operation `trends.decide`: 입력 = 학교 분석 요약(라벨만)+학생 지원서 주장 라벨+segment+현재 월의 **트렌드 목록 제목만(요약 제외)**이 아니라 "트렌드 조회가 필요한지" 판단용 최소 정보. 출력 `{use_trend:boolean, trend_ids:[...], reason}`. `use_trend=true`이고 `trend_ids`가 Mock 데이터에 존재할 때만 해당 항목을 **조회해 질문 생성 입력에 포함**한다. 판단 호출이 막히거나(게이트·실패) `use_trend` 아님이면 **트렌드를 쓰지 않는다**(보수적 기본값).
- 사용 시 질문의 `trend_ids`, `source_status:'monthly_trend_mock'`, 라벨 `월간 트렌드(Mock · 보조)`를 남긴다. 트렌드는 학교의 공식 요구가 아님을 UI·보고서에 표기.
- 기존 관리자 월간 역량 저장소(C3)는 **유지**(삭제 금지). 데모의 질문 생성 경로는 Mock 모듈만 사용한다.

## 5. Gemini 통합 (WP-S 질문, WP-E 평가)

모든 호출은 기존 호출 래퍼(`caller.call`)·게이트·예산·폴백·`provider_trace`를 통과한다. 새 operation을 registry/config에 추가: `school.analyze`, `trends.decide`, `questions.design`, `evaluation.generate`(이미 정의, Gemini 구현 추가). 기본 공급자는 `gemini`, 환경변수 `LLM_*`/`ROUTE_*`로 바꿀 수 있어야 하며 Claude/DeepSeek 라우트는 기본에서 꺼둔다.

### 5.1 질문 생성 (`questions.design`)
- 입력: 승인된 학교 분석(인재상·전형요소의 **label+quote**), 학과, 지원자 주장(quote+gaps), (조건부) 트렌드 항목, 면접 시간(문항 수).
- 출력: `{questions:[{text, target_competency, evidence_ids:[...]}]}`. 근거 ID는 입력에 준 ID(`claim-N`, `trait-N`, `elem-N`, `trend-ID`)만 허용.
- 서버 검증: 질문 1개/문장, ≤200자, `?` 포함, 점수·합격·모범답안 어휘 금지, **입력 근거에 없는 숫자·고유명사 금지**, 알 수 없는 evidence_id 폐기, 개수 상한. 하나라도 위반하면 해당 질문 폐기, 전부 폐기되면 **기존 규칙 기반 계획**(`planGeneralQuestions`)으로 폴백. 지원자 주장 기반 질문(P0-3)은 **항상 앞에 유지**(모델이 대체하지 않음).
- 승인 시점에 한 번 생성해 버전에 저장(프리즈). 같은 계획을 세션 생성·`GET /profiles/:id/plan`이 사용(기존 C8 규약 유지). `generator:'gemini'|'rule'`.

### 5.2 면접 진행(꼬리질문) — 기존 `dialogue.next` 유지
프롬프트 입력에 `school_context`(학교 인재상 label 최대 5개)를 추가해 학교 맥락을 반영한다. 나머지 검증·폴백 불변.

### 5.3 평가 (`evaluation.generate`, Gemini)
- 입력: 확정 답변(턴별 텍스트·elicited 차원·루브릭 정의).
- 출력(JSON): 차원별 `{id, level(1-4)|null, observation, evidence:[{turn_id, quote}]}`, `next_actions`. 서버는 인용 위치를 원문에서 재계산하고 기존 `validateEvaluation`/`checkFeedbackSafety`를 통과한 보고서만 채택. 실패·검증 불일치 시 **규칙 기반 평가로 폴백**.
- 보고서 `evaluator`: Gemini 성공 시 `{kind:'llm', provider:'gemini', model_alias, version, validated:false}`, 폴백 시 `{kind:'rule_based',...}`. UI 칩: `Gemini 분석 · 검증 전(참고용)` / `규칙 기반 참고 관찰`. **합격 예측·점수 순위 금지**, "정확한 AI 평가" 주장 금지.
- 동의·게이트는 면접 답변도 실데이터이므로 §2를 따른다(고입 실제 입력은 외부 평가 호출 불가 → 규칙 기반).

## 6. 음성 (WP-V)

- TTS: 브라우저 `SpeechSynthesis` 유지(서버 TTS·ElevenLabs는 보류, 기본 라우트 `browser`).
- STT: 기존 Groq Whisper 어댑터·`POST /sessions/:id/transcriptions`·`MediaRecorder` UI·전사 확인/교정 흐름 재사용. 설정 화면 기본 답변 방식을 **`녹음 전사`(groq)** 로(`GET /stt/status`가 사용 가능일 때만; 아니면 텍스트 기본). 면접실에서 음성 기본 경로가 한 번에 보이게 한다(녹음 → 전사 → 확인·교정 → 제출).
- 게이트: `GROQ_LIVE_ACK`+`GROQ_REAL_DATA_ACK`+만 19세 확인+Groq 전송 안내 동의. 합성 프로필이나 서버 synthetic 테스트 설정은 마이크 녹음을 합성으로 취급하지 않는다. 차단 시 이유를 한국어로 보여 주고 텍스트로 계속.

## 7. 합성 샘플(fixtures)

`src/domain/fixtures.js`: `fx-highschool-1`(가상 고등학교·계열, 모집요강+인재상 포함 `posting_text`, 학생 `application_text`(자소서/학생부 요약 서술, 갭 포함), 샘플 답변 2~3개), `fx-university-1`(가상 대학·학과, 동일 구조) 유지/갱신. `company` fixture는 레거시 테스트용으로 남기되 UI 목록(`GET /fixtures`)에는 `highschool`/`university`만 노출. 모든 샘플은 가상(실제 학교·인명·연락처 없음). 학교 레지스트리(§3.2)와 fixture의 학교명·모집요강 텍스트가 **일치**해야 한다(샘플 → 자동 탐색 성공 경로).

## 8. 완료 기준 (MVP)

1. 대시보드에서 고입/대입 선택 → 학교·학과 입력(샘플 불러오기 포함) → 근거 확인 화면에 **학교 분석(인재상·전형요소·확인 시점·출처 상태·미확인 목록)** 표시 → 승인.
2. 승인된 근거로 만든 **학교 맞춤 질문**(질문별 근거 표시)과 꼬리질문.
3. 설정 기본 `녹음 전사`로 음성 답변 → 전사 확인·교정 → 제출. (서버 전사가 막히면 사유 표시 후 텍스트로 계속)
4. 보고서: 평가기 칩이 실제 평가기와 일치, 인용 기반 관찰, 주장↔답변 연결.
5. 트렌드는 AI가 필요하다고 판단한 경우에만 Mock에서 조회되고 질문에 "Mock 트렌드" 라벨이 붙는다.
6. 기존 테스트 전부 통과(레거시 company 테스트 포함), 신규 기능 테스트 추가, `npm test`·`check:project`·`npm run e2e`·`npm run rehearsal` 통과(시나리오가 고입/대입으로 갱신).
7. `PROJECT.md`와 문서가 **구현된 것 / 향후 계획**을 구분해 갱신된다.

## 9. 향후 계획(이번 범위 밖, 구현 금지)
실제 웹 검색 기반 학교 자동 탐색, 보호자 동의 절차와 미성년자 실데이터 외부 AI 경로, 실제 월간 입시 이슈 수집·검수, Claude/DeepSeek 연동 재개, 사람 평가 후 평가기 승격, 재연습·고급 분석 확장.

## UI 개편 구현 기록 (2026-10-30)

사용자 승인 계획에 따라 P1·P4·P5의 UI를 전문 코칭 노트 형태로 개편했다. 기본 5분, 텍스트/허용된 녹음, 접힌 추가 설정, 자료 입력·데이터 관리·관리자 탭을 사용한다. 원문 인용·판단 보류·연령/소유권/삭제 보호는 유지한다. 학교 분석 병합에서 source_id/source_status를 보존하며 원문 일치를 공식 검증으로 취급하지 않는다. 마이크 녹음은 fixture 세션에서도 실데이터이며 고입 실음성은 외부로 전송하지 않는다. 비교 ID를 저장하여 서버 조회로 복원한다. 실모델·실기기·배포·학습 효과는 미검증이다. 과거 문서의 점진 개선/재설계 금지는 이번 사용자 승인 전면 개편에 한해 대체한다.
