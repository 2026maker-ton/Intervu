# Intervu — 연구 및 구현 착수 설계

**2026-10-23 기준. 한국어 AI 모의면접 서비스를 위한 시장·경쟁·기술·평가·법률 연구와 구현 명세다. 2026-10-24에 Gemini 우선 공급자로 전환하고 MVP 코드를 구현했다.** 성능 수치·수요 지표·매출은 실측이 아닌 검증 계획으로 구분했다.

먼저 [종합 설계서](docs/master-plan.md)를 읽고, [구현 명세](docs/implementation-spec.md)와 [AI 계약](docs/ai-contracts.md) 순서로 진행한다. **AI 공급자 결정은 [Gemini 우선 결정 기록](docs/decisions/2026-10-24-gemini-first.md)이 우선한다.**

- [시장·경쟁·면접 유형 연구](docs/research-market.md)
- [실시간 AI·모델·원가 연구](docs/research-technology.md)
- [평가·법률·개인정보 연구](docs/research-evaluation-legal.md)
- [평가 JSON Schema](docs/contracts/evaluation.schema.json) · [합성 보고서](docs/fixtures/evaluation.valid.json)
- [원가 가정 (레거시 Groq/Luna)](docs/cost-assumptions.json) · [Gemini 원가 가정](docs/cost-assumptions.gemini.json)

핵심 결정: 만19세 이상 신입 구직자, 1:1 음성/블라인드/근거 피드백/재연습을 공개 MVP로 하고 토론은 닫힌 베타로 검증한다. **AI 기본 공급자는 Gemini(`gemini-3.5-flash-lite` + `gemini-3.5-transcribe`)이며, Mock → Gemini 순서로 구현했다.** 자세한 범위·기본값은 종합 설계서의 최종 결정표와 Gemini 결정 기록이 기준이다.

## 실행

```powershell
npm start                 # http://localhost:3000
npm test                  # 통합 테스트 43개 (외부 키 불필요)
node tools/verify-design.mjs
node tools/e2e-institution.mjs  # 기관 맞춤형 14개
node tools/cost-model-gemini.mjs --sessions=1000
```

`.env`에 `GEMINI_API_KEY`가 있으면 서버가 Gemini 어댑터를 초기화한다. **단, 실제 사용자 데이터 전송은 `GEMINI_PAID_ACK=true` 전까지 차단되고 Mock으로 동작한다.** 무료 할당량은 학습·인간 검토 대상이므로 합성 트래픽에만 명시적으로 허용한다. 자세한 내용과 보안 경계는 `docs/decisions/2026-10-24-gemini-first.md`와 `.env.example`을 따른다.

외부 라이브러리 없이 Node.js 20+로 동작한다. 검증 도구는 합성 근거 구간·중앙값·비용 산식을 검사하며 실제 제품의 품질이나 보안을 검증한 것은 아니다.
