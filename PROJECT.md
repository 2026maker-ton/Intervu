# Intervu — 제품 전체 기획 및 구현 기준서

> **Version:** 1.2.0 | **기준일:** 2026-10-29 | **상태:** 목표 제품 명세 + 2026-10-29 전수 점검 결과(§7·§10~§17) + WP-E4 문서 정합(브랜치 `fix/p0-1-provider-gate`, 기준 커밋 `aa6d0cc`). 목표 설계는 구현 완료를 뜻하지 않는다.
>
> **핵심 정의:** 지원서의 주장을 검증하고, 부족한 답변을 집중 훈련한 뒤, **처음 보는 다른 질문**에서 개선 여부를 확인하는 근거 기반 AI 면접 코치.
>
> **North Star:** Application claim probing → evidence-grounded coaching → new-question transfer check.

## 0. 이 문서의 지위와 변경 원칙

이 문서는 Intervu의 **최상위 제품 방향(Product Source of Truth)** 을 정의한다. 사용자 여정, 기능 우선순위, 제품 표현, 질문 생성, 평가, 데이터 처리, 완료 기준은 이 문서를 따른다.

우선순위는 다음과 같다.

1. 적용 법령, 최신 외부 AI 제공사 약관, 사용자 명시 지시, 필수 보안·개인정보 보호 요건
2. **`PROJECT.md`** — 제품 목표·대상·사용자 경험·기능 범위·완료 기준
3. 구현된 API 계약과 회귀 테스트 — 기능을 의도적으로 이행하기 전까지 보호
4. `docs/`의 과거 기획서·ADR — 변경 이력으로 유지하되 현재 제품 목표와 충돌하면 본 문서를 우선

과거 ADR의 보안상 제한은 **더 안전한 대안 및 근거가 승인되기 전까지 유효**하다. 기능 구현을 편하게 하려고 개인정보 전송 차단, 사용 연령 제한, 비용 상한을 제거하지 않는다.

**프로젝트 방향을 수정할 때에는 반드시 같은 변경에서 `PROJECT.md`와 관련 테스트를 수정한다.** 코드에 맞춰 문서만 몰래 완화하는 행위를 금지한다. 모든 설명은 `현재 구현`, `시제품`, `개발 예정`, `실험으로 검증됨`을 엄격히 구별한다.

**상태 표기 표준(§7 이후 전 구간 공통).** 코드 경로 또는 테스트 근거가 없는 상태 판정은 쓰지 않는다.

| 표기 | 의미 |
|---|---|
| `[DONE]` | 구현되어 있고 자동 테스트·브라우저 E2E 등으로 실제 동작을 확인함(Mock 경로 한정이면 그렇게 명시) |
| `[PARTIAL]` | 일부만 구현됐거나 목표 동작과 다름(차이를 같이 적는다) |
| `[TODO]` | 코드 없음 |
| `[BUG]` | 결함을 재현·확인함 |
| `[UNVERIFIED]` | 코드는 있으나 실키 호출·실사용자 환경 등 이번 점검에서 확인하지 못함 |

## 1. 제품 전략

### 1.1 해결할 문제

기업별 면접, 자소서 기반 질문, 꼬리질문, 음성 응답, AI 피드백은 이미 경쟁 서비스가 제공한다. Intervu는 이 기능들의 단순한 복제 또는 모델 교체만으로 차별화하지 않는다.

지원자는 자소서에 “리더십을 발휘했다”, “갈등을 해결했다”, “문제를 개선했다”고 작성하지만 실제 면접에서는 **본인 역할·판단 기준·행동·관찰된 결과·한계·배운 점**을 설명하지 못하는 경우가 있다. 일반적인 “더 구체적으로 답하세요”라는 피드백만으로는 다른 질문에서 실제로 답변이 개선되는지도 알 수 없다.

### 1.2 대체 불가능한 핵심 가치

1. **지원서 주장 검증(Claim probing):** 실제 지원서 구절을 근거로 역할, 행동, 결과, 논리, 불일치를 질문한다. 거짓말 탐지 또는 현실 사실 검증을 주장하지 않는다.
2. **약점 집중 훈련(Targeted remediation):** 실제 발언을 인용해 부족한 부분 한 가지를 지목하고, 다음 답변에 적용할 구체적 행동을 제안한다.
3. **새 질문에서 재검증(Transfer check):** 같은 역량을 다루는 **새롭고 다른 질문**으로 두 번째 답변을 받고, **같은 버전의 평가 기준**으로 비교하며 실제 발언 근거를 보여준다. 충분한 증거가 없으면 개선 판정을 보류한다.

원천 추적 가능성과 기업·대학 맞춤 기능은 이 핵심 루프를 뒷받침하는 기능이지 그 자체로 주요 차별점은 아니다.

### 1.3 대상과 범위

- **기업 취업:** 일반 기업 지원자. 기업명, 지원 직무, 채용 공고, 이력서·자기소개서·지원서를 받는다.
- **대학 입학:** 대학·학과·전형 지원자. 모집요강, 공시된 평가 기준, 해당 전형에서 사용 가능한 지원 자료를 받는다.
- 고교 입학, 토론 면접, PT, 패널, 상황 역할극 등은 **기본 제품 화면에서 제외**한다. 과거 코드에 있어도 핵심 사용자 흐름으로 노출하지 않는다.
- 대입 지원자 중 미성년자가 있을 수 있다. **연령 제한이 있는 AI API를 미성년자 실제 자료에 사용하지 않는다.** 법률·제공사 약관·적절한 처리 근거가 검증되기 전까지 합성 예제 데모 또는 적법한 다른 경로만 제공한다. 단순 체크박스나 보호자 동의 가정만으로 연령 제한을 우회하지 않는다.

### 1.4 하지 않을 것

합격 가능성 예측, 실제 합격 판정, 비공개 평가 기준 추정, 거짓말·성격·감정·외모 분석, 자동 경력·성과 조작, 검증되지 않은 기출이라고 주장하기, 총점·백분위 과장, 카메라 감시, 무단 웹 수집, 개인정보 포함 답변의 무료 AI API 무단 전송, 유료 모델 자동 승격을 하지 않는다.

### 1.5 프로젝트 개요·SDGs 연계·사용자 시나리오

- **프로젝트 성격:** 목표는 상용 출시가 아니라 **AI 경진대회에 제출할 수 있는, 처음부터 끝까지 정상 동작하는 작동형 데모**이다. 기능 수보다 한 줄기 데모 시나리오(§13)의 완주를 우선한다.
- **해결하려는 문제(가설):** 지원서에 쓴 주장을 면접에서 뒷받침하지 못하는 문제, 막연한 피드백으로는 다음 답변이 실제로 나아졌는지 확인할 수 없는 문제. 사용자 인터뷰·실측으로 검증된 것이 아니다(`docs/project-intro.md`도 가설로 분류).
- **SDGs 연계 `[미확정]`:** 저장소에는 SDGs 문서가 없다. 아래는 제출용 **연계 가설**이며 측정된 효과가 아니다. 제출 전에 공식 목표·세부목표 번호를 직접 확인한다.
  - SDG 4 양질의 교육(청년의 취업·진학 역량 개발): 면접 준비 기회를 근거 기반 코칭으로 확장.
  - SDG 8 양질의 일자리와 경제성장(청년 고용 진입): 공개 채용·모집 기준에 맞춘 준비.
  - SDG 10 불평등 감소: 고가 사설 면접 코칭에 접근하기 어려운 지원자의 비용 장벽 완화(무료·저비용 구성 목표). 단, 현재 데모는 **Mock/무료 티어 중심이라 실사용자 대상 효과를 주장하지 않는다.**
  - 기대 효과는 §6.2의 사람 평가 실험으로 측정하기 전까지 "기대"로만 쓴다.
