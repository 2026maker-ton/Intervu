# Intervu 구현 명세 v1.0

작성·조사 기준: 2026-10-23, Asia/Seoul. 상태: 구현 착수용 설계. 실행 코드·운영 검증 결과가 아니다. 제품 범위와 근거는 `master-plan.md`, 조사 원문은 `research-*.md`를 함께 읽는다. 충돌하면 본 명세의 인터페이스와 `master-plan.md`의 확정 범위를 우선한다.

## 1. 구현 경계와 기본값

- 대상: 한국어로 신입 면접을 준비하는 만 19세 이상 개인. 초기 공개 범위는 일반기업·공공기관 1:1 인성/상황/기초 직무 면접과 블라인드 설정이다.
- 모드: `interview_type` 6종(`general`/`technical`/`discussion`/`pt`/`situational`/`panel`) + 독립 축(블라인드·persona·role·input·duration). 레거시 `mode: discussion_beta/pt_beta/structured`는 `interview_type`으로 정규화되고, 미지원 `interview_type`은 422다. UI 카탈로그는 `GET /api/v1/interview-types`가 단일 출처다. 음성은 브라우저 SpeechRecognition → 텍스트 전송(원음 미전송)이며 미지원 브라우저는 텍스트로 폴백한다.
- 성향: `supportive`, `standard`, `challenging`. 성향은 질문 표현·추가 확인 강도만 변경한다. 평가 기준·점수 보정값은 동일하다.
- 세션: 5/10/15분 선택(3/4/5문항). 15분 모드의 시간 배분은 안내 1분, 본질문 5개와 최대 꼬리질문 3개 12분, 종료 2분. 토론은 사용자 발언 기회 최소 4회(`action: discussion_complete`로 종료), PT는 `pt.prepare`(brief→prepare→present→qa) 단계 명령으로 진행한다. 질문 수보다 시간 상한 우선. 실제 발화량은 비용 모델의 별도 가정이다.
- 인터뷰 중 정답 예시를 보여주지 않는다. 종료 후 증거→개선 행동→같은 역량 재연습 순서로 보여준다.
- 카메라·얼굴·감정·성격 추정, 합격률, 타 지원자 백분위, 실면접 중 답변 대행은 범위 밖이다.
- 공고 입력은 텍스트 붙여넣기부터 구현한다. 파일·URL 자동 수집은 공개 MVP에 포함하지 않는다. URL 필드는 출처 표시용이며 서버가 임의 URL을 요청하지 않는다.
- 신규 계정에 10분 음성 체험 1회와 3문항 텍스트 연습 1회. 반복 무료 제공·가격은 파일럿 실측 후 결정한다. 서버 예산이 우선하며 광고된 무제한은 없다.

## 2. 화면과 사용자 흐름

| 경로 | 입력/행동 | 완료 조건·오류 UI |
|---|---|---|
| `/` | 사례 질문 1개와 가상 보고서, 이용 대상 안내 | 실제 평가인 것처럼 가상 자료 표시 금지; 모든 데모에 예시 배지 |
| `/auth` | 이메일 링크 로그인, 만 19세 이상 확인 | 인증 만료 재발급, 60초 발송 간격; 정확한 생년월일 수집 안 함 |
| `/setup` | 기관 종류/이름, 직무, 공고 본문, 선택 경험 3개 | 이름 100자, 직무 100자, 공고 20,000자, 경험 각 2,000자; 필수 개인정보 감지 후 수정 권고 |
| `/profiles/:id/review` | 공고에서 추출한 직무·역량·면접 형식 확인 | 출처 문장·직접입력·일반 템플릿 구분; 사용자 승인 전 세션 생성 불가 |
| `/sessions/new` | 시간, 성향, 블라인드, 음성/텍스트 | 예상 이용량, 보관 기간, AI 생성·평가 한계, 음성 외부 처리 안내 |
| `/device-check` | 마이크 권한, 10초 테스트, 출력 확인 | 권한 거부 시 텍스트 전환; 테스트 음성은 즉시 폐기 |
| `/sessions/:id` | 자막, 남은 시간, 말하기/답변완료/다시듣기/일시정지/종료 | 말하기와 AI 재생 상태를 색상 외 텍스트로도 표시; 키보드·스크린리더 지원 |
| `/sessions/:id/report` | 근거 발언, 역량별 관찰, 개선점 최대 3개 | 일부 실패해도 완료된 항목 표시; 점수 보류 이유 표시 |
| `/practice/:id` | 약점 1개에 대한 새 질문 답변 | 원래 평가 수정하지 않고 새 attempt로 기록 |
| `/history` | 세션·동일 역량 변화 | 다른 모드/루브릭 버전/난이도 점수를 한 선으로 연결하지 않음 |
| `/settings/data` | 다운로드, 세션 삭제, 계정 삭제 | 삭제 진행 상태와 보관 예외·백업 만료 안내 |

실제 표시 예: “이 공고에는 토론면접 여부가 명시되어 있지 않습니다. 일반 1:1 연습으로 구성합니다.” 기관명만 주어진 경우에도 일반 연습은 가능하지만 ‘기관 맞춤 검증 완료’ 배지를 주지 않는다. 지원 직무가 고도 전문직이면 일반 역량만 평가한다고 표시한다.

## 3. 공고→면접 계획 생성

