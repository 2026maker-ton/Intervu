# Intervu — Instructions for every coding agent

**Mandatory: Read the root `PROJECT.md` before inspecting or editing product code.** It is the canonical product source of truth. If missing or unreadable, stop product modifications and report the blocker.

## At the start of EACH execution

1. Read `PROJECT.md` in full, then this file, then code/tests and relevant historical docs.
2. Identify the active PROJECT phase (P0–P5), concrete requirement(s), acceptance criteria and likely safety risks.
3. Compare proposed work with the product differentiator: **application claim probing → evidence-grounded coaching → new-question transfer check**.
4. Distinguish current implementation from future design. Existing historical docs/ADRs do not supersede `PROJECT.md` on product direction; current laws/provider terms and stricter protections always do.

## Development constraints

- Focus on company and university admission interviews, not generic feature parity.
- Preserve source provenance, exact citations, answer revision integrity and explicit `insufficient_evidence` behavior.
- The current evaluator is rule-based. Never market it as validated AI scoring. No invented evidence, hiring predictions, unsupported competency ratings or fake performance claims.
- Do not send real applicant data to a free/unapproved AI tier, and do not let client-controlled `synthetic` flags bypass this. Enforce provider/age restrictions, server-only secrets, SSRF and prompt-injection defenses, ownership, deletion and budget caps.
- Never quietly switch to a paid provider or mark a Mock as live AI.
- Prefer minimal safe changes with failure-case tests. Do not remove existing safety invariants to make a demo appear functional.

## At the end of EACH execution

1. Run `npm run check:project` and `npm test`, plus appropriate integration/browser checks. If a command cannot run, explicitly state that it was NOT run.
2. Report requirement IDs/sections, files touched, actual test results, provider mode, gaps, and any docs that remain inconsistent.
3. If the product direction changes, update `PROJECT.md`, associated tests and design decision notes in the same change.
4. Never claim implementation completeness based only on passing document checks or Mock-only tests.

**No agent, editor, or code-generation workflow is exempt.** CI checks are guardrails, not proof of design correctness.
