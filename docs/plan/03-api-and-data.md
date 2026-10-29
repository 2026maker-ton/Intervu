# 03. 데이터 모델·API 계약

> 현재 구현과의 차이를 **현재 / 변경 / 신규**로 표시한다. 스키마를 바꾸면 `PROJECT.md` §4.3과 같은 변경에서 동기화한다. 모든 응답 본문은 JSON, 오류는 `{ code, message, retryable, request_id, details }`.

## 1. 공통 규약

| 항목 | 규칙 |
|---|---|
| 인증 | `Authorization: Bearer <접속 토큰>`. 관리자 기능은 추가로 `x-admin-token` 헤더(쿼리·본문 금지) |
| 쓰기 요청 | `Idempotency-Key` 필수. **변경:** 현재는 헤더 존재만 검사 → 소유자+키+(메서드·경로·본문 해시)로 응답을 24h 저장·재생, 같은 키 다른 본문은 409 |
| 소유권 | 모든 행에 `owner_id`. 조회·변경은 항상 소유자 범위. 타 사용자 리소스는 404 |
| 시간 | ISO-8601 UTC. 만료는 `expires_at`(기본 +30일, DG-10) |
| 버전 | 세션 명령은 `expected_version`(낙관적 잠금)과 `command_id`(재생) 유지 |
| 한도 | 본문 크기, 문서 크기, 호출 속도는 사용자별 제한. 초과 시 413/429 + `retryable` |
| 라벨 | 모델이 관여한 응답에는 `provider_trace`(§4) 포함. Mock 사용을 숨기지 않는다 |

## 2. 데이터 모델 (목표)

`P` = PROJECT.md §4.3 대응. `[현재]` 구현 여부 표기.

| 엔티티 | 핵심 필드 | 비고 |
|---|---|---|
| **Consent** | `id, owner_id, age_19_confirmed(bool), notice_version, provider_modes_seen(map op→mode), created_at` | `[신규]` 감사 기록. 실데이터 경로 전 필수(§3 `consent_required`) |
| **ApplicationProfile** (P) | `id, owner_id, org_type(company\|university), target_name, role_or_major, track(전형, 대학), synthetic(server-derived), status, expires_at` | `[현재, 변경]` `track`·`synthetic` 추가 |
| **SourceDocument** | `id, profile_id, kind(posting\|cover_letter\|resume\|other), filename, sha256, extract_status(ok\|failed\|scanned\|unsupported), failure_code` | `[신규]` 현재는 상태 없는 `/documents/extract` |
| **DocumentRevision** | `document_id, revision, origin(extracted\|user_edit), text_masked, char_count, created_at` | `[신규]` 원본/추출/수정 분리(PROJECT.md §2.1). 원본 바이너리는 저장하지 않음 |
| **Source** (P: SourceDocument 중 URL) | `id, profile_id, url, host, kind, status(official_verified\|user_supplied\|monthly_trend\|unverified\|unavailable\|stale\|conflict), retrieved_at, confirmed_at, published_at, quote` | `[현재 일부]` `status` 값 확장. 수집기 전에는 `official_verified` 부여 금지 |
| **EvidenceClaim** (P) | `id, profile_id, document_id, revision, quote, start_cp, end_cp, kind(applicant_claim\|posting_keyword), gaps[], excluded(bool), status` | `[현재 일부]` `applicant_claims`/`claims`가 프로필 버전 `extracted`에 저장됨 → 별도 행으로 이동, `excluded` 추가 |
| **InstitutionProfile** | `core_values[], formats[], role_focus[], evaluable[], unevaluable[], badge, fallback_to_general, approved_at` | `[현재]` |
| **MonthlyTrend** (P) | `segment, yyyy_mm, versions[{version, items[≤3]{competency, comment, sources[≥1]}, status, published_at, approved_by}]` | `[현재, 변경]` 출처·코멘트 필수(BUG-5), `approved_by` 추가, 공개 중단(unpublish) |
| **InterviewPlan / Question** (P) | `question_id, text, target_competency, primary, application_evidence_ids[], institution_evidence_ids[], trend_ids[], source_status, prompt_version, generator(rule\|model), provider_trace` | `[현재 일부]` 지원서 근거 질문만. 기관·트렌드 연결은 `[TODO]` |
| **Session** | `id, owner_id, profile_version_id, interview_type, duration, persona, input_mode, state, version, questions[], policy_snapshot, synthetic` | `[현재]` |
| **Turn / AnswerRevision** (P: AnswerTurn) | `turn_id, question_id, speaker, revision, origin(user\|stt_correction), text, quality_flags[]` | `[현재]` |
| **Evaluation** (P) | `evaluation_id, rubric_version, dimensions[{id, status, level, observation, evidence[{turn_id, revision, start_cp, end_cp, quote}]}], next_actions[], claim_links[], institution_link, evaluator{kind, provider, model, version}, provider_trace[]` | `[현재, 변경]` `evaluator` 신규, `badge` 제거(BUG-6) |
| **TransferJob / Comparison** (P) | `transfer_id, owner_id, baseline_session_id, retry_session_id, competency, rubric_version, baseline{...}, retry{...}, comparison{status, delta, evidence[], caution}` | `[현재]` 인메모리 → `Store`로(삭제 연동 유지) |
| **ProviderCall**(감사) | `id, owner_id, session_id?, operation, provider, model, mode(live\|mock\|fallback\|blocked), reason, latency_ms, tokens_in/out, cost_est, created_at` | `[신규]` 본문·키 비저장 |
| **LedgerEntry** | `scope(session\|profile\|provider\|month), reserved, settled, unknown` | `[현재, 변경]` 영속·월 경계 리셋·공급자별 |
| **Fixture** | `id, kind, title, posting_text, application_text, answers[], seed` | `[신규]` 서버 보유 합성 샘플(코드/정적 JSON). 클라이언트 입력 아님 |
| **Deletion** | `id, kind(session\|account), completed_at, backup_expiry` | `[현재]` |

