# Vercel 배포 (정적 화면 + 서버리스 API + Upstash Redis)

> 상태: 코드와 가짜 Redis 테스트는 통과했습니다. **실제 Vercel·Upstash에 올려 돌려 본 적은 없습니다** `[UNVERIFIED]`.

## 구조
- `public/` → 정적 화면(Vercel이 그대로 서빙, 빌드 없음)
- `api/handler.js` → `/api/v1/*` 전체를 처리하는 서버리스 함수(`vercel.json` 리라이트가 경로를 `__p` 쿼리로 넘김)
- `src/vercel/handler.js` → 요청마다 새 코어를 만들고, Upstash Redis에서 **그 사용자의 데이터만** 불러와 처리한 뒤 다시 저장
- `vercel.json` → 출력 폴더, 함수 실행 시간(60초), 보안 헤더(CSP, 마이크 허용은 같은 출처만)

## Redis에 저장되는 것
| 키 | 내용 |
|---|---|
| `user:{id}`, `email:{이메일}` | 계정(비밀번호는 해시), 이메일 중복 가입 방지 |
| `sess:{해시}`, `usess:{id}` | 로그인 세션(토큰은 SHA-256 해시, 7일 만료) |
| `own:{id}` | 그 사용자의 프로필·질문 계획·면접·평가·동의를 gzip+base64로 한 덩어리 |
| `lock:{id}` | 같은 사용자의 요청이 겹치지 않게 하는 잠금(30초 자동 해제) |
| `ledger:{YYYY-MM}` | 월 AI 비용 합계 |
| `rl:*` | 가입·로그인 시도 제한(이메일+IP 분당 5·일 50, IP 분당 20) |

30일 보관 기한은 요청 때마다 `own:{id}` 안에서 지웁니다. 계정 삭제는 위 키를 모두 지웁니다.

## 배포 순서
1. Vercel에서 이 저장소를 프로젝트로 가져옵니다(Framework: Other, 빌드 명령 없음 — `vercel.json`이 정합니다).
2. Storage 탭에서 만든 Upstash Redis(`intervuDB`)를 이 프로젝트에 **연결**합니다. 연결하면 `KV_REST_API_URL`·`KV_REST_API_TOKEN`(또는 `UPSTASH_REDIS_REST_URL`·`UPSTASH_REDIS_REST_TOKEN`)이 자동 등록됩니다.
3. 환경변수(Production)에 `.env`의 값을 등록합니다. **넣지 말 것:** `PORT`, `DEV_TOKEN_A/B`, `STORE`, `DATA_DIR`, `TRENDS_FILE`.
   **반드시 넣을 것:** `SITE_PASSWORD`(사이트 입장 비밀번호)와 `GATE_SECRET`(입장 쿠키 서명용 임의 문자열, 32자 이상). `SITE_PASSWORD`가 없으면 Vercel에서는 `/api`가 503(`gate_unconfigured`)으로 닫힙니다. 비밀번호나 `GATE_SECRET`을 바꾸면 이미 입장한 브라우저도 다시 입력해야 합니다.
4. 배포 후 확인: 가입 → 샘플로 면접 한 바퀴 → 새로고침해도 로그인 유지 → 계정 삭제.

## 입장 비밀번호
- 서버가 `/api` 전체를 잠급니다(화면 가림이 아님). 통과하면 12시간짜리 HttpOnly·SameSite=Strict·Secure 쿠키가 생기고, 값은 만료시각의 HMAC이라 비밀번호가 들어 있지 않습니다.
- 잠금 통과 전 요청은 Redis를 건드리지 않습니다. 시도는 IP당 분당 5회·일 30회(Redis로 집계)이고 실패는 0.3초 늦게 응답합니다.
- 이 잠금은 데모 공개 범위를 좁히는 장치이며 사용자 인증을 대체하지 않습니다(가입·로그인은 그대로 필요).

## 알려진 한계
- **월 Claude 호출 상한(`CLAUDE_MONTHLY_CALL_CAP`)은 서버리스에서 작동하지 않습니다**(요청마다 카운트가 초기화). Anthropic·Google 콘솔에서 월 지출 한도를 직접 거세요. 월 비용 합계(`MONTHLY_API_BUDGET_USD`)는 Redis로 이어지지만 Claude 단가를 설정하지 않으면 0원으로 계산됩니다(`CLAUDE_PRICE_IN_PER_M_USD`, `CLAUDE_PRICE_OUT_PER_M_USD`).
- 사용자 데이터를 한 덩어리로 저장하므로 면접 기록이 매우 많아지면 한 번에 주고받는 크기가 커집니다(압축해도 Upstash 요청 크기 제한 1MB 안에서). 30일 보관으로 억제합니다.
- 함수 실행 시간은 `maxDuration` 60초(Hobby 상한). 질문 설계 2단계·최종 평가가 이를 넘기면 규칙 기반으로 대체됩니다.
- 요청 본문 4.5MB 제한: 음성 한 구간은 보통 이보다 작습니다.
- 이메일 인증이 없어 가짜 계정으로 AI 비용을 쓰게 만들 수 있습니다. 가입 시도 제한은 있지만 공개 전에 공급자 지출 한도를 반드시 거세요.
- 관리자 월간 트렌드는 서버리스에서 영속하지 않습니다(UI 미사용).