1. 입력 길이·형식·개인정보를 검사한다. 전화/이메일/주민번호 후보를 클라이언트와 서버에서 마스킹한다. 이름·학교명은 사용자가 확인하며 완전 자동 익명화를 보장하지 않는다.
2. 공고 본문을 불변 `document_version`으로 저장한다. 해시와 입력자, `source_url`, `published_at`(모르면 null), `retrieved_at`, 권리 근거를 기록한다. 사용자가 붙여넣은 URL은 `user_supplied` 상태이지 공식 검증 완료가 아니다.
3. 모델이 `requirements[]`, `competencies[]`, `format_claims[]`, 각 항목의 `source_span`을 JSON으로 추출한다. 출처 구간 없는 기관 고유 주장은 거부한다.
4. 프로그램이 구간 인덱스와 원문 일치를 검증한다. 역량을 승인된 분류로 매핑한다. 일치 실패는 일반 템플릿으로 내리고 화면에 표시한다.
5. 사용자가 확인한 `profile_version`을 만든다. 기본 역량은 질문 적합성, 경험·근거 구체성, 논리·판단, 성찰·전이 4개다. 직무 정확성은 검수된 정답 자료가 있는 항목만 추가한다.
6. 서버가 검수된 질문 풀에서 역량별 1개씩 선택한다. 동일 세션 내 중복과 최근 3회 동일 질문은 피하되, 질문 풀이 부족하면 중복 사실을 표시한다. 질문 풀 버전과 random seed를 저장한다.
7. 모델은 질문을 공고 문맥에 맞춰 표현한다. 사실 검증·금칙 질문 검사 후 확정한다. 10초 내 생성 실패 시 일반 템플릿으로 대체한다. 질문을 만드는 모델에게 평가 정답이나 최종 점수를 맡기지 않는다.

공개 초기 콘텐츠: 일반/공공사무 상황형 중심 40개 질문, 4역량×기본질문 5개+꼬리질문 유형 5개를 사람이 검수한다. 이는 콘텐츠 제작 목표이며 현재 준비 완료 수량이 아니다. 기술 직무 확장은 해당 분야 검수자 확보 후 별도 question pack으로 추가한다.

## 4. 진행 상태와 단일 진실 원천

세션 상태: `draft → ready → active ↔ paused → completing → completed`. `draft/ready/active/paused/completing → aborted` 가능. 삭제는 별도 `deleting → deleted` 상태로 모든 동작보다 우선한다. 오류 자체는 세션을 종료시키지 않고 마지막 확정 상태와 `degraded_reason`을 보존한다.

턴 상태: `queued → ai_speaking → user_listening → transcribing → committed → deciding → done`. `ai_speaking → interrupted`일 때 듣지 않은 AI 내용은 다음 질문 문맥에서 제외한다. 사용자 발화 중 ‘다시듣기’는 녹음을 멈춘 뒤 확정/폐기를 고르게 한다. `committed` 이후 수정은 원문 덮어쓰기가 아니라 새 transcript revision이다.

서버의 `session.version`과 증가하는 `event.seq`가 상태 기준이다. 타이머는 `active_elapsed_ms`를 서버 시계로 누적한다. 클라이언트 시간이 달라도 15분 상한이 달라지지 않는다. AI/사용자 발화와 정상 처리 대기는 active 시간에 포함하고, 장애·명시적 pause 시간은 제외한다. 발화 중이 아닌 입력대기 유휴 2분 후 paused, 최초 시작 24시간 내 재개 가능. 총 pause 10분을 넘으면 재개한 보고서에 ‘중단 후 재개’ 표시를 남기고 연속 실전 결과와 직접 비교하지 않는다. 시작한 면접의 모델·루브릭·공고 버전은 중간 변경하지 않는다.

명령 처리 순서: 인증→소유권→삭제상태→중복명령 확인→예상 버전 확인→예산 확보→짧은 DB 트랜잭션으로 상태/이벤트/작업 저장→커밋→외부 호출. 외부 API 응답을 기다리는 동안 DB 행 잠금을 유지하지 않는다. 호출 결과는 세션 버전과 generation epoch를 재검사하여 폐기된 턴의 늦은 응답을 화면에 보내지 않는다.

## 5. 음성 파이프라인

기본 구현은 음성인식(STT)→텍스트 대화 모델→음성합성(TTS)의 모듈식 구조다. 처음부터 직접 음성 모델에 의사결정과 평가를 모두 위임하지 않는다. 공급사 선택과 단가는 `research-technology.md` 및 `master-plan.md`의 최종 결정을 따른다.

1. 사용자가 시작을 누른 뒤 HTTPS의 `getUserMedia`로 마이크를 연다. mono PCM16 16kHz로 변환하여 100ms 프레임을 WSS 전송한다. 브라우저 장치 샘플레이트가 48kHz여도 서버 계약은 동일하다. AudioWorklet 미지원 시 MediaRecorder 턴 업로드 방식으로 전환하고 지연 증가를 알린다.
2. 권한을 준 동안에도 사용자 답변 상태에서만 오디오를 전송한다. 기본은 턴 단위, 사용자가 답변완료 버튼으로 끝낼 수 있다. 선택적 VAD는 1.2초 무음에 종료 후보를 띄우고 2초 후 확정; 최대 답변 120초. 이 수치는 튜닝 초기값이다.
3. AI 음성 재생 중에는 기본 녹음을 닫는다. ‘끼어들어 답하기’ 버튼/단축키를 누르면 출력 정지, generation epoch 증가, 공급사 취소, 버퍼 폐기 후 녹음 시작. 자동 양방향 끼어들기는 AEC와 실측을 통과한 후 확장한다. MVP가 사람과 동일한 완전 양방향 대화라고 홍보하지 않는다.
4. 기본 경로는 서버가 현재 턴 PCM을 메모리에 조립하고 답변완료 후 WAV로 Groq REST 전사에 한 번 제출한다. 120초/8MB 중 먼저 닿는 상한 적용. 발화 중 실시간 자막은 없고 완료 후 final 자막을 제공한다. 스트리밍 플래그를 켜는 Nova-3 경로에서만 partial 자막을 제공하며 final만 저장한다. 음성 중단/정정/인식불명 구간을 메타데이터로 유지한다. 공급사 confidence가 없으면 임의 신뢰도 숫자를 생성하지 않는다.
5. 확정 답변→진행기 결정→검증된 AI 텍스트→문장 단위 TTS. 잘못된 JSON·금칙 발언이 사용자에게 흘러가지 않도록 검증 전 텍스트/음성을 재생하지 않는다. 낮은 지연과 안전 검증 사이의 비용은 성능 게이트로 판단한다.
6. 기본 WaveNet은 문장 전체 합성 결과를 받은 뒤 sentence_id 단위로 전송한다. 청크 전송은 전송 최적화이며 공급사 실시간 합성이라고 표현하지 않는다. Chirp3 스트리밍은 별도 플래그다. 현재 epoch만 재생하고 재생 ack를 받아 들은 문장만 컨텍스트에 포함한다. ack가 불명확하면 재연결 후 해당 문장을 다시 제공하고 반복 표시한다.

