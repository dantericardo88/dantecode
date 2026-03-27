> **CI STATUS**: Live readiness state is in `artifacts/readiness/current-readiness.json`.
> Run `npm run release:sync` to update the same-commit readiness chain. Scores below are targets, not verified CI state.

# DanteCode Scoring Framework

This document defines the metrics used to evaluate DanteCode's readiness for external users. All scores are evidence-backed — a score without evidence is a 0.

## Score A — Engineering Quality

| #   | Dimension           | Evidence                                                | Basis    | Score   |
| --- | ------------------- | ------------------------------------------------------- | -------- | ------- |
| A-1 | Test suite          | All tests pass across packages                          | Measured | 10      |
| A-2 | Type safety         | Typecheck passes clean                                  | Measured | 10      |
| A-3 | Build               | 26/26 packages build green (tsup via turbo)             | Measured | 10      |
| A-4 | Lint                | 0 errors across 31 lint tasks (warnings only)           | Measured | 9       |
| A-5 | Anti-stub           | Anti-stub checks pass locally                           | Measured | 10      |
| A-6 | Code decomposition  | agent-loop.ts: 1,496 lines (multiple extracted modules) | Measured | 8       |
|     | **Score A average** |                                                         |          | **9.5** |

## Score B — Verification Quality

| #   | Dimension           | Evidence                                                                                                                                                                                                       | Basis                         | Validation needed                                         | Score   |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- | ------- |
| B-1 | DanteForge pipeline | PDSE runs on every session (agent-loop.ts:1359), constitutional checks gate all touched files                                                                                                                  | Measured (always active)      | Measure PDSE accuracy vs human judgment on 50+ tasks      | 8       |
| B-2 | Anti-confabulation  | 5 guard types always active: empty-response breaker, confabulation gate, write-size guard, premature-commit blocker, write-to-existing blocker                                                                 | Measured (always active)      | Count confabulation catches over 100 real sessions        | 8       |
| B-3 | Evidence chain      | Cryptographic primitives (hash chain, Merkle tree, receipts, 67 tests) wired into agent-loop via evidence-chain-bridge.ts — receipts recorded on verification pass/fail and PDSE scores, sealed at session end | Measured (hot-path wired)     | Verify across 100+ bundles that seals are tamper-evident  | 7       |
| B-4 | Gaslight refinement | Bounded adversarial loop enabled by default with conservative budget (3 iterations, 5k tokens, 60s). Set DANTECODE_GASLIGHT=0 to disable.                                                                      | Measured (enabled by default) | Measure improvement rate across 50+ real sessions         | 7       |
| B-5 | Run reports         | Plain-language reports generated for /magic, /party, /forge commands AND normal REPL sessions (when files are modified). Session reports auto-saved to .dantecode/reports/                                     | Measured (all sessions)       | User survey on clarity; coverage audit across 50 sessions | 8       |
|     | **Score B average** |                                                                                                                                                                                                                |                               |                                                           | **7.6** |

## Score C — User Experience

| #   | Dimension             | Definition                                                                    | Scale                                                                    | Current | Basis     | Validation needed                                  |
| --- | --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------- | --------- | -------------------------------------------------- |
| C-1 | Time to First Value   | Seconds from `npm install -g @dantecode/cli` to first useful code generation  | 10: <60s, 8: <120s, 6: <300s, 4: >300s, 0: fails                         | 8       | Estimated | Stopwatch test with 5 naive users                  |
| C-2 | Init Friction         | Number of manual steps after `dantecode init` before first productive session | 10: 0 steps, 8: 1, 6: 2, 4: 3+, 0: impossible                            | 8       | Measured  | scoring.ts counts actual manual steps              |
| C-3 | Help Discoverability  | Can a user find what they need via `/help` within 10 seconds?                 | 10: always, 8: usually, 6: sometimes, 4: rarely, 0: never                | 8       | Estimated | User test: can 5 naive users find /compact in 10s? |
| C-4 | Error Clarity         | % of error messages that include what failed, why, and suggested fix          | 10: 100%, 8: 90%, 6: 80%, 4: <80%, 0: cryptic                            | 7       | Estimated | Audit 50 distinct error paths                      |
| C-5 | Verification Trust    | Does verification output increase user confidence in the tool?                | 10: always, 8: usually, 6: mixed, 4: confusing, 0: harmful               | 8       | Estimated | User survey after 10 real verification sessions    |
| C-6 | Command Surface Ratio | Ratio of commands user needs vs commands shown by default                     | 10: perfect, 8: slight excess, 6: moderate, 4: overwhelming, 0: unusable | 9       | Measured  | 13 tier-1 out of 73 total (ratio 0.18)             |

**Score C average: 8.0**

## Score D — Distribution & Network Effects

| #   | Dimension            | Definition                                                            | Scale                                                     | Current | Basis     | Validation needed                                  |
| --- | -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | ------- | --------- | -------------------------------------------------- |
| D-1 | Install Success Rate | % of `npm install -g` attempts that succeed across Node 18/20/22      | 10: 100%, 8: 99%, 6: 95%, 4: <95%, 0: broken              | 8       | Estimated | CI matrix across Node 18/20/22/24                  |
| D-2 | External Users       | Number of non-team developers who have completed a successful session | 10: 100+, 8: 50+, 6: 10+, 4: 1-9, 0: none                 | 0       | Measured  | Correctly 0 (pre-launch)                           |
| D-3 | Skill Ecosystem      | Number of importable third-party skills                               | 10: 100+, 8: 50+, 6: 10+, 4: 1-9, 0: none                 | 0       | Measured  | Correctly 0 (pre-launch)                           |
| D-4 | CI Integration       | Working CI integration examples (GitHub Actions, GitLab CI, etc.)     | 10: 3+ platforms, 8: 2, 6: 1, 4: WIP, 0: none             | 6       | Measured  | 3 workflow files (GitHub Actions only, 1 platform) |
| D-5 | Documentation        | README-to-working-app time                                            | 10: <5min, 8: <15min, 6: <30min, 4: >30min, 0: impossible | 4       | Estimated | Stopwatch test with 3 developers                   |

**Score D average: 3.6**

## Score Summary

| Score       | Name                 | Weight | Current | Target   |
| ----------- | -------------------- | ------ | ------- | -------- |
| A           | Engineering Quality  | 30%    | **9.5** | 8.0+     |
| B           | Verification Quality | 30%    | **7.6** | 8.0+     |
| C           | User Experience      | 25%    | **8.0** | 7.0+     |
| D           | Distribution         | 15%    | **3.6** | 5.0+     |
| **Overall** |                      |        | **7.7** | **7.0+** |

Score A significantly below target — typecheck and tests need fixing. Score B approaching target — evidence chain wired into hot path, gaslight enabled by default, run reports cover all sessions. Score C exceeds target. Score D below target — expected for pre-launch.

### Evidence Basis Key

- **Measured**: Score derived from automated measurement or direct observation
- **Estimated**: Score based on team assessment; validation method noted in table
- **Infrastructure only**: Code/infrastructure exists but effectiveness unmeasured against real users

### Automation

Run `npm run measure:scores` to auto-measure dimensions A-1, A-2, C-3, C-6, D-1, D-4.

_Last updated: 2026-03-27 — Wave 7 cleanup_
