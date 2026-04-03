> Live readiness state: `artifacts/readiness/current-readiness.json`
> Live score report: `artifacts/scoring/current-score-report.json`

# DanteCode Scoring Framework

This file is an interpretation layer for the same-commit artifacts. If evidence is missing, the score stays low or unverified. No aspirational score should be treated as earned.

## Current Snapshot

- Commit: `6b9b62cd1bc4`
- Readiness: `local-green-external-pending`
- Score report generated: `2026-03-27T16:37:10.250Z`

| Area | Current | Basis | Notes |
| --- | --- | --- | --- |
| A. Engineering Quality | **10.0** | Measured | 7,132 passing tests, 48/48 packages typecheck clean, local build/lint/release gate green |
| B. Verification Quality | **Unscored** | Partial | Verification infrastructure exists, but the repo does not yet have receipt-backed benchmark evidence for all B dimensions |
| C. User Experience | **6.7** | Measured | `/help` default surface is strong, but docs time-to-value is still `0` because no stopwatch evidence is recorded |
| D. Distribution | **5.0** | Measured | Install smoke and CI examples are strong; external users and third-party skill ecosystem are still `0` |

## Measured Dimensions

| ID | Dimension | Score | Evidence |
| --- | --- | --- | --- |
| A-1 | Test Suite | 10 | 7,132 passing tests, 0 failures |
| A-2 | Type Safety | 10 | 48/48 packages clean |
| C-1 | Docs Time To Value | 0 | No stopwatch evidence recorded in `artifacts/scoring/docs-time-to-value.json` |
| C-3 | Help Discoverability | 10 | 15 commands shown by default in `/help` |
| C-6 | Command Surface Ratio | 10 | 15/107 commands shown by default (`0.140`) |
| D-1 | Install Success Rate | 10 | `npm run smoke:install` passes |
| D-2 | External Users | 0 | 0 successful external sessions recorded |
| D-3 | Skill Ecosystem | 0 | 0 importable third-party skills recorded |
| D-4 | CI Integration | 10 | 3/3 configured platforms: GitHub Actions, GitLab CI, CircleCI |

## Readiness Reality

Local quality gates are green for the current commit, but public-ready proof is still incomplete. Same-commit blockers still open in `artifacts/readiness/current-readiness.json` are:

- `windowsSmoke` gate is still `unknown`
- `publishDryRun` external gate is still `unknown`
- `liveProvider` external gate is still `unknown`
- GitHub CI for commit `6b9b62cd1bc4` is not yet green
- provider credentials are not configured for the live smoke
- `NPM_TOKEN` is not configured for publish validation

## What Must Happen To Reach Honest 9+

### Repo / process proof

- Get same-commit GitHub CI green for `6b9b62cd1bc4` or a newer release candidate SHA
- Run and record `windowsSmoke`, `publishDryRun`, and `liveProvider`
- Add `NPM_TOKEN` and, if publishing the preview extension, `VSCE_PAT`

### Score B proof

- Build a receipt-backed verification benchmark set for PDSE, anti-confabulation, evidence-chain integrity, gaslight improvement rate, and run-report usefulness
- Replace prose-only claims with measured reports under `artifacts/scoring/`

### Score C proof

- Record real stopwatch trials in `artifacts/scoring/docs-time-to-value.json`
- Add user-tested evidence for error clarity and verification trust

### Score D proof

- Record real external-user sessions in `artifacts/scoring/external-users.json`
- Record real third-party imported skills in `artifacts/scoring/skill-ecosystem.json`
- Keep the CI examples green on GitHub Actions, GitLab CI, and CircleCI

## Automation

- `npm run measure:scores`
- `npm run release:check`
- `npm run release:prove-quickstart`
- `npm run release:sync`