- **주요 사용자:** ① 기업 취업 준비생(만 19세 이상), ② 대입 지원자 중 성인(미성년자는 §5 #2에 따라 합성 예제만), ③ 운영자(월간 역량 검수·승인; 현재 1인 개발 데모에서는 개발자 본인).
- **대표 시나리오(데모 기준):** 지원자가 기업/대학을 고르고 공고와 합성 자소서를 넣으면 → 서버가 원문에서 근거를 추출·표시 → 사용자가 확인 → 면접 → 근거 인용 보고서에서 약한 역량 1개 확인 → 같은 역량의 **다른 질문**으로 재연습 → 전후 발언 비교(또는 판단 보류) → 기록 내보내기·삭제.

## 2. 사용자 전체 여정

**대시보드 → 지원 정보·서류 입력 → 서류 추출·교정 → 공식 기관 자료 수집 → 근거 검토·확정 → 간단 면접 설정 → 맞춤 질문·꼬리질문 → 근거 기반 분석 → 약점 재연습 → 새 질문에서 비교 → 기록·삭제**

### 2.1 지원 정보 입력

- 유형: 기업 취업 / 대학 입학.
- 필수 정보: 대상 기관, 직무 또는 대학·학과·전형.
- 선택 정보: 공고·모집요강 URL/본문, 자기소개서·이력서·지원서, 부가 경험 자료.
- PDF/DOCX/TXT 및 텍스트 붙여넣기 기능을 단계적으로 구현한다.
- 서버에서 파일 확장자·실제 MIME·크기·파싱 실패를 검증하며 추출 텍스트를 사용자에게 보여준다. 스캔 PDF 등 읽을 수 없는 파일은 붙여넣기를 안내한다.
- 추출·변환이 실패했으면 **실패 상태를 표시**하고 내용을 지어내지 않는다.
- 원본 문서, 추출 텍스트, 사용자가 수정한 텍스트는 다른 revision으로 구분한다.

### 2.2 공식 홈페이지·기관 기준 조사

- 기업: 공식 채용 페이지, 인재상·핵심 가치, 직무 요구사항.
- 대학: 모집요강, 전형별 공개 평가 요소, 학과 맥락.
- **웹 탐색은 별도 서버 제어 수집기로 구현**한다. LLM에 URL만 전달했다고 자동 방문 또는 공식 확인이 완료된 것으로 간주하지 않는다.
- 각각의 근거에 문서 ID, URL, 출처 구분, 확인일·게시일(가능한 경우), 정확한 원문 발췌와 위치, 검증 상태를 연결한다.
- `official_verified`, `user_supplied`, `monthly_trend`, `unverified`, `unavailable` 상태를 구분한다.
- URL 접속 실패, 접근 거절, 근거 없음, 오래된 문서, 내용 충돌은 **서로 다른 상태**로 기록한다.
- 사용자가 근거를 미리 확인·수정·승인할 수 있게 한다. 공식 근거가 없으면 그 사실을 명확히 안내한다.

**우선순위:** 검증된 공식 자료 > 출처가 있는 사용자 제공 공고·모집요강 > 검수된 월간 트렌드(명시적 보조 기준) > 일반 템플릿. 월간 트렌드를 해당 기업의 공식 인재상처럼 표현하지 않는다.

### 2.3 월간 핵심 역량

매달 **기업 취업**과 **대학 입학**을 별도 영역으로 관리한다. 향후 직무·전형별 세분화는 충분한 자료가 생겼을 때 한다.

1. 관리자가 자료를 직접 등록하거나 서버가 허용된 공개 웹 자료를 수집한다.
2. AI가 역량 후보와 근거 문장을 추출·통합한다.
3. 관리자가 출처, 발행일, 반복성, 편향·충돌 여부를 검수한다.
4. 분야별 **최대 3개 핵심 역량**, 역량별 짧은 코멘트 1~2문장, 출처, 연월·버전을 승인·공개한다.
5. 공개 후에도 이전 버전을 보존하고 롤백 가능해야 한다.

승인 자료가 없으면 해당 달의 역량을 임의 생성하지 않는다. 자동 월별 작업이 구현·검증되기 전에는 자동 갱신된다고 소개하지 않는다.

### 2.4 지원서 주장 분석 및 질문 설계

**추적 구조:** `서류 원문 문장 → 지원자의 주장 → 검증할 부족한 정보 → 공식 요구 역량(또는 트렌드) → 질문 → 답변 → 관찰 근거 → 재연습 → 새 질문 비교`.

주장 추출 항목: 경험/성과 주장, 본인 역할, 행동, 판단 기준, 대안, 근거, 결과, 수치, 한계, 회고. 없는 정보를 있는 것처럼 채우지 않는다.

질문 예시: “팀 프로젝트에서 갈등을 해결했다고 하셨는데, 실제로 본인이 수행한 결정과 팀원이 수행한 일을 구분해 설명해 주세요.”

초기 5문항 구성의 **가설적 비율**:
- 지원서 구절의 역할·성과·논리 검증 2개
- 공식 기관 인재상·평가 요소와 연계한 역량 2개
- 지원 직무·학과·전형 맥락 1개

자료가 부족하면 비중을 유연하게 바꾸고, 질문별 기반 근거를 저장한다. 질문에는 `question_id`, `target_competency`, `application_evidence_ids`, `institution_evidence_ids`, `source_status`, `prompt_version` 등을 포함한다. 실제 자소서에 없는 수치, 성과, 사람, 경험을 생성하지 않는다.

### 2.5 실시간 면접

사용자가 설정할 항목은 기본적으로 **시간(5/10/15분), 면접관 성향(친절/보통/압박), 답변 방식(텍스트/마이크)** 정도로 제한한다. 블라인드 기능은 안전하게 동작하는 경우에만 선택적으로 표시한다.

- 질문은 한 번에 하나만 보여준다.
- 음성 답변은 STT로 변환하고, 사용자 교정·확인 후 확정한다.
- 답변에서 빠진 역할·이유·근거·결과·성찰을 파악해 **직전 확정 답변에 연관된 꼬리질문 하나**를 생성한다.
- 시간과 질문 수, 모델 호출 수, 사용자 비용 한도를 서버가 강제한다.
- 외부 모델이 실패하거나 429가 발생하면 승인된 정적 질문으로 대체하거나 제한된 상태로 마무리한다. 실제 AI 대신 Mock이 작동했으면 그대로 표시한다.
- 브라우저 TTS는 초기 옵션. 사람 음성처럼 오인시키는 가짜 아바타/파형은 넣지 않는다.

### 2.6 평가와 보고서

평가는 지원자의 인격이나 합격 가능성이 아닌 **관찰된 답변**을 대상으로 한다.

초기 루브릭:
- `relevance` — 질문에 직접 답했는가
- `evidence_specificity` — 본인 행동·결과·관찰 근거가 구체적인가
- `reasoning` — 선택과 판단 기준이 설명되는가
- `reflection` — 한계·학습·다음 행동이 드러나는가

각 관찰에는 해당 질문, 확정 답변 revision, **정확한 인용 구절과 코드포인트 구간**, 적용한 평가 기준 및 개선 행동을 연결한다. 단순 인용 문자열 일치 검사는 평가 내용의 타당성을 보장하지 않으므로 별도의 의미상 검수 시험이 필요하다. 근거가 부족하면 **판단 보류**한다.

**현재 서버의 평가는 키워드·길이에 따른 결정적 휴리스틱이다.** 새 의미 기반 평가기를 검증하기 전까지 UI에서는 “규칙 기반 참고 관찰”이라고 밝히고, “AI가 정밀 평가”나 근거 없는 수준의 정확도를 주장하지 않는다.

보고서에 반드시 표시할 것: **실제로 한 말 → 부족한 부분 → 다음에 바꿀 행동 하나 → 새 질문으로 재연습**. 과도한 복합 점수·순위·장식 그래프는 제외한다.

### 2.7 새 질문을 통한 개선 검증

- 기존 답변에서 관찰된 약점과 목표 역량을 선택한다.
- 기존 질문을 단순 반복하지 않고 **동일 역량을 묻는 새로운 질문**을 제시한다.
- 기존 답변·새 답변은 각각 독립적으로 저장한다.
- 같은 버전의 평가 기준과 가급적 유사한 난이도 조건에서 발언 근거를 비교한다.
- 결과는 `관찰된 변화` 또는 `자료 부족으로 판단 보류`로 표현한다.
- 90초 집중 연습은 초기 방식으로 허용하되, 그것만으로 학습 효과가 입증됐다고 주장하지 않는다.
- 인과적 향상을 주장하려면 별도의 사람 평가자·대조 설계가 필요하다.

### 2.8 면접 유형별 동작 설계 (현재 구현 vs 목표)

핵심 제품 경로는 **기업·대학 1:1 면접**이다. 나머지 유형은 코드에 있으나 §1.3에 따라 핵심 흐름이 아니다. 아래 "현재"는 Mock(규칙) 경로 기준이며 근거는 `tests/api/interview-types.test.mjs`·`tests/domain/pii-eval-transfer-trends.test.mjs` 등 해당 테스트다.

| 유형 | 현재 구현 | 목표 설계 |
|---|---|---|
| 일반·인성(1:1) | `[DONE]` 정적 팩+기관 템플릿 질문, 시간별 3/4/5문항, 규칙 평가 | 지원서 주장·공식 요구에 연결된 질문(§2.4), 목표 모델의 꼬리질문 |
| 면접관 성향: 친절/보통/압박(논리 검증) | `[PARTIAL]` 설정 값은 검증·저장됨. **Mock `next`는 성향을 사용하지 않고(`providers/adapters.js` `void persona`) Gemini 프롬프트에서만 어조를 바꾼다.** 즉 Mock에서는 성향 차이가 없다 | DeepSeek 프롬프트에서 성향별 압박 수준 구현, 모욕·인신공격·출신 질문 금지(`roles.js`) |
| 블라인드 | `[PARTIAL]` 저장·평가 텍스트에서 학교·출신·성별·연령 단서 마스킹. 마스킹은 완전하지 않음 | 안전하게 동작할 때만 선택 노출, 질문 생성 입력도 마스킹 |
| 직무·기술 | `[PARTIAL]` 기술 질문 팩+기술 루브릭 | 직무별 질문은 근거 연결 후 확장(P2) |
| 토론(사용자+AI 2+사회자) | `[PARTIAL]` **결정적 규칙 기반**(`discussion.js`, LLM 미사용), 4회 발언 기회, 부족 시 협업 차원 보류 | 핵심 흐름 밖. 실모델 연결은 P2 이후 |
| PT | `[PARTIAL]` 과제→준비→발표→Q&A 단계 강제 | 핵심 흐름 밖(P2) |
| 상황·역할극 | `[PARTIAL]` 고정 시나리오·검수된 고정 후속 문장 | 핵심 흐름 밖(P2) |
| 패널 | `[PARTIAL]` 역할 2~3명 순환 | 핵심 흐름 밖(P2) |
| 재연습(90초) | `[PARTIAL]` 1문항 세션+새 질문 템플릿(§7.2) | 같은 역량·다른 질문·같은 루브릭 비교(§2.7) |

## 3. UI/UX 정보 구조

기존의 '입력·설정·진행을 한 화면 양쪽에 동시에 표시'하는 UI는 새 목표 구조가 아니다. 다음 화면으로 전면 재설계한다.

| 화면 | 주요 요소 | 반드시 제거·축소할 것 |
|---|---|---|
| 대시보드 | 기업/대학 선택, 새 면접, 최근 연습 | 긴 마케팅 문구, 개발자용 API 상태 칩 |
| 지원 정보 | 기관·직무/학과·공고·서류 입력 | 불필요한 면접 유형 선택 |
| 근거 확인 | 공식 정보·지원서 주장·출처·확인/승인 | 검증 불명 자료를 공식 정보처럼 표현 |
| 면접 설정 | 시간·성향·입력 모드·간단 시작 | 과도한 설정, 예산 수치 노출 |
| 실전 면접실 | 현재 질문·타이머·녹음/답변·제출·일시정지 | 무의미한 파형·다중 패널·설명 문구 |
| 피드백 | 실제 답변 인용·관찰·개선 행동·재연습 | 과장 점수·합격률 |
| 재연습 비교 | 서로 다른 질문 2개, 동일 역량 비교 | 임의 생성된 성장 수치 |
| 기록·데이터 | 이전 기록·내보내기·삭제·처리 안내 | 관리자 설정 |
| 관리자 화면 | `[PARTIAL]` | `ADMIN_TOKEN` **필수**: 미설정이면 관리 기능·`/metrics`·`/diagnostics` 전체가 꺼짐(403 `admin_disabled`), 토큰은 `x-admin-token` 헤더로만 수신하고 상수시간 비교(`checkAdmin`), `tests/api/admin.test.mjs`, E2E. WP-D7 편집기·체크리스트·공개 중단 | 역할 모델·감사 기록·토큰 교체 절차 없음(단일 공유 비밀) |

한국어 우선, 모바일·PC 반응형, 키보드·스크린리더 접근성, 명확한 로딩/실패/권한 상태를 유지한다. 경쟁 서비스의 공개 UI 흐름은 참고만 하고 화면·상표·이미지·소스코드를 복제하지 않는다.

## 4. 시스템 아키텍처와 모델 전략

### 4.1 권장 모듈

- **Frontend:** 화면별 컴포넌트와 상태 관리. 기존 `public/` UI는 전면 교체 가능. 프레임워크 도입은 복잡성 대비 가치 검토.
- **Backend:** 플랫폼 중립 핸들러 코어(`src/app/`) + Node 어댑터(`src/node/server.js`) + Workers 어댑터(`src/worker/`, 미검증) + `Store` 계약(`src/store/`). 원장·세션 직렬화·`Idempotency-Key` 재생 포함.
- **Document:** PDF/DOCX/TXT 추출·교정·안전 검사·revision.
- **Research:** 공식 도메인 검증, 안전한 URL 검색/수집, 추출 근거 및 출처 저장.
- **Claims:** 지원서 주장의 분류·문장 위치 추적.
- **Questions:** 근거를 연결한 질문 설계·생성·검증.
- **Dialogue:** 면접 진행·꼬리질문·오류 시 폴백.
- **Evaluation:** 버전 관리된 루브릭·평가 근거 검증.
- **Transfer:** 새 질문 생성·기존 대비 비교.
- **Admin Trends:** 월간 역량 게시·검수.
- **Storage/Auth:** 기본 인메모리 Store, `STORE=file`이면 파일 영속(단일 프로세스 가정), Workers는 DO 스냅샷(미검증). 인증은 환경변수 접속 토큰(`DEV_TOKEN_A/B`)뿐이므로 **운영 서비스 전 실제 인증으로 교체 필수**.

### 4.2 LLM과 음성 공급자 — 현재 구현 vs 목표 설계

**목표 구성(2026-10-29 개발자 지시; 구현·결제 완료를 뜻하지 않음).** 모델 ID·엔드포인트·가격·무료 티어·지원 기능·데이터 약관은 아직 확인하지 않았으므로 확정값을 적지 않는다.

| 역할 | 목표 서비스 | 현재 저장소 상태 | 근거 |
|---|---|---|---|
| 실시간 AI 면접관·꼬리질문 | DeepSeek API | `[PARTIAL]` 어댑터·프롬프트·검증기 구현(WP-B2, 스텁 테스트만). `LLM_DIALOGUE_PROVIDER=deepseek`+키·BASE_URL·MODEL·`DEEPSEEK_LIVE_ACK` 모두 있어야 합성 데이터에 한해 호출. 요청 형태(OpenAI 호환 chat-completions)는 `[UNVERIFIED]`, 실호출 미실행 | `src/providers/adapters/deepseek.js`, `prompts/followup.js`, `tools/deepseek-smoke.mjs`(수동) |
| 면접관 음성(TTS) | ElevenLabs | `[PARTIAL]` 어댑터·프록시 구현(WP-B6, 스텁 테스트만). `TTS_PROVIDER=elevenlabs`+키·BASE_URL·MODEL·VOICE_ID·`ELEVENLABS_LIVE_ACK` 모두 있어야 합성 데이터에 한해 호출. 문장은 서버가 세션에서만 선택(요청 텍스트 무시). 요청 형태는 `[UNVERIFIED]`, 실호출 미실행 | `src/providers/adapters/elevenlabs.js`, `src/app/handlers/tts.js`, `tools/elevenlabs-smoke.mjs`(수동) |
| 이력서 분석·질문 설계·종합 평가 | Claude Sonnet API | `[PARTIAL]` 지원서 주장 추출 어댑터만(WP-B3, 스텁 테스트만, 요청 형태 `[UNVERIFIED]`, 실호출 미실행, 기본 라우팅 아님 `LLM_ANALYSIS_PROVIDER=claude`). 질문 설계=정적 팩+템플릿(AI 없음), 평가=규칙 기반(Gemini `evaluate`는 501, WP-B4 미착수 `[TODO]`) | `src/providers/adapters/claude.js`, `src/domain/claims.js`, `providers/adapters.js` |
| 지원자 음성 인식 | Groq Whisper | `[UNVERIFIED]` 어댑터·엔드포인트·브라우저 녹음 UI·스텁 계약 시험(WP-B5) 있음. 실키 호출·한국어 오류율은 미실행 | `createGroqWhisperAdapter`, `POST /sessions/:id/transcriptions`, `public/screens/room.js`, `tests/api/b5-stt.test.mjs`, `tools/stt-smoke.mjs`(수동) |
| 면접관 음성 합성(브라우저 폴백) | ElevenLabs | `[DONE]` 브라우저 `SpeechSynthesis` 폴백·질문 듣기 UI(`public/screens/room.js speak`). 서버 TTS는 위 ElevenLabs 행 | `public/screens/room.js` |
| 정적 프런트엔드 | GitHub Pages | `[PARTIAL]` WP-A4: `public/config.js` API_BASE·CORS 허용 목록(`CORS_ALLOW_ORIGINS`)·`.github/workflows/pages.yml`·비밀 스캔(`tools/check-bundle-secrets.mjs`)·`docs/deploy-pages.md` 구현. **실제 배포 미실행** `[UNVERIFIED]`(개발자가 Pages 활성화 필요). 기본은 같은 오리진 | `public/config.js`, `src/app/cors.js`, `.github/workflows/pages.yml` |
| API 키 보호·서버리스 프록시 | Cloudflare Workers | `[PARTIAL]` WP-A3: Workers 어댑터 `src/worker/index.js`·Durable Object 스냅샷 Store `do-session.js`·`wrangler.toml`·`docs/deploy-workers.md`. **Workers 런타임에서 실행·배포한 적 없음** `[UNVERIFIED]`(계약 테스트는 `fetch(Request)` 직접 호출, wrangler 미설치, compatibility_date 미기입). 현재 실사용 백엔드는 Node 어댑터 | `src/worker/*`, `tests/api/a3-worker.test.mjs`, `wrangler.toml` |

**현재 구현된 공급자:** Gemini(`gemini-3.5-flash-lite`, 대체 `gemini-3.6-flash`, 환경설정 기준; 실제 응답 가능 여부는 호출하지 않아 `[UNVERIFIED]`), Groq Whisper(`[UNVERIFIED]`), DeepSeek·Claude(주장 추출)·ElevenLabs 어댑터(스텁 시험만, `[UNVERIFIED]`), Mock, 브라우저 SpeechSynthesis. 앞의 `Groq GPT-OSS 120B 비교 후보`는 개발자의 목표 구성에서 제외되었으므로 **현재 목표가 아니다**(이력으로만 유지).

**마이그레이션 원칙(Gemini → 목표 구성).**
1. 어댑터 인터페이스(`extract / next / evaluate / transcribe`)를 operation별 공급자 라우팅(`config.registry`)으로 연결해 교체한다. `[DONE]`(WP-B1·B2·B3·B6): `config.registry`를 `providers/registry.js`가 읽어 operation(`dialogue.next`·`claims.extract`·`evaluation.generate`·`speech.transcribe`·`speech.synthesize`)별로 라우팅하고, 게이트(`providers/gate.js`)·호출 래퍼(`providers/call.js`)를 거친다. DeepSeek(꼬리질문)·Claude(주장 추출)·ElevenLabs(TTS) 어댑터가 있으나 **스텁 시험만**이며 실호출은 없다. Claude 평가(B4)는 `[TODO]`.
2. 신규 유료 공급자 도입은 개발자의 **명시적 설정·확인 플래그**로만 켜고, 장애·429 시 다른 유료 모델로 자동 승격하지 않는다(§5 #8).
3. 공급자별로 **개인정보 전송 전제 조건**을 먼저 확인한다: 약관상 학습·인간검토 여부, 데이터 보존, 국외 이전 고지, 연령 제한. 현재 DeepSeek·Claude·ElevenLabs 각각에 대해 `[UNVERIFIED]`이며, 확인 전까지 실제 지원자 문서는 전송하지 않고 합성 fixture만 사용한다.
4. 키는 Cloudflare Workers 비밀값(또는 서버 `.env`)에만 두고 Pages 번들에 넣지 않는다(번들 비밀 스캔 `tools/check-bundle-secrets.mjs`). Workers 이전용 코드(핸들러 코어·Workers 어댑터·DO Store)는 있으나 **Workers 런타임 미검증** `[UNVERIFIED]`이며, 영속 저장은 DO 스냅샷 방식으로 구현했으나(KV/D1 비교는 `[미확정]`) 실환경 한도는 확인하지 않았다.
5. 모델 선정은 실제 한국어 사례 블라인드 비교 후 확정한다(질문 품질·꼬리질문 적합성·응답 시간·비용·개인정보 적합성). 비교 결과는 아직 없다.

**기타:** 평가용 LLM(Claude Sonnet)은 사람 평가자와 비교·검증하기 전에는 "AI 정밀 평가"로 표기하지 않는다. **Mock**은 합성 데모·장애 대체용이며 실제 모델이라고 표기하지 않는다.

실제 키는 서버 `.env`에서만 읽는다(`.env.example`: `GEMINI_API_KEY`, `GROQ_WHISPER_KEY`/`GROQ_API_KEY`, `CLAUDE_*`, `DEEPSEEK_*`, `ELEVENLABS_*`, 공급자별 `<P>_LIVE_ACK`/`<P>_REAL_DATA_ACK`, 킬 스위치). 신규 공급자 키는 별도 이름으로 추가하고 `.env.example`에 같은 변경으로 반영한다. **키가 존재하는 것만으로 실제 자소서를 전송하지 않는다.**

### 4.3 핵심 데이터 구조

- `ApplicationProfile`: 사용자 ID, 기업/대학 구분, 직무·학과, 사용자 동의.
- `SourceDocument`: 문서 종류, 원본 해시, URL, 출처 상태, 추출 revision, 확인일.
- `EvidenceClaim`: 원문 인용, 코드포인트 span, 문서 ID, 지원자/기관/트렌드 구분, 검증 상태.
- `MonthlyTrend`: 연월, 분야, 최대 3개 역량, 코멘트, 출처, 승인자, 버전.
- `InterviewPlan`: 질문 배치, 대상 역량, 근거 참조, 모델·프롬프트·루브릭 버전.
- `Question`: 질문 유형, 대상 역량, 지원서·기관 근거 참조, 공급자/폴백 상태.
- `AnswerTurn`: 질문 ID, 발화자, 전사 확인 여부, revision, 확정 텍스트.
- `Evaluation`: rubric anchor, 발언 인용/span, 판단 보류 사유, 평가기 종류.
- `PracticeAttempt`/`TransferComparison`: 전후 서로 다른 질문 ID, 공통 역량, 비교 가능한 근거, 결과 제한.
- `AuditEvent`: 동의·권한·외부 호출·삭제 기록(비밀키·필요 없는 원문 제외).

모든 참조는 소유권 검증, 버전 정합, 원문 역추적을 통과해야 한다.

### 4.4 AI 호출 구조 (operation별, 현재 vs 목표)

| operation | 현재 호출 경로 | 목표 공급자 | 비고 |
|---|---|---|---|
| 자료 분석(`profile.extract`) | `createProfile` → 게이트 통과 시 Gemini `extract`(공고 키워드), 지원서 주장은 규칙 `extractApplicantClaims`, `LLM_ANALYSIS_PROVIDER=claude`일 때만 Claude(마스킹본·합성 한정) | Claude Sonnet | 서버가 모델 좌표를 믿지 않고 원문에서 span 재계산·검증(`mergeModelClaims`) |
| 질문 설계 | AI 호출 없음(정적 팩+기관 템플릿+지원서 주장 질문+트렌드 보조 질문, `planGeneralQuestions` 공유) | Claude Sonnet | 근거 ID·지원서에 없는 사실 금지 검증 필요 |
| 실시간 꼬리질문(`dialogue.next`) | 게이트 통과 시 Gemini `next` 또는 `LLM_DIALOGUE_PROVIDER=deepseek`일 때 DeepSeek(`validateFollowupOutput` 통과분만), 아니면 Mock 고정 문장, 실패·429는 정적 폴백으로 세션 계속 | DeepSeek | 질문당 1개·세션 3개 상한, 호출 14회/세션 상한 유지(`config.budgets`) |
| STT(`speech.transcribe`) | 브라우저 녹음 → `POST /sessions/:id/transcriptions` → Groq Whisper(서버 키, `GROQ_LIVE_ACK` 필요). Gemini `transcribeAudio`는 정의만 있고 라우트 없음 | Groq Whisper | 원음은 전사 후 폐기, 전사 확인·교정 후 제출 |
| 종합 평가(`evaluation.generate`) | Gemini `evaluateAnswers`(WP-E, 스텁 시험만·검증 전·참고용 `evaluator.kind=llm`; 서버가 인용 위치를 재계산하고 검증·금지어 통과분만 채택, 그 외·게이트 닫힘·장애는 규칙 기반 `buildMockEvaluation`/`buildTypedEvaluation`), Claude 평가 어댑터 없음(B4 `[TODO]`) | Claude Sonnet(검증 후) | 인용·span 검증 통과 출력만 채택 |
| 새 질문 생성 | 템플릿 선택+유사도 검사 | Claude Sonnet(선택) | 유사도·역량 일치 검사 유지 |
| TTS(`speech.synthesize`) | `POST /sessions/:id/tts`(세션 문장만) → `TTS_PROVIDER=elevenlabs`+전 조건 충족 시 ElevenLabs, 그 외 204+브라우저 `SpeechSynthesis` | ElevenLabs | 서버 프록시, 실패 시 브라우저 TTS 폴백(구현, 실호출 미실행) |

모든 외부 호출은 서버(현재 Node, 목표 Cloudflare Workers)에서만 수행하고, 키·실제 지원자 데이터·예산 상한·킬 스위치는 §5의 불변 조건을 따른다.

## 5. 보안·개인정보·안전의 불변 조건

1. **실제 지원서/지원자 답변을 무료 API로 자동 전송하지 않는다.** 무료·유료 데이터 사용 약관은 활성화 직전에 재검증하고, 사전 안내·적절한 동의·처리 기반을 갖춘 후 전송한다.
2. **미성년자 관련 제공사 조건을 우회하지 않는다.** 대입 사용자와 데이터 주체가 미성년자일 수 있음을 설계·테스트에 반영한다.
3. 사용자가 `synthetic=true`, `free_test=true`를 보냈다는 이유로 **실제 사용자 문서를 합성 데이터로 취급하지 않는다.** 합성 데모는 서버에서 제공하는 가상 fixture만 사용한다.
4. API 키는 `.env`의 서버 전용 비밀값이다. 번들, 로그, 오류 화면, 저장소 및 내보내기에 포함하지 않는다.
5. 웹 수집은 SSRF, private IP, localhost, DNS rebinding, URL 리디렉션, 비허용 도메인, 파일 다운로드 크기, 타임아웃, 약관·robots 제한을 검사한다.
6. 사용자 서류·웹 페이지·모델 출력은 모두 **신뢰할 수 없는 데이터**로 처리한다. 문서의 프롬프트 인젝션이 시스템 지시가 될 수 없다.
7. 기존 개인정보 마스킹은 불완전하다. **이유·이번·이해·21세기**와 실제 학교·이름에 대한 오탐/누락 검증을 거친다. 완전 익명화를 보장하지 않는다.
8. 공급자 429·타임아웃·장애에 유료 자동 승격을 금지하고, 킬 스위치와 예산·턴·시간 제한을 강제한다.
9. 전사 오류 시 수정·확정 과정을 제공한다. 오디오를 이용자 의사와 무관하게 전송하거나 장기 저장하지 않는다.
10. 보관 기간, 열람/내보내기, 세션·계정 삭제 등 실제 동작과 UI 설명을 일치시킨다. 인메모리 상태에서는 재시작 후 기록 보존을 보장하지 않는다.
11. 인용 문자열이 일치하더라도 논리적 평가가 맞는지 별도 검증한다. 개인정보·불리한 고정관념·차별적 평가를 지양한다.
12. 합격 예측·채용 결정·성격/거짓말 진단을 하지 않는다.

### 5.1 불변 조건의 현재 이행 상태 (2026-10-29)

| # | 조건 | 상태 | 근거 |
|---|---|---|---|
| 1 | 실제 지원서의 무료 API 자동 전송 금지 | `[DONE]` 위조 플래그로 외부 호출 0건(스텁 시험). 실호출 경로는 `[UNVERIFIED]` | P0-1, `tests/api/provider-gate.test.mjs`·`b1-gate.test.mjs` |
| 2 | 미성년자 제공사 조건 우회 금지 | `[PARTIAL]` 고교 유형 Mock 강제(`tests/api/interview-types.test.mjs`). 연령 확인 절차 없음 | §7.2 |
| 3 | 클라이언트 `synthetic` 불신 | `[DONE]` `isServerSynthetic` 제거, 공급자는 서버 상태로만 결정 | P0-1 |
| 4 | API 키 서버 전용 | `[DONE]` 번들·추적 파일에 키 없음(코드 검토). `/health` 설정 노출은 BUG-4 수정됨 | §10 |
| 5 | 웹 수집 SSRF 방어 | `[PARTIAL]` WP-C2 수집기(`fetcher.js`): 허용 도메인(기본 꺼짐)·DNS 해석 후 사설 IP 재검사·수동 리디렉션 재검사·크기/시간/robots 제한을 **주입 fetch/dns 스텁으로만** 시험. 실제 네트워크 수집 미실행 `[UNVERIFIED]`, 해석→연결 사이 rebinding 틈은 DEBT-9로 남음 | `tests/api/c2-fetcher.test.mjs`, DEBT-9 |
| 6 | 문서·모델 출력 비신뢰, 프롬프트 인젝션 방어 | `[PARTIAL]` 평가가 결정적이라 인젝션 영향 없음. LLM 경로는 비신뢰 데이터 블록·구분자 위조 방지·출력 검증기(`validateFollowupOutput`, `mergeModelClaims` 원문 일치)가 있으나 **스텁 시험뿐**, 실모델 대상 인젝션 시험 미실행 `[UNVERIFIED]` | `prompts/*`, `tests/eval/golden.test.mjs` |
| 7 | PII 마스킹 오탐/누락 검증 | `[PARTIAL]` 오탐 회귀 + C5 코퍼스(오탐 66·정탐 36). 이름·학교·주소 휴리스틱 탐지, 누락 가능 | DEBT-7 |
| 8 | 429·장애 시 유료 자동 승격 금지, 예산·킬 스위치 | `[PARTIAL]` 무료 허용 목록·킬 스위치·세션/월 상한(`tests/api/gates.test.mjs`). 429·타임아웃·잘못된 출력은 정적 폴백으로 **세션을 계속**하고 원장 예약 정산(`b1-call`). 공급자별 월 상한은 DeepSeek·ElevenLabs만 집행(호출 수·USD, **인메모리**, 재시작 시 0), Claude는 `[TODO]` 미집행. 원장은 `STORE=file`이면 월 경계 포함 영속(A2) | BUG-8 수정 |
| 9 | 음성 의사 없는 전송·장기 저장 금지 | `[PARTIAL]` 원음 전사 후 폐기 코드. 실동작 미검증 | `[UNVERIFIED]` |
| 10 | 보관·내보내기·삭제와 UI 설명 일치 | `[PARTIAL]` 세션·계정 삭제가 전이 작업·내보내기 캐시·재작성 연습·이의 제기를 파기(P0-2 수정, `tests/api/lifecycle.test.mjs`). 인메모리 한정이며 백업·영속 저장소의 삭제 보장은 해당 없음/`[TODO]` | BUG-2 수정, DEBT-1 |
| 11 | 인용 일치≠타당성 별도 검증 | `[TODO]` 의미 검수 시험 없음 | §6.2 |
| 12 | 합격 예측·성격/거짓말 진단 금지 | `[DONE]` UI 문구 가드(E2E "합격 예측 문구 없음"), `checkFeedbackSafety` | `evaluation.js` |

## 6. 구현 단계 및 완료 기준

| 단계 | 구현 우선순위 | 완료 조건 |
|---|---|---|
| **P0: 제품 기준/안전** | 본 문서, 에이전트 규칙, 실제·Mock 표시, PII 버그, 연령/키 게이트 | 문서 자동검사 + 보안 회귀 테스트 통과 |
| **P1: 핵심 UI/서류** | 기업·대학 전용 UI, 공고·자소서 PDF/DOCX/TXT, 교정/출처 표시 | 2경로 브라우저 E2E 및 추출 실패 테스트 |
| **P2: 공식 자료/트렌드** | 실제 공식 홈페이지 탐색·근거 확인, 관리자 검수 월간 3역량 | SSRF·출처 검증·미발견 폴백 검증 |
| **P3: 질문·면접** | 근거 연결 질문, 답변 기반 꼬리질문, 모델 A/B, STT | 정적/실 모델 모드 구분, 품질 사례 검수, 녹음 오류 테스트 |
| **P4: 핵심 차별화** | 주장 검증, 약점 집중 코칭, **새 질문에서 전후 비교** | 별개 답변 2개와 같은 루브릭·발언 근거 비교 |
| **P5: 데모 출시** | 반응형 UI, 기록·삭제, 개인정보 설명, 문서 갱신 | 실제 브라우저 데모 통과, 미구현/제약 명시 |

각 단계에서 완전한 세로 단면(end-to-end vertical slice)을 먼저 작동시킨다. 멋진 아바타, 과도한 인터뷰 유형, 외형만 있는 기능, 불필요한 복잡한 아키텍처에 우선순위를 빼앗기지 않는다.

### 6.1 반드시 자동으로 테스트할 항목

- 기업/대학 사용자 경로 구분, 다른 인터뷰 유형 기본 화면에서 제외.
- PDF/DOCX/TXT의 유효/손상/미지원 입력과 추출 실패 처리.
- 공식 URL 기록과 **실제 수집·검증** 상태 분리, 근거 없는 기업 사실 거부.
- 웹 SSRF 및 문서·답변 프롬프트 인젝션 처리.
- 월간 분야별 3개 제한, 관리자 승인 필수, 구버전 보존.
- 질문 근거 ID·정확한 발췌 및 지원자의 허구 경험 생성 차단.
- 꼬리질문의 직전 확정 답변 연관성, 호출 한도·429 폴백.
- PII 정상 문장 보존 및 이름·학교·전화·이메일 등 차단 검증.
- 실제 문서의 합성 플래그 위장 공격, 미성년자 차단, API 키 로그 노출 방지.
- 음성 권한 오류, 전사 실패·교정, 텍스트 폴백.
- 평가 발언 인용/span 정합, 근거 부족 시 판단 보류.
- “저는 이유 결과” 등 키워드 조합으로 부당하게 최고 등급을 받지 않는지 검증.
- 새 질문 재연습이 실제 다른 질문인지, 같은 역량·루브릭인지, 두 시도를 독립 보관하는지 검증.
- 기록 내보내기·삭제·소유권 격리·기존 세션 상태/비용 테스트.
- 모바일 레이아웃, 화면 전환, 키보드, 비활성 버튼·오류 메시지 브라우저 확인.

### 6.2 사람 평가가 필요한 실험(아직 실측 결과 아님)

- 지원서/기관 자료 20건 이상에 대해 질문이 실제 근거에 연결됐는지 블라인드 검수.
- 답변 20건 이상을 사람 평가자 2명 이상이 독립 채점하고 시스템과 일치도 비교.
- 키워드 주입·프롬프트 인젝션·개인정보 우회 각종 공격을 반복 시험하고 성공/총 시도 수 기록.
- 누락된 역할·논거·결과에 대한 꼬리질문의 관련성 평가.
- 같은 역량의 **다른 질문에서** 두 번째 답변이 나아졌는지 사람 평가자가 블라인드 비교.
- 한국어 STT 오류율(CER/WER), 평균·상위 지연, 오류 복구 측정.

시험 표본 수·평가 방법·실제 결과가 없는 한 “품질 입증”이나 “향상 증명”이라고 표시하지 않는다. 가정 목표와 관찰값은 분리한다.

### 6.3 동작 데모의 완료 조건

가상 지원자 샘플 데이터만으로 다음 전체 과정이 실제 UI에서 끝까지 수행되어야 한다.

1. 기업 또는 대학 선택 → 공고와 합성 지원서 입력.
2. 실제 추출 결과·공식/사용자 근거/트렌드 구분 확인.
3. 근거에 연결된 질문·직전 답변 관련 꼬리질문 진행.
4. 텍스트 및 구성된 경우 음성(STT, 교정)으로 답변.
5. 규칙/LLM 평가 여부가 명시된 근거 기반 보고서 확인.
6. 동일 역량의 **새 질문**에 답변하고 이전 답변과 비교.
7. 기록을 조회·내보내고 삭제.

데모는 실제 키 연결 시에도 개인정보 보호 게이트를 통과한 승인된 데이터만 전송한다. 키가 없으면 Mock 사용 사실을 숨기지 않는다. 테스트를 실행하지 못한 경우에는 “미실행”으로 보고한다.

## 7. 저장소의 실제 구현 상태 (2026-10-29 전수 점검 + WP-E4 정합 기준)

### 7.0 점검 방법과 범위

- **기준 커밋:** 최초 점검은 `79e803c`(main). WP-E4 정합은 `fix/p0-1-provider-gate` 브랜치 `aa6d0cc`(WP-A0~A4, B1~B3, B5~B7, C1~C8, D1~D7, D9, E1 병합 후)에서 수행했다. 코드·설정·테스트·Git 이력을 직접 읽고 `npm test`·`npm run check:project`·`npm run e2e`·`node tools/e2e-institution.mjs`·`node tools/verify-design.mjs`를 새로 실행해 §10을 갱신했다. 외부 API 호출은 하지 않았다.
- **코드와 실제 동작이 우선**이다. 아래 표의 상태는 코드 경로·자동 테스트가 있는 것만 올렸고, 스텁 `fetch`·가짜 키 시험은 "스텁 시험만"으로 명시한다.
- **확인하지 않은 것:** 실키 호출(Gemini·Groq·DeepSeek·Claude·ElevenLabs), 실제 한국어 PDF/DOCX, 실기기 마이크·TTS, Safari/Firefox, 모바일 실기기, Pages·Workers 실배포, Workers 런타임 동작(§10).
- **미착수 WP:** B4(Claude 평가), E2의 실험 수행(양식·프로토콜만 B7에서 준비). D8(자동 접근성·반응형·카피 QA, `c400e20`)과 E3(API 수준 데모 리허설, `2fdad8e`)는 **부분 완료**(수동·실기기 점검은 미실행) — §12.

### 7.1 현재 시스템 구조

| 계층 | 현재 구현 | 근거 |
|---|---|---|
| 런타임 | Node.js ≥20, **외부 의존성 0**(`package.json`에 dependencies 없음), 타입스크립트·린터·번들러 없음 | `package.json` |
| 프런트엔드 | 순수 HTML/CSS/JS 단일 페이지, 해시 라우터 9화면(`#/dashboard`…`#/admin`). `public/app.js` 엔트리 + `public/core/*.js`(api·router·state·copy·dialog·providers 등)·`public/screens/*.js`(9화면) 네이티브 ES 모듈, `public/ui/index.js` 컴포넌트 헬퍼, `core/copy.js` 고정 문구/금지 표현 린트. WP-U(docs/plan/09): 진입점 고입·대입만(기업·공공은 UI 미노출, 서버 레거시), 학교 분석 섹션·연령 2택 동의·녹음 전사 기본(가능 시)·평가기 칩 llm/rule_based. API 기본 주소는 `public/config.js`의 `API_BASE`(빈 값=같은 오리진 `/api/v1`) | `public/`, `tests/domain/ui-copy.test.mjs` |
| 백엔드 | 플랫폼 중립 코어 `(Request, env, ctx)=>Response`(`src/app/router.js` + `handlers/*`, Web 표준 API·Web Crypto만) + Node `http` 어댑터(`src/node/server.js`: 변환·정적 서빙·CSP·.env 로딩·CORS). `src/server.js`는 호환 재수출. 쓰기 `Idempotency-Key` 24h 재생·세션별 쓰기 직렬화(WP-A1). Workers 어댑터 `src/worker/index.js`·`do-session.js`·`wrangler.toml`(WP-A3, **런타임 미검증** `[UNVERIFIED]`). `documents.js`는 `DecompressionStream` 기반 async | `src/app/*`, `src/node/server.js`, `src/worker/*` |
| 저장소 | 기본 **인메모리 `Store`**(`src/store/index.js` 계약, `memory.js`). `STORE=file`(`DATA_DIR`, 기본 `data/store`)이면 파일 영속 `file.js`(원자적 쓰기·만료 정리·삭제 즉시 반영·원장 월 경계, **단일 프로세스 가정**, 동의·문서 포함). Workers DO 스냅샷 Store(`do-session.js`, 미검증). 월간 트렌드는 별도 파일(`TRENDS_FILE`, 기본 `data/trends.json`, git 제외) | `src/store/*`, `src/domain/trends.js`, `tests/api/a2-file-store.test.mjs` |
| 공급자 | Mock(기본) · Gemini(게이트 통과 시 꼬리질문·공고 추출) · Groq Whisper(STT) · DeepSeek(꼬리질문, `LLM_DIALOGUE_PROVIDER=deepseek`) · Claude(지원서 주장 추출, `LLM_ANALYSIS_PROVIDER=claude`) · ElevenLabs(TTS, `TTS_PROVIDER=elevenlabs`) · 브라우저 SpeechSynthesis. 신규 3종은 **스텁 시험만**, 요청 형태 `[UNVERIFIED]`. 라우팅·게이트·호출 래퍼: `providers/{registry,gate,call,validate}.js` | `src/providers/*` |
| 공식 자료 수집 | `src/domain/fetcher.js`(허용 도메인 기본 비어 있음=꺼짐, DNS 재검사, 수동 리디렉션, robots, 발췌). 실제 네트워크 수집 미실행 | `docs/official-fetch.md`, `tests/api/c2-fetcher.test.mjs` |
| 배포 | **실배포 없음.** `.github/workflows/pages.yml`(Pages 배포 워크플로, 개발자 실행)·`project-guard.yml`(`check:project`+`npm test`), CORS 허용 목록(`CORS_ALLOW_ORIGINS`), `wrangler.toml`. 배포 가이드 `docs/deploy-pages.md`·`docs/deploy-workers.md` | `.github/workflows/`, `tools/check-bundle-secrets.mjs` |
| 환경변수 | `.env.example` 기준: `DEV_TOKEN_A/B`, `ADMIN_TOKEN`, `STORE`·`DATA_DIR`, `TRENDS_FILE`, `CORS_ALLOW_ORIGINS`, `GEMINI_*`, `GROQ_*`, `CLAUDE_*`, `DEEPSEEK_*`, `ELEVENLABS_*`·`TTS_PROVIDER`, 공급자별 `<P>_LIVE_ACK`/`<P>_REAL_DATA_ACK`, `ROUTE_<OP>`, 속도 제한(`*_RATE_PER_*`), `OFFICIAL_FETCH_*`, `DEMO_FIXTURES`, 예산·킬 스위치. 신규 공급자는 모델·URL 기본값이 없다 | `.env.example`, `src/config.js` |
| 로컬 `.env` 상태 | 최초 점검(`79e803c`) 시점: Gemini·Groq 키 **존재**(값은 기록하지 않음), `GEMINI_ALLOW_UNPAID=true`, `GEMINI_PAID_ACK=false`, `ADMIN_TOKEN` 없음. `.env`는 `.gitignore` 대상이며 Git 이력에 커밋된 적 없고 추적 파일에서 키 패턴도 발견되지 않음. WP-E4에서는 로컬 `.env`를 다시 확인하지 않았고, 테스트 서버는 키를 비워 Mock으로만 동작한다 | `git log -- .env` 빈 결과, `git grep` |


### 7.2 기능별 구현 상태

Mock 경로 한정 확인이면 "(Mock)", 스텁 `fetch`·가짜 키로만 시험했으면 "스텁 시험만"이라고 적는다. "근거"는 파일·함수 또는 테스트 파일이다(줄 번호·옛 `tests/run.mjs` 번호는 WP-A0 분리 후 무효라 쓰지 않는다).

| 기능 | 상태 | 근거 | 미완성·차이 |
|---|---|---|---|
| 기업·대학 선택 UI | `[DONE]` | `public/screens/dashboard.js startJourney`, `tools/check-project.mjs`가 `public|highschool` 여정 금지 검사, `tools/e2e-ui.mjs` | 서버는 `public/highschool/general` org_type도 계속 허용(`institution.js ORG_TYPES`). 고교는 Mock 강제 |
| 직무·학과 입력 | `[DONE]` | `public/screens/application.js`(WP-D3 재설계) | 전형(대학) 별도 필드 없음 |
| 공고·모집요강 붙여넣기 | `[DONE]`(Mock) | `source_text`(최대 20,000자) → `createProfile` | — |
| 이력서·자소서 입력 | `[PARTIAL]` | `application_text`(최대 20,000자, 마스킹본만 저장·분석, 계정 삭제 시 파기) — `src/app/handlers/profiles.js`, `tests/api/claims.test.mjs`. WP-C1: `POST /profiles/:id/documents`(kind posting/cover_letter/resume/other)·`PATCH /documents/:id`·`GET /documents/:id/revisions`로 문서 종류 구분과 revision 분리(extracted → user_edit, 마스킹본, 원본 바이너리 비저장·sha256만), 계정 삭제 시 파기(`tests/api/c1-documents.test.mjs`). WP-C7: 승인·claims·plan 시 문서 최신 revision(마스킹본)에서 문서별 주장을 추출해 신청 본문 주장과 합치고 panel·technical 세션에도 주장 질문 적용(규칙 정확도 코퍼스 `docs/claims-accuracy.md`, 합성 49문장 P1.00/R0.957은 소규모 한계). WP-D3: 지원 정보 화면에 문서 카드·종류·미리보기·수정·합성 샘플·동의 대화상자 연결 | 실제 한국어 서류 대상 정확도 미측정 `[UNVERIFIED]`. 별도 이력서 전용 파서 없음(텍스트로 취급) |
| 문서 업로드·추출(PDF/DOCX/TXT) | `[PARTIAL]` | `src/domain/documents.js`(WP-A3 이후 `DecompressionStream` 기반 async), `POST /documents/extract`, `public/screens/application.js`, `tests/domain/documents-extract.test.mjs`, `tests/api/documents.test.mjs` | 직접 만든 최소 파서. 합성 샘플(프로그램 생성 DOCX/텍스트 PDF/CID PDF/스캔형 PDF)만 검증. CID/Type0(Identity-H) 글꼴 PDF는 ToUnicode 파싱을 하지 않고 `unsupported_font_encoding`으로 명시 실패(쓰레기 텍스트 금지) — 실제 한국어 PDF 성공률은 `[UNVERIFIED]`. 업로드 경로만 본문 한도 7.5MB로 상향해 5MB 파일 허용(BUG-9 수정, 그 외 경로 1MB). Workers 런타임에서의 추출은 미검증 |
| 추출 텍스트 확인·수정 | `[DONE]` | 추출 텍스트가 문서 카드에 채워지고 `PATCH /documents/:id`로 `user_edit` revision 저장, 원본 해시·추출·수정 revision 분리(C1·D3) | 원본 바이너리는 저장하지 않으므로 원본 재다운로드 불가(의도) |
| **지원서 주장·공백 추출** | `[PARTIAL]` | `src/domain/claims.js extractApplicantClaims`: 자소서를 문장 단위로 나눠 경험·성과 서술 문장을 **원문 코드포인트 span과 함께** 추출하고(`verifyClaimSpan` 재검증) 문장에 없는 정보(역할·결과·판단 기준·수치)를 `gaps`로 표시. 규칙 기반이라 외부 전송 없음. `tests/api/claims.test.mjs`, `tests/domain/c7-claims-corpus.test.mjs`, E2E "지원서 주장 원문 인용 표시". WP-B3 Claude 어댑터(마스킹본만 전송·원문 일치 인용만 채택·규칙 결과 하한선 병합)는 `LLM_ANALYSIS_PROVIDER=claude`일 때만, **스텁 시험만** | **의미 이해가 아닌 정규식 표지 기반**: 표현이 다르면 놓치거나(미탐) 소개 문장을 잘못 주장으로 볼 수 있음(오탐). 한국어 자소서 실사례 정확도 미측정 `[UNVERIFIED]`. Claude 실호출 미실행. 주장 제외 토글(`PATCH /profiles/:id/claims/:claimId`)은 승인 시 동결, 변경 시 재승인(C8·D4) |
| 기관 프로필(핵심가치·평가가능/불가·권장질문) | `[DONE]`(규칙 기반) | `institution.js buildInstitutionProfile`, `tests/api/institution.test.mjs`, `tools/e2e-institution.mjs` 14 PASS | 키워드 16개 매칭 기반. 사용자 확인·수정·승인 흐름은 있음(`approveProfile`) |
| 공식 홈페이지·공고 **실제 수집** | `[PARTIAL]`(2026-10-29 WP-C2, 주입 fetch/dns 시험만) | `src/domain/fetcher.js`, `POST /profiles/:id/sources/:sid/fetch`, `tests/api/c2-fetcher.test.mjs` 14건, `docs/official-fetch.md`. 허용 도메인 `OFFICIAL_FETCH_ALLOW`(기본 비어 있음=수집 꺼짐) | **실제 네트워크 수집은 실행하지 않음 `[UNVERIFIED]`.** fetch가 연결 시 DNS를 재해석하므로 해석→연결 사이 rebinding 틈이 남음(허용 도메인 목록·매 홉 재검사로 완화). 상태는 규칙 기반 키워드 발췌이며 AI 검증이 아님 |
| 출처 검증(SSRF·공식 여부·신선도) | `[PARTIAL]` | `validateSourceUrl`, `freshnessOf`, `detectConflicts`, `tests/api/institution.test.mjs` | `validateSourceUrl`은 문자열 검사, 수집 시점에는 `fetcher.js`가 DNS 해석 후 사설·루프백·링크로컬·메타데이터·ULA·IPv4-mapped IP를 연결 전에 재검사(리디렉션 매 홉). `official_verified`는 수집 성공+허용 도메인+발췌 존재일 때만. `official` 판정은 제목·URL 문자열 추정(`inferKind`) |
| 월간 핵심 역량(관리자 초안→공개→롤백) | `[PARTIAL]` | `trends.js`, `/admin/trends*`, `tests/api/trends.test.mjs`·`c3-trends.test.mjs`, E2E [9]. WP-D7: 관리자 편집기·검토 체크리스트·공개 중단·미리보기 | 자동 수집·AI 후보 추출·편향 검수 없음. 항목별 출처≥1·코멘트·역량 필수(WP-C3, 422), 공개 중단(`unpublish`)·목록·`approved_by`, 규칙 위반 레거시 공개본은 노출 차단+보고. 공개 트렌드는 해당 월·분야 일반 면접 질문 끝에 보조 질문 1개로 반영(`월간 트렌드(보조)`, 기관 공식 요구 아님). 평가 연결은 `[TODO]` |
| 맞춤 질문 생성 | `[PARTIAL]` | `planGeneralQuestions`(`src/domain/plan.js`)를 세션 생성과 `GET /profiles/:id/plan`이 공유(WP-C8): **지원서 주장 검증 질문 최대 2개를 앞에 배치**(`buildClaimQuestions`; 고정 템플릿+자소서 문장 원문 인용, `application_evidence_ids`·`source_status`·`prompt_version(claim-probe-v1)`, 새 수치·사실 추가 불가), 나머지는 정적 8문항 팩+기관 권장질문 최대 2개+월간 트렌드 보조 1개. WP-C7: panel·technical 세션에도 주장 질문 적용 | 공식 요구(`institution_evidence_ids`) 연결은 `[PARTIAL]`. 질문 문장 품질은 템플릿 수준이며 사람 평가 없음 |
| 꼬리질문 |  `[PARTIAL]` | `followupReasonFor`(정규식) → Mock 고정 문장 / Gemini는 직전 답변·최근 4턴 전달(`adapters.js next`) / DeepSeek(`LLM_DIALOGUE_PROVIDER=deepseek`, WP-B2)는 `validateFollowupOutput`(질문 1개·≤240자·새 숫자 금지·어휘 중첩) 통과분만 채택, `tests/api/b2-deepseek.test.mjs`(스텁) | 질문당 1개·세션 3개 상한. 외부 모델 경로는 게이트 통과 시에만. DeepSeek 요청 형태·모델 ID `[UNVERIFIED]`, 실호출·실모델 품질 평가 없음 |
| 면접 유형 | `[PARTIAL]` | general/technical/discussion/pt/situational/panel 서버 구현, `tests/api/interview-types.test.mjs` | 설정 화면은 기본 `일반·인성`, 나머지는 `고급(실험)` 접힘(WP-D5, DEBT-8 해소). 일반·압박(`challenging`)·블라인드는 구현. 유형별 설계는 §2.8 |
| 실시간 면접 대화·세션 관리 | `[PARTIAL]` | REST 명령(`session.start/pause/resume/finish`, `turn.text`), 서버 시계 시간 상한, 낙관적 버전 잠금, `command_id` 재생, 세션별 쓰기 직렬화, `tests/api/sessions.test.mjs`·`a1-*.test.mjs`. 새로고침 후 면접실 복원(WP-D9·D5, E2E) | 실시간 스트리밍·WebSocket 없음(`/ws`는 티켓 스텁). 기본 memory 저장소는 재시작 시 세션 소실(`STORE=file`이면 유지) |
| TTS | `[PARTIAL]` | 브라우저 `SpeechSynthesis`(`public/screens/room.js speak`): "질문 듣기"+정지 버튼, 자동 낭독은 설정 토글 시에만. `/providers/status`의 `speech.synthesize`가 live일 때만 `POST /sessions/:id/tts`를 시도하고 실패 시 브라우저 TTS로 조용히 대체(WP-D5; 서버 TTS는 WP-B6 이후 `POST /sessions/:id/tts`가 오디오 또는 204+`X-TTS-Fallback: browser`로 응답) | ElevenLabs `[PARTIAL]` 어댑터·프록시 구현(WP-B6, 스텁 테스트만, 요청 형태 `[UNVERIFIED]`, 실호출 미실행). 브라우저·OS별 한국어 음성 편차 미확인 |
| STT(Groq Whisper) | `[UNVERIFIED]` | `createGroqWhisperAdapter`, `POST /sessions/:id/transcriptions`, 브라우저 `MediaRecorder` UI(`public/screens/room.js`), 키 없음/비오디오 경로 `tests/api/stt-flags.test.mjs`, 스텁 fetch 계약 시험 `tests/api/b5-stt.test.mjs`(WP-B5: multipart·허용 형식·크기 상한·429→텍스트 안내·타임아웃·빈 결과·`pii_warnings`·원음 비저장·키 비노출) | 실키 호출 미실행(`tools/stt-smoke.mjs`·`docs/stt-smoke.md`는 수동·미실행). 계약 시험은 Groq 실동작을 증명하지 않는다. 전사 확인·교정 UI와 음성 상태 머신(D5)은 존재하나 실기기 미확인. 한국어 오류율·지연 측정 없음. `GROQ_LIVE_ACK` 없으면 차단 |
| 답변 분석·평가 | `[DONE]`(규칙 기반) | `mock-eval*.js`, 인용·span 검증(`evaluation.js`), `tests/api/sessions.test.mjs`, `tests/domain/pii-eval-transfer-trends.test.mjs`, 골든 불변식 `tests/eval/golden.test.mjs`(WP-B7, 합성 30건) | 의미 기반 평가 아님. UI는 "규칙 기반 참고 관찰" 고지(E2E 확인). 보고서에 `evaluator:{kind:'rule_based',provider:'mock',…}`를 표기하고 `badge` 필드 제거(BUG-6 수정, WP-B1). 사람 평가자 비교는 미실행 |
| 근거 인용·판단 보류 | `[DONE]` | `validateEvaluation`, `insufficient_evidence`, `tests/api/sessions.test.mjs`, `tests/eval/invariants.mjs` | 의미 타당성 검증 없음 |
| 약점 집중 코칭·재연습 | `[PARTIAL]` | `POST /practice-attempts`, `generateTransferQuestion`, UI `public/screens/repractice.js`·`feedback.js`(WP-D6) | 새 질문은 루브릭 5종 전 차원(15개) × **고정 템플릿 3개**에서 선택(`transfer.js TRANSFER_BANK`). 알 수 없는 역량은 422(대체 없음). 90초·1문항 세션 |
| 새 질문 전후 비교 | `[PARTIAL]` | `compareTransfer`, `POST /transfer-comparisons`, UI `public/screens/repractice.js`, `tests/api/transfer.test.mjs`, `tests/domain/c4-transfer-bank.test.mjs` | 같은 루브릭·다른 질문·유사도(바이그램 Jaccard 0.55)·판단 보류는 구현. 비교 수준은 키워드 규칙 점수의 차이(DEBT-10). 전이 작업은 세션·계정 삭제 시 파기(P0-2 수정, `STORE=file`이면 파일에도 반영) |
| 답변 수정 이력 | `[DONE]` | `addRevision`(stt_correction은 새 revision, content_rewrite는 새 연습), `tests/api/sessions.test.mjs` | — |
| 결과 저장·기록 | `[PARTIAL]` | `GET /sessions`, `GET /history`, UI `public/screens/history.js`(WP-D7), `tests/api/lifecycle.test.mjs` | `STORE=file`이면 재시작 후 유지(WP-A2, `tests/api/a2-file-store.test.mjs`). 기본 memory는 재시작 시 소실. 사용자별 장기 추이 저장 없음 |
| 내보내기·삭제 | `[DONE]`(Mock·단일 프로세스 한정) | `POST /exports`(JSON, 10분), `DELETE /sessions/:id`, `DELETE /account`, `tests/api/lifecycle.test.mjs`, `a2-file-store.test.mjs`(삭제 후 파일에서 본문 제거) | 삭제 시 `transferJobs`·`exports`·재작성 연습·이의 제기·멱등 저장본 파기(`purgeOwnedCaches`). 내보내기는 JSON 10분 캐시뿐(메모리), 외부 백업·다중 프로세스·Workers DO에서의 삭제 보장은 미검증 |
| 개인정보 처리 | `[PARTIAL]` | `detectPii`(이메일·전화·주민번호 + 휴리스틱 이름·학교·주소·학번/사번), `maskPii`, 블라인드 마스킹, `tests/domain/c5-pii-corpus.test.mjs`(오탐 66·정탐 36) | **이름·학교·주소 탐지는 표지어·접미어 기반 휴리스틱이라 누락·오탐이 있으며 완전 익명화가 아님.** 블라인드도 휴리스틱(UI도 "완전하지 않을 수 있음" 고지). D7 데이터 처리 패널은 실제 보관·삭제 동작에 맞춘 문구 |
| 연령·미성년자 보호 | `[PARTIAL]` | 서버: `highschool` Mock 강제(`tests/api/interview-types.test.mjs`), 동의 API의 만 19세 확인(`POST /consents`, WP-C6)·동의 없으면 프로필 428, 공급자 게이트가 `consent`·`age19` 없으면 실데이터 전송 차단(`consent_missing`). UI: 지원 정보 화면 연령·처리 안내 대화상자(WP-D3) | **자기 신고(확인 체크) 방식**이며 신원·연령 검증 절차 없음. 고교 경로가 UI에는 없음. 법적 검토 미실시 |
| 오류 복구 | `[PARTIAL]` | 공급자 실패·429→정적 꼬리질문 폴백+`degraded_reason`+`provider_trace`(WP-B1, **세션 계속**, 원장 예약 정산, `tests/api/b1-call.test.mjs`), STT 실패→텍스트 안내, TTS 실패→204+브라우저 폴백, 평가 실패 상태, 보고서 폴링, 새로고침 후 면접실·코칭 복원(E2E) | 클라이언트 자동 재시도 없음. 재연습·토론 로그는 새로고침 복원에서 제외 |
| API 사용량·예산 | `[PARTIAL]` | `ledger.js`(예약→정산), 세션 $0.08·월 $30 상한, 프로필 분당2/일10 제한, 킬 스위치, `tests/api/gates.test.mjs`. 문서 추출·STT·턴·TTS·수집에 사용자별 속도 제한(`*_RATE_PER_*`, `Store.recordRate`). 원장 월 경계 리셋·`STORE=file` 영속(WP-A2). 공급자별 월 상한(`DEEPSEEK_*`/`ELEVENLABS_*` `_MONTHLY_CAP_USD`·`_MONTHLY_CALL_CAP`)을 호출 래퍼가 집행 | **공급자별 월 상한은 인메모리라 재시작 시 0**이며 Claude(`CLAUDE_MONTHLY_CAP_USD`)는 미집행. 단가표는 Gemini 전용, 신규 공급자 단가가 비면 0 정산 → 호출 수 상한만 방어. 속도 제한도 인메모리 |
| 인증 | `[PARTIAL]` | 환경변수로 명시한 접속 토큰 2개(`DEV_TOKEN_A/B`)만 유효 — **내장 기본 토큰 제거**(`config.js`), 브라우저도 내장 토큰 없이 첫 401에서 접속 토큰을 물어 저장(`public/core/api.js promptToken`, E2E [10b]). 소유권 검사·교차 사용자 격리 `tests/api/profiles-auth.test.mjs`, `admin.test.mjs` | **실제 로그인·세션·계정 없음**(토큰은 운영자가 나눠 주는 공유 비밀, `localStorage` 저장). 예시 토큰(`dev-user-*-token`) 사용 시 서버 시작 경고만 출력. 공개 서비스 불가(DEBT-2) |
| 관리자 화면 | `[PARTIAL]` | `ADMIN_TOKEN` **필수**: 미설정이면 관리 기능·`/metrics`·`/diagnostics` 전체가 꺼짐(403 `admin_disabled`), 토큰은 `x-admin-token` 헤더로만 수신하고 상수시간 비교(`checkAdmin`), E2E·P0-6 테스트 | 역할 모델·감사 기록·토큰 교체 절차 없음(단일 공유 비밀). 출처 없는 트렌드 공개 허용은 BUG-5로 남음 |
| 공급자 게이트(실데이터 외부 전송 차단) | `[DONE]`(스텁 fetch 시험) | `providers/gate.js`(키·BASE_URL·MODEL·`<P>_LIVE_ACK`·데이터 등급·동의·만 19세·킬 스위치)+`providers/call.js`, `tests/api/provider-gate.test.mjs`·`b1-gate.test.mjs`(조건별 외부 호출 0건)·`GET /providers/status` | 요청 본문의 `synthetic`·`free_test`는 전송 근거가 아님. 합성 판정은 서버 fixture 해시 일치(`isServerSynthetic` 아님, WP-C6)·`createApp({syntheticTraffic:true})` 코드 호출로만. 동의·연령은 Store의 동의 기록(`POST /consents`)에서만 읽는다. **실키·유료 경로(`paidAck=true`)는 실제 호출하지 않아 `[UNVERIFIED]`**. 구 `GEMINI_PAID_ACK`는 호환 경로(deprecated). Groq STT는 `GROQ_LIVE_ACK`+합성/동의 필요 |
| 보고서 공급자 표기 | `[DONE]`(2026-10-29 WP-B1, BUG-6 수정) | `commands.js`(평가 `evaluator`·`provider_trace`), 테스트 `b1-call` labels | 규칙 기반 평가 보고서는 `provider:'mock'`·`model_version:'mock-model-v1'`·`evaluator.kind:'rule_based'`로 고정(`paidAck`와 무관), 응답·세션·보고서에 `provider_trace[]`(실제 호출과 일치, 모델 ID 비노출) |
| DeepSeek | `[PARTIAL]` 꼬리질문 어댑터(스텁 테스트만, 실호출·약관·모델 ID 미확인 `[UNVERIFIED]`) | `src/providers/adapters/deepseek.js`, `tools/deepseek-smoke.mjs`(수동, 미실행) | §4.2 |
| Claude (지원서 주장 추출) | `[PARTIAL]` 스텁 계약 테스트만 | `src/providers/adapters/claude.js`(요청 형태 `[UNVERIFIED]`, 실호출 미실행), 기본 라우팅 아님(`LLM_ANALYSIS_PROVIDER=claude`), 합성 데이터만 | §4.2 |
| ElevenLabs | `[PARTIAL]` TTS 프록시·어댑터(WP-B6, 스텁 테스트만, 요청 형태·모델/음성 ID `[UNVERIFIED]`, 실호출 미실행) | `src/providers/adapters/elevenlabs.js`, `src/app/handlers/tts.js`, `tests/api/b6-tts.test.mjs`, `tools/elevenlabs-smoke.mjs`(수동) | §4.2 |
| GitHub Pages / Cloudflare Workers | `[PARTIAL]` | Pages 워크플로·`API_BASE`·CORS·번들 비밀 스캔(WP-A4, `tests/api/a4-cors.test.mjs`·`tests/domain/a4-secrets-scan.test.mjs`), Workers 어댑터·DO Store(WP-A3, `tests/api/a3-worker.test.mjs`)가 코드·계약 테스트로 존재 | **실제 배포·`wrangler dev`·Pages 호스팅 모두 미실행 `[UNVERIFIED]`**, wrangler 설치·`compatibility_date` 미기입 |

### 7.3 단계별 진행도(P0~P5, §6 표 기준)

| 단계 | 평가 | 근거 |
|---|---|---|
| P0 제품 기준/안전 | `[PARTIAL]` | PROJECT/AGENTS/CI 가드·PII 회귀·키워드 안티게이밍 회귀·공급자 게이트 위조 방어(P0-1)·삭제 완전성(P0-2)·관리자·토큰 정리(P0-6)·동의 API 완료. **열린 항목:** 실제 인증 없음(DEBT-2), 공급자별 월 상한 비영속, 신규 공급자 실호출·약관 미확인 |
| P1 핵심 UI/서류 | `[PARTIAL]` | 9화면 재설계(D3~D7·D9)·반응형·문서 종류/revision 구현, E2E 통과(§10). 실제 한글 PDF 추출 미검증, 접근성·카피 전수 점검(WP-D8) 미착수 |
| P2 공식 자료/트렌드 | `[PARTIAL]` | 관리자 월간 역량 초안·공개·롤백·공개 중단·규칙 강화·질문 보조 반영 동작. 수집기(WP-C2)는 스텁 시험만, **실제 수집 미실행**, 기본 꺼짐 |
| P3 질문·면접 | `[PARTIAL]` | 주장·기관·트렌드 근거 연결 질문 계획(C7·C8), 게이트·폴백·`provider_trace`. DeepSeek·Groq·ElevenLabs·Claude는 스텁 시험만, STT 실측·모델 A/B·사람 검수 미완 |
| P4 핵심 차별화 | `[PARTIAL]` | 주장 질문 → 보고서 `claim_links` → 새 질문 재연습(15개 템플릿) → 같은 루브릭 비교/판단 보류가 Mock에서 끝까지 동작(E2E). 비교는 키워드 규칙 점수, 사람 평가 미실행 |
| P5 데모 출시 | `[PARTIAL]` | 대시보드 이어하기·복원·기록·삭제·`STORE=file` 영속은 있음. **실배포·실모델 데모·데모 리허설(WP-E3)·접근성 QA(WP-D8) 미완** |

### 7.4 데모 완성도에 대한 근거 기반 평가

- **되는 것(Mock 경로, 자동 테스트·E2E로 확인):** 기업/대학 여정 → 공고·자소서 붙여넣기/TXT 추출/합성 샘플·동의 → 주장·공백 추출과 제외 토글 → 기관 프로필 확인·승인 → 질문 계획 미리보기 → 설정 → 면접(텍스트, 새로고침 복원) → 규칙 기반 근거 인용 보고서(주장↔답변 연결) → 새 질문 재연습 → 전후 비교(또는 판단 보류) → 기록·내보내기·삭제 → 관리자 월간 역량 초안/공개/중단/롤백.
- **코드는 있으나 실동작 미확인(`[UNVERIFIED]`):** DeepSeek 꼬리질문, Claude 주장 추출, ElevenLabs TTS, Groq STT, 공식 자료 수집, Pages 배포, Workers 실행(모두 스텁/주입 시험만).
- **안 되는 것:** 실제 로그인, 실모델 품질 검증·사람 평가, Claude 평가(B4), 접근성 전수 점검(D8), 데모 리허설(E3), 실제 배포.
- **판단:** 핵심 루프(주장 검증 → 코칭 → 새 질문 전이 확인)가 Mock·합성 데이터로 UI에서 끝까지 동작한다. 그러나 실모델 경로는 한 번도 호출하지 않았고 평가는 규칙 기반이므로 "Mock 기반 시제품"이며, AI 경진대회용 **완성 데모(실모델 연결·배포·리허설)는 아니다.**

### 7.5 남은 문서 불일치 (WP-E4 이후)

| 문서 | 상태 |
|---|---|
| `README.md`, `IMPLEMENTATION_CHECKLIST.md`, `docs/plan/*` | WP-E4에서 현재 상태로 갱신함 |
| `docs/project-intro.md`, `docs/master-plan.md`, `docs/implementation-spec.md`, `docs/decisions/2026-10-24-gemini-first.md` | **이력으로 보존**(과거 목표·31개 테스트·Gemini 우선·토론 베타 등). 현재 상태·목표 구성(§4.2)과 다르며 사용자용 설명으로 쓰지 않는다. 미갱신 |
| `docs/cost-assumptions*.json`, `tools/cost-model*.mjs` | Gemini/레거시 Groq 가정뿐. 목표 구성 비용 가정 없음(미갱신) |
| `docs/validation-results.md` | 손대지 않음. 실측 결과가 아니라 과거 설계 fixture 검증 기록 |
| `docs/eval/` | 사람 평가 프로토콜·템플릿만 있고 **결과는 없음**(WP-E2 실험 미실행) |

## 8. 매 실행 시 에이전트 강제 작업 규칙

1. **코드를 수정하기 전에 `PROJECT.md`와 `AGENTS.md`를 읽는다.** 파일이 누락되거나 읽을 수 없으면 제품 코드를 먼저 수정하지 않는다.
2. 현재 단계(P0~P5), 작업이 충족할 요구사항, 변경 파일, 테스트를 시작 보고 또는 작업 계획에 기록한다.
3. 기존 코드·과거 문서와 충돌하는 사양을 발견하면 보안 불변 조건을 우선하고, **현재 상태와 목표 상태의 차이**를 명시한다.
4. 실제로 동작하지 않는 기능을 구현됐다고 설명하지 않는다. 단순 Mock·정적 프롬프트·스키마 테스트를 AI 성능 증명이라 부르지 않는다.
5. 변경 범위에 해당하는 성공·실패·오용 시나리오 테스트를 추가하고, 기존 회귀 테스트를 보존한다.
6. **매 작업의 검증에서 `npm run check:project`, `npm test`를 실행한다.** UI/사용자 흐름을 건드렸다면 실제 브라우저에서도 확인한다. 실행 불가하면 이유와 미실행 상태를 남긴다.
7. 완료 보고에는 요구사항 매핑, 변경 파일, **정확한 테스트 통과/실패 수**, 실제 API/Mock 모드, 남은 제한, 문서 반영 여부를 포함한다.
8. 제품 전략·대상·질문 구성·평가/보안 정책을 바꿀 때는 `PROJECT.md` 수정 및 ADR/테스트 조정을 **같은 작업**에 포함한다.
9. 컴파일·정적 분석·문서 검사 통과만으로 데모 완료나 출시 준비를 선언하지 않는다.
10. 사용자 동의·외부 API 정책·개인정보 보호·미성년자 처리의 필수 보호장치를 테스트 편의를 이유로 무력화하지 않는다.

## 9. 자동 검사 범위의 한계

`npm run check:project`와 CI는 필수 문서·구조적 규칙의 **존재와 연결**만 자동 검사한다. 코드·UI·AI 모델의 실제 의미적 적합성은 증명하지 못한다. 향후 계약 기반 테스트, 실사용 브라우저 E2E, 자료 추출/인용 검증, 사람 평가 기반 품질 검사를 단계적으로 추가해야 한다.

## 10. 현재 테스트·검증 결과 (2026-10-29, WP-E4가 `aa6d0cc`에서 새로 실행)

| 검사 | 실행한 것 | 결과 |
|---|---|---|
| 문서·UI 구조 가드 | `npm run check:project` | PASS 4/4(PROJECT.md 헤딩·AGENTS.md·package 스크립트·UI 9화면/금지 패턴). **문서 구조 검사일 뿐 제품 적합성을 증명하지 않는다** |
| 통합 테스트 | `npm test`(= 가드 + `node --test "tests/**/*.test.mjs"`) | **252 pass / 0 fail / 0 cancelled / 0 skipped**, 약 6.6초. 테스트 서버는 키를 비우고 Mock·스텁 fetch로만 동작(외부 호출 0) |
| 기관 맞춤 E2E(HTTP) | `node tools/e2e-institution.mjs` | 14 pass / 0 fail (Mock) |
| 브라우저 E2E | `npm run e2e`(`tools/run-e2e.mjs` → `tools/e2e-ui.mjs`) | **155개 체크 ok(D8 접근성 검사 포함)**, 실패 0, "E2E 통과"(9화면 경로, 1440/768/390px 가로 오버플로 없음, 콘솔 오류·페이지 예외 0, 의도된 관리자 403·동의 428 각 1회). 헤드리스 Chromium 1종·Mock 전용. 마이크·SpeechSynthesis 실장치 미포함 |
| 설계 fixture 검사 | `node tools/verify-design.mjs` | PASS (문서 fixture·원가 산식 검사. 제품 품질·보안 검증 아님) |
| 골든 불변식 하니스 | `tests/eval/golden.test.mjs`(`npm test`에 포함) | 합성 30건에 규칙 출력·스텁 공급자 출력 불변식 적용 통과. 실모델 출력에는 적용한 적 없음 |
| 타입 검사·린트·빌드 | **미실행** | 해당 설정이 저장소에 없음(TypeScript·ESLint·번들러·빌드 단계 없음) |
| **실키 공급자 호출** | **미실행** | Gemini(`smoke:gemini`, `e2e:gemini`)·Groq STT(`tools/stt-smoke.mjs`)·DeepSeek(`deepseek-smoke.mjs`)·Claude(`claude-smoke.mjs`)·ElevenLabs(`elevenlabs-smoke.mjs`) 모두 실행하지 않음. 외부 호출·무료 한도 소모·데이터 전송 방지. 따라서 5개 공급자의 실동작·요청 형태·지연·429 처리는 `[UNVERIFIED]` |
| 실제 공식 사이트 수집 | **미실행** | `OFFICIAL_FETCH_ALLOW` 기본 비어 있음, 시험은 주입 fetch/dns 스텁뿐(`c2-fetcher` 14건) |
| 배포 | **미실행** | GitHub Pages 배포·`wrangler dev`/Workers 배포·DO 저장 모두 실행하지 않음. Workers 계약 시험(`a3-worker`)은 `fetch(Request)` 직접 호출 |
| 다른 브라우저·모바일 실기기 | **미실행** | Safari/Firefox, 실기기 마이크·TTS·브라우저별 한국어 음성 미확인. 390px 폭 에뮬레이션 레이아웃만 확인 |
| 비용 모델(`npm run cost*`) | **미실행** | Gemini 가정 산식이며 목표 구성과 무관 |
| 사람 평가·STT 오류율 실측 | **미실행** | `docs/eval/` 프로토콜·템플릿만 존재, 결과 없음 |
| 데모 리허설·접근성 점검 | **부분 실행** | `npm run rehearsal` 26/26 PASS(API 수준, Mock·스텁, 기업·대학·재시작·공급자 장애) — `docs/rehearsal.md`. 브라우저 E2E에 접근성·대비·터치·포커스·금지표현 자동 검사 포함(`docs/a11y-checklist.md`). **미실행:** 스크린리더, 실기기, Safari/Firefox, 200% 확대, UI 수동 12단계 완주 |
| API 키 클라이언트 노출 | 자동 시험+코드 검토 | `public/`에 키 참조 없음(`tools/check-bundle-secrets.mjs`, `tests/domain/a4-secrets-scan.test.mjs`), `/stt/status` 키 비노출. `/health`는 비인증 시 `selected`만 |

**상위 결론:** 위 PASS는 Mock·합성 데이터·스텁 fetch·문서 구조에 대한 것이다. 실모델 품질, 실제 한국어 문서/음성, 배포 환경, 보안 침투 시험은 검증되지 않았다.

## 11. 발견된 버그와 기술 부채

심각도는 데모 영향 기준(P0 데모 핵심·보안 / P1 품질 / P2 개선 / P3 확장). 재현 방식을 같이 적는다.

| ID | 우선 | 내용 | 근거·재현 |
|---|---|---|---|
| BUG-1 | ~~P0~~ **수정됨(2026-10-29, P0-1)** | **[원 결함·참고용]** 실사용자 텍스트가 클라이언트 위조 플래그로 Gemini에 전송될 수 있었음. `isServerSynthetic()`은 이름과 달리 **요청 본문의 `synthetic:true`와 `_synthetic_fixture:true`**만 본다. `GEMINI_ALLOW_UNPAID=true`이면(현재 로컬 `.env` 값) 선택기가 `gemini`를 반환한다. 방어는 이메일·전화·주민번호 정규식뿐이라 이름·학교는 통과. 프로필 경로는 응답에 `provider:"mock"`이라 적으면서 Gemini를 호출한다. `PROJECT.md` §5 #1·#3 위반 | 구 `server.js`(현재 `src/app/` 핸들러로 분리, 줄 번호는 이력). 임시 프로브(스텁 fetch): 플래그 없음 → mock·호출 0, 위조 플래그 → `provider:"gemini"`·호출 1(턴), 프로필 → 응답 `mock`·호출 발생. 기존 테스트는 키를 비워 이 경로를 못 보고, 옛 공허 테스트는 201/422 둘 다 통과시켜 공허함. 배포된 UI는 플래그를 보내지 않음(가드가 검사) — 직접 API 호출로만 악용 |
| BUG-2 | ~~P0~~ **수정됨(2026-10-29, P0-2)** | **[원 결함·참고용]** 삭제 후 사용자 발언이 남았음. `DELETE /sessions/:id`·`DELETE /account`가 `transferJobs`(기준·재연습 발췌 원문)와 `exports`(10분)를 지우지 않는다. 계정 삭제 후에도 `GET /transfer-comparisons/:id`가 200과 발췌를 반환 | 구 `server.js`(현재 `src/app/` 핸들러로 분리, 줄 번호는 이력). 프로브로 재현. `PROJECT.md` §5 #10 위반 |
| BUG-3 | ~~P1~~ **수정됨(2026-10-29, P0-6)** | **[원 결함·참고용]** `ADMIN_TOKEN`이 없으면 **모든 일반 개발 토큰 사용자가 월간 역량 초안·공개·롤백 가능**(프로브: 사용자 B가 초안 201). 관리자 토큰을 쿼리스트링(`?admin_token=`)으로도 받아 URL·로그에 남을 수 있음 | 구 `server.js`(현재 `src/app/` 핸들러로 분리, 줄 번호는 이력) |
| BUG-4 | ~~P1~~ **수정됨(2026-10-29, P0-6; `/health`는 비인증 시 `selected`만, 나머지는 인증 필요)** | **[원 결함·참고용]** 인증 전 엔드포인트: `/health`(설정 불리언·모델명), `/metrics`(월 지출 원장), `/diagnostics/gemini-models`(**서버 Gemini 키로 외부 호출, 인증·속도 제한 없음**) | 구 `server.js`(현재 `src/app/` 핸들러로 분리, 줄 번호는 이력), 프로브로 무인증 200 확인 |
| BUG-5 | ~~P1~~ **수정됨(WP-C3, `91318cf`)** | **[원 결함·참고용]** 월간 트렌드를 출처·코멘트 없이 공개할 수 있었음. 현재 422, 규칙 위반 레거시 공개본은 노출 차단+보고 | `trends.js validateItems`, `tests/api/c3-trends.test.mjs` |
| BUG-6 | ~~P1~~ **수정됨(2026-10-29, WP-B1; `evaluator` 표기·`badge` 제거·`provider_trace` 일치)** | **[원 결함·참고용]** 보고서 표기 불일치: `badge:"AI 생성 코칭…"`이 규칙 기반 평가에도 붙음. `provider`는 전역값, `paidAck=true`면 `model_version`이 Gemini 모델명이 됨 | 구 `server.js`(현재 `src/app/` 핸들러로 분리, 줄 번호는 이력)(구) |
| BUG-7 | ~~P1~~ **수정됨(WP-C4, `047d0d3`)** | 전 루브릭 차원별 템플릿 3개 이상, 기준 질문과 유사도 <0.55, 미지 역량 422, 미사용 `practiceText` 제거 | `transfer.js TRANSFER_BANK`, `tests/domain/c4-*`, `tests/api/c4-*` |
| BUG-8 | ~~P1~~ **수정됨(2026-10-29, WP-B1; 429·장애 시 정적 폴백으로 계속, 호출 단위 예약·정산, 사전 예산 확인에서 가짜 `session:${owner}` 키 제거)** | **[원 결함·참고용]** 대화 중 429 → 정적 폴백 없이 `finishSession`, 원장 예약 미정산, `createSession` 예산 사전 확인이 실제 세션 원장과 무관한 키 사용 | 구 `server.js`(현재 `src/app/` 핸들러로 분리, 줄 번호는 이력)(구) |
| BUG-9 | ~~P1~~ **수정됨(WP-C1, `4f4c23a`)** | 업로드 한도 불일치: 문서 업로드 경로(`/profiles/:id/documents`, `/documents/extract`)만 본문 한도 7.5MB(5MB 파일의 base64+여유), 나머지는 1MB 유지. 4MB 통과·5MB 초과 413 테스트 | `router.js DOCUMENT_BODY_LIMIT`, `documents.js MAX_BYTES`, `tests/api/c1-documents.test.mjs` |
| DEBT-1 | P0 **부분 해소(WP-A2 `4881568`, `62d2812`)** | `STORE=file`(`DATA_DIR`, 기본 `data/store`)이면 세션·턴·보고서·전이 작업·멱등 기록·원장(월 경계)·동의·문서가 재시작 후 유지(`tests/api/a2-file-store.test.mjs`). **기본값은 여전히 memory**, 파일 저장은 **단일 프로세스 가정**(다중 프로세스 쓰기 보호 없음, 전체 스냅샷). 내보내기·티켓은 메모리 전용, 업로드 원본은 저장 안 함. Workers DO 저장은 미검증 | `src/store/file.js` |
| DEBT-2 | P0 **열림**(부분 완화) | **실제 인증 없음** — 환경변수 정적 접속 토큰만(내장 기본 토큰·클라이언트 내장 토큰은 P0-6에서 제거, 첫 401에서 토큰 입력). 공개 배포 전에 반드시 교체 | `src/config.js`, `public/core/api.js` |
| DEBT-3 | ~~P0~~ **해소(2026-10-29, WP-B1)** | **[원 결함·참고용]** 공급자 라우팅 부재 — `config.registry` 미사용 → 이제 `providers/registry.js`·`gate.js`·`call.js`가 라우팅·게이트·호출을 담당 | `src/providers/` |
| DEBT-4 | ~~P1~~ **해소(WP-A1 `559dc98`)** | **[원 결함·참고용]** `Idempotency-Key`를 요구만 하고 재생하지 않음 → 24h 응답 재생·같은 키+다른 본문 409·소유자 단위 파기 | `tests/api/a1-idempotency.test.mjs` |
| DEBT-5 | ~~P1~~ **해소(WP-A1 `559dc98`, WP-D1 `c4a859f`)** | **[원 결함·참고용]** `server.js`·`app.js` 단일 대형 파일 → `src/app/`·`src/node/`·`src/store/`, `public/core|screens` 모듈로 분리 | `src/`, `public/` |
| DEBT-6 | ~~P1~~ **해소(2026-10-29, WP-B1; 문서 추출·STT·턴·프로필, `Store.recordRate`)** | **[원 결함·참고용]** 사용자별 속도 제한이 프로필 생성에만 있음. TTS는 엔드포인트 신설 시(WP-B6) 같은 방식으로 추가 | `store.recordRate` |
| DEBT-7 | P1 **부분 해소(WP-C5 `f1e86e8`)** | 이름·학교·주소 PII는 휴리스틱 탐지(표지어 없는 이름 등 누락 가능, 완전 익명화 아님), 블라인드 마스킹도 휴리스틱 | `pii.js`, `tests/domain/c5-pii-corpus.test.mjs` |
| DEBT-8 | ~~P2~~ **해소(2026-10-29, WP-D5; E2E 확인)** | **[원 결함·참고용]** 6개 면접 유형이 기본 설정 화면에 노출(§3과 충돌). 현재: 기본 `일반·인성`, 나머지는 `고급(실험)` 접힘 | `index.html` 설정 화면 |
| DEBT-9 | P2 **부분 해소(WP-C2 `adf8c3c`), 틈 남음** | 수집기가 DNS 해석 후 사설 IP를 재검사하고 리디렉션을 수동 재검증하나, **fetch가 연결 시 DNS를 다시 해석하므로 해석→연결 사이 TOCTOU(rebinding) 틈이 남음**(허용 도메인 목록·매 홉 재검사로 완화). 실제 네트워크 수집 미실행 `[UNVERIFIED]` | `src/domain/fetcher.js`, `docs/official-fetch.md` |
| DEBT-10 | P2 | 새 질문 비교가 1~2개 답변의 키워드 규칙 점수 차이에 의존 | `compareTransfer`, `mock-eval.js scoreHeuristic` |
| DEBT-11 | P1 | **공급자별 월 상한·사용자별 속도 제한이 인메모리**: DeepSeek·ElevenLabs 호출 수/USD 상한은 호출 래퍼가 집행하나 재시작 시 0. Claude `CLAUDE_MONTHLY_CAP_USD`는 미집행, 신규 공급자 단가가 비면 0 정산 | `providers/call.js`, `src/config.js providerCaps` |
| DEBT-12 | P1 `[UNVERIFIED]` | DeepSeek(OpenAI 호환 chat-completions 가정)·Claude·ElevenLabs·Groq 요청/응답 형태, 모델 ID, 가격, 약관·데이터·연령 조건을 공식 문서로 확인하지 않았고 실호출을 한 번도 하지 않음(스텁 시험만). 실데이터 전송 불가 유지 | `src/providers/adapters/*`, `tools/*-smoke.mjs`(수동) |
| DEBT-13 | P1 `[UNVERIFIED]` | Workers 런타임(`wrangler.toml` compatibility_date 미기입, `nodejs_compat` 범위, DO SQLite 선언)·Pages 배포 미실행. 파일 저장은 단일 프로세스 가정 | `src/worker/*`, `docs/deploy-workers.md` |
| DEBT-14 | P1 | 평가는 규칙 기반이며 사람 평가자 비교 없음(§6.2), Claude 평가 어댑터(WP-B4)·사람 평가 실험(WP-E2)·접근성 QA(WP-D8)·데모 리허설(WP-E3) 미착수 | §12 |

## 12. 구현 우선순위와 단계별 로드맵

구현 작업 단위·병렬 실행 규칙·UI/UX 전체 명세·API 계약은 **`docs/plan/README.md`**(하위 에이전트용 구현 기획서)에 있다. 충돌 시 이 문서(PROJECT.md)가 우선한다.

원칙: 기능 수보다 **처음부터 끝까지 정상 동작하는 데모 시나리오(§13)**. 난이도 S(≈반나절) / M(1~2일) / L(3일+) 은 대략 추정이다. 모든 변경은 `AGENTS.md` 종료 절차(`check:project`·`npm test`·브라우저 확인)를 따른다.

### P0 — 데모 핵심 경로·보안을 막는 항목

| ID | 작업 | 대상 파일 | 필요한 변경 | 선행 | 검증 | 난이도 |
|---|---|---|---|---|---|---|
| P0-1 | `[DONE]` 완료(2026-10-29) 공급자 게이트 복구(BUG-1) | `src/app/handlers/*`(`isServerSynthetic`,`providerForRequest`,`createProfile`,`runCommand`), `adapters.js selectProvider`, `store.js`(`free_test`), `tests/` | 요청 본문의 합성 표시를 **전송 근거에서 제거**. 합성 허용은 서버가 보유한 데모 fixture ID(서버 환경설정)로만. 응답의 `provider`는 실제 호출 공급자를 반영. 이름·학교 PII 탐지 보강은 P1-8 | 없음 | 가짜 키+스텁 `fetch`로 위조 플래그 시 **외부 호출 0건** 단언 테스트(프로필·턴), 서버 fixture 경로만 호출됨 단언 | M |
| P0-2 | `[DONE]` 완료(2026-10-29) 삭제 완전성(BUG-2) | `src/app/handlers/*`(`deleteSession`,`deleteAccount`,`exports`,`transferJobs`), `store.js` | 세션/계정 삭제 시 전이 작업·내보내기 캐시 파기(또는 소유 세션 ID로 연결해 연쇄 삭제) | 없음 | 삭제 후 `GET /transfer-comparisons/:id` 404, `exports` 404 테스트 | S |
| P0-3 | `[PARTIAL]` 1차 규칙 기반 `f2b5f3e`+C7 `ea43252`, Claude 2차는 B3 스텁만 1차 완료(2026-10-29, 규칙 기반·Mock) 지원서 주장 검증 슬라이스 — 모델 기반 2차는 P0-4에서 | 신규 `src/domain/claims.js`, `src/app/handlers/*`(`createProfile`,`createSession`), `public/screens/evidence.js`, `tests/` | 자소서/지원서 텍스트를 별도 입력으로 받아 문장 단위 주장(역할·행동·결과·수치·공백) 추출, 원문 span·코드포인트 보존, 질문에 `application_evidence_ids`·`source_status`·`prompt_version` 연결, 자소서에 없는 사실 생성 금지. 1차는 결정적 규칙+Mock, 2차에 Claude Sonnet 연결 | P0-1 | 합성 자소서에서 질문이 인용 문장에 연결됨, 존재하지 않는 구절 거부, 프롬프트 인젝션 문장이 지시로 쓰이지 않음 | L |
| P0-4 | `[PARTIAL]` B1 `cf95781`·B2 `d585161`·B3 `f76491a`·B6 `202a8b8` 스텁 시험만, 합성 실호출 스모크 미실행 공급자 라우팅 + 목표 구성 최소 실모델 경로 | `config.js registry`, `src/app/handlers/*`, 신규 어댑터(DeepSeek 꼬리질문, Claude Sonnet 분석·질문 설계) | operation별 공급자 선택. 명시적 환경 플래그·예산 상한 없이는 호출 금지, 실패 시 Mock 폴백과 **"Mock 사용 중" 표시**, 유료 자동 승격 금지(§5 #8). 각 공급자 약관·데이터·연령 조건 확인 후 합성 데이터만 연결 | P0-1, §14 약관 확인 | 스텁 `fetch` 계약 테스트 + 합성 데이터 실호출 1회 스모크(개발자 승인 후) | L |
| P0-5 | `[PARTIAL]` 코드·워크플로 준비(A3 `f0a9058`·A4 `fe06d70`), 실배포·실행 미검증 배포 구조 결정·구현 | `public/`, 신규 `wrangler` 설정·Worker, `.github/workflows` | (a) Pages 정적 UI + Workers 프록시/백엔드로 갈지 (b) 대회 데모는 로컬 Node 서버로 시연할지 결정(`[미확정]`). (a)면 API 기본 URL 설정, CORS, 키는 Workers 비밀값, 영속 저장(KV/D1/Durable Objects 택1) 필요. 현 `src/app/handlers/*`는 그대로 Worker로 이식 불가 | 결정 | 배포 URL에서 §13 시나리오 완주, 번들에 키 없음 확인 | L |
| P0-6 | `[DONE]` `9d08110`(실제 로그인 제외) 완료(2026-10-29, 실제 로그인 제외) 공개 전 필수 보안 정리 | `src/app/handlers/*`(`checkAdmin`,`/health`,`/metrics`,`/diagnostics`), `config.js`, `public/core/api.js` | 관리자 토큰 필수화(미설정 시 관리 기능 비활성), 토큰 쿼리 수신 제거, 진단·지표 엔드포인트 인증·제한, 기본 개발 토큰 제거·실제 인증 도입(또는 데모 전용 초대 토큰) | P0-5 | 무인증 호출 401/403 테스트 | M |
| P0-7 | `[DONE]` WP-A2 `4881568`(`STORE=file`, 단일 프로세스) 데모 데이터 영속화 | `store.js` 또는 외부 저장소 | 최소한 세션·평가·전이 작업을 파일/KV에 저장해 재시작 후 기록 조회 | P0-5 | 서버 재시작 후 기록·비교 유지 테스트 | M |

### P1 — 면접 품질·분석 정확성·평가·음성

| ID | 작업 | 대상 파일 | 필요한 변경 | 선행 | 검증 | 난이도 |
|---|---|---|---|---|---|---|
| P1-1 | `[TODO]` WP-B4 미착수 평가기 고도화 | `mock-eval*.js`, 신규 평가 어댑터 | Claude Sonnet 평가는 **기존 인용·span 검증(`validateEvaluation`)을 통과한 출력만** 채택, 평가기 종류를 보고서에 표기. 사람 평가자 비교 전에는 "검증된 AI 평가" 금지 | P0-4 | 사람 2명 이상 독립 채점 20건 대비 일치도(§6.2), 키워드 주입 회귀 유지 | L |
| P1-2 | `[PARTIAL]` WP-B6 `202a8b8` 스텁 시험만 면접관 TTS(ElevenLabs) | `src/app/handlers/*`(프록시 엔드포인트), `public/screens/*`(`speak`) | 서버 프록시로 합성, 키 비노출, 실패·한도 시 브라우저 TTS 폴백, 사람 음성 오인 금지 표기 | P0-5 | 스텁 계약 테스트, 폴백 E2E | M |
| P1-3 | `[PARTIAL]` 계약 시험·수동 도구만(실측 미실행) Groq STT 실검증 | `adapters.js`, `public/screens/*` | 합성 음성으로 실호출(승인 후), 오류율·지연 기록, 교정 UI 점검 | 키·승인 | WER/CER·p95 지연 기록(§6.2) | S (계약 시험·수동 스모크 도구 준비됨 2026-10-29 WP-B5; 실측 **미실행**) |
| P1-4 | `[DONE]` WP-C4 `047d0d3` 새 질문 생성 개선(BUG-7) | `transfer.js`, `server.js createPractice` | 루브릭별 템플릿 또는 LLM 생성+유사도·역량 일치 검사, 전 루브릭 역량 지원 | P0-4 | 루브릭 6종 모두 같은 역량·다른 질문 테스트 | M |
| P1-5 | `[DONE]` WP-C3 `91318cf`(질문에 보조 1개 반영) 월간 트렌드 규칙 강화·연결(BUG-5) | `trends.js`, `src/app/handlers/*`, `questions`/`institution.js` | 출처·코멘트 필수, 공개 항목을 **보조 기준으로 표기**해 질문 설계에 반영, 미승인 노출 금지 유지 | 없음 | 출처 없는 공개 422, 공개본만 질문에 반영 | M |
| P1-6 | `[PARTIAL]` WP-C2 `adf8c3c`(스텁 시험만, 실수집 미실행) 완료(2026-10-29, WP-C2; 실수집 미검증) 공식 자료 수집기 | 신규 `src/domain/fetcher.js`, `sources.js` | 허용 도메인 목록, 서버 fetch, DNS 해석 후 사설 IP 재검사, 리디렉션 재검증, 크기·시간·robots 제한, 상태 `official_verified/unavailable/stale/conflict` 분리. **미구현 시 데모에서는 큐레이션 fixture를 "사용자 제공/데모 fixture"로 표기** | P0-1 | SSRF 시험(사설 IP·리디렉션·DNS rebinding 모사), 수집 실패 상태 분리 테스트 | L |
| P1-7 | `[DONE]` WP-B1 `cf95781`, BUG-9 `4f4c23a` 오류·한도 처리(BUG-8,9) | `providers/call.js`, `commands.js` | **WP-B1: 429 정적 폴백 계속·원장 정산 누락 수정·사용자별 속도 제한 확대 완료. 업로드 한도 정합(BUG-9)은 WP-C1에서 수정** | 없음 | 429·타임아웃 스텁 테스트(`b1-call`) | M |
| P1-8 | `[PARTIAL]` WP-C5 `f1e86e8`(휴리스틱) PII 탐지 보강 | `pii.js` | 이름·학교·주소 후보 탐지, 오탐(`이유`,`이번`,`21세기`) 회귀 유지 | 없음 | 정/오탐 코퍼스 테스트 | M |
| P1-9 | `[DONE]` WP-B1 보고서 표기 정정(BUG-6) | `commands.js`(보고서 생성) | **`[DONE]` WP-B1: 평가기 종류·실제 공급자 표기, `badge` 제거** | 없음 | 보고서 필드 단언 테스트(`b1-call` labels, `sessions`) | S |
| P1-10 | `[TODO]`/`[UNVERIFIED]` 합성 CID PDF는 명시 실패(C1 `4f4c23a`), 실제 한국어 문서 시험 없음 실제 PDF/DOCX 호환 | `documents.js` | 실제 한국어 PDF/DOCX 샘플(합성)로 시험, 실패 시 붙여넣기 안내 유지(필요 시 검증된 파서 도입 검토 — 의존성 추가는 개발자 승인 필요) | — | 실문서 샘플 추출 성공/실패율 기록 | M |

### P2 — 추가 유형·UX·운영 편의

- `[DONE]` 비핵심 면접 유형을 "고급(실험)"으로 이동(DEBT-8) — WP-D5 `ee178e4`.
- `[PARTIAL]` 관리자 화면: 편집기·검토 체크리스트·공개 중단·미리보기 구현(WP-D7 `e73aac7`); 월간 후보 AI 추출 보조·편향 검수는 `[TODO]`.
- `[PARTIAL]` 연령 확인·합성 예제 모드: 동의 API(WP-C6 `e2e6f7e`)+안내 대화상자(WP-D3 `f863841`), 자기 신고 방식.
- `[DONE]` `server.js`·`app.js` 모듈 분리(DEBT-5)·`Idempotency-Key` 재생(DEBT-4) — WP-A1 `559dc98`, WP-D1 `c4a859f`.
- `[PARTIAL]` 접근성: 자동 검사(대비·라벨·터치·포커스·오버플로 9화면×3폭)는 E2E에 있음(WP-D8). 스크린리더·다른 브라우저(Safari/Firefox)·모바일 실기기는 미실행. 문서 재정비는 WP-E4(이 변경)로 수행했고 `docs/` 과거 문서는 이력으로 남김(§7.5).

### 12.1 WP 진행 현황 (`docs/plan/07-work-packages.md` 기준, `aa6d0cc`)

| 상태 | WP (커밋) |
|---|---|
| `[DONE]`(Mock·스텁 시험 범위) | A0 `e417484` · A1 `559dc98` · A2 `4881568`(+`62d2812`) · B1 `cf95781`(+`adf2a02`) · B7 `6ae151b` · C1 `4f4c23a` · C3 `91318cf` · C4 `047d0d3` · C5 `f1e86e8`(휴리스틱) · C6 `e2e6f7e` · C8 `b3fccf5` · D1 `c4a859f` · D2 `aa11c0c` · D3 `f863841` · D4 `f06e922` · D5 `ee178e4` · D6 `1c03f7b` · D7 `e73aac7` · D9 `056a73a` · E1 `8a09a70` · E4(이 변경) |
| `[PARTIAL]`(코드+스텁/계약 시험, 실동작 `[UNVERIFIED]`) | A3 `f0a9058`(Workers 미실행) · A4 `fe06d70`(배포 미실행) · B2 `d585161` · B3 `f76491a` · B5 `6ae151b`(계약 시험만, 실측 미실행) · B6 `202a8b8` · C2 `adf8c3c`(실수집 미실행) · C7 `ea43252`(합성 코퍼스 한정) · E2(프로토콜·템플릿만, 실험 미실행) |
| `[TODO]`(미착수) | B4(Claude 평가) |
| `[PARTIAL]` | D8(자동 QA 완료·수동 미실행) · E3(API 리허설 26/26, UI·실기기 미실행) |


### P3 — 상용화·확장성·장기 운영

실제 계정·로그인, 관리형 DB와 행 수준 접근 제어, 실시간 스트리밍(WebSocket), 월간 수집 자동화 작업, 이의 제기 운영 절차, 미성년자 대상 법적 경로, 사용량 과금·팀 관리, 장기 학습 추이, 개인정보 처리방침·보존 정책 문서화.

## 13. 데모데이 시연 범위와 완료 조건

**범위:** 합성 지원자 1~2명(기업 1경로, 대학 1경로)으로 아래 시나리오를 **실제 UI에서 끝까지** 수행. 실사용자 데이터는 사용하지 않는다. 화면에는 **현재 공급자 모드(Mock / 실모델)와 평가기 종류**를 항상 표시한다.

| # | 시연 단계 | 완료 조건 | 현재 |
|---|---|---|---|
| 1 | 기업/대학 선택, 공고·합성 자소서 입력 | 두 경로 모두 진행 | `[DONE]`(Mock; 문서 종류·revision·합성 샘플·동의 포함 E2E). 실제 한국어 서류는 `[UNVERIFIED]` |
| 2 | 주장·공백 추출 결과 표시 | 자소서 **원문 문장 인용+위치** 표시, 없는 사실 없음 | `[DONE]`(규칙 기반, 정확도 미측정 — 합성 코퍼스 한정) — 근거 확인 화면 E2E 통과 |
| 3 | 공식 기준·출처 확인·승인 | 출처 상태(공식 확인/사용자 제공/트렌드/미확인) 구분, 수집 실패 표시 | `[PARTIAL]`(출처 상태 칩·승인 UI 있음, 수집기는 스텁 시험만·기본 꺼짐 → 실수집 없음) |
| 4 | 개인정보·연령 확인 | 합성 데이터만 외부 전송, 연령 안내 | `[PARTIAL]`(동의·만 19세 자기 신고·게이트 구현, 연령 검증 아님) |
| 5 | 검증 질문·꼬리질문 | 질문이 근거 ID에 연결, 직전 답변 관련 꼬리질문 | 질문 근거 연결 `[DONE]`(지원서 주장·기관·트렌드), 꼬리질문 `[PARTIAL]`(Mock 고정 문장, DeepSeek 스텁만) |
| 6 | 텍스트·음성 답변 | 음성은 전사 확인·교정 후 제출, 실패 시 텍스트 | 텍스트 `[DONE]`, 음성 `[UNVERIFIED]` |
| 7 | 근거 기반 보고서 | 발언 인용·판단 보류, 평가기 종류 명시 | `[DONE]`(규칙 기반) |
| 8 | 약점 집중 코칭 | 약한 역량 1개와 다음 행동 1개 | `[DONE]` |
| 9 | 새 질문 재연습 | 같은 역량의 **다른 질문**, 같은 루브릭 | `[PARTIAL]`(루브릭 전 차원 고정 템플릿 15개 — 질문 품질 사람 평가 없음) |
| 10 | 답변 변화 비교 | `observed_change`/`no_clear_change`/판단 보류 + 발언 근거 | `[PARTIAL]` |
| 11 | 기록·내보내기·삭제 | 삭제 후 잔존 없음 | `[PARTIAL]`(삭제 파기 구현·`STORE=file`도 반영, 기본 memory는 재시작 시 소실, 백업·다중 프로세스 미검증) |
| 12 | 운영자: 월간 역량 초안→검수→공개 | 출처 필수, 공개본만 노출 | `[PARTIAL]`(BUG-5 수정·편집기·공개 중단 있음, 자동 수집·AI 후보·편향 검수 없음) |

**데모 완료 조건:** 위 12단계가 같은 환경에서 중단 없이 수행되고, `npm run check:project`·`npm test`·브라우저 E2E가 통과하며, DEBT-2가 닫혀 있고(BUG-1·BUG-2는 2026-10-29 수정), 실모델 사용 여부가 화면·보고서에 정확히 표시될 것. 목표 AI 구성(DeepSeek·Claude·ElevenLabs)을 연결하지 못한 항목은 "미연결/Mock"으로 표시하고 완료로 세지 않는다. **현재(`aa6d0cc`)는 Mock 경로에서 12단계가 E2E로 통과하나 DEBT-2 미해소, 실모델 미연결, 데모 리허설(WP-E3) 미수행이므로 완료 조건을 충족하지 않는다.**

## 14. 알려진 한계와 미확정 사항

- **미확인 외부 사실:** DeepSeek·Claude Sonnet·ElevenLabs·Groq·Cloudflare·GitHub Pages의 현재 모델 ID, 엔드포인트, 가격, 무료 티어, 지원 기능(한국어 품질 포함), 데이터 학습·보존·국외 이전·연령 조건. 확인 전에는 코드·문서에 확정값을 쓰지 않는다.
- **법·약관:** 실제 지원서(특히 미성년자 가능 대입 지원자)를 각 공급자에 보낼 수 있는지 `[UNVERIFIED]`. 확인 전까지 합성 fixture만.
- **저장소·배포 아키텍처:** DG-1 A안(Pages 정적 UI + Workers API + Durable Object) 코드는 준비됐으나(A3·A4) 실제로 배포·시험하지 않았고 Workers 한도·`nodejs_compat` 범위는 `[UNVERIFIED]`. 대회 시연을 로컬 Node(`STORE=file`) 서버로 할지 배포로 할지 `[미확정]`.
- **품질 미검증:** 한국어 STT 오류율, 꼬리질문 적합성, 평가 타당성, 새 질문 비교의 의미, 개선 효과(사람 평가 실험 필요 — §6.2). 현재 평가는 규칙 기반 참고 관찰이다.
- **재현 못 한 것:** 실제 한글 PDF/DOCX 추출, 실기기 마이크·TTS, Safari/Firefox, 5개 공급자(Gemini·Groq·DeepSeek·Claude·ElevenLabs) 실호출, 공식 사이트 실수집, Pages·Workers 실배포, 사람 평가·STT 오류율 실측. BUG-9(업로드 한도)는 자동 테스트로 확인(C1).
- **한도·인메모리 상태:** 공급자별 월 상한·사용자별 속도 제한은 인메모리(재시작 시 0), 실제 로그인·역할 모델 없음(DEBT-2), 파일 저장은 단일 프로세스 가정(DEBT-1), 수집기에 DNS rebinding 틈(DEBT-9).
- **SDGs 연계**는 가설이며(§1.5) 효과를 측정하지 않았다.
- **Figma 원본**은 레이어 이름·구조만 확인했다(§16). 노드 안의 설명 문구와 시각 디자인은 읽지 않았다.
- **결제·충전 상태:** §15 금액은 계획액이며 **결제 증빙이 저장소에 없어 결제 여부는 미확인**이다.

## 15. 예산 (계획액, 결제 상태 미확인)

총 데모 예산 **200,000원**. 아래는 개발자가 정한 **계획액**이며 실제 결제·충전 완료를 뜻하지 않는다(저장소에 증빙 없음 → 모두 `[UNVERIFIED]`).

| 항목 | 계획액 | 비고 |
|---|---|---|
| DeepSeek API | $10 | 목표 실시간 면접관·꼬리질문 |
| Claude Sonnet API | $10 | 목표 이력서 분석·질문 설계·종합 평가 |
| Groq Whisper | $4 | 목표 STT |
| ElevenLabs Creator | $22 | 목표 TTS |
| GitHub Pages | 무료 | — |
| Cloudflare Workers | 무료 티어 우선 | 한도 초과 시 유료 여부 `[미확정]` |
| 개발용: Claude Pro | $20 | — |
| 개발용: ChatGPT Business Standard | $50 | 월간 최소 2석 기준(개발자 계획) |
| **합계(계획)** | **$116** (API·서비스 $46 + 개발 구독 $70) | |

- 산술 참고: 합계 $116이 200,000원 이내이려면 환율·수수료·부가세 반영 후 약 **1,724원/USD 이하**여야 한다. 실제 환율·세금·결제 수수료는 확인하지 않았다.
- 현재 코드의 예산 장치(`ledger.js`)는 Gemini 단가표 기준 세션 $0.08·월 $30 상한이다(`STORE=file`이면 월 경계·영속). 공급자별 월 상한은 DeepSeek·ElevenLabs만 호출 수/USD로 집행하며(인메모리, 재시작 시 0) Claude는 미집행이다(DEBT-11). 신규 공급자 연결 시 공급자별 월 상한·킬 스위치·자동 승격 금지를 같은 변경에 포함한다. 기존 `docs/cost-assumptions*.json`은 목표 구성에 맞지 않는다(§7.5).

## 16. Figma 워크플로우 대조

**검증 범위.** Figma MCP로 `NcKWUyP3hhw6oKCC43UkJs`, 노드 `3:3`(프레임 "초안", 4532×1690)의 **메타데이터(레이어 이름·구조·위치)를 읽는 데 성공**했다. 확인한 구조: 주 흐름 12단계(요청 문서의 12단계와 이름·순서 일치), 운영자 흐름 4단계(웹 조사·자료 등록 → 근거·신선도 검토 → 관리자 승인 → 월간 역량 게시), 하위 분기 7개(자소서 원문 근거 / 미확인·수집 실패 / 실데이터 처리 차단 / 질문별 근거 연결 / 규칙 평가≠AI 평가 / 새 문항 유사도 검사 / 비교 가능 여부 판정), 트렌드 대체 경로, 재검증 루프. **각 노드의 설명 텍스트와 시각 디자인은 읽지 않았다**(스크린샷·`get_design_context` 미사용). 따라서 단계 설명 문구까지 직접 검증했다고 주장하지 않는다.

### 16.1 사용자 흐름 12단계

| 단계 | 현재 구현 | 목표 동작 | 누락된 데이터 흐름 | 모델·API (현재 → 목표) | 선행·제약 |
|---|---|---|---|---|---|
| 1 기업·대학 선택 | `[DONE]` `public/screens/dashboard.js` | 유형 선택 | — | 없음 | — |
| 2 지원 자료 제출 | `[PARTIAL]` 공고 텍스트·TXT/PDF/DOCX 추출·경험 3개 | 공고·이력서·자소서 문서 구분, 원본/추출/수정 revision(API 구현, S2 UI 카드·종류·미리보기·수정 연결 WP-D3 완료(질문 생성의 revision 읽기: C7 구현)) | 문서 종류·revision 저장(구현) | 없음 | 실제 한글 PDF 미검증(CID 글꼴은 명시 실패) |
| 3 주장·공백 추출 | `[PARTIAL]` 규칙 기반 `extractApplicantClaims`(문장 단위·원문 span·공백, 문서 revision 기반 C7)+공고 키워드(Gemini/규칙). Claude 어댑터는 스텁 시험만 | 자소서 문장 단위 주장(역할·행동·결과·수치)과 공백, 원문 span | 지원자 주장 모델(`EvidenceClaim`, 구현) | 규칙/Gemini(공고 키워드) → Claude Sonnet(스텁만) | 실호출·한국어 정확도 `[UNVERIFIED]`, 프롬프트 인젝션 방어는 스텁 시험 |
| 4 공식 기준 탐색 | `[PARTIAL]` 수집기 `fetcher.js`(허용 도메인 기본 꺼짐·DNS 재검사·리디렉션·robots·발췌, 스텁 시험만) | 서버 제어 수집기로 공식 페이지 수집·발췌 | 수집 결과·발췌 위치·확인일 저장(구현) | 없음 → 수집기 | 실제 수집 미실행, DEBT-9 TOCTOU 틈 |
| 5 출처 검토·승인 | `[PARTIAL]` 기관 프로필 확인·승인(`approveProfile`)+출처 상태 칩·재승인 안내(D4) | 출처별 상태(공식 확인/사용자 제공/트렌드/미확인/수집 실패)와 승인 | 수집 실패 구분은 수집기 결과(`official_verified/unavailable/stale/conflict`) | 없음 | 4단계 실수집 선행 |
| 6 개인정보·연령 확인 | `[PARTIAL]` PII 휴리스틱·동의 API(`POST /consents`, 만 19세 자기 신고)·동의 없으면 프로필 428·서버 fixture 해시 합성 판정(C6)·S2 연령·처리 안내 대화상자(D3)·공급자 게이트가 동의·연령 없으면 실데이터 차단(B1) | 연령 확인 절차, 실데이터 외부 전송 차단, 합성 모드 | 연령·동의 기록(구현, 자기 신고), 서버 소유 합성 fixture(구현) | 없음 | 공급자 약관(§14) `[UNVERIFIED]`, 연령 검증 아님 |
| 7 검증 질문 설계 | `[PARTIAL]` 지원서 주장 질문(원문 인용·`application_evidence_ids`·`prompt_version`)+정적 팩+기관 템플릿+트렌드 보조, `GET /profiles/:id/plan` | 주장·공식 요구에 연결된 질문(근거 ID) | `institution_evidence_ids` 연결은 부분적 | 없음 → Claude Sonnet(선택, 미구현) | 질문 품질 사람 평가 없음 |
| 8 실전 면접 진행 | `[PARTIAL]` REST 명령, 텍스트·Groq 녹음(`[UNVERIFIED]`), 브라우저 TTS+서버 TTS 프록시(스텁), 새로고침 복원 | 실시간 꼬리질문, 음성 입출력 | 스트리밍(선택) | Gemini(조건부)/DeepSeek(스텁)/Mock, Groq Whisper, ElevenLabs(스텁) | 실호출·약관 확인·예산 상한 |
| 9 근거 기반 관찰 | `[DONE]`(규칙, `evaluator` 표기 BUG-6 수정) | 발언 인용 기반 관찰, 판단 보류 | — | 규칙 → Claude Sonnet(B4 미착수) | 인용 검증 유지, 사람 평가 비교 |
| 10 약점 집중 코칭 | `[DONE]`(규칙) | 약한 역량 1개·다음 행동 1개 | — | 규칙 | — |
| 11 새 질문 재연습 | `[PARTIAL]` 루브릭 전 차원 × 템플릿 3개(15개) | 같은 역량의 새·다른 질문 | 질문 은행/생성(BUG-7 수정) | 규칙 → Claude Sonnet(선택) | 유사도 검사 유지 |
| 12 답변 변화 비교 | `[PARTIAL]` `compareTransfer` | 같은 루브릭 비교, 판단 보류 | 영속 저장(`STORE=file`, 삭제 연동 P0-2) | 규칙 | 학습 효과 주장 금지 |

### 16.2 운영자(월간 역량) 흐름 4단계

| 단계 | 현재 구현 | 목표 동작 | 누락 | 비고 |
|---|---|---|---|---|
| 웹 조사·자료 등록 | `[PARTIAL]` 관리자가 직접 입력(`/admin/trends` 초안, D7 편집기) | 허용된 공개 자료 수집·등록 | 트렌드용 수집기 없음 | 수집기는 기관 출처용(C2) |
| 근거·신선도 검토 | `[PARTIAL]` 관리자 검토 체크리스트 UI(D7)·출처≥1 규칙, 발행일·반복성·편향 자동 검토는 `[TODO]` | 출처·발행일·반복성·편향 검토 | 검토 데이터·자동화 | P2 |
| 관리자 승인 | `[PARTIAL]` 공개 시 `approved_by` 기록 | 역할 기반 승인 | 역할 모델 없음(단일 공유 토큰) | DEBT-2 |
| 월간 역량 게시 | `[PARTIAL]` 공개·공개 중단·롤백·구버전 보존·공개본만 노출·출처·코멘트 필수(BUG-5 수정)·질문 보조 1개 반영 | 분야별 최대 3개+출처+코멘트 | 평가 연결 `[TODO]` | P1-5 |

### 16.3 하위 분기·루프 대조

| Figma 분기 | 현재 |
|---|---|
| 자소서 원문 근거 | `[PARTIAL]` 규칙 기반 주장 원문 span(공고 키워드 span 포함), 한국어 실사례 정확도 미측정 |
| 미확인 / 수집 실패 | `[PARTIAL]` 수집기가 `official_verified/unavailable/stale/conflict`를 분리(스텁 시험만), 기관 프로필에 "일반 템플릿" 폴백 표시 |
| 실데이터 처리 차단 | `[PARTIAL]` 위조 플래그 우회 수정(P0-1)·동의 428·게이트의 동의/연령 차단. 연령은 자기 신고 |
| 질문별 근거 연결 | `[DONE]` 지원서 주장·기관 질문의 근거 ID·`source_status`(질문 계획 API) |
| 규칙 평가 ≠ AI 평가 | `[DONE]` UI 고지·API `evaluator` 표기 일치(BUG-6 수정) |
| 새 문항 유사도 검사 | `[DONE]` `questionSimilarity` ≥0.55 거부 |
| 비교 가능 여부 판정 | `[DONE]` 판단 보류 조건(동일 질문·유사 질문·루브릭 버전 불일치·근거 부족) |
| 트렌드 대체 경로 | `[PARTIAL]` 공개본 없으면 `unavailable`, 공개본은 질문 보조 1개로만 반영 |
| 재검증 루프 | `[PARTIAL]` 재연습 반복 가능, `STORE=file`이면 기록 유지(기본 memory는 소실) |

## 17. 변경 요약 (v1.0.0 → v1.1.0 → v1.2.0)

**v1.2.0 / WP-E4 (문서 정합).** §7·§10~§14·§16 상태를 `aa6d0cc`의 코드·새 테스트 실행(251 pass/0 fail, E2E 99 ok)에 맞췄다. 줄 번호·옛 `tests/run.mjs` 번호 참조를 현재 모듈·테스트 파일 경로로 바꾸고, 해소된 BUG/DEBT(BUG-5·7·9, DEBT-4·5)를 증거와 함께 닫았으며 열린 항목(DEBT-1·2·7·9·10)과 신규 부채(DEBT-11~14)를 기록했다. 상태는 증거 없이 올리지 않았다. 코드·테스트는 수정하지 않았다.

**v1.1.0 이후 구현 변경(2026-10-29, 그룹별, WP ID·커밋).** 모든 항목은 Mock·스텁 `fetch`·가짜 키로만 시험했고 **실호출은 하나도 실행하지 않았다.**

- **P0 보안·기준(P0-1 `480b697`, P0-2 `14b4265`, P0-3 `f2b5f3e`, P0-6 `9d08110`):** 위조 `synthetic`/`free_test` 무시(서버 상태 기반 공급자 선택, 위조 시 외부 호출 0건), 세션·계정 삭제 시 전이 작업·내보내기·재작성 연습·이의 제기 파기, 지원서 주장→질문→보고서 `claim_links` 1차(규칙 기반), 관리자 토큰 필수·`/metrics`·`/diagnostics` 관리자 전용·내장 개발 토큰 제거. 한계: 실제 로그인 없음.
- **Track A 플랫폼:** A0 `e417484` 테스트를 `tests/{helpers,api,domain}`로 동작 불변 분리 · A1 `559dc98` 플랫폼 중립 핸들러·Node 어댑터·`Store` 계약·`Idempotency-Key` 재생·세션별 쓰기 직렬화 · A2 `4881568`(+`62d2812`) `STORE=file` 영속·만료 정리·원장 월 경계 · A3 `f0a9058` Workers 어댑터·DO Store·`DecompressionStream` 추출(**런타임 미검증**) · A4 `fe06d70` `API_BASE`·CORS 허용 목록·번들 비밀 스캔·`pages.yml`(**배포 미실행**).
- **Track B AI:** B1 `cf95781`(+`adf2a02`) 공급자 registry·gate·call 래퍼, `provider_trace`, `GET /providers/status`, 429 정적 폴백, 보고서 `evaluator`(BUG-6·8, DEBT-3·6 해소) · B2 `d585161` DeepSeek 꼬리질문 어댑터·검증기·공급자별 월 상한 · B3 `f76491a` Claude 주장 추출 어댑터(마스킹본만·원문 일치·규칙 하한선) · B5 `6ae151b` Groq STT 계약 시험·`tools/stt-smoke.mjs`(수동) · B6 `202a8b8` `POST /sessions/:id/tts`·ElevenLabs 어댑터(세션 문장만, 204 브라우저 폴백) · B7 `6ae151b` 골든 30건 불변식 하니스·사람 평가 템플릿. 한계: 신규 공급자 요청 형태·모델 ID·가격·약관 `[UNVERIFIED]`, 월 상한 비영속.
- **Track C 제품 로직:** C1 `4f4c23a` 문서 종류·revision·BUG-9·CID PDF 명시 실패 · C2 `adf8c3c` 공식 자료 수집기(기본 꺼짐, 주입 fetch/dns 시험만) · C3 `91318cf` 트렌드 규칙(BUG-5)·공개 중단·트렌드 보조 질문 · C4 `047d0d3` 전이 질문 은행 15개(BUG-7) · C5 `f1e86e8` 이름·학교·주소 PII 휴리스틱 · C6 `e2e6f7e` 합성 fixture·`POST /consents`·428 `consent_required` · C7 `ea43252` 문서 기반 주장·panel/technical 주장 질문·정확도 코퍼스 · C8 `b3fccf5` `GET /profiles/:id/plan`·`PATCH /profiles/:id/claims/:claimId` 제외(승인 시 동결).
- **Track D UI:** D1 `c4a859f` `public/app.js` ES 모듈 분리 · D2 `aa11c0c` 토큰·컴포넌트·`core/copy.js` 금지 표현 린트 · D3 `f863841` 지원 정보 · D4 `f06e922` 근거 확인 · D5 `ee178e4` 설정·면접실(provider 요약·복원·음성 상태 머신) · D6 `1c03f7b` 보고서·재연습 · D7 `e73aac7` 기록·관리자 · D9 `056a73a` 대시보드·라우트 가드·복원. 실키·실기기 마이크·TTS 미검증.
- **Track E:** E1 `8a09a70` `npm run e2e`(Playwright 자동 탐색·브라우저 빌드 불일치 폴백) · 기획서 `b329896`(`docs/plan`) · E4 이 변경.
- **미착수:** B4(Claude 평가), E2의 실험 수행. **부분:** D8·E3(위 §10 참조).

**v1.1.0 점검 변경(이력).**

- 헤더에 버전·점검 범위를 갱신하고 §0에 상태 표기 표준을 추가했다.
- §1.5(개요·SDGs 가설·사용자·시나리오), §2.8(면접 유형별 동작), §4.2(현재 vs 목표 공급자·마이그레이션), §4.4(AI 호출 구조), §5.1(현재 구현 대조), §7(실제 구현 상태 전면 개정), §10~§17을 추가·개정했다.
- 기존 v1.0.0 §7의 "PDF/DOCX 지원서 업로드 미확인/현 UI 미제공"은 코드상 **구현됨(부분)**으로, "월간 트렌드 승인·버전 미구현"은 **부분 구현(관리자 초안·공개·롤백·영속)**으로, "90초 재연습 일부 구현 — 다른 질문 간 비교 추가"는 **전후 비교 골격 구현(Mock)**으로 정정했다.
- 변경·삭제: "Groq GPT-OSS 120B 성능 비교 후보"는 개발자의 목표 구성(§4.2)에서 제외되어 이력으로만 남겼고, "Gemini↔GPT-OSS 블라인드 A/B" 항목은 목표 구성 기준의 모델 비교로 바꿨다. §1~§6·§8·§9의 제품 원칙·보안 불변 조건은 **완화하지 않고 유지**했다.
- (이력) 당시 신규 목표 구성(DeepSeek·Claude·ElevenLabs·Pages·Workers)은 `[TODO]`였다. 현재 상태는 §7.2·§12.1을 따르며, 어댑터·배포 준비 코드는 있으나 스텁 시험만이고 실호출·구매·결제·배포 완료가 아니다.

---

**기술·제품 최종 판단 기준:** 사람인의 일반 모의면접 기능을 복제하는 데 우선순위를 두지 않는다. **지원서 주장 검증 → 부족한 역량의 근거 기반 코칭 → 처음 보는 질문에서의 재검증** 루프를 가장 먼저 완성한다.