개별 턴 STT 최종 결과 4초, LLM 4초, TTS 첫 소리 3초 제한과 별도로 전체 처리 10초 hard deadline을 둔다. 3초에 ‘답변을 처리하고 있습니다’ 자막, 8초에 텍스트 전환 선택. 10초에 기존 generation을 취소하고 epoch를 증가시킨 뒤 승인된 후속 질문 또는 재답변을 제안한다. 늦은 원응답은 폐기한다. 정확한 E2E 기준은 사용자 답변 종료→AI 첫 유효 음성 p50≤2.5초/p95≤5초를 **목표**로 하며 달성 사실이 아니다.

WSS ping 20초, pong 10초 제한; 재연결 1/2/4/8초+jitter, 30초 후 paused. 오디오 재전송은 현재 턴 클라이언트 메모리 버퍼 10초까지, 이미 ack된 프레임 제외. 서버는 1초마다 ephemeral `audio.ack {epoch,last_contiguous_frame_seq}`를 반환한다. commit은 `last_frame_seq`까지 모두 수신해야 승인하며 누락 범위 재요청 후 5초 내 복구 못하면 재답변으로 처리한다. 서버 재시작으로 현재 턴 WAV 버퍼가 소실되면 미확정 음성은 사용자에게 재답변 요청하고 추정 복원하지 않는다. 새로고침 시 마이크를 자동 켜지 않는다.

## 6. 면접관과 토론 참여자의 내부 동작

### 6.1 1:1 진행기

모델 출력은 `{action, question_id, target_competency, followup_reason, utterance, evidence_turn_ids}`. action은 `ask_followup`, `next_question`, `clarify`, `finish`만 허용한다. 서버는 남은 시간, 꼬리질문 한도 3회, 동일 질문 꼬리질문 1회, 최대 AI 발화 240자, 이미 평가한 역량, 사실 근거를 점검하여 최종 action을 결정한다.

꼬리질문 우선순위: 불명확한 인식→질문과 무관한 답변→본인 역할 없음→판단 근거 없음→결과/성찰 부족. 인식 불명은 역량 부족으로 계산하지 않는다. 정보가 충분하면 억지 꼬리질문 없이 다음 질문으로 이동한다. 친절형은 답변을 기다리고 질문을 재표현하지만 사례 답안을 대신 말하지 않는다. 도전형은 “그 대안을 택하지 않은 이유는 무엇인가요?”처럼 주장과 근거를 검증하며 모욕·인신공격·출신 질문은 금지한다.

### 6.2 혼자 하는 토론 베타

사용자 1명+AI 참가자 2명+코드 기반 사회자. AI 이름 옆에 항상 AI 표시. 서로 독립 모델 인스턴스를 계속 호출하지 않고, 한 번에 선택된 발화자 1명의 관점만 생성한다. 참가자 A는 실행 가능성, B는 이해관계자 영향을 주로 확인하되 특정 성별·학력·성격을 고정하지 않는다. 역할과 관점은 세션 seed에 따라 바꾼다.

15분 템플릿: 자료읽기 2분, 3인 입론 각 1분(3분), 쟁점 교환 6분, 합의안 3분, 마무리 1분. AI 발언은 35초/240자 이내, 두 AI 연속 발언 뒤에는 반드시 사용자 차례. 사용자가 발언권을 요청하면 현재 문장 후 우선 배정한다. 자동 중첩 발화는 제공하지 않는다. 사용자에게 최소 4번 응답 기회를 주고 주지 못하면 협업 점수를 보류한다.

각 발언은 `{speaker_id, stance, claim_id, responds_to_turn_id, stance_change_reason}`를 가진다. 사회자는 `agenda`, `unresolved_claims`, `agreed_points`, `remaining_time`만 유지한다. AI가 가상의 통계·기업 사실을 말하면 제거하고 제공된 자료나 ‘가정’으로만 표현한다. 주제는 사람이 작성한 가상 사례 5개로 시작한다. 찬반 승패를 평가하지 않는다. 상대 주장 정확한 요약, 근거 있는 반박, 질문, 양보/통합안을 본다. 두 AI가 사용자를 동시에 공격하는 전개는 금지한다.

### 6.3 PT·다대다 확장 계약

PT 베타는 검수된 1페이지 과제→준비 3분→발표 3분→Q&A 6분→종료. 초기 파일 업로드 없이 텍스트 개요만 입력한다. 발표 타이머·질문 타이머를 분리하고 주장-자료-실행계획을 평가한다. 슬라이드 시각디자인이나 얼굴을 평가하지 않는다. 자료 OCR·PDF 파싱은 별도 보안·정확도 게이트 뒤 추가한다.

다대다는 후보별 turn ledger와 발언 순서, 면접관별 역량 배정을 확장한다. AI 지원자와 사용자 점수를 비교하는 가상 순위는 만들지 않는다. 여러 실제 사람이 접속하는 기능은 미디어 서버·동의·신고·중재가 추가되는 별도 프로젝트다.

