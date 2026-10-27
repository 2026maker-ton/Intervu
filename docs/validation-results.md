# 설계 산출물 검증 기록

검증일: 2026-10-23 (설계), 2026-10-24 (MVP 구현·브라우저 E2E), 2026-10-26 (계약 보완·UI 개편). 대상은 연구·설계 문서, 합성 fixture, 비용 계산기, Mock-first MVP 코드다. 실사용자 데이터·유료 공급자 품질 검증이 아니다.

## 실행 확인

- `node tools/verify-design.mjs`: 통과. JSON 파싱, 발언 구간/인용 일치, 참조 턴·질문 역량, 차원 중앙값, 중복 차원, 가짜 인용·다른 턴·중복 증거·잘못된 수준 등 6개 오류 변형의 거부 확인.
- `node tools/cost-model.mjs --sessions=1000`: 절약형 1회 $0.021133333, 1,000회 API $21.133333, 25% 예비 포함 $26.416667, 계획 고정비 포함 $65.416667~106.416667.
- `node tools/cost-model.mjs --sessions=1000 --tts-free-tier`: 해당 월 다른 TTS 사용량이 없다는 가정에서 API $12.333333. 무료량은 프로젝트 공유이므로 실제 청구가 이 값이라는 보장은 없음.
- `node --check tools/verify-design.mjs`, `node --check tools/cost-model.mjs`: JavaScript 문법 통과.
- 기존 연구의 절약형 합계 $0.02063 오류를 실행 검산으로 발견하여 $0.02113으로 관련 표·수치를 교정.

## 교차 검토 후 수정

1명령 다수이벤트를 허용하도록 event unique 제약 수정; 오디오 ACK·누락·epoch 계약 추가; unknown 공급사 호출의 자동 중복 재시도 금지; 블라인드 컨텍스트 분리; 전사 정정과 답변 재작성 분리; 공급사 이전 정책 게이트; 이의제기 API; 만료 후 자동삭제; 공고추출 비용우회 방지; 평가 호출슬롯 예약을 반영했다.

## 2026-10-24 MVP 구현 검증

- `npm test`: 21개 통합 테스트 통과(인증·멱등·소유권·상태전이·NFC span 인용·가독 인용 구간·90초 재연습·서버 시간 상한·예산 429·공급자 게이트·삭제 목록 제외). 3회 반복 실행 모두 통과.
- `node tools/verify-design.mjs`: 통과.
- `node tools/cost-model-gemini.mjs --sessions=1000`: 세션당 $0.066(LLM $0.026 + STT $0.04), 1,000회 $66, 25% 예비 포함 $82.5. Gemini 공식 가격 가정이며 측정값 아님.
- `node tools/gemini-smoke.mjs`: 실키로 모델 가용성 확인. `gemini-3.5-flash-lite`·`gemini-3.6-flash`·`gemini-3.5-flash` 응답 OK, `gemini-2.5-flash-lite`는 신규 사용자 404. `gemini-3.5-transcribe`는 목록에 존재.
- 브라우저 E2E(Mock): 공고 입력+개인정보 토스트 → 추출 카드(span 위치 표시) → 승인 → 세션 설정(10/15분, 성향, 블라인드) → 시작 → 답변·꼬리질문 → 종료 → 근거 인용 보고서(판단 보류 포함) → 90초 재연습(별도 세션) → 기록 → 보고서 재열람 → 세션 삭제. 삭제 세션은 목록에서 제외.
- 브라우저 E2E(Gemini): `GEMINI_PAID_ACK=false`에서 `/api/v1/health`가 `selected: mock`을 반환하여 실사용자 경로가 외부로 전송되지 않음을 확인.

## 2026-10-26 계약 보완·UI 개편 검증

