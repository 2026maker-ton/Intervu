# Intervu P0–P5 Implementation Checklist (persistent)
_Last updated: 2026-10-29 — active phase P0→P4 vertical slice_

## Baseline (2026-10-29 audit)
- `npm run check:project`: PASS 3/3 (docs-structure only)
- `npm test`: 51 pass / 0 fail (Mock, no external keys)
- Core loop status: claim probe (keyword heuristic) → coaching (heuristic report) → transfer (90s same-rubric retry, NOT new-question comparison)
- Gaps: no file upload parser, no real web fetch (metadata only), no monthly-trend store, evaluator keyword-stuffing vulnerable, PII `21세기` false-positive risk, client `synthetic` flag trusted for Gemini path

## P0: Product/Safety baseline
- [x] PROJECT.md v1.0.0 + AGENTS.md read, phase mapping done
- [ ] PII regression: `이번/이유/이해/21세기` + names/schools/email/phone preserved (fix `src/domain/pii.js`)
- [ ] Evaluator anti-gaming: `저는 이유 결과` must NOT get L4 (fix `mock-eval.js` + `mock-eval-typed.js`)
- [ ] Provider gate: server-owned synthetic fixtures, block client-flag bypass, minor/highschool force-Mock preserved
- [ ] `tools/check-project.mjs` extended with behavioral contracts where cheap
- [ ] Tests: add P0 regressions to `tests/run.mjs`, keep 51 existing green

## P1: Core UI/Documents
- [ ] 9-screen nav (dashboard→setup→evidence→config→room→feedback→repractice→history→admin) in `public/`
- [ ] Corporate / university journeys only in primary UI; legacy types hidden from primary entry
- [ ] TXT paste + PDF/DOCX/TXT upload validation, server extraction, preview/correction/revision, scanned-file failure path
- [ ] Browser E2E: desktop 1440 / tablet 768 / mobile 390 for corp + univ + failure cases

## P2: Official sources/Trends
- [ ] URL/domain validation + SSRF/private-IP/localhost/metadata/redirect/size/timeout guards (extend `sources.js`)
- [ ] `official_verified/user_supplied/monthly_trend/unverified/unavailable` status honestly shown; no fetch → no verified claim
- [ ] Admin trends: ≤3/segment/month, review/approve/version/rollback, user sees only approved + labeled

## P3: Questions/Dialogue
- [ ] Claim→competency→question grounding with IDs + source_status; no fabricated applicant facts
- [ ] Adaptive follow-up from confirmed answer; deterministic fallback labeled; budget/turn caps
- [ ] STT: Groq configured → record/transcribe/correct; else text fallback; mic-denied path

## P4: Differentiation (must-have slice)
- [ ] Baseline store (questionID/competency/revision/rubric/evidence/limits)
- [ ] New-question generator: same competency, different content, no answer reuse/leak
- [ ] Independent retry store + same-rubric compare + `observed_change` vs `insufficient_evidence`
- [ ] Tests: different Q, same competency/rubric, separate storage, span validity, no fake metrics, abstention

## P5: Demo release
- [ ] Responsive/accessible UI, history/export/delete, privacy disclosures match in-memory reality
- [ ] README/.env.example/API docs updated; ADRs preserved as history
- [ ] `npm run check:project` + `npm test` + browser E2E actually run; report exact counts/modes/gaps

## Files touched (running log)
- (pending) `IMPLEMENTATION_CHECKLIST.md` created
- Next: `src/domain/pii.js`, `src/domain/mock-eval*.js`, `tests/run.mjs`, `src/domain/transfer.js`, `src/server.js`, `public/*`, `src/domain/documents.js`, `src/domain/trends.js`, `README.md`

## Blockers
- No GROQ/GEMINI keys in env → Mock-only verification; no paid transmission
- No PDF/DOCX parser dep → honest failure + manual entry unless minimal safe parser added

## UI rebuild + P1/P2/P4 gaps
- [x] 9-screen UI, no prompt/confirm, hash router, responsive 1440/768/390 (E2E verified, Mock)
- [x] DOCX deflate / PDF Flate extraction, scanned PDF explicit failure
- [x] Trend persistence, admin token gate, history endpoint, encoded publish/rollback ids
- [x] Transfer HTTP integration test, repractice comparison in UI
- [ ] Real admin auth/roles, live Gemini/Groq verification, persistent transferJobs/store

