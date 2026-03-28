# DanteCode Readiness

**Status:** blocked  
**Scope:** repo-proof  
**Commit:** `83e4b19c9d37`  
**Generated:** 2026-03-28T18:42:13.760Z

## Gates

| Gate | Status |
|------|--------|
| typecheck | fail |
| lint | fail |
| test | fail |
| build | pass |
| windowsSmoke | unknown |
| antiStub | pass |
| liveProvider | unknown |
| publishDryRun | unknown |

## Release Doctor

- missing same-commit release doctor receipt

## Quickstart Proof

- missing same-commit quickstart proof receipt

## Blockers

- Gate "typecheck" failed
- Gate "lint" failed
- Gate "test" failed

## Open Requirements (privateReady)

- Gate "typecheck" must pass. Current status: fail.
- Gate "lint" must pass. Current status: fail.
- Gate "test" must pass. Current status: fail.
- Gate "windowsSmoke" must pass. Current status: unknown.
- Gate "publishDryRun" must pass. Current status: unknown.

## Open Requirements (publicReady)

- Gate "typecheck" must pass. Current status: fail.
- Gate "lint" must pass. Current status: fail.
- Gate "test" must pass. Current status: fail.
- Gate "windowsSmoke" must pass. Current status: unknown.
- Gate "publishDryRun" must pass. Current status: unknown.
- Gate "liveProvider" must pass. Current status: unknown.
- Release doctor receipt is missing for the current commit. Run `npm run release:doctor` to validate publish blockers.
- Quickstart proof receipt is missing for the current commit. Run `npm run release:prove-quickstart` to validate the README quickstart path.