## 7. 평가와 피드백 데이터 흐름

`session.finish` 명령이 확정된 transcript revision 목록을 동결하고 평가 job을 만든다. 실시간 면접관과 평가기는 별도 프롬프트·호출이다. 동일 공급사라도 역할 분리 자체가 독립적 타당성을 보장하지는 않는다.

평가 순서: 평가 가능 여부→관찰 근거 추출→루브릭 앵커 매칭→반증/인식오류 검사→피드백 생성→서버 검증. 출력마다 `turn_id`, `revision`, `start_cp`, `end_cp`, `quote`, `rubric_anchor_id`가 필수다. 인덱스는 NFC 정규화 후 Unicode code point 기준이며 JS UTF-16 인덱스와 혼용하지 않는다. quote와 해당 부분문자열이 정확히 같지 않으면 근거를 무효화한다.

1~4단계 앵커(공통):

| 역량 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| 질문 적합성 | 질문과 다른 주장만 함 | 일부 관련하나 핵심에 답하지 않음 | 핵심 질문에 직접 답함 | 핵심과 제한·조건까지 분명히 함 |
| 경험·근거 구체성 | 주장만 있음 | 사례가 있으나 역할/행동이 불명확 | 본인 행동과 관찰 결과가 구체적 | 대안·기여·결과의 한계까지 구별 |
| 논리·판단 | 결론과 근거 연결이 모순 | 이유는 있으나 중요한 연결 생략 | 선택 이유와 근거가 연결 | 대안·반례·상충 기준을 비교 |
| 성찰·전이 | 성찰 질문에 검토 없이 반복 | 일반 교훈만 언급 | 경험에서 바꿀 행동 설명 | 다른 조건에 적용할 기준과 한계 설명 |

`not_observed`는 0점이나 1점이 아니다. 해당 역량을 묻지 않았거나 자료 부족/STT 오류면 보류한다. 각 역량은 서로 다른 유효 응답 2개 이상에서 관찰된 경우에만 수준을 공개하고, 그 전에는 발언별 관찰만 표시한다. 답변별 수준의 중앙값을 사용하며 짝수 응답은 .5 표시 가능; 원자료의 수준 분포도 함께 제공한다. 전체 총점은 MVP에서 제공하지 않는다. 공고와 무관한 매끄러운 말투에 가산점을 주지 않는다.

직무 정확성은 검수된 reference pack이 존재할 때만 주장별 supported/contradicted/unverifiable로 분리한다. LLM 기억에 기반한 기술 정답 판정은 하지 않는다. 말 속도·침묵 시간은 선택 관찰이며 점수에 합산하지 않는다. 방언·억양·언어 장애와 무관하게 내용 기준 적용. 텍스트 모드에서 음성 지표는 산출하지 않는다.

피드백 카드: (1) 관찰 (2) 원문 근거 (3) 왜 개선이 필요한지 (4) 다음 답변에서 할 행동 하나 (5) 90초 재연습 버튼. 예시 답변은 사용자 사실을 지어내지 않고 `[실제 결과를 입력하세요]` 빈칸 형태로 제공한다. 재연습은 같은 역량의 새 문항을 주고, 동일 문항 반복은 ‘암기 효과 가능’ 표시. 수정 전·후 차이는 같은 루브릭 버전 내에서만 비교한다.

원문 수정은 명시적 사용자 동작으로 revision을 늘린다. `reason=stt_correction`만 이전 보고서를 superseded로 만들고 ‘사용자 전사 교정 후 평가’ 배지를 붙인다. 원음이 없으면 실제 발화와 일치함을 검증했다고 주장하지 않는다. `content_rewrite`는 별도 practice attempt로 분기하여 실시간 수행 기록을 덮어쓰지 않는다. 1회 무료 재평가 후 추가는 예산 정책 적용. 모델 출력 보정은 1회만 허용하며 실패하면 점수를 꾸며내지 않고 transcript+검증된 관찰만 제공한다.

## 8. 아키텍처와 모듈 경계

```text
Browser (React/TypeScript)
  ├─ HTTPS REST: 계정·공고·보고서·삭제
  └─ WSS: 명령·오디오·자막·AI 출력
       ↓
Node/TypeScript API + session controller (1 container initially)
  ├─ Profile compiler / Question pack / Persona policy
  ├─ Deterministic state machine / Budget reservation
  ├─ Provider adapters: STT / LLM / TTS
  └─ Postgres transaction → events + jobs + usage
       ↓
Worker (same image, separate process when deployed)
  ├─ evaluation / retry / delete / retention sweep
  └─ PostgreSQL + private object storage + managed auth
```

비교 후 선택: SPA는 면접 앱 자체의 SEO 중요도가 낮고 음성 상태를 브라우저에서 관리하므로 React+Vite+TypeScript. API는 Node+Fastify+ws로 브라우저와 타입 공유. Python/FastAPI도 가능하지만 자체 음성 모델을 운영하지 않는 초기에는 두 언어 유지 비용을 피한다. 저장은 PostgreSQL, 인증·개인 저장소는 Supabase로 구축 시간을 줄인다. ORM은 Drizzle+SQL migrations, 입력 검증은 Zod. 무거운 agent framework, vector DB, Kubernetes, Redis는 초기 필수 아님. 채택 버전은 구현 첫날 지원 중 안정판을 확인하고 lockfile에 고정한다.

