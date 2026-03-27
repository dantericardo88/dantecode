# DanteCode Readiness

**Status:** blocked  
**Scope:** repo-proof  
**Commit:** `2eab47dbf137`  
**Generated:** 2026-03-27T10:50:03.412Z

## Gates

| Gate | Status |
|------|--------|
| typecheck | fail |
| lint | pass |
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
- Gate "test" failed

## Open Requirements (privateReady)

- Gate "typecheck" must pass. Current status: fail.
- Gate "test" must pass. Current status: fail.
- Gate "windowsSmoke" must pass. Current status: unknown.
- Gate "publishDryRun" must pass. Current status: unknown.

## Open Requirements (publicReady)

- Gate "typecheck" must pass. Current status: fail.
- Gate "test" must pass. Current status: fail.
- Gate "windowsSmoke" must pass. Current status: unknown.
- Gate "publishDryRun" must pass. Current status: unknown.
- Gate "liveProvider" must pass. Current status: unknown.
- Release doctor receipt is missing for the current commit. Run `npm run release:doctor` to validate publish blockers.
- Quickstart proof receipt is missing for the current commit. Run `npm run release:prove-quickstart` to validate the README quickstart path.
