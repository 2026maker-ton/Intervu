# Intervu 구현 체크리스트 (현재 상태)

_갱신: 2026-10-29, WP-E4, 기준 커밋 `aa6d0cc`(`fix/p0-1-provider-gate`). 정본은 `PROJECT.md`(§7 상태, §11 결함, §12 로드맵). 이 문서는 요약이며 충돌하면 PROJECT.md가 맞다._

## 검증 기준선 (새로 실행)
- `npm run check:project`: PASS 4/4 (문서 구조 검사일 뿐)
- `npm test`: **252 pass / 0 fail / 0 skipped** (Mock·스텁 fetch, 외부 호출 0)
- `npm run e2e`: **155 ok**, "E2E 통과" (헤드리스 Chromium 1종, Mock 전용)
- `node tools/e2e-institution.mjs`: 14 pass / 0 fail
- **미실행:** 실키 공급자 호출 전부, Safari/Firefox, 실기기 마이크·TTS, Pages·Workers 실배포, 공식 사이트 실수집, 사람 평가·STT 오류율 실측, 데모 리허설

## 완료 `[DONE]` (Mock·스텁 시험 범위)
- [x] P0: 공급자 게이트 위조 방어(P0-1), 삭제 완전성(P0-2), 관리자·토큰 정리(P0-6), 지원서 주장 1차 규칙 기반(P0-3)
- [x] A0 테스트 분리 · A1 핸들러/Store/멱등 · A2 `STORE=file` 영속
- [x] B1 공급자 registry·gate·call · B7 골든 불변식 하니스
- [x] C1 문서 종류·revision · C3 트렌드 규칙 · C4 전이 질문 15개 · C5 PII 휴리스틱 · C6 합성 fixture·동의 · C8 질문 계획 API
- [x] D1~D7·D9 UI(모듈화, 디자인 시스템, 지원 정보, 근거 확인, 설정·면접실, 보고서·재연습, 기록·관리자, 대시보드·복원)
- [x] E1 `npm run e2e`

## 부분 `[PARTIAL]` / 미검증 `[UNVERIFIED]`
- [ ] A3 Workers 어댑터·DO Store — 코드·계약 테스트만, **Workers 미실행**
- [ ] A4 Pages 배포 준비·CORS — 코드·워크플로만, **배포 미실행**
- [ ] B2 DeepSeek · B3 Claude 주장 추출 · B6 ElevenLabs TTS — **스텁 시험만**, 요청 형태·모델·약관 미확인, 실호출 없음
- [ ] B5 Groq STT — 계약 시험·수동 스모크 도구만, 실측 미실행
- [ ] C2 공식 자료 수집기 — 스텁 시험만, 기본 꺼짐, DNS rebinding 틈(DEBT-9)
- [ ] C7 문서 기반 주장 — 합성 코퍼스(49문장) 한정
- [ ] E2 사람 평가 — `docs/eval/` 프로토콜·템플릿만, 실험·결과 없음

## 미착수 `[TODO]`
- [ ] B4 Claude 평가(사람 평가 검증 전에는 "검증된 AI 평가" 금지)
- [ ] D8 접근성·반응형·카피 전수 QA(스크린리더·키보드 수동 점검 기록 없음)
- [ ] E3 데모 리허설(`npm run rehearsal` 없음)
- [ ] 실제 로그인·역할 모델(DEBT-2), 실제 한국어 PDF/DOCX 검증, 목표 구성 실모델 품질·보안 검증

## 열린 결함·부채 요약 (상세 PROJECT.md §11)
- DEBT-1 파일 저장은 단일 프로세스·기본은 memory · DEBT-2 실제 인증 없음 · DEBT-7 PII 휴리스틱 · DEBT-9 수집기 TOCTOU · DEBT-10 비교가 키워드 규칙 점수 · DEBT-11 공급자별 월 상한·속도 제한 인메모리 · DEBT-12 공급자 요청 형태 미확인 · DEBT-13 Workers/Pages 미검증 · DEBT-14 평가 사람 비교 없음

## 데모 완료 조건(PROJECT.md §13)
12단계는 Mock 경로 E2E로 통과하나 DEBT-2 미해소, 실모델 미연결, 리허설 미수행이므로 **완료 조건 미충족**이다.
