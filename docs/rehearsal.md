# 데모 리허설 (WP-E3)

> 근거: `docs/plan/08-demo-and-qa.md` §1·§5·§6, PROJECT.md §13. **자동화된 것은 API 수준 리허설(`npm run rehearsal`)뿐이다.** 화면 클릭·모바일·마이크·실기기는 사람이 해야 하며, 아래 체크리스트에서 `미실행`으로 남아 있다.

> **2026-10-31 갱신:** 아래 "시연자 대본"은 현재 대입·일반 면접 UI 기준으로 다시 썼다. 4절 로그와 "UI 개편 구현 기록"은 당시 기준의 이력이다(재연습·기록·관리자 화면은 현재 숨김).

## 1. 시연자 대본 (2026-10-31 기준, 대입·일반 면접)
전제: 화면 상단 모드 칩이 `Mock`(또는 실제 모드)과 일치하는지 먼저 말로 확인한다. 입장 비밀번호(`SITE_PASSWORD`)가 켜져 있으면 먼저 입력한다. 아래 흐름은 사람이 화면으로 하는 리허설이며 자동 검사는 `npm run e2e`(UI)와 `npm run rehearsal`(API)가 맡는다.

| # | 화면 | 하는 일 | 확인할 것 |
|---|---|---|---|
| 1 | 로그인 | 가입(이름·이메일·비밀번호·만 18세 확인·처리 안내 동의) 후 로그인 | 가입 직후 대시보드로 이동, 새로고침해도 로그인 유지 |
| 2 | 지원 정보 | `샘플 불러오기`에서 대학 샘플 선택 | 샘플 라벨("예시 설명, 공식 모집요강 아님") |
| 3 | 근거 확인 | 자동 분석·검색을 기다림 | 역량 칸 "검색 중…" → 결과 또는 "직접 등록" 안내, 검색 결과는 "AI 검색 · 미검증" 표시 |
| 4 | 근거 확인 | 렌치로 역량 수정, 새로고침 아이콘으로 다시 분석 | 수정하면 재승인 필요 표시 |
| 5 | 근거 확인 | 승인 | 질문 5개가 고정되어 면접 준비로 이동 |
| 6 | 면접 준비 → 면접실 | 마이크 확인 후 시작 | 면접실에는 질문만 보임(근거·진행률·녹음 버튼 없음) |
| 7 | 면접실 | 말하기(또는 텍스트 모드) | 낭독이 끝나면 자동 녹음, 3초 정적+문장 종결 후 "네 답변 잘 들었습니다.", 60초 초과 시 마감 문구 — **실마이크는 미검증** |
| 8 | 결과 | 면접 종료 | 차트(참고 점수·역량 적합성·레이더·음성), 답변별 음량 그래프, `i` 버튼 근거, 라벨 "검증 전(참고용)" |
| 9 | 상단 메뉴 | 내 데이터 삭제 → 로그아웃 | 삭제 후 기록 접근 404 |

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
