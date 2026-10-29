# Groq STT 수동 스모크 (WP-B5)

상태: **미실행.** 이 절차는 개발자가 외부 호출을 명시 승인한 뒤에만 실행한다. `npm test`·CI·에이전트가 자동으로 돌리지 않는다.

## 목적과 한계

- 키·네트워크·`whisper-large-v3-turbo` 경로·429/지연 반응이 실제로 동작하는지 확인한다.
- 도구가 보내는 것은 **로컬에서 생성한 440Hz 사인파 WAV**(음성 아님)다. 전사 결과는 비어 있거나 의미 없을 수 있고, 이것은 정상이다. **한국어 오류율(CER/WER)은 이 도구로 측정되지 않는다.**
- 오류율은 합성(TTS) 또는 동의받은 한국어 음성으로 `docs/eval/templates/E-6-stt-error.csv` 절차에 따라 따로 측정한다.

## 실행 전 확인

1. 개발자가 외부 호출·무료 한도 소모를 승인했다.
2. 키는 환경변수로만 준다(파일·저장소·화면 공유에 두지 않는다).
3. 실제 지원자 음성·개인정보를 쓰지 않는다.

## 실행

```
GROQ_WHISPER_KEY=<키> GROQ_LIVE_ACK=true node tools/stt-smoke.mjs --i-approve-live-call --runs=3
```

`GROQ_WHISPER_KEY`(또는 `GROQ_API_KEY`), `GROQ_LIVE_ACK=true`, `--i-approve-live-call` 중 하나라도 없으면 도구는 호출 없이 종료한다. 429를 받으면 즉시 멈춘다.

## 기록

- 표(실행 번호·결과·지연·글자 수)를 `docs/validation-results.md`에 **표본 수, 실행일, 환경, 한계**와 함께 옮긴다. 합성 사인파 연결 확인과 한국어 오류율 측정을 구분해서 적는다.
- 키·응답 원문을 기록에 남기지 않는다.

## 자동 계약 시험(실호출 없음)

`tests/api/b5-stt.test.mjs`가 스텁 fetch로 multipart 파싱, 허용 형식, 크기 상한, 429→텍스트 안내, 타임아웃, 빈 결과, `pii_warnings`, 원음 비저장, 키 비노출을 검증한다. 이 시험은 계약이며 실제 Groq 동작을 증명하지 않는다.