호스팅 기본안: Render paid web process+worker, Supabase 단일 프로젝트. 무료 인스턴스는 데모/개발 전용. 웹소켓 연결은 배포 시 끊길 수 있어 이벤트 복원이 필수다. [Render WebSocket 문서](https://render.com/docs/websocket). 선택 근거는 상태형 연결·배포 단순성이다. 국내 리전 데이터 고정이 계약상 필요하면 같은 컨테이너를 국내 리전 VM/관리형 DB에 배치하며 비용을 다시 계산한다. 특정 호스팅 가입·배포는 본 작업에서 수행하지 않는다.

`jobs`는 Postgres `FOR UPDATE SKIP LOCKED`로 claim한 후 트랜잭션을 종료하고 실행한다. lease 60초, 20초 heartbeat, 만료 시 재claim, 지수 backoff 5/30/120초, 최대 3회 후 dead letter. at-least-once이므로 결과 unique key로 중복 반영 방지. [PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.html). 세션별 단일 owner lease와 fencing epoch를 사용하고, 초기 단일 API 인스턴스에서도 DB 중복 방지를 구현한다.

## 9. 저장 구조와 권한

| 테이블 | 핵심 필드 | 제약·인덱스 |
|---|---|---|
| profiles | id, owner_id, org_type, target_name, role, created_at | owner_id+created_at |
| profile_versions | id, profile_id, version, source_text, source_url, source_status, extracted_json, approved_at, content_hash | unique(profile_id,version), 불변 |
| consents | id, owner_id, purpose, policy_version, granted_at, withdrawn_at | 처리/선택 보관/연구 동의 분리 |
| sessions | id, owner_id, profile_version_id, mode, persona, blind, state, version, active_elapsed_ms, seed, policy_snapshot, expires_at | owner_id+created_at; 활성 세션 사용자당 1개 |
| turns | id, session_id, ordinal, speaker_id, question_id, competency, status, epoch, spoken_ms | unique(session_id,ordinal) |
| transcript_revisions | id, turn_id, revision, normalized_text, origin, quality_flags, created_at | unique(turn_id,revision) |
| session_events | session_id, seq, command_id, type, sanitized_payload, created_at | PK(session_id,seq), command_id는 nonunique index; 1명령 다수 이벤트 가능 |
| commands | session_id, command_id, request_hash, response_json | unique(session_id,command_id); 동일키 다른 본문 409 |
| evaluations | id, session_id, input_hash, rubric_version, model_version, status, report_json, superseded_by | unique(session_id,input_hash,rubric_version) |
| evidence | evaluation_id, turn_id, revision, start_cp, end_cp, quote, anchor_id | 동일 세션/동결 revision 검증 |
| practice_attempts | id, owner_id, origin_evaluation_id, competency, session_id | 삭제시 사용자 데이터 함께 제거 |
| model_calls | id, session_id, operation_key, attempt, provider_request_id, model, status, usage_json, price_version, estimated_cost, actual_cost | operation_key+attempt unique |
| budget_reservations | id, owner_id, session_id, limit_scope, amount_usd, state, expires_at | 사용자/전체 budget row lock |
| jobs | id, kind, dedupe_key, payload_ids, state, run_after, lease_until, attempts, deletion_epoch | unique(kind,dedupe_key), ready+run_after partial index |
| deletions | id, owner_id, requested_at, epoch, state, completed_at | 작업별 잔여 시스템 상태 |
| assets | id, session_id, object_key, retention_until, consent_id | private bucket, raw audio 기본 미저장 |
| content_packs | id, version, status, rights, source_refs, json | 게시 버전 불변, 운영자만 수정 |

`owner_id`는 요청 본문에서 신뢰하지 않고 검증한 인증 subject에서 설정한다. 모든 사용자 테이블에 RLS, 최소 grant, 다른 사용자 접근 거부 테스트. 내부 jobs/model_calls/budgets는 공개 schema 접근 권한을 철회한다. 사용자 브라우저에서 service-role 키 사용 금지. API가 elevated key로 접근하는 경로는 RLS가 대신 막아주지 않으므로 모든 쿼리에 owner scope를 강제한다. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 10. HTTP 계약

공통: JSON UTF-8, `/api/v1`, bearer access token, request_id. 쓰기 요청 `Idempotency-Key` 필수(UUID); 24시간 보관, 동일키·상이한 본문 409. 오류 `{error:{code,message,retryable,request_id,details}}`. 401 인증, 403 권한, 404 비소유 자원 포함, 409 상태/중복, 422 검증, 429 쿼터(초 단위 Retry-After), 503 공급사/서버 중단. 공개 오류에 원문·키·공급사 내부 로그를 포함하지 않는다.

| 메서드·경로 | 요청 | 응답/동작 |
|---|---|---|
| POST `/profiles` | org_type,target_name,role,source_text,source_url?,experiences[] | 201 id, version_id, status=extracting |
| GET `/profiles/:id` | 없음 | 현재 추출 상태/주장·근거 목록 |
| POST `/profiles/:id/approve` | version_id, corrections | 200 approved version; 기존판 변경 금지 |
| POST `/sessions` | profile_version_id, mode, persona, blind,duration_minutes,input_mode,consent_version | 201 id,state=ready,limits; 예산 원자 예약 |
| POST `/sessions/:id/connect` | last_seq | 200 one_time_ticket,expires_in=30,ws_url; ticket은 로그 제외 |
| GET `/sessions/:id` | 없음 | state,version,last_seq,active_elapsed_ms |
| POST `/sessions/:id/commands` | command_id,expected_version,type,payload | 202 command_id; WS 끊긴 경우 대체 경로 |
| GET `/sessions/:id/events?after_seq=N` | cursor | 이벤트 최대 100개,next_cursor; 오디오 포함 안 함 |
| GET `/sessions/:id/report` | 없음 | 200 report 또는 202 pending/retry_at |
| POST `/turns/:id/revisions` | base_revision,text,reason=stt_correction\|content_rewrite | 201 revision 또는 practice_attempt_id; 원문 유지 |
| POST `/evaluations/:id/appeals` | category=stt\|fact\|evidence\|inappropriate,evidence_id?,comment?(500자) | 201 appeal_id,state=received; 재평가/수동검토 구분 |
| POST `/practice-attempts` | evaluation_id,competency_id | 201 새 3분 세션 id |
| GET `/sessions?cursor=` | 없음 | 소유자 기록 최대 20개 |
| DELETE `/sessions/:id` | 없음 | 202 deletion_id; 즉시 접근/외부호출 차단 |
| POST `/exports` | format=json | 202 job_id; 결과는 10분 private signed URL |
| DELETE `/account` | 최근 재인증 토큰 | 202 deletion_id |
| GET `/deletions/:id` | 없음 | 상태, 잔여 백업 만료일; 삭제 후 제한 토큰으로 조회 |

## 11. WSS 계약

연결 후 첫 메시지에서 30초 단일사용 ticket 인증, 인증 전 5초 내 실패 종료. URL query에 영구 bearer를 넣지 않는다. 허용 Origin 검사. command envelope는 `{v:1,session_id,command_id,expected_version,type,payload}`. 서버 이벤트는 `{v:1,session_id,seq,type,turn_id?,epoch?,server_time,payload}`.

클라이언트 명령: `session.start`, `session.pause`, `session.resume`, `session.finish`, `turn.start`, `turn.commit`, `turn.interrupt`, `turn.text`, `playback.ack`. `turn.start`가 승인된 turn_id/epoch를 먼저 반환한 후에만 오디오를 보낸다. 텍스트 답변 최대 4,000자. audio frame header: v:uint8, type:uint8=1, epoch:uint32 LE, frame_seq:uint32 LE, sample_count:uint16 LE 이후 PCM16 LE. 연결은 한 active turn에 귀속되어 turn_id 중복 전송 불필요. 프레임 최대 64KiB, 초당 실제 PCM 속도+20% 이상은 제한한다.

서버 이벤트: `session.snapshot`, `command.accepted`, `turn.opened`, `transcript.partial`, `transcript.final`, `assistant.message`, `audio.start`, binary audio, `audio.end`, `budget.warning`, `session.paused`, `session.completed`, `report.ready`, `error`. partial/audio는 ephemeral로 seq 재생 대상에서 제외하고 durable event에만 증가 seq를 배정한다. 이 둘을 구분하는 `durable` 필드를 실제 envelope에 필수 추가한다. 재연결 시 마지막 durable seq 이후를 보내고 최대 1,000개 초과는 snapshot으로 대체한다. 출력 오디오는 `audio.start`의 codec/sample_rate/message_id/epoch/segment_id로 해석한다.

## 12. 장애·보안·삭제

| 상황 | 동작 | 사용자 영향/비용 |
|---|---|---|
| 모델 429 | Retry-After 준수, 1회만 재시도, circuit breaker | 승인된 텍스트 질문 또는 일시정지 |
| 공급사 timeout | 성공 여부 unknown으로 usage 원장에 남김 | 같은 호출 무한 재전송 금지; 상한 예상 비용 유지 |
| TTS만 실패 | 검증된 텍스트 질문 표시 | 같은 LLM 다시 호출 안 함 |
| STT 무음/실패 | 다시 말하기/직접 입력 | 답변 역량 점수 감점 안 함 |
| 잘못된 JSON | schema repair 1회, 실패시 템플릿 | repair도 예산 집계 |
| 프롬프트 인젝션 | 문서/답변은 비신뢰 데이터로 분리, tool 실행 없음 | 점수·시스템 지시 변경 요구 무시 |
| 서버 배포/장애 | snapshot+events 복원, 미확정 턴만 재요청 | 동결 보고서 중복 생성 방지 |
| 동시 접속/더블클릭 | user active-session unique, command dedupe | 예약 중복 차감 없음 |
| 세션 시간/예산 초과 | 새 질문 생성 중지, 종료·요약 예약 사용 | 이미 확정된 답변 보존 |
| 삭제 중 평가 완료 | epoch 재검사, 결과 폐기, 저장 금지 | 삭제 데이터 부활 차단 |
| 악성 파일/URL | MVP 자동 파일/URL 수집 없음 | 후속 도입시 격리 파싱/SSRF/권리 검사 |

기본 raw audio는 서버 메모리의 전사 버퍼만 사용하고 발화 처리 후 제거한다. 보고서·텍스트는 기본 30일, 사용자가 기록 보관을 선택하면 최대 180일 후 재확인. 원문 공고/경험도 같은 만료 정책. 애플리케이션 로그는 본문 없이 request_id·오류코드·지연만 14일, 집계 비용은 식별자를 제거해 90일. 숫자는 법정 의무 기간이 아닌 제품 정책이다. 별도 법정 거래기록은 결제 도입시 법률 검토 후 분리한다.

삭제 요청 즉시 세션 cancel·토큰 취소→provider 요청 취소 가능한 범위 수행→job 취소→DB/오브젝트/캐시/파생 보고서 삭제→공급사 보관 정책에 따른 처리 상태 기록. 활성 저장소 삭제 목표 24시간. 백업의 물리 삭제는 공급사 만료주기까지 남을 수 있어 정확한 최장 기간을 배포 전 계약으로 고정한다. 복구 시 별도 tombstone을 먼저 적용한다. raw transcript를 에러추적·분석 SDK로 전송하지 않는다.

## 13. 비용·운영 통제

세션 생성 시 사용자·월 전체 budget을 같은 트랜잭션으로 예약한다. `reserved+settled+unknown`이 상한을 넘으면 신규 세션 거절. 정상 종료 시 실제 사용량 정산 후 잔액 반환. 실패 호출 비용·연결시간 과금도 집계한다. 세션당 가변비 hard cap은 절약형 $0.08(평가 $0.02/종료 $0.005 포함), 스트리밍 $0.30(평가 $0.05/종료 $0.01 포함)이다. 실제 단가/테스트 결과에 따라 가격 버전과 함께 수정하며 이 상한에 맞지 않는 경로는 비활성화한다.

로그 지표: input/output/cached/audio tokens, STT billed_seconds, TTS seconds/chars, retries, cancellation 후 과금, egress bytes, model_price_version. 공급사 usage가 늦으면 최악 추정치 유지. 예약 lease가 만료되어도 API 호출 상태 unknown이면 즉시 전액 반환하지 않고 reconciliation job으로 확인한다. 50/80/100% 예산 알림, 100%에서는 관리자도 자동 우회하지 않는다.

온콜 없이 운영하는 베타: 동시 세션 5개, 사용자 1개, 분당 신규 세션 5개. 실제 부하테스트로 상향. CPU·메모리·event loop·공급사 rate limit 모두 관찰한다. 일별 비용 대조, 주별 오류·평가 이의 검토, 월별 가격·약관·모델 지원 확인. 공급사 장애/안전사고시 음성/평가/전체 세션을 각각 끄는 kill switch를 둔다.

## 14. 저장소 구조와 완료 정의

```text
apps/web/                 화면, audio worklet, WS client
apps/api/                 REST/WSS, auth, session state machine
apps/worker/              evaluation, deletion, retention jobs
packages/contracts/       Zod schemas, generated API types
packages/domain/          transitions, rubrics, budgets, schedulers
packages/providers/       mock + STT/LLM/TTS adapters
content/packs/            source metadata, reviewed questions
db/migrations/            schema, RLS, indexes
evals/fixtures/            consented/synthetic test datasets
tests/integration/        lifecycle, isolation, billing, deletion
tests/e2e/                microphone-mocked browser journeys
```

구현 시작 순서는 `master-plan.md`의 백로그를 따른다. 첫 vertical slice는 mock provider로 공고 승인→1질문→답변→근거 보고서→삭제까지 완주하는 것이다. 실제 API 호출 전 adapter contract test와 예산 원장을 먼저 통과시킨다. 베타 완료는 기능 화면의 존재가 아니라 재연결·비용·개인정보 삭제·평가 보류 경로까지 E2E가 통과하는 상태다.

## 15. 통합 검토로 확정한 보완 계약

- 면접 설정은 `task_type=behavioral|situational|discussion|presentation`, `participant_layout=one_to_one|panel|group`, `blind_policy`, `persona` 네 축이다. 기존 `mode`는 UI 패키지 이름으로만 유지한다. MVP는 one_to_one과 behavioral/situational 조합만 공개, 베타는 discussion/group. 지원하지 않는 조합은 422다.
- 블라인드 서버 경계: 원문 source_text/experiences와 별도로 `blind_context`를 생성한다. 이름·학교·출신·성별·연령·가족 관련 단서를 마스킹하고 의미상 직무정보만 유지한다. 원문을 후속 질문/평가 프롬프트에 직접 삽입하지 않는다. 추출 단계에 전달되는 원문도 개인정보 처리 대상이고 완전 익명화가 아니다. 원문-마스킹 문서의 span mapping을 보존하고 평가 evidence는 실제 마스킹 전사 revision에 연결한다. 사용자용 원문 인용 복원은 소유자 화면에서만 수행한다. 블라인드 탐지 알림은 역량 점수와 분리한다.
- `provider_policies(id,version,provider,service,processing_countries,subprocessors,retention,training_use,dpa_ref,transfer_basis,status)`와 `session_provider_policies`를 추가한다. status=approved이고 해당 세션 고지/동의 또는 적용 가능한 법적 처리근거가 유효한 공급사만 호출한다. 장애 시 승인되지 않은 공급사로 자동 failover하지 않는다.
- `appeals(id,owner_id,evaluation_id,category,evidence_id,comment,status,resolution_code,created_at,resolved_at)` 추가. received→reviewing→resolved/rejected; 처리 목표 3영업일은 운영 목표다. 운영자는 별도 허가된 이의 항목만 접근하고 접근 감사를 남긴다. 신고는 모델 학습에 자동 편입하지 않는다.
- 180일 선택 보관 만료 후 무응답이면 삭제한다. 원문 공고/경험은 프로필 단위 expiry를 가지며 가장 긴 세션 FK 때문에 무기한 보존하지 않는다. 삭제 시 참조 세션에는 비개인 비복원 메타데이터만 남기거나 보고서와 함께 삭제한다. 만료된 프로필로 새 세션 시작 불가.
- 백업 순환 최장 30일을 배포 요건으로 한다. 공급사 실제 보존이 더 길거나 개별 삭제 불가이면 그 사실을 고지하고 승인 전 경로 비활성화한다. 삭제 완료는 활성 저장소 파기와 백업/공급사 만료를 구분한다. 접속 감사기록의 법정 기간·필수 필드는 별도 검토하여 일반 앱로그 14일과 분리한다.
- 작업 재claim은 외부 API 재호출 허가가 아니다. `model_calls.status=started|unknown`이면 재호출하지 않고 reconciliation으로 보낸다. provider 조회 불가 시 그 attempt는 unknown 비용을 유지하고 사용자에게 실패를 안내한다. 사용자가 명시적으로 다시 생성을 요청한 경우 새 operation_key와 별도 예산으로 처리한다. 오류가 확정된 retryable 응답만 전체 1회 재시도하며 job의 3회 실행 한도는 로컬 작업·정산을 포함한다.
- 초기 공개 비용 cap은 절약형 $0.08(평가 $0.02, 종료 $0.005 포함), 스트리밍 베타 $0.30(평가 $0.05, 종료 $0.01 포함)로 확정한다. §13의 $0.30은 스트리밍 경로에만 해당한다. 생성 최대 10턴, 대화·평가·repair 합산 외부 LLM 호출 최대 14회, 대화 출력 500 tokens, 평가 2,500 tokens. 공고 추출 비용도 owner/global 원장에 별도 예약한다.
- 최초 세션의 기본 질문 5개는 역량 매핑을 중첩하여 4차원마다 관찰기회 2회 이상을 확보한다. 꼬리질문/마무리에서 충족되지 않으면 해당 차원 수준은 공개하지 않는다. 질문이 요구하지 않은 성찰의 부재를 낮은 수준으로 처리하지 않는다.
- PCM frame의 byte_length는 정확히 `12+2*sample_count`, 기본100ms는 sample_count=1600이다. 서버는 framing·순서·중복·초당바이트를 검증하고 누락을 몰래 무음으로 채우지 않는다. 출력 binary는 별도 type=2, audio.start의 segment_id/epoch와 연결한다.
- 세션 전 공고 추출, 모든 repair·재평가·전사·TTS도 같은 owner/global 예산 검사와 호출 원장을 사용한다. `/profiles`는 계정당 분당2회/일10회, 1회예약 $0.01을 초기값으로 둔다. 동일 원문·설정해시의 진행중/완료된 본인 추출은 재사용한다. 프로필 API로 세션 예산을 우회할 수 없다. 모델이 필요한 자료길이에서 이 예약을 초과하면 호출 전에 거절하거나 자료를 줄이도록 안내한다.
- 세션 LLM 14회 중 평가 최대2회+repair1회를 예약하고 대화에는 최대11회만 허용한다. 정상 본질문/꼬리질문 합8회를 넘는 나머지는 인식확인·종료에 사용한다. 평가 분할이 2회로 부족하면 전체 점수를 강제로 합성하지 않고 관찰 가능한 차원만 보고한다. 공고 추출은 세션 호출한도와 별도지만 전체 월 원장에는 포함한다.
- 이벤트 envelope의 `durable`은 필수 boolean이며 durable=true일 때만 seq는 증가하는 정수다. partial/audio ACK 등 ephemeral 이벤트는 seq=null이고 이벤트 재생 로그에 저장하지 않는다.

## 16. 구현 상태와 MVP 계약 (2026-10-24)

이 절은 구현이 확정한 계약이다. 위 설계와 충돌하면 이 절과 `decisions/2026-10-24-gemini-first.md`가 우선한다.

- **구현 범위**: 공고 입력/승인 → 세션 생성/시작 → 텍스트 질문·꼬리질문 → 종료 → 근거 보고서 → 전사 교정/내용 개선 → 이의 제기 → 삭제. 단일 Node 프로세스, 인메모리 저장. Postgres/RLS/worker/실제 WSS는 미구현.
- **인증**: MVP는 `Authorization: Bearer <DEV_TOKEN>` + `.env` 매핑. 사용자 간 소유권 검사는 모든 조회·쓰기에서 강제하며 비소유 자원은 404.
- **공급자**: `mock` 기본(키 없음/게이트 미통과) → `gemini`(`GEMINI_PAID_ACK=true`). 무료 quota는 `GEMINI_ALLOW_UNPAID=true`인 합성 트래픽에만. 실제 사용자 데이터는 Paid+DPA 확인 전 전송 금지. `KILL_PROVIDERS=gemini` 설정 시 외부 호출을 강제 차단하고 Mock으로 동작.
- **모델**: `gemini-3.5-flash-lite`(텍스트), `gemini-3.5-transcribe`(음성, 미연동). 2.5-flash-lite는 신규 사용자 404. 429/5xx/timeout 시 1회 재시도 후 `gemini-3.6-flash`, 최종 실패 시 승인된 정적 질문/템플릿.
- **평가**: MVP는 서버 결정적 생성기. 모델이 좌표를 만들지 않고 서버가 NFC 원문에서 span을 계산·검증한다. 차원당 서로 다른 유효 답변 2개 미만이면 `insufficient_evidence`.
- **예산**: 호출 단위 예약·정산. 세션 상한 $0.08, 평가 예약 $0.02, 종료 $0.005. 프로필 추출은 호출당 $0.01 예약 + 계정당 분당2회/일10회 제한. unknown은 자동 반환·자동 재호출 금지. 월 상한 초과 시 429.
- **멱등성**: 쓰기 요청에 `Idempotency-Key` 필수. `command_id` 동일·본문 동일이면 저장된 응답 재생, 본문 다르면 409.
- **이벤트**: durable 이벤트만 `seq` 증가. `seq=null`은 재생 대상 아님.
- **연결**: `POST /sessions/:id/connect`로 30초 일회성 티켓 발급. MVP는 실제 WSS 미연동이며 `GET /sessions/:id/ws?ticket=` 확인 후 REST 명령으로 진행.
- **내보내기/삭제**: `POST /exports` → 10분 유효 `GET /exports/:id`(JSON). 세션 삭제는 즉시 `deleting→deleted`, 전사 마스킹·보고서 삭제·이벤트 비움. `DELETE /account`는 계정 전체 tombstone 후 파기. 백업 만료일 고지.
- **테스트**: `npm test` 43개 통합 테스트(인증·멱등·소유권·상태전이·근거검증·90초 재연습·서버 시간상한·예산·공급자 게이트·프로필 속도제한·일회성 티켓·내보내기·계정삭제·이의제기·기관 6종·면접유형 6종·축 검증). 브라우저 E2E로 승인→면접→보고서→재연습→삭제 흐름 확인. 기관 E2E(`node tools/e2e-institution.mjs`) 14개 별도 통과. 전체 유형 start→turn→report 프로브(`probe-types`) 통과.
