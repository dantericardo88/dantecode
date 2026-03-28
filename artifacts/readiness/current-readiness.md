# DanteCode Readiness

**Status:** private-ready  
**Scope:** repo-proof  
**Commit:** `6b9b62cd1bc4`  
**Generated:** 2026-03-27T18:42:36.967Z

## Gates

| Gate | Status |
|------|--------|
| typecheck | pass |
| lint | pass |
| test | pass |
| build | pass |
| windowsSmoke | pass |
| antiStub | pass |
| liveProvider | unknown |
| publishDryRun | pass |

## Release Doctor

- canPublish: false
- blockers: 3
- actions: 4

## Quickstart Proof

- canClaimQuickstart: false
- blockers: 0
- actions: 1

## Open Requirements (publicReady)

- Gate "liveProvider" must pass. Current status: unknown.
- Release doctor blocker: GitHub CI for 6b9b62cd1bc4 concluded failure.
- Release doctor blocker: No provider credentials detected for the live model-router smoke test.
- Release doctor blocker: No npm publish auth token detected locally or in GitHub Actions secrets.
- Quickstart proof action: Same-commit live provider receipt is missing or unknown. Generate it with real credentials.
