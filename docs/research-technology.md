# Intervu 기술·실시간 음성·비용 연구

통합 후 주의: 본 문서의 무료량·예산·지연 기준은 연구 제안이다. 최종 운영값은 `master-plan.md` 최종 결정표와 `implementation-spec.md`가 우선한다. 절약형 비용 합계는 실행 계산기 교차 검증으로 $0.02113으로 교정했다.

기획 기준일·문서 조회일: **2026-10-23, Asia/Seoul**. 아래 링크는 이 연구에서 실제 열어 확인한 공식 문서다. 문서 자체의 갱신일과 조회일은 다르다. 가격은 USD, 세금·환전·인프라·재시도 제외이며 계정별 접근권한과 할당량을 보증하지 않는다. API 유료 호출, 실제 한국어 품질·지연 벤치마크는 수행하지 않았다. 숫자의 성격은 `[공식]`, `[설계 결정]`, `[추정]`, `[검증 필요]`로 구분한다.

## 1. 결론과 선택의 근거

**[설계 결정] MVP 기본 음성 경로는 STT → 텍스트 면접 제어기 → TTS로 한다.** 사용자가 답변을 마치면 앞선 답변에 근거한 꼬리질문을 즉시 생성하는 상호작용을 구현한다. 녹화 후 일괄 평가만 제공하는 방식은 요구를 충족하지 않는다. 다만 비용절약 경로의 발화 종료 후 업로드는 완전한 양방향 음성 스트리밍과 다름을 UI에 명확히 한다.

선택 이유는 평가 근거와 발화 스크립트를 서버가 확정할 수 있고, 잘못 인식한 답변을 복구할 수 있으며, 토론의 발언 순서·질문 예산·압박 강도를 결정론적으로 통제할 수 있기 때문이다. 자연스러움만 최적화하면 native audio가 유리할 가능성이 있지만, 그것이 평가 정확성이나 낮은 총비용을 자동 보장하지 않는다. 음성·텍스트·평가 모델을 독립 교체하는 어댑터를 둔다.

| 대안 | 가치 | 핵심 약점 | 결정 |
|---|---|---|---|
| 턴 단위 STT + 텍스트 LLM + 짧은 TTS | 매우 낮은 변동비, 구조화 검증 쉬움 | 말하는 도중 자막 없음, 종료감지·업로드 지연 | 무료 체험/초기 기본 |
| 스트리밍 STT + 텍스트 LLM + 스트리밍 TTS | 부분 자막, 더 짧은 응답 지연, 평가 근거 분리 | 세 공급사 지연 합산·연결 관리 | 한국어 시험 통과 시 정식 기본 또는 유료 경로 |
| native audio realtime | 자연스러운 끼어들기·운율·짧은 반응 | 발화와 전사의 불일치, 상태 통제·가격 예측 복잡 | 별도 실험 후 고급 연습 |
| Web Speech API만 이용 | 개발자 측 STT 청구가 없을 수 있음 | 브라우저 편차, 음성이 외부 서비스로 전송될 수 있음 | 생산 기본 경로 제외 |
| 로컬 Whisper·온디바이스 LLM | 외부 전송 감소 | 다운로드·메모리·모바일 발열·GPU 운영비 | 오프라인 요구 확인 후 검토 |

MDN은 SpeechRecognition의 호환성이 제한되고 일부 Chrome 구현이 서버 인식을 사용한다고 명시한다. 따라서 “브라우저 API = 무료·로컬·개인정보 안전”이라는 전제를 두지 않는다. [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

## 2. 확인된 모델과 공급사 후보

### 2.1 텍스트 추론·채점

| 후보 | 공식 확인 내용 | 역할 제안 |
|---|---|---|
| `gpt-6-luna` | Standard 입력 $0.10/1M, 출력 $0.50/1M; 구조화 출력·스트리밍·함수호출 지원, 음성 직접 입력 없음 | 기본 질문 선택·꼬리질문·근거 추출·리포트 후보 |
| `gemini-3.5-flash-lite` | 입력 $0.30/1M, 출력 $2.50/1M | 성인용 유료 API 설정의 비교 후보 |
| `gemini-2.5-flash-lite` | 입력 $0.10/1M, 출력 $0.40/1M | 저가 대조군. 신규 모델보다 품질·수명 유리하다고 가정하지 않음 |
| Groq의 `qwen/qwen3.8-27b`, `openai/gpt-oss-20b` | 현재 rate limit 문서에 ID 존재 | 합성 데이터 개발 테스트. 한국어 면접 채점 품질은 미확인 |

OpenAI 모델 카드는 `gpt-6-luna`의 현재 ID와 지원 기능, 가격을 직접 확인할 수 있다. 모델의 빠름·추론력에 관한 공급사 설명은 Intervu 한국어 벤치마크 결과가 아니다. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)

