# DanteCode Scoring Framework

This document defines the metrics used to evaluate DanteCode's readiness for external users. All scores are evidence-backed — a score without evidence is a 0.

## Existing Scores

- **Score A (Engineering Quality):** Code correctness, test coverage, type safety, anti-stub compliance
- **Score B (Verification Quality):** PDSE accuracy, GStack pass rate, constitution enforcement

## Score C — User Experience

| # | Dimension | Definition | Scale | Current |
|---|-----------|-----------|-------|---------|
| C-1 | Time to First Value | Seconds from `npm install -g @dantecode/cli` to first useful code generation | 10: <60s, 8: <120s, 6: <300s, 4: >300s, 0: fails | — |
| C-2 | Init Friction | Number of manual steps after `dantecode init` before first productive session | 10: 0 steps, 8: 1, 6: 2, 4: 3+, 0: impossible | — |
| C-3 | Help Discoverability | Can a user find what they need via `/help` within 10 seconds? | 10: always, 8: usually, 6: sometimes, 4: rarely, 0: never | — |
| C-4 | Error Clarity | % of error messages that include what failed, why, and suggested fix | 10: 100%, 8: 90%, 6: 80%, 4: <80%, 0: cryptic | — |
| C-5 | Verification Trust | Does verification output increase user confidence in the tool? | 10: always, 8: usually, 6: mixed, 4: confusing, 0: harmful | — |
| C-6 | Command Surface Ratio | Ratio of commands user needs vs commands shown by default | 10: perfect, 8: slight excess, 6: moderate, 4: overwhelming, 0: unusable | — |

**Measurement method:** Timed manual test on 3 fresh project types (Node/TS, Python, Rust). Score C is the average of all 6 dimensions.

## Score D — Distribution & Network Effects

| # | Dimension | Definition | Scale | Current |
|---|-----------|-----------|-------|---------|
| D-1 | Install Success Rate | % of `npm install -g` attempts that succeed across Node 18/20/22 | 10: 100%, 8: 99%, 6: 95%, 4: <95%, 0: broken | — |
| D-2 | External Users | Number of non-team developers who have completed a successful session | 10: 100+, 8: 50+, 6: 10+, 4: 1-9, 0: none | — |
| D-3 | Skill Ecosystem | Number of importable third-party skills | 10: 100+, 8: 50+, 6: 10+, 4: 1-9, 0: none | — |
| D-4 | CI Integration | Working CI integration examples (GitHub Actions, GitLab CI, etc.) | 10: 3+ platforms, 8: 2, 6: 1, 4: WIP, 0: none | — |
| D-5 | Documentation | README-to-working-app time | 10: <5min, 8: <15min, 6: <30min, 4: >30min, 0: impossible | — |

**Measurement method:** CI matrix results (D-1), telemetry/proxy metrics (D-2, D-3), manual audit (D-4, D-5). Score D is the average of all 5 dimensions.

## Score Summary

| Score | Name | Weight | Current | Target |
|-------|------|--------|---------|--------|
| A | Engineering Quality | 30% | (measured) | 8.0+ |
| B | Verification Quality | 30% | (measured) | 8.0+ |
| C | User Experience | 25% | — | 7.0+ |
| D | Distribution | 15% | — | 5.0+ |
| **Overall** | | | — | **7.0+** |

Scores must be updated with every release. Evidence for each score should be linked from the release notes.