**삭제 규칙(불변):** 세션 삭제 시 그 세션의 전이 작업·내보내기·재작성 연습·이의 제기·공급자 호출 감사(본문 없음 제외 대상 아님)를 파기하고, 계정 삭제 시 소유자의 모든 행을 파기한다(`purgeOwnedCaches`와 같은 의미를 `Store` 전체로 확장, 테스트 유지).

## 3. API 목록

경로 접두사 `/api/v1`. 표의 **상태**: `현재`(유지), `변경`, `신규`.

### 3.1 공개·상태
| 메서드 경로 | 인증 | 상태 | 설명 |
|---|---|---|---|
| GET `/health` | 없음 | 현재 | 비인증: `{ ok, provider:{selected}, time }` 만. 인증 시 전체 설정 |
| GET `/providers/status` | 사용자 | **신규** | operation별 `{provider, mode: live\|mock, blocked_reason?}` — UI 모드 칩·설정 요약용. 키·모델 ID 비노출(모델명은 표시용 별칭만) |
| GET `/stt/status` | 사용자 | 현재 | 키 비노출 |
| GET `/fixtures`, GET `/fixtures/:id` | 사용자 | **신규** | 합성 샘플 목록/본문. `DEMO_FIXTURES=on`일 때만 |

### 3.2 동의·프로필·문서·근거
| 메서드 경로 | 상태 | 설명 |
|---|---|---|
| POST `/consents` | **신규** | `{ age_19_confirmed:true, notice_version }` → Consent. 실데이터 프로필 생성 전 필수 |
| POST `/profiles` | 변경 | `{ org_type, target_name, role, track?, source_text?, application_text?, experiences[], sources[], fixture_id? }`. 동의 없고 `fixture_id`도 없으면 428 `consent_required`. `fixture_id`가 있으면 본문이 서버 fixture와 **해시 일치**할 때만 `synthetic=true`(서버 판정). 응답에 `applicant_claims_count`, `provider_trace` |
| GET `/profiles/:id` | 현재 | 확장: 문서·claims·sources 요약 |
| POST `/profiles/:id/documents` | **신규** | `{ kind, filename, mime_type, content_base64 }` → 추출 상태·revision 1. 크기 한도 정합(BUG-9) |
| PATCH `/documents/:id` | **신규** | `{ text }` → revision n+1(`user_edit`). claims 재계산은 승인 단계에서 |
| GET `/documents/:id/revisions` | **신규** | 목록 |
| POST `/documents/extract` | 현재(유지·deprecate 예정) | 상태 없는 추출. 신규 UI는 위 `documents` 사용 |
| GET `/profiles/:id/claims` | **신규** | 주장·공백 목록(`excluded` 포함) |
| PATCH `/claims/:id` | **신규** | `{ excluded:boolean }` — 사용자가 질문 대상에서 제외 |
| POST `/profiles/:id/sources` | 현재 | URL 메타 등록(수집기 전에는 접속 안 함) |
| POST `/profiles/:id/sources/:sid/fetch` | **신규(Could)** | 서버 수집기(WP-C2). `official_verified/unavailable/stale/conflict` 상태 분리 |
| GET `/profiles/:id/institution` | 현재 | |
| POST `/profiles/:id/approve` | 현재 | 승인 시 claims 확정(제외 반영) |
| GET `/profiles/:id/plan` | **신규** | 질문 계획 미리보기: 질문별 근거 링크(주장·기관 요구·트렌드), `generator`, `provider_trace` |

