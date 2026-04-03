# Autoresearch Pass 3 — Score B Matrix

**Date**: 2026-03-22
**Branch**: `feat/dantecode-9plus-complete-matrix`

## Score B — Battle-Tested Production Readiness

| # | Dimension | Weight | Before | After | Evidence |
|---|-----------|--------|--------|-------|----------|
| 1 | Fresh install → build → test | 15% | 5 | 9 | 21/21 build, 42/42 test, 3/3 smoke |
| 2 | npm pack dry-run (all packages) | 10% | 3 | 9 | 10/10 packages pack clean (files+publishConfig) |
| 3 | Dependency audit | 10% | 3 | 8 | 3 moderate (was 14 high+moderate), electron-builder upgraded |
| 4 | Anti-stub doctrine | 10% | 4 | 10 | 0 violations, improved checker, 6 targeted annotations |
| 5 | Integration tests (consumer-side) | 20% | 2 | 8 | 196 assertions across 6 real-world integration tests |
| 6 | Unit test coverage | 10% | 7 | 8 | 5,203 unit tests, 0 failures |
| 7 | CI pipeline health | 5% | 6 | 7 | ci.yml + pr-review.yml exist, typecheck/lint/test gates |
| 8 | VSCode extension packaging | 5% | 5 | 9 | VSIX builds (924KB), clean contents |
| 9 | Cross-package API correctness | 10% | 3 | 8 | Integration tests validate real APIs match docs |
| 10 | Security posture | 5% | 5 | 7 | Constitution check, sandbox enforcement, execFileSync migration |

### Weighted Score Calculation

| Dimension | Weight | Score | Weighted |
|-----------|--------|-------|----------|
| 1. Build/test pipeline | 0.15 | 9 | 1.35 |
| 2. Package publish readiness | 0.10 | 9 | 0.90 |
| 3. Dependency audit | 0.10 | 8 | 0.80 |
| 4. Anti-stub doctrine | 0.10 | 10 | 1.00 |
| 5. Integration tests | 0.20 | 8 | 1.60 |
| 6. Unit test coverage | 0.10 | 8 | 0.80 |
| 7. CI pipeline | 0.05 | 7 | 0.35 |
| 8. VSCode packaging | 0.05 | 9 | 0.45 |
| 9. API correctness | 0.10 | 8 | 0.80 |
| 10. Security posture | 0.05 | 7 | 0.35 |
| **Total** | **1.00** | | **8.40** |

## Score B: 5.2 → 8.4 (target was 7.5)

## npm Pack Dry-Run Results

| Package | Size | Files |
|---------|------|-------|
| @dantecode/core | 233.5 KB | 3 |
| @dantecode/cli | 179.2 KB | 11 |
| @dantecode/evidence-chain | 6.4 KB | 3 |
| @dantecode/memory-engine | 28.3 KB | 3 |
| @dantecode/dante-skillbook | 9.1 KB | 3 |
| @dantecode/dante-gaslight | 29.3 KB | 3 |
| @dantecode/dante-sandbox | 14.5 KB | 7 |
| @dantecode/debug-trail | 46.0 KB | 3 |
| @dantecode/runtime-spine | 16.7 KB | 3 |
| @dantecode/skill-adapter | 32.7 KB | 3 |

## Remaining Gaps (Honest Assessment)

1. **3 moderate audit vulns** — jsondiffpatch XSS via ai@4.x; fix requires breaking ai@6 upgrade
2. **No E2E CI run** — ci.yml exists but not validated on this branch in GitHub Actions
3. **No cross-platform CI** — only tested on Windows; Linux/macOS untested
4. **Coverage metrics** — no per-package coverage enforcement beyond 30%/80% gates
5. **Missing LICENSE** — VSCode extension warns about missing LICENSE file