- `npm test`: 25개 통합 테스트 통과. 기존 21개 + 4개 추가(프로필 속도제한 분당 cap·`connect` 일회성 티켓 발급/사용/재사용 거부·세션 JSON 내보내기→계정 전체 삭제→목록 비움·이의제기 evidence_id 검증 + received/reviewing 조회).
- 명세 대비 추가 구현: `POST /sessions/:id/connect` + `GET /sessions/:id/ws?ticket=`(30초 일회성, 재사용 불가), `POST /exports` + `GET /exports/:id`(JSON, 10분 만료), `DELETE /account`(계정 전체 tombstone 후 파기), `GET /appeals/:id`(received→reviewing 자동 전이), 프로필 추출 속도제한(기본 분당2/일10 + 호출당 $0.01 원장 예약), 킬 스위치(`KILL_PROVIDERS=gemini` 시 외부 호출 차단), 일시정지/재개·질문 TTS(브라우저 SpeechSynthesis)·질문 복사·이의 유형 선택/상태 조회·전사 교정 UI.
- UI 개편: 왼쪽 연습 흐름(1 지원 정보 → 2 추출 확인 → 3 면접 설정 → 보고서) + 오른쪽 고정 라이브룸(LIVE 파형·남은 시간·진행·예산 상태·일시정지/TTS). 라이트 “연습실” 테마, 단계 상태 배지, Ctrl+Enter 답변 제출, `role=status` 토스트.
- 문서 반영: `implementation-spec.md` §16(프로필 속도제한·킬 스위치·연결 티켓·내보내기/계정삭제·테스트 25개), `validation-results.md` 본 절, `.env.example`(프로필 속도제한·킬 스위치 변수).

### 이번 검증에서 수정한 결함

1. 90초 재연습 시작이 `expected_version` 불일치(409)로 실패 → API가 생성 직후 버전(2)을 반환하고 클라이언트가 그 값을 사용.
2. 재연습 질문에 꼬리질문 문장이 없어 followup 호출이 기본 질문을 반환 → 재연습 전용 후속 질문·역량 지정.
3. 재연습 길이가 3분(180초)으로 표시 → 90초로 통일(`duration_seconds` 도입).
4. 평가 인용이 답변 앞 8자만 잘라 문맥이 사라짐 → 첫 문장(공백 경계) 구간으로 변경, 가독 인용 테스트 추가.
5. 클라이언트 타이머만 있고 서버 시간 상한이 없음 → `active_elapsed_ms`+서버 시계로 답변 시점에 세션 종료, pause/resume 누적 반영.
6. 삭제된 세션이 기록 목록에 노출 → deleted/deleting 제외.
7. 진행바가 질문 수 8 고정 → 세션 질문 수 기준.

## 2026-10-27 기관 맞춤형 고도화 검증

- `npm test`: 31개 통합 테스트 통과(기존 25개 + 기관 6개: 기업 공식출처 연결·일반템플릿 폴백·SSRF/신선도/비공식 표시·역할 분리 루브릭 고정·고교 Mock 강제·역할값 검증).
- `node tools/verify-design.mjs`: 통과.
- `node tools/e2e-institution.mjs`: 14개 통과(기업 프로필→기관draft→승인→HR 세션→시작→종료→보고서 기관연결, 대학 입학사정관 세션·역할 라벨, SSRF localhost 차단, 고교 Mock 강제, stale 표시). 전용 ephemeral 서버(`PROFILE_RATE_LIMIT_PER_MINUTE=100`)로 공용 서버 429 회피.
- UI: 기관구분 4종(일반기업/공기업·공공기관/대학/고교)·URL 입력·역할 선택(6종)·기관 확인·보고서 기관 연결 영역. 브라우저 실화면 전체 여정은 스냅샷 렌더 확인, 헤드리스 스크린샷은 `Screenshot needs a visible tab` 제약으로 미촬영.

## 검증 한계

JSON Schema 전문 validator는 실행하지 않았으며 전달 예시의 domain 불변식만 검사했다. DB migrations/RLS·WSS·유료 공급자 품질·부하시험은 아직 구현·검증 전이다(MVP는 인메모리 단일 프로세스). 브라우저 E2E는 로컬 Mock 경로이며 실제 사용자 데이터·실제 결제 계정 검증이 아니다. 시장·경쟁 사실은 공식 공개 자료 범위이고 제품 로그인 후 동작·무료량·효과를 검증한 것이 아니다. 법률 검토는 적용 쟁점을 정리한 것이며 자문 완료가 아니다. 출시 승인은 종합 설계서 G0~G9의 해당 게이트로 판단한다.
