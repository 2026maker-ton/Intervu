# 데모 리허설 (WP-E3)

> 근거: `docs/plan/08-demo-and-qa.md` §1·§5·§6, PROJECT.md §13. **자동화된 것은 API 수준 리허설(`npm run rehearsal`)뿐이다.** 화면 클릭·모바일·마이크·실기기는 사람이 해야 하며, 아래 체크리스트에서 `미실행`으로 남아 있다.

> **2026-10-30 갱신(학생 MVP):** 대본 1·2열의 `기업 취업`·"가상 회사"는 이전 기준이다. 현재 UI 진입점은 `고입`/`대입`이며, 근거 확인 단계에서 **학교 분석**(인재상·전형요소·확인 시점·출처 상태·미확인 목록)을 확인한다. 아래 §4 `실행 2`는 이 패스에서 새로 실행한 API 리허설이다(UI 수동 대본은 이번에도 **미실행**).

## 1. 시연자 대본 (12단계)
전제: 합성 샘플만 사용, 화면 상단 모드 칩이 `Mock`(또는 실제 모드)과 일치하는지 먼저 말로 확인한다. 접속 후 토큰 입력(`DEV_TOKEN_A` 값).

| # | 라우트 | 클릭 | 말할 것 | 확인할 것 |
|---|---|---|---|---|
| 1 | `#/dashboard` | `기업 취업` | "지원서의 주장을 근거로 묻고, 코칭하고, 새 질문으로 다시 확인하는 도구입니다." | 지원 정보 화면으로 이동 |
| 2 | `#/application` | `합성 샘플 불러오기` → 연령·처리 안내 동의 | "전부 가상의 인물·회사입니다." | `합성 샘플` 배지, 동의 기록 |
| 3 | `#/evidence` | `근거 확인하기` | "자소서 문장 그대로와 위치를 보여주고, 없는 정보는 칩으로 표시합니다." | 원문 문장+위치, 공백 칩 |
| 4 | `#/evidence` | 출처 카드·월간 트렌드 | "공식 확인이 아니면 사용자 제공/데모라고 표시합니다." | 출처 상태 라벨 |
| 5 | `#/evidence` | 주장 1개 제외 → `이 내용으로 승인` | "승인해야 면접으로 넘어갑니다." | 승인 후에만 설정 진입 |
| 6 | `#/setup` → `#/room` | 기본값으로 면접 시작 | "첫 질문은 자소서 문장을 인용합니다." | 근거 칩, 모드 칩 |
| 7 | `#/room` | `샘플 답변 넣기` | "꼬리질문이 방금 답변에 이어집니다." | 꼬리질문, 폴백이면 앰버 배너 |
| 8 | `#/room` | 마이크(선택) | "전사를 확인·교정한 뒤 제출합니다. 안 되면 텍스트로 갑니다." | 전사 교정 / 텍스트 폴백 |
| 9 | `#/feedback` | 면접 종료 → 보고서 | "이것은 규칙 기반 참고 관찰이며 합격 예측이 아닙니다." | `규칙 기반 참고 관찰` 칩, 발언 인용, 바꿀 행동 1개, 주장↔답변 |
| 10 | `#/repractice` | `이 역량으로 새 질문 재연습` | "같은 역량, 다른 질문입니다." | 질문이 이전과 다름 |
| 11 | `#/repractice` | 비교 | "한 번의 비교라 개선을 단정하지 않습니다." | 상태(관찰된 변화/뚜렷한 변화 없음/판단 보류)+주의문 |
| 12 | `#/history`, `#/admin` | 내보내기 → 세션 삭제 → 관리자 토큰으로 월간 초안→공개 | "삭제하면 보고서·비교·내보내기가 모두 사라집니다. 출처 없는 트렌드는 공개되지 않습니다." | 삭제 후 목록에서 사라짐, 출처 필수 |

기업 경로 후 대학 경로(`#/dashboard`에서 `대학 입시`)를 한 번 더 시연한다.

## 2. 장애 대응 (08 §5)
| 상황 | 대응 |
|---|---|
| 외부 AI 지연·실패·한도 | 앰버 배너와 함께 기본 질문으로 계속(폴백). "Mock로 대체됨"을 말로 설명. (API 수준 시험: §4 provider-down) |
| 서버 재시작/데이터 소실 | `STORE=file`이면 복원(정상 종료 시 즉시 기록, 비정상 종료는 최대 약 200ms 분량 유실 가능). 소실 시 샘플 재로드 후 6단계부터 |
| 마이크 권한/미지원 | 텍스트 입력으로 진행(음성은 선택) |
| 네트워크 단절 | 로컬 Node 서버 + `STORE=file` 백업 실행(DG-1 대안 B) |
| 실모델 키 만료·결제 이슈 | `LLM_*_PROVIDER=mock`로 전환, 모드 칩이 Mock으로 바뀌는 것을 보여줌 |

## 3. 사전 점검 체크리스트 (08 §6)
`실행`은 이 저장소에서 실제로 돌린 것만 표시한다.