### 3.3 세션·면접·보고서
| 메서드 경로 | 상태 | 설명 |
|---|---|---|
| POST `/sessions`, GET `/sessions`, GET/DELETE `/sessions/:id` | 현재 | 응답에 `provider_trace` 요약 추가 |
| POST `/sessions/:id/commands` | 현재(변경) | `session.start/pause/resume/finish`, `turn.text`/`turn.commit`, `pt.prepare`. 응답에 `provider`, `degraded_reason`, `provider_trace`. 429 시 **정적 폴백으로 계속**(BUG-8) |
| POST `/sessions/:id/transcriptions` | 현재 | multipart 음성 → 텍스트. 원음 비저장 |
| POST `/sessions/:id/tts` | **신규** | `{ target: 'current_question' \| 'last_utterance' }` — **세션이 가진 문장만** 합성(임의 텍스트 금지, 오픈 프록시 방지). 음성 바이너리 스트림, 실패 시 204+`fallback:'browser'` |
| GET `/sessions/:id/events`, `/connect`, `/report` | 현재 | |
| POST `/turns/:id/revisions` | 현재 | 전사 교정(`stt_correction`) / 내용 개선은 새 연습 |
| POST `/evaluations/:id/appeals`, GET `/appeals/:id` | 현재 | |

**보고서 변경:** `badge:"AI 생성 코칭…"` 제거. 추가: `evaluator:{kind:'rule_based'|'llm', provider, model_alias, version}`, `provider_trace[]`, `claim_links[]`(현재 있음). 보고서 UI는 `evaluator.kind==='rule_based'`면 "규칙 기반 참고 관찰"을 항상 표시.

### 3.4 재연습·기록·데이터
| 메서드 경로 | 상태 | 설명 |
|---|---|---|
| POST `/practice-attempts` | 변경 | 전 루브릭 역량 지원(BUG-7), 서버 생성 새 질문+유사도 검사 유지 |
| POST/GET `/transfer-comparisons` | 현재 | `Store` 영속, 삭제 연동 유지 |
| POST `/exports`, GET `/exports/:id` | 현재 | JSON. 내보내기에는 키·내부 감사 제외 |
| DELETE `/account`, GET `/deletions/:id` | 현재 | 확장된 삭제 범위(§2) |
| GET `/history/summary` | 신규(Could) | 같은 루브릭·같은 질문 조건 전후만 묶어 반환(UI §8.8) |

### 3.5 월간 트렌드·관리자
| 메서드 경로 | 상태 | 설명 |
|---|---|---|
| GET `/trends/:segment/:yyyyMm` | 현재 | 공개본만(없으면 `unavailable`) |
| POST `/admin/trends` | 변경 | 항목별 **출처 ≥1·코멘트 필수**, 최대 3개 |
| POST `/admin/trends/:id/publish`, `/rollback` | 현재 | |
| POST `/admin/trends/:id/unpublish` | **신규** | 공개 중단(이전 버전 보존) |
| GET `/admin/trends`, GET `/admin/trends/:id/history` | 변경 | 목록(분야·월)·이력 |
| GET `/admin/status`, GET `/metrics`, GET `/diagnostics/*` | 현재 | `x-admin-token` 필수 |

## 4. `provider_trace` (표준 라벨)

모델이 관여할 수 있는 모든 응답/보고서에 포함한다.

```json
[{
  "operation": "dialogue.next",
  "provider": "deepseek",         // 실제 응답한 공급자. 폴백이면 "mock"
  "mode": "live",                 // live | mock | fallback | blocked
  "reason": null,                 // fallback/blocked 사유 코드: rate_limited, timeout, invalid_output,
                                  //   budget_cap, kill_switch, not_configured, live_ack_missing,
                                  //   real_data_ack_missing, consent_missing, synthetic_only
  "model_alias": "…",             // 표시용. 모델 ID 원문·키 비노출 가능
  "latency_ms": 840
}]
```
UI는 이 값만으로 모드 칩·배너를 그린다(`06 §5`).

## 5. 합성 샘플(Fixture) 판정 규칙 (DG-4)

1. 서버가 합성 샘플(공고·지원서·샘플 답변)을 **코드/정적 JSON**으로 가진다.
2. `fixture_id`가 있고 제출 텍스트의 정규화 해시가 fixture와 일치할 때만 `profile.synthetic=true`.
3. 턴 텍스트가 해당 fixture의 샘플 답변과 일치할 때만 `turn.synthetic=true`. 일치하지 않는 직접 입력은 **합성으로 취급하지 않는다.**
4. 합성으로 판정된 경우에만 "승인 전(무료/미검증) 공급자"를 허용한다(`04 §2`). 클라이언트의 `synthetic`/`free_test` 값은 어디서도 읽지 않는다(회귀 테스트 유지).
5. UI는 "샘플 불러오기"→ 입력란 채움, "샘플 답변 넣기"→ 답변란 채움으로 제공하고 "합성 샘플" 배지를 표시한다.
