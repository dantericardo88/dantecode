# DanteCode Clarification
_Spec gaps resolved | Generated: 2026-04-14_

---

## Clarification

This document resolves all ambiguities in the specification before implementation begins.
Each decision is final and binding. All questions that could cause scope drift have been
answered with concrete, testable decisions.

---

## Missing Requirements

The following requirements were implicit in the spec but needed explicit resolution:

- **Score definition (C1):** A dimension score requires end-to-end VSCode smoke test, all
  6 gates passing, and functional parity with best-in-class competitor — not unit tests alone.
- **Build scope (C2):** Enterprise foundations (audit logs, configurable limits, multi-user
  data models) are built now; billing/SSO UI deferred to Phase 2. This was implicit.
- **OSS routing (C3):** Which tool to use per OSS source was unspecified in SPEC. Resolved below.
- **PDSE threshold (C4):** The PDSE gate threshold was implicit. Now explicit: ≥ 7.0.
- **Autocycle order (C5):** self-improve runs first; targeted sprints only for what it cannot close.
- **Browser MVP scope (C8):** dim 28 minimum was unspecified. Now: 4 concrete deliverables.

---

## Consistency

All decisions below are consistent with the CONSTITUTION:
- **Local-first:** All new features operate offline where possible; cloud APIs are optional.
- **Zero ambiguity:** Every decision resolves to a concrete action, file, or threshold.
- **Verify before commit:** All sprints run 6 gates before claiming score improvement.
- **Atomic commit:** No partial work committed; completeness gate mandatory on every sprint.
- **Moat protection:** dims 15, 22, 24 never regress; dim 21 is a secondary moat target.

---

## Ambiguities Resolved

### C1 — What counts as "9" on the matrix?
**Decision:** A dimension reaches 9 when:
1. The feature works end-to-end in VSCode (smoke tested, not just unit tested)
2. All 6 constitution gates pass
3. The implementation is functionally comparable to the best-in-class competitor at 9
4. No regressions on other dimensions
A 9 is NOT claimed for: working unit tests only, wired but unvalidated code paths,
or infrastructure that exists but is not reachable from user-visible flows.

### C2 — Personal use vs enterprise: which decisions to make now?
**Decision:** Build enterprise-ready foundations now (audit logs, configurable limits,
multi-user data models) but do not build the UI/billing layer until Phase 2. Concretely:
- DIM 28: Build read-only session sharing + org-level skill config in Sprint K
- SSO: Guard with `process.env.DANTECODE_SSO_PROVIDER` env-var; wire for SAML in Phase 2
- Audit logs: Already exist via DanteForge audit_log — expose via CLI command

### C3 — Which OSS sources need constitutional harvest vs direct /inferno?
**Decision:**
- **Use `/harvest` first** for: Continue.dev (40% done, specific patterns known),
  Sweep (well-scoped PR pipeline), JetBrains (specific debug patterns)
- **Use `/inferno` directly** for: Plandex (0% done, need discovery), SWE-agent
  (0% done), GPT-Pilot (0% done), Aider+Cline (completion of prior work)
- **Use `/nova` only** for: Screenshot-to-code (no OSS), Browser preview (e2b.dev API)

### C4 — What is the PDSE threshold for gate passing?
**Decision:** PDSE score ≥ 7.0 for all present artifacts. Newly created artifacts
(CONSTITUTION, SPEC, CLARIFY, PLAN, TASKS) must reach ≥ 7.0 before Sprint A begins.
The `danteforge_score_all` MCP call after each sprint is the enforcement mechanism.

### C5 — How does `danteforge self-improve` interact with targeted sprints?
**Decision:** Run `self-improve` first after bootstrap. It handles all +1 gaps
(dims at 8 needing 9) via its assess→forge loop. Only invoke targeted sprints for
gaps it cannot close (dims at 2, 3, 5, 6, or requiring external API integration).
Check `danteforge_leapfrog_opportunities` after each self-improve cycle to re-prioritize.

### C6 — Where do the 4 failing tests live?
**Decision (investigated 2026-04-14):** Pre-existing failures confirmed and documented:
1. `packages/mcp/src/e2e-waves.test.ts` — "records and queries lessons" — real failure.
   Root cause: `packages/danteforge/dist/sql-wasm.wasm` is missing from DanteForge 0.8.0
   distribution. Not our code; not fixable without a DanteForge release update.
2. `packages/cli/src/integration.test.ts` and `packages/vscode/src/__tests__/codebase-index-manager.test.ts`
   — fail only under full parallel run; pass in isolation. Root cause: the danteforge
   wasm crash cascades and corrupts timing in parallel test workers.
**Policy:** These 3 failures are pre-existing and do not block Sprint A. Any new failure
introduced by our sprints is a blocker and must be fixed before score is claimed.

### C7 — Does `danteforge oss-intel` exist as a CLI command?
**Decision:** `oss-intel` is not confirmed in the installed DanteForge 0.8.0 CLI.
Alternative: run `/oss` slash command which executes the full autonomous OSS research
pipeline (auto-detect → search → clone → scan → extract → implement). This also seeds
the `ADOPTION_QUEUE.md` for `danteforge_harvest_next_pattern` to consume.

### C8 — Enterprise path: what is the minimum dim 28 MVP?
**Decision (Sprint K):** Minimum viable dim 28 = 8 (not 9) for Phase 1:
1. Read-only session sharing (shareable workspace link)
2. Org-level skill config file (`~/.dantecode/org-config.json`)
3. Audit log export command (`dantecode audit export --format json`)
4. Usage stats dashboard (CLI: `dantecode stats`)
Full SSO/SAML is Phase 2. An env-var guard (`process.env.DANTECODE_SSO_PROVIDER`) marks
the integration point for Phase 2 SAML wiring without leaving dead code.

---

## Deferred to Phase 2

- Billing model: per-seat, usage-based, or freemium — decided at Phase 2 kickoff
- Distribution: npm package only through Phase 1; marketplace listing is Phase 2
- Model hosting: author-managed API keys only through Phase 1
- JetBrains package: maintained in packages/jetbrains; deprecation requires explicit vote

---
_Clarification complete. Next: /plan_