| 항목 | 상태 | 비고 |
|---|---|---|
| 깨끗한 환경 설치→실행→토큰 입력→시나리오 1~12 완주(2회 이상) | 미실행 | API 수준 완주만 `npm run rehearsal`로 실행(UI 클릭 미실행) |
| 기업·대학 양 경로 | 부분 실행(API만) | UI는 미실행 |
| 데스크톱·모바일 폭 | 미실행 | |
| 비밀(`.env`)이 저장소·화면·로그·스크린샷에 없음 | 미실행 | 내보내기 응답의 키 흔적 검사만 리허설에 포함 |
| 공급자 모드 표시 vs 실제 호출 일치 | 부분 실행(API만) | 폴백 시 `provider=mock`·`mode=fallback`, 평가기 `rule_based` 확인. 화면 표시는 미실행 |
| 금지 표현 0건, 평가기 칩 정확 | 미실행 | 평가기 값(`rule_based`)만 API로 확인 |
| 삭제 후 잔존 없음, 내보내기에 키 없음 | 부분 실행(API만) | 삭제 후 보고서·전이·내보내기 404, 내보내기 키 흔적 없음 |
| 백업 플랜(§2) 각각 1회 시연 | 미실행 | 공급자 다운 폴백만 API로 실행 |
| 리허설 로그를 `docs/validation-results.md`에 기록 | 미실행 | 이 문서 §4에 기록(validation-results.md는 미수정) |

## 4. 리허설 로그
`npm run rehearsal`은 임시 `DATA_DIR`(STORE=file)·`DEMO_FIXTURES=on`·`ADMIN_TOKEN` 설정의 프로세스 내 앱에서 서버 fixture로 실행한다. 보고서 직후 앱을 정상 종료·재기동해 영속을 확인하고, 공급자 다운은 Gemini 구성 + 합성 인스턴스 + 500/429 스텁(외부 호출 없음)으로 확인한다.

**실행 1** — 2026-10-29, Windows 11, Node v22.15.0, 공급자 Mock(외부 호출 없음), 결과 26/26 PASS, 미해결 없음

```
scenario | step | result | detail
company | 1 프로필(fixture) | PASS | synthetic=true claims=3
company | 3 주장 추출 | PASS | claims=3
company | 5 승인 | PASS | plan questions=5
company | 6 세션 생성 | PASS | session ok
company | 7 답변·종료 | PASS | fixture 답변 제출 후 종료
company | 9 보고서 | PASS | evaluator=rule_based claim_links=2
company | 9r 재시작 후 복원 | PASS | 같은 evaluation_id 복원
company | 10 새 질문 재연습 | PASS | competency=evidence_specificity
company | 11 변화 비교 | PASS | status=observed_change
company | 12 기록·내보내기 | PASS | sessions=2
company | 12d 세션 삭제 후 404 | PASS | report/transfer/export=404
company | 12a 운영자 트렌드 초안→공개→비공개 | PASS | draft→publish→view(monthly_trend)→unpublish→view(unavailable)
university | 1 프로필(fixture) | PASS | synthetic=true claims=3
university | 3 주장 추출 | PASS | claims=3
university | 5 승인 | PASS | plan questions=5
university | 6 세션 생성 | PASS | session ok
university | 7 답변·종료 | PASS | fixture 답변 제출 후 종료
university | 9 보고서 | PASS | evaluator=rule_based claim_links=2
university | 9r 재시작 후 복원 | PASS | 같은 evaluation_id 복원
university | 10 새 질문 재연습 | PASS | competency=relevance
university | 11 변화 비교 | PASS | status=observed_change
university | 12 기록·내보내기 | PASS | sessions=2
university | 12d 세션 삭제 후 404 | PASS | report/transfer/export=404
university | 12a 운영자 트렌드 초안→공개→비공개 | PASS | draft→publish→view(monthly_trend)→unpublish→view(unavailable)
provider-down-500 | 폴백 지속 | PASS | 스텁 호출 4회, mode=fallback, 보고서 rule_based
provider-down-429 | 폴백 지속 | PASS | 스텁 호출 4회, mode=fallback, 보고서 rule_based
```

**실행 2** — 2026-10-30, Windows 11, Node v22.15.0, 기준 `49357bd`, 공급자 Mock(외부 호출 없음), 결과 **38/38 PASS**. 시나리오: `company`(레거시 서버 경로)·`highschool`·`university`(각 12개 단계: 프로필(서버 fixture)·주장 추출 3건·승인(질문 5개)·세션·답변·보고서 `evaluator=rule_based claim_links=2`·재시작 후 복원·새 질문 재연습·변화 비교 `observed_change`·기록 2건·삭제 후 404·운영자 트렌드 초안→공개→비공개) + `provider-down-500`/`429`(스텁 호출 10회, `mode=fallback`, 보고서 `rule_based`). 단계 ID·세부 출력은 `npm run rehearsal`로 재현한다. 이 리허설은 학교 분석·Gemini 평가를 거치지 않는다(규칙 기반 `rule_based`만 확인) — 해당 경로는 `tests/api/s1-school.test.mjs`·`s2-questions.test.mjs`·`e-llm-eval.test.mjs` 스텁 시험으로만 검증됐다.

**한계:** API 수준이다. UI·모바일·마이크·실기기·접근성·다른 브라우저·성능 측정·합성 샘플 이외 데이터는 검증하지 않았다. "기록" 단계는 재연습 세션 포함 2건을 센다.

## UI 개편 구현 기록 (2026-10-30)

사용자 승인 계획에 따라 P1·P4·P5의 UI를 전문 코칭 노트 형태로 개편했다. 기본 5분, 텍스트/허용된 녹음, 접힌 추가 설정, 자료 입력·데이터 관리·관리자 탭을 사용한다. 원문 인용·판단 보류·연령/소유권/삭제 보호는 유지한다. 학교 분석 병합에서 source_id/source_status를 보존하며 원문 일치를 공식 검증으로 취급하지 않는다. 마이크 녹음은 fixture 세션에서도 실데이터이며 고입 실음성은 외부로 전송하지 않는다. 비교 ID를 저장하여 서버 조회로 복원한다. 실모델·실기기·배포·학습 효과는 미검증이다. 과거 문서의 점진 개선/재설계 금지는 이번 사용자 승인 전면 개편에 한해 대체한다.
