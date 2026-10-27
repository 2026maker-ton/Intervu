# 결정 기록: Gemini 우선 공급자 (2026-10-24)

**상태: 적용됨. 상위 결정.** `master-plan.md` §7·§10, `implementation-spec.md` §5·§13, `ai-contracts.md` §1과 충돌하는 부분은 이 문서가 우선한다.

## 배경

초기 설계는 텍스트·평가 모델의 기본 후보를 OpenAI `gpt-6-luna`, 음성을 Groq Whisper + Google Cloud WaveNet으로 두었다. 사용자 지시에 따라 **Google Gemini를 기본 AI 공급자**로 전환한다. 기존 AI 계약(역할 분리·JSON 스키마·서버 검증·예산 원장·공급자 정책 게이트)은 유지한다.

## 공식 문서 확인 결과 (2026-10-24 조회)

| 항목 | 확인 내용 | 출처 |
|---|---|---|
| 모델 가용성 | `gemini-2.5-flash-lite`는 **신규 사용자에게 404**(서비스 종료). 실키 호출로 확인 | Gemini API `models.list` + 실호출 |
| 기본 텍스트 모델 | **`gemini-3.5-flash-lite`** — 무료 tier 제공, 유료 $0.30/$2.50 per 1M, JSON 모드 지원 | [가격](https://ai.google.dev/gemini-api/docs/pricing) |
| 대체 모델 | `gemini-3.6-flash` — 무료 tier 제공, 유료 $0.75/$3.75. 실호출 성공 | 동일 |
| 고비용 모델 | `gemini-3.8-flash` $0.75/$3.75, 첫 호출 95초 지연 관측 → 기본값 부적합 | 실측 |
| 전사 | `gemini-3.5-transcribe` 제공, 약 $0.005/분 (약 $0.30/시간) | 가격표 |
| 무료 tier | **입력·출력이 Google 제품 개선에 사용됨. 인간 검토자가 읽을 수 있음.** 민감·기밀·개인정보 제출 금지 | [약관](https://ai.google.dev/gemini-api/terms) |
| 유료 tier | 프롬프트·응답을 제품 개선에 사용하지 않음. DPA 적용. 오남용 탐지 목적 제한 보존 | 동일 |
| 연령 | API 사용자는 18세 이상. 18세 미만 대상/접근 가능 서비스에 사용 금지 | 동일 |
| Rate limit | 모델별 RPM/RPD/TPM은 AI Studio에서 프로젝트별 확인. 고정 무료 동시접속 수를 약속하지 않음 | [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) |

## 확정 사항

1. **기본 공급자 = Gemini**, operation별 모델은 `src/config.js`의 레지스트리.
   - `profile.extract` / `dialogue.next` → `gemini-3.5-flash-lite`
   - 실패 시 1회 재시도 후 `gemini-3.6-flash`, 그래도 실패하면 **검증된 정적 질문/템플릿**으로 대체.
   - `evaluation.generate`는 MVP에서 **결정적 서버 생성기**(`src/domain/mock-eval.js`)를 사용한다. 모델이 만든 인용 좌표를 신뢰하지 않고 서버가 span을 계산하므로 quote 불일치가 원천 차단된다. Gemini 평가는 G4/G5 게이트 후 별도 활성화.
2. **데이터 전송 게이트**: `.env`의 `GEMINI_PAID_ACK=true`(유료 결제계정 + DPA/보존 확인) 없이는 실제 사용자 데이터를 Gemini로 보내지 않고 Mock으로 동작한다. 무료 quota 사용은 `GEMINI_ALLOW_UNPAID=true`인 **합성/개발 트래픽에만** 허용.
3. **키는 서버 전용**: `.env`는 `.gitignore`에 등록, `.env.example`만 커밋. 브라우저 번들에 키를 넣지 않는다.
4. **비용 상한**: 세션 $0.08 유지. Gemini 3.5 Flash-Lite 기준 추정 **$0.066/15분**(STT 포함, TTS는 브라우저 합성으로 $0). 평가 예약 $0.02, 종료 $0.005는 별도 보존.
5. **호출 한도**: 세션 LLM 최대 14회(대화 11 + 평가·repair 3). 초과 시 새 질문 중단 후 종료·부분 보고서.
6. **MVP 음성 범위**: 텍스트 면접 + 브라우저 `SpeechSynthesis` 낭독. 서버 STT/TTS 파이프라인은 어댑터 계약만 두고 미연동. Groq/WaveNet은 대체 후보로만 유지.
7. **연령**: 서비스는 만 19세 이상. Gemini 약관의 18세 기준보다 엄격하게 운영한다.

## 해소한 설계 충돌

| 충돌 | 이전 | 변경 |
|---|---|---|
| 기본 텍스트 모델 | `gpt-6-luna` (master-plan §7, §10) | `gemini-3.5-flash-lite` |
| 모델 가격 가정 | Luna $0.10/$0.50 | Gemini $0.30/$2.50, 세션 추정 $0.021→$0.066 |
| 음성 기본 경로 | Groq STT + WaveNet TTS | MVP는 텍스트 + 브라우저 TTS, 서버 음성은 후속 |
| Gemini 무료 tier 사용 | "합성/비식별 데모에 사용 가능" | 실제 사용자 데이터 전송 **차단**. 합성도 명시적 허용 필요 |
| 모델 ID | `gemini-2.5-flash-lite` (연구 문서) | 신규 사용자 404 확인 → `gemini-3.5-flash-lite` |
| 평가 방식 | LLM이 인용 좌표 생성 | 서버가 span 계산 + 결정적 평가 생성기 |
| 예산 예약 | 세션 시작 시 전액 예약 | 호출 단위 예약(전액 예약은 다른 호출을 막음) |

## 남은 위험

- Gemini 3.5 Flash-Lite의 한국어 면접 평가 품질은 **미검증**. G4/G5 전까지 점수는 참고용이며, 현재 MVP 보고서는 휴리스틱 관찰이다.
- 무료 tier의 rate limit은 프로젝트 단위이므로 사용자별 무료량을 보장하지 않는다.
- 유료 전환 시 2027-01-01부터 3.6/3.7/3.8 Flash 가격이 2배 인상될 예정. 원가 재계산 필요.
- `gemini-3.5-transcribe`의 한국어 CER은 미측정. 음성 활성화 전 G2 필요.
