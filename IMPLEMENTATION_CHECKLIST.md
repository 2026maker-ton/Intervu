# Intervu 구현 체크리스트 (현재 상태)

_갱신: 2026-10-30, 학생 MVP 문서 패스, 기준 커밋 `49357bd`(`feat/student-mvp`). 정본은 `PROJECT.md`(§7.6 학생 MVP 상태, §11 결함, §12 로드맵). 충돌하면 PROJECT.md가 맞다._

## 검증 기준선 (이번 패스에서 새로 실행)
- `npm run check:project`: PASS 4/4 (문서 구조 검사일 뿐)
- `npm test`: **286개**. 대부분 286 pass / 0 fail, **간헐적으로 285 pass / 1 fail**(실행마다 다른 시험, 원인 미조사) — 안정 통과로 보고하지 않음
- `npm run e2e`: **155 ok**, 1회 "E2E 통과"; 다른 1회 실행에서 `키보드 포커스 링 항상 표시` 1건 FAIL(간헐)
- `npm run rehearsal`: **38/38 PASS**(API 수준, Mock; company 레거시·highschool·university·공급자 장애)
- `node tools/e2e-institution.mjs`: 14 pass / 0 fail
- **미실행:** `verify-design`, Gemini·Groq 실호출 전부(합성 톤 Groq 연결 확인 1건은 전달 사항이며 재검증 안 함), 실제 음성, Safari/Firefox, 실기기, Pages·Workers 실배포, 공식 사이트 실수집, 사람 평가·STT 오류율, UI 수동 리허설

## 학생 MVP 전환 (docs/plan/09)
- [x] U 고입/대입 두 여정 UI, 기업·공공 UI 미노출(서버 레거시 유지) — E2E 확인(Mock)
- [x] S1 동의 `minor_notice_ack`, 고입 실입력 Mock 강제, 학교·학과 입력, 합성 샘플(`fx-highschool-1`/`fx-university-1`)
- [~] S1 학교 탐색(데모 레지스트리 3곳 + 붙여넣기/URL) · 학교 분석(`school.analyze`, 서버 인용 재검증) — **스텁 시험만**, 실웹 탐색 미구현
- [~] S2 Mock 트렌드 + `trends.decide` + `questions.design`(승인 시 동결, 규칙 폴백) — **스텁 시험만**
- [~] E Gemini 평가 + 라벨 `Gemini 분석 · 검증 전(참고용)` + 규칙 폴백 — **스텁 시험만**
- [?] 음성: Groq STT 기본 + 브라우저 TTS — 실음성·실기기 `[UNVERIFIED]`
- 보류: Claude·DeepSeek·ElevenLabs(코드 유지, 기본 꺼짐)

## 완료 `[DONE]` (Mock·스텁 시험 범위, 이전 WP)
- [x] P0 게이트 위조 방어·삭제 완전성·관리자·토큰·주장 1차 규칙 기반
- [x] A0~A2 테스트 분리·핸들러/Store/멱등·`STORE=file` · B1 공급자 registry·gate·call · B7 골든 하니스
- [x] C1 문서 revision · C3 트렌드 규칙 · C4 전이 질문 15개 · C5 PII 휴리스틱 · C6 합성 fixture·동의 · C8 질문 계획 API
- [x] D1~D7·D9 UI · E1 `npm run e2e` · E3 API 리허설(UI·실기기 미실행) · D8 자동 접근성 검사(수동 미실행)

## 부분 / 미검증 / 보류
- [ ] A3 Workers·A4 Pages — 코드만, 미배포 (보류)
- [ ] B2 DeepSeek · B3 Claude · B6 ElevenLabs — 스텁 시험만 (보류)
- [ ] B5 Groq STT — 계약 시험·수동 스모크만
- [ ] C2 공식 수집기 — 스텁 시험만, 기본 꺼짐, DEBT-9
- [ ] C7 주장 추출 — 합성 코퍼스 한정
- [ ] E2 사람 평가 — 프로토콜만, 결과 없음
- [ ] B4 Claude 평가 — 보류

## 향후 계획 (구현 금지)
실제 웹 검색 기반 학교 탐색 · 보호자 동의·미성년자 실데이터 외부 AI 경로 · 실제 월간 입시 이슈 수집·검수 · Claude/DeepSeek 재개 · 사람 평가 후 평가기 승격 · 실제 로그인(DEBT-2)

## 열린 결함·부채 요약 (PROJECT.md §11)
DEBT-1 단일 프로세스 파일 저장 · DEBT-2 실제 인증 없음 · DEBT-7 PII 휴리스틱 · DEBT-9 수집기 TOCTOU · DEBT-10 비교가 키워드 점수 · DEBT-11 월 상한·속도 제한 인메모리 · DEBT-12 공급자 요청 형태 미확인 · DEBT-13 Workers/Pages 미검증 · DEBT-14 평가 사람 비교 없음 · DEBT-15 신규 Gemini operation 실호출 미검증 · DEBT-16 간헐 실패 시험

## 데모 완료 조건(PROJECT.md §13)
Mock 경로 12단계는 E2E·API 리허설로 통과하나 DEBT-2 미해소, Gemini·Groq 실호출 미검증, UI 수동 리허설 미실행이므로 **완료 조건 미충족**.
