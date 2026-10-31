# 11. 일반 면접 5단계 · 로그인 · 결과 개편 (2026-10-31)

> **지위:** 구현 기록이다. 제품 기준은 `PROJECT.md` v1.4.0 §7.7이고, 결정 근거는 `docs/decisions/2026-10-31-*.md`에 있다.

## 흐름
1. 로그인/가입: 이름, 이메일, 비밀번호, 만 18세 확인, 처리 고지 동의
2. 지원 정보 입력: 대학, 학과, 전형, 모집요강(선택), 자소서·학생부. 샘플 10건을 불러올 수 있다.
3. 근거 확인:
   - 핵심 역량(렌치로 수정)
   - 면접 형태(렌치로 수정, 일반 면접만 선택 가능)
   - 학교·전형 검색
   - 지원서 주장(질문에서 제외 가능)
   - 5단계 질문 계획
   - 승인하면 계획이 동결된다.
4. 면접 준비: 음성(서버 전사가 가능할 때)이나 텍스트를 고르고, 마이크를 확인한다.
5. 면접실: 인사 → 질문 TTS → 자동 녹음.
   - 발화 후 3초 정적이면 그 구간을 전사하고, 전사가 종결어미(…다/…요/…죠/…까)로 끝났으면 완료로 본다(브라우저 규칙, AI 호출 없음). 아니면 계속 듣는다.
   - 완료되면 "네 답변 잘 들었습니다."를 말하고, 동시에 서버가 꼬리질문 여부를 정한다.
   - 다음 질문으로 넘어갈 때는 동결된 연결 문장을 말한 뒤 다음 질문을 한다.
   - 60초가 지나면 "네, 거기까지만 말해주시면 될 것 같습니다."를 말한다.
6. 결과:
   - 차트: 참고 점수, 대학 역량 적합성, 차원 레이더, 음성 지표
   - 질문·답변 본문: 꼬리질문은 구분해 표시하고, i 버튼으로 근거를 연다.
   - 다음 연습 최대 3개

## API (추가)

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| POST | `/auth/signup` | 가입 |
| POST | `/auth/login` | 로그인 |
| POST | `/auth/logout` | 로그아웃 |
| GET | `/auth/me` | 현재 사용자 |
| PATCH | `/profiles/:id/customization` | `{competencies?, interview_format?}` 렌치 수정 |
| POST | `/profiles/:id/school-search` | 학교·전형 검색(grounding) |
| GET | `/profiles/:id/plan` | 기존 응답에 `format`, `stages[]` 추가 |
| POST | `/sessions` | `{interview_format:'general', profile_version_id, input_mode}`. 특수 형태는 422 |
| POST | `/sessions/:id/commands` | `turn.text` payload에 `cut_off`, `voice_metrics` 추가. 응답에 `ack`, `bridge`, `question` 추가 |

- 보고서(일반 면접)에는 `format:'general'`, `transcript[]`, `competency_fit[]`이 들어간다. `claim_links`와 `institution_link`는 넣지 않는다.

## 향후 계획 (구현하지 않음)
- **특수 면접 5종:** 진행 방식은 `SPECIAL_FORMATS`에 정의만 되어 있다.
- **`{이름}` 치환:** 지원서의 이름 문자열을 `{이름}`으로 바꿔 AI에 보내고, AI 문장의 `{이름}`을 TTS 직전에 로그인한 이름으로 바꾼다. 현재 `pii.js`의 `[이름]` 마스킹을 확장하는 방식이다.
- 실시간 스트리밍 전사(현재는 구간 전사), Workers 로그인, 재연습 재도입.