Gemini 비용은 일반 Paid Standard 기준이다. Contributor 같은 데이터 제공 할인, Batch 할인, 프리뷰의 일시적 무료 가격을 일반 생산 가격으로 혼용하지 않는다. [Gemini 가격](https://ai.google.dev/gemini-api/docs/pricing)

**[설계 결정]** 기본 텍스트 후보는 Luna로 고정한 실행 가능한 구성을 제시하되, 출시 전 동일 테스트셋에서 Gemini 후보와 비교한다. 입력 근거·출력 schema는 동일하게 하고, 모델 이름만 바꿔 비교한다. 면접 질문에는 낮은 reasoning, 평가에는 별도 제한된 reasoning budget을 사용한다. 공급사별 인자 차이는 어댑터 내부에 둔다. 테스트 미통과 시 ‘대형 모델 자동 상향’보다 채점 표시를 보류하는 것이 우선이다.

### 2.2 음성 인식

| 후보 | 단위 가격 | 기술적 구분 |
|---|---:|---|
| Groq `whisper-large-v3-turbo` | $0.04/시간 | 다국어 파일 전사, 최소 청구 10초/요청 |
| Groq `whisper-large-v3` | $0.111/시간 | 품질 비교용, 파일 전사 |
| Deepgram `nova-3`, `language=ko` | 스트리밍 $0.0048/분 프로모션, 통상가 $0.0077/분 | 연속 partial/final 전사 후보 |
| OpenAI `gpt-4o-mini-transcribe` | 추정 $0.003/분 | 전사 대체 후보 |
| OpenAI `gpt-transcribe` | $0.0045/분 | 신규 전사 후보 |

Groq의 “216배 realtime speed factor”는 처리속도 지표이며 실시간 WebSocket이나 사용자 체감 216배 지연 개선을 뜻하지 않는다. 1초 조각마다 호출하면 10초 최소청구로 비용이 커진다. 답변 한 턴을 한 파일로 보내는 경로에 사용한다. [Groq Speech to Text](https://console.groq.com/docs/speech-to-text)

Deepgram Nova-3의 한국어 단일 언어 지원과 `multi` 목록은 다르다. `multi`를 쓰면 한국어도 자동 지원된다고 가정하지 않는다. 현재 `flux-general-multi` 목록에는 한국어가 없다. Nova-3 한국어 경로의 종료감지는 애플리케이션에서 보완한다. [Deepgram 언어 목록](https://developers.deepgram.com/docs/models-languages-overview)

Deepgram 프로모션 종료일은 확인되지 않았다. 재무 계획에는 $0.0077/분을 민감도 상한으로 포함한다. 최초 $200 크레딧은 반복되는 월별 무료량이 아니다. [Deepgram 가격](https://deepgram.com/pricing)

### 2.3 음성 합성

| 후보 | 요금 | 결정 |
|---|---:|---|
| Google Cloud `ko-KR-Wavenet-A`/`-C` | 월 4M 문자 무료 구간, 초과 $4/1M 문자 | 짧은 질문 단위 기본 후보 |
| Google Cloud `ko-KR-Chirp3-HD-Aoede`/`-Charon` | 월 1M 문자 무료 구간, 초과 $30/1M 문자 | 양방향 텍스트 스트리밍이 필요할 때 |
| `gemini-2.5-flash-preview-tts` | 입력 $0.50/1M text, 출력 $10/1M audio | 프리뷰이므로 실험 후보 |
| `gpt-4o-mini-tts` | 공식 모델 카드에 Deprecated | 신규 기본 선택에서 제외 |

Google Cloud TTS는 billing 활성화가 필요하고 초과분이 청구된다. 월 무료량을 hard spending cap으로 해석하지 않는다. 공백·줄바꿈도 청구 문자에 포함된다. [Cloud TTS 가격](https://cloud.google.com/text-to-speech/pricing)

한국어 음성 ID와 WaveNet/Chirp의 스트리밍 차이는 공식 목록에서 확인했다. Wavenet은 질문 문장을 완성한 후 짧게 합성하고, Chirp는 스트리밍 경로에서 검토한다. 성향은 발화 내용과 질문 행태로 먼저 표현하며 단순 음성 높낮이로 압박을 정의하지 않는다. [Cloud TTS 음성 목록](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types)

OpenAI의 TTS 가이드 예제에는 아직 `gpt-4o-mini-tts`가 있으나 모델 카드에는 Deprecated가 표시된다. 문서 간 상태 차이를 숨기지 말고 신규 의존성을 피한다. AI 생성 음성 고지도 필요하다. [모델 카드](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), [TTS 가이드](https://developers.openai.com/api/docs/guides/text-to-speech)

### 2.4 Native realtime

| 후보 | 공식 단가 | 검토점 |
|---|---:|---|
| `gemini-3.8-live` | 오디오 입력 약 $0.005/분, 출력 $0.018/분; text 별도 | stable, 한국어 지원 목록, 구조화 출력 미지원 |
| `gpt-realtime-2.1-mini` | audio 입력 $10/1M, 출력 $20/1M; text 입력 $0.60/1M, 출력 $2.40/1M | WebRTC·WebSocket, browser 직접 연결 가능 |
| `gpt-realtime-2.1` | audio 입력 $32/1M, 출력 $64/1M | 품질 대조군, MVP 무료 기본에는 비쌈 |
| `gpt-live-1` | 세션 $0.05/분 + backend 모델·도구 별도 | 15분 $0.75부터 시작하므로 비용 우선 MVP 제외 |

OpenAI 요금은 [공식 가격표](https://developers.openai.com/api/docs/pricing), Gemini 요금은 위 가격표를 기준으로 한다. 현재 모델명을 과거 `gpt-4o-realtime-preview`나 `gemini-2.5`와 혼동하지 않는다.

Gemini 3.8 Live 모델 페이지는 2026-10-19 갱신이며, 오디오 응답 모드와 output transcription 사용, 구조화 출력 미지원, proactive audio 비활성화 불가를 명시한다. 그러므로 명시적 질문 진행 제어가 필요한 MVP에서는 native 방식이 무조건 단순한 구현은 아니다. [Gemini 3.8 Live 모델](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)

OpenAI Realtime의 입력 음성은 대략 100ms/토큰, 출력 음성은 50ms/토큰이고, 이전 대화의 재입력도 청구에 영향을 준다. 분당 단가만 곱한 값은 전체 세션 청구액이 아니다. [Realtime 비용](https://developers.openai.com/api/docs/guides/voice-latency-cost?voice-api=realtime)

## 3. 무료 정책·데이터·연령 제약

**[공식] Gemini API 약관은 18세 이상 사용과 18세 미만 대상 또는 접근 가능성이 있는 API 클라이언트에 대한 제한을 명시한다.** 또한 unpaid에는 민감·기밀·개인정보를 제출하지 말라고 명시하고 사람 검토가 가능하다. 한국어 자기소개서·경력 답변을 무료 tier로 보내는 생산 설계는 채택하지 않는다. “사용자 동의만 받으면 무료 tier 이용 가능”으로 단정하지 않는다. 성인 취준생 MVP에 paid를 적용하거나, 학교입시 대상 확장 전에 별도 공급사/계약 경로를 확인해야 한다. 유료 Cloud TTS는 Gemini Developer API와 다른 서비스이므로 약관을 같다고 추정하지 않는다. [Gemini 약관, 2026-03-23 시행](https://ai.google.dev/gemini-api/terms)

Groq은 일반 inference의 입력·출력을 기본 저장하지 않으나 장애·오남용 예외로 최대 30일 로그가 가능하고, 모든 고객에게 ZDR 설정을 제공한다고 명시한다. 설정을 실제 조직에서 확인한다. 데이터의 미국 보관과 국외이전 고지는 별개 검토 항목이다. [Groq 데이터](https://console.groq.com/docs/your-data)

OpenAI는 API 데이터를 기본 학습에 사용하지 않으나 엔드포인트별 보존이 다르다. Realtime은 통상 abuse monitoring 30일, 전사 엔드포인트는 표상 None이다. Responses는 `store:false`를 설정하고, 이 설정이 모든 오남용 로그까지 없애지는 않는다고 고지한다. ZDR은 계정 자격·설정 확인이 필요하다. [OpenAI 데이터 제어](https://developers.openai.com/api/docs/guides/your-data)

무료량은 사용자별이 아니라 공급사 프로젝트/조직 단위다. Gemini는 활성 quota를 AI Studio에서 확인하도록 안내하므로 고정 무료 동시접속 수를 약속하지 않는다. Groq 공개 표에는 Whisper 20 RPM, 2K RPD, 7.2K audio seconds/hour, 28.8K/day가 표시되지만 플랜 설명과 토글의 추출 상태가 혼재한다. 계정 콘솔 확인 전 이를 확정 무료 quota로 계약하지 않는다. [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Groq rate limits](https://console.groq.com/docs/rate-limits)

**[설계 결정]** 데모는 합성/비식별 예제로 무료 tier를 사용할 수 있다. 실제 사용자용 무료 제공은 운영자가 유료 API 비용을 부담하는 제한형 체험이다. 일 1회 5분, 이메일 검증, 계정·IP 속도제한, 프로젝트 하루 비용 상한, 동시 세션 예약을 둔다. 숫자는 제품 실험으로 조정하며 계정 다중 생성으로 공급사 quota를 우회하지 않는다.

## 4. 15분 세션 비용 산식

### 4.1 재현 가능한 가정

**[추정]** 벽시계 15분 = 사용자 발화 8분 + AI 발화 4분 + 생각·전환 3분. 사용자 턴 10회, 질문·진행 생성 10회와 종료 평가 1회. 전체 LLM 누적 입력 45,000 token, 출력(추론 포함) 5,000 token. AI TTS 청구문자 2,200자. 언어·질문 길이에 따라 발화분과 문자는 변하므로 이 둘은 독립 사용량 측정값으로 교체한다.

`C = STT billed_seconds × rate/3600 + Σ(input_tokens×p_in + output_tokens×p_out + cache_write_cost)/1M + TTS_characters×p_char/1M + search + infra + retry`

계산에서는 할인·무료량·캐시 적중을 0으로 가정한다. 자동 캐시 쓰기 비용은 별도 계측 항목이며 아래 baseline에 포함하지 않았다. 한국어 글자 수를 영어 token 비율로 환산하지 않는다.

| 경로 | 계산 | 세션당 API 원가 추정 |
|---|---|---:|
| 절약형 Groq Turbo + Luna + WaveNet | 8/60×0.04 + 45,000/1M×0.10 + 5,000/1M×0.50 + 2,200/1M×4 | **$0.02113** |
| 스트리밍 Nova-3 + Luna + Chirp3 | 8×0.0048 + 0.007 + 2,200/1M×30 | **$0.1114** |
| 같은 경로 통상 STT 가격 | 8×0.0077 + 0.007 + 0.066 | **$0.1346** |
| Gemini native 신규 오디오만 | 8×0.005 + 4×0.018 | **$0.112 + text/history/평가** |
| OpenAI realtime mini 신규 오디오만 | 8×600/1M×10 + 4×1,200/1M×20 | **$0.144 + text/history/평가** |

절약형 전사 기준은 모든 10회 답변이 최소청구 10초보다 길다는 가정이다. 실제는 `Σmax(10, audio_seconds_i)`로 계산한다. 전체 세션 음성을 스트리밍 STT에 지속 전송하면 8분 대신 15분 청구될 수 있다. Nova 프로모션 기준 이 경우 $0.145, 통상가 기준 $0.1885다. 로컬 VAD로 전송을 줄일 때 끝 음절 손실이 생기면 절약보다 정확성을 우선한다.

**Native history 민감도 [추정]:** OpenAI mini의 10턴을 균등 발화로 단순화하면 과거 사용자 음성 21,600 + 과거 AI 음성 21,600 = 재입력 43,200 audio token이 추가될 수 있다. 전부 cached이면 약 $0.01296, 전부 uncached이면 $0.432 추가다. 실제 전사 치환·truncation·캐시 작동은 공급사 usage로 확인해야 한다. 따라서 $0.144를 세션 최종 청구액으로 광고하면 안 된다. Gemini도 음성 단가만으로 재입력·문자·툴 요금을 누락하지 않는다.

### 4.2 민감도·운영비

| 변화 | 절약형 변화 |
|---|---:|
| 사용자 음성 +1분 | +$0.000667 |
| TTS 1,000자 추가 | +$0.004 (Chirp는 +$0.03) |
| LLM 입력 10,000 token 추가 | +$0.001 |
| LLM 출력/추론 10,000 token 추가 | +$0.005 |
| 사용자8분→12분, AI2,200자→4,400자, token 2배 | $0.0396 |
| 같은 전체 처리를 한 번 더 수행 | 약 2배, 중복 방지 필요 |

[추정] 1,000회/월 API 변동비는 절약형 약 $21.13, 스트리밍 약 $111.40~188.50. 고정 서버·DB·저장소·모니터링·메일 예산을 **$25~60/월의 계획 가정**으로 두면 절약형 합계 $46.13~81.13이다. 실제 견적이 아니며 지원 인건비·평가자 검수·결제수수료·부가세는 제외했다. 환율을 고정 사실로 두지 말고 `KRW = USD × 결제일 적용환율`로 계산한다.

**[설계 결정] 비용 회계:** 세션 시작 시 예상 최대액을 원자적으로 예약하고, 공급사 usage마다 누적 ledger를 기록한다. 절약형 15분 예산 $0.08, 스트리밍 $0.25는 초기 hard cap 제안이다. 80%에서 남은 질문 축소, 100%에서 새 AI 호출 중단 후 이미 받은 답변만 평가한다. 리포트 예산을 미리 분리 예약해 면접 종료 직전에 전액 소진되지 않게 한다. 공급사 과금 로그가 늦으면 token 상한·발화 시간 상한으로 사전 차단한다.

## 5. 구현 상세: 음성·턴·예외

### 5.1 공통 이벤트 계약

`SessionEvent { sessionId, eventId, seq, turnId, serverTs, type, payload }`

타입: `session.ready`, `audio.started`, `transcript.partial`, `transcript.final`, `turn.committed`, `assistant.text`, `assistant.audio`, `assistant.cancelled`, `budget.updated`, `session.paused`, `session.completed`, `error`.

서버는 `turnId + operation`으로 멱등성을 강제한다. 중복 final은 기존 결과를 반환하고 다시 모델을 호출하지 않는다. partial은 UI 표시만, final 또는 사용자 확정 텍스트만 채점·질문 생성에 사용한다. 전사 수정 시 `transcriptRevision`을 증가시키고 해당 revision을 쓰는 점수만 유효하다.

### 5.2 절약형 진행

1. HTTPS에서 마이크 권한·3초 입력 레벨·TTS 재생을 확인한다. 권한 거절, 장치 없음, 권한창 미응답을 구분한다. 권한이 없으면 텍스트 모드로 계속 가능하다.
2. 질문을 표시하고 짧은 TTS를 재생한다. 공통 인사·안내만 캐시하고 개인 답변이 섞인 음성은 공용 캐시하지 않는다.
3. `LISTENING`에서 사용자가 답변. 기본 ‘답변 완료’ 버튼, 선택적 VAD 자동완료. 자동완료 무음 임계는 **설계 초기값 1.2초**, 300ms pre-roll, 너무 짧은 음성 재확인. 한국어 머뭇거림에서 조기 종료율 측정 후 조정한다.
4. 최대 120초/턴, 8MB/파일 등 애플리케이션 자체 제한. 수신 파일을 실제 파싱하고 media duration을 검사한다. MIME 문자열만 믿지 않는다.
5. STT 최종문을 저장하고, 문맥·용어 인식이 불확실하면 질문 또는 평가 보류. 짧은 “전사 수정”으로 교정 가능.
6. 서버 제어기가 다음 행동을 `ASK_CORE | ASK_FOLLOWUP | CLARIFY | CLOSE`로 선택. LLM은 허용된 행동의 발화만 만든다. 검증된 JSON에서 질문 길이·대상 근거를 검사하고 UI/TTS로 전달한다.
7. 전사 실패 1회만 안전 재시도; 이후 사용자가 텍스트 입력하거나 그 턴을 다시 녹음한다. 실패를 무응답·역량 부족으로 채점하지 않는다.

마이크 접근은 HTTPS와 사용자 권한이 필요하며 권한 요청 Promise가 미결로 남을 수 있다. [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

### 5.3 끼어들기·스트리밍

AI 재생 중 사용자 `말하기` 버튼 또는 검증된 VAD speech-start 발생 → 로컬 playback 즉시 정지 → 생성 abort → `assistant.cancelled` 저장 → 실제 재생된 범위만 대화 컨텍스트에 남김 → 새 사용자 turn. 생성됐지만 듣지 못한 답변을 사용자가 들은 것으로 가정하지 않는다. 에코를 사용자 끼어들기로 오인하지 않도록 헤드폰 권고와 echoCancellation, 기기별 시험이 필요하다.

질문은 문장 단위로 합성하고 최대 1문장만 선행 버퍼링한다. 취소된 generation의 늦게 도착한 chunk는 `generationId` 검증으로 폐기한다. 토론 AI 참가자도 한번에 한 명만 발화하며 한 제어기가 역할을 선택한다. AI 참가자 수만큼 독립적인 항상 켜진 realtime 세션을 열지 않는다.

### 5.4 Native adapter 제약

OpenAI browser 경로는 서버가 세션을 승인한 후 ephemeral credential/WebRTC를 사용한다. permanent API key를 번들에 두지 않는다. 서버에서 정책·예산·시간 제한을 유지하며 client가 보내는 점수·사용량은 신뢰하지 않는다. [OpenAI WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime)

Gemini는 입력 PCM 16-bit little-endian(기본 16kHz), 출력 24kHz이고 한국어를 지원 목록에 포함한다. AudioWorklet의 입력 sample rate를 명시하고 출력 jitter buffer를 둔다. interrupted 이벤트에서 출력 큐를 비운다. [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)

Gemini 세션은 압축 없을 때 audio-only 15분, 연결 약 10분이라는 제약이 문서에 있다. **15분 면접에도** context compression·resumption·GoAway 처리와 중복 재생 방지가 필요하다. 종료 직전 끊기는 데모를 피해야 한다. ephemeral token은 Preview이므로 운영 경로 적합성도 별도 검증한다. [세션 관리](https://ai.google.dev/gemini-api/docs/live-api/session-management), [임시 토큰](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)

### 5.5 장애 정책

| 상황 | 동작 |
|---|---|
| 공급사 429 | Retry-After 존중, 최대 1회 재시도, 진행 시계 일시정지; 대기 안내 |
| 5xx/timeout | 같은 turn에 새 생성 중복 금지. 승인된 대체 공급사만 전환 |
| 마이크 해제·탭 백그라운드 | 자동 일시정지, 돌아오면 장치 재확인 |
| 연결 종료 | 마지막 seq 이후 resume. 처리 완료된 턴 재청구 금지 |
| TTS 실패 | 질문 텍스트로 진행, 음성 실패 표기 |
| STT 내용 빈값·환각 의심 | 무음 에너지와 대조, 채점 제외 및 재입력 |
| schema 불일치 | 1회 repair 후 deterministic 안전 질문 사용 |
| 비용 한도 | 새 질문 중단, 예약된 평가 예산으로 부분 리포트 |
| 사용자 중단 | 스트림·마이크 즉시 종료, 진행 상태 저장/삭제 선택 |

## 6. 한국어·성능 검증 계획

아래는 합격 보증이나 업계 표준이 아니라 **출시 게이트 제안**이다.

1. 동의 받은 성인 30명 이상, 발화 300개 이상으로 한국어 평가셋 구축. 표준어·지역 억양·말더듬/긴 침묵·영어 약어·전공 용어·조용한 방·노트북 팬·휴대폰·블루투스 조건 포함. 화자 단위로 개발/보류 테스트 분리.
2. 정답 전사 2인 검수. 한국어는 CER와 띄어쓰기 정규화 WER를 함께 보고, 숫자·부정어·고유명사 보존율을 별도 측정. 공급사의 영어 WER를 한국어 정확도로 전용하지 않는다.
3. STT 3후보 동일 오디오 비교. 목표 CER≤10%는 초기 가설이며 오류가 평가를 뒤집는 비율을 더 우선한다. 잘못 인식한 부정어가 점수를 낮춘 사례는 출시 차단 결함이다.
4. `end_of_user_audio → first_audible_AI` p50/p95 및 각 단계(VAD, STT final, LLM first valid sentence, TTS first chunk, playback)를 수집. 절약형 p95≤4초, 스트리밍 p95≤2.5초, barge-in 재생정지 p95≤300ms를 목표로 한다. 서울 사용자의 실제 유무선 환경에서 측정한다.
5. 20개 동시 세션 15분 soak, 끊김·429·늦은 chunk·중복 event 주입. 세션 완료율≥98%, 이중 청구성 호출 0, 다른 사용자 데이터 노출 0. 목표 실패 시 native 도입보다 기본 안정성을 개선한다.
6. 모델 변경은 고정 100개 답변의 rubric/evidence 회귀검사, blind A/B, 비용 95분위 비교 후 승격. promptVersion/modelVersion/rubricVersion을 리포트에 저장한다. 모델 alias 변경도 회귀 원인으로 기록한다.
7. 평가 엔진과 면접 발화 엔진을 분리한다. 유창한 목소리·성별·억양을 직무역량 점수로 쓰지 않는다. 음성 지표는 속도·침묵 같은 관찰값으로 한정하고 치료·성격·정서 진단으로 해석하지 않는다.

## 7. 개발 에이전트에게 넘길 초기 설정

```yaml
voice_mode: turn_based_cascade
stt:
  provider: groq
  model: whisper-large-v3-turbo
  language: ko
dialogue:
  provider: openai
  model: gpt-6-luna
  api: responses
  store: false
  max_output_tokens_per_turn: 500
tts:
  provider: google_cloud_tts
  voice: ko-KR-Wavenet-A
evaluation:
  provider: openai
  model: gpt-6-luna
  max_output_tokens: 2500
limits:
  session_seconds: 900
  answer_seconds: 120
  max_user_turns: 10
  max_llm_calls_including_repair: 14
  session_reserved_usd: 0.08
  evaluation_reserved_usd: 0.02
```

이는 문서 조사로 선택한 **실행 기본안**이며 benchmark를 통과했다는 뜻이 아니다. Cloud TTS 계약·계정 quota, 모델 존재/폐기 공지, 한국어 품질, 로그 보존 설정, 일별 예산 차단을 출시 전 확인한다. 우선순위는 (1) 텍스트 상태기계와 근거 기반 평가 (2) 턴 단위 음성 (3) 비용 ledger·복구 (4) 사용자 검증 (5) 스트리밍 경로 (6) native 음성 실험 순서다.
