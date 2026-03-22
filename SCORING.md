# DanteCode Scoring Framework

This document defines the metrics used to evaluate DanteCode's readiness for external users. All scores are evidence-backed — a score without evidence is a 0.

## Score A — Engineering Quality

| # | Dimension | Evidence | Score |
|---|-----------|----------|-------|
| A-1 | Test suite | 5,364 tests across 19 packages, 0 failures | 10 |
| A-2 | Type safety | 38/38 packages typecheck clean (tsc --noEmit) | 10 |
| A-3 | Build | 21/21 packages build green (tsup via turbo) | 10 |
| A-4 | Lint | 0 errors across 31 lint tasks (warnings only) | 9 |
| A-5 | Anti-stub | Anti-stub checks pass in CI gate | 9 |
| A-6 | Code decomposition | agent-loop.ts: 3,016 → 1,496 lines (11 extracted modules) | 8 |
| | **Score A average** | | **9.3** |

## Score B — Verification Quality

| # | Dimension | Evidence | Score |
|---|-----------|----------|-------|
| B-1 | DanteForge pipeline | Compiled binary, constitutional checks, PDSE scoring | 8 |
| B-2 | Anti-confabulation | 5 guard types + diff-based verification | 8 |
| B-3 | Evidence chain | Cryptographic primitives (hash chain, Merkle tree, receipts) | 8 |
| B-4 | Gaslight refinement | Bounded adversarial loop, 5 stop conditions, lesson distillation | 8 |
| B-5 | Run reports | Plain-language reports with verification status per entry | 8 |
| | **Score B average** | | **8.0** |

## Score C — User Experience

| # | Dimension | Definition | Scale | Current |
|---|-----------|-----------|-------|---------|
| C-1 | Time to First Value | Seconds from `npm install -g @dantecode/cli` to first useful code generation | 10: <60s, 8: <120s, 6: <300s, 4: >300s, 0: fails | 8 |
| C-2 | Init Friction | Number of manual steps after `dantecode init` before first productive session | 10: 0 steps, 8: 1, 6: 2, 4: 3+, 0: impossible | 8 |
| C-3 | Help Discoverability | Can a user find what they need via `/help` within 10 seconds? | 10: always, 8: usually, 6: sometimes, 4: rarely, 0: never | 8 |
| C-4 | Error Clarity | % of error messages that include what failed, why, and suggested fix | 10: 100%, 8: 90%, 6: 80%, 4: <80%, 0: cryptic | 7 |
| C-5 | Verification Trust | Does verification output increase user confidence in the tool? | 10: always, 8: usually, 6: mixed, 4: confusing, 0: harmful | 8 |
| C-6 | Command Surface Ratio | Ratio of commands user needs vs commands shown by default | 10: perfect, 8: slight excess, 6: moderate, 4: overwhelming, 0: unusable | 9 |

**Evidence:** 13 tier-1 commands shown by default (was 70). Smoke tests pass across Node/TS, Python, Rust, Go, JS, empty projects. `dantecode init` auto-detects project type with zero manual config.

**Score C average: 8.0**

## Score D — Distribution & Network Effects

| # | Dimension | Definition | Scale | Current |
|---|-----------|-----------|-------|---------|
| D-1 | Install Success Rate | % of `npm install -g` attempts that succeed across Node 18/20/22 | 10: 100%, 8: 99%, 6: 95%, 4: <95%, 0: broken | 8 |
| D-2 | External Users | Number of non-team developers who have completed a successful session | 10: 100+, 8: 50+, 6: 10+, 4: 1-9, 0: none | 0 |
| D-3 | Skill Ecosystem | Number of importable third-party skills | 10: 100+, 8: 50+, 6: 10+, 4: 1-9, 0: none | 0 |
| D-4 | CI Integration | Working CI integration examples (GitHub Actions, GitLab CI, etc.) | 10: 3+ platforms, 8: 2, 6: 1, 4: WIP, 0: none | 4 |
| D-5 | Documentation | README-to-working-app time | 10: <5min, 8: <15min, 6: <30min, 4: >30min, 0: impossible | 4 |

**Evidence:** npm pack produces valid 560.9 KB tarball (37 files). Smoke-install test passes. GitHub Actions integration exists (.github/actions/dantecode-review). No external users or third-party skills yet (pre-launch).

**Score D average: 3.2**

## Score Summary

| Score | Name | Weight | Current | Target |
|-------|------|--------|---------|--------|
| A | Engineering Quality | 30% | **9.3** | 8.0+ |
| B | Verification Quality | 30% | **8.0** | 8.0+ |
| C | User Experience | 25% | **8.0** | 7.0+ |
| D | Distribution | 15% | **3.2** | 5.0+ |
| **Overall** | | | **7.5** | **7.0+** |

**Overall = (9.3 * 0.30) + (8.0 * 0.30) + (8.0 * 0.25) + (3.2 * 0.15) = 2.79 + 2.40 + 2.00 + 0.48 = 7.67**

Scores A, B, C exceed targets. Score D below target — expected for pre-launch; requires external users and documentation to improve.

*Last updated: 2026-03-22 — OnRamp v1.3 final sprint*

Scores must be updated with every release. Evidence for each score should be linked from the release notes.
