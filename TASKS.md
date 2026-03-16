# TASKS.md - OSS v1 Execution Checklist

**Date:** 2026-03-16

## Legend

- `[x]` complete
- `[ ]` pending
- `[!]` blocked on external credentials or services

## Phase 1 - Repo truth

- [x] Fix workspace test discovery so package `test` scripts run correctly
- [x] Repair `packages/core/src/integration.test.ts` for current `ModelConfig`
- [x] Replace unsafe `Function` test helper types in desktop and sandbox tests
- [x] Fix Windows GStack execution for shell built-ins like `echo`
- [x] Make root npm gates canonical: build, typecheck, lint, test, coverage

## Phase 2 - Product and docs alignment

- [x] Rewrite public messaging around portable skills and model-agnostic runtime behavior
- [x] Add canonical [VISION.md](VISION.md)
- [x] Standardize docs on `.dantecode/STATE.yaml`
- [x] Remove Bun-first instructions from public docs
- [x] Mark VS Code as preview and desktop as beta
- [x] Remove the stale root `STATE.yaml` artifact

## Phase 3 - Release path alignment

- [x] Make npm the official install path
- [x] Align `scripts/install.sh` with npm package distribution
- [x] Update publish workflow to validate root gates
- [x] Ensure publish workflow can be run as a dry-run path
- [x] Add `npm run release:doctor` for git, auth, provider, and publish readiness

## Phase 4 - External acceptance

- [!] Set real git identity for public history
- [!] Push to GitHub and verify first Actions run
- [!] Add `NPM_TOKEN`
- [!] Add `VSCE_PAT`
- [ ] Run `npm run smoke:provider -- --require-provider` with real credentials
- [x] Add a scripted fixture-based Claude-style skill import acceptance pass

## Current local baseline

- [x] `npm run build`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run test:coverage`
- [x] `npm run release:doctor`
- [x] `npm run smoke:skill-import`

## Notes

- `npm test` currently passes with 562 tests across 24 suites.
- The strict coverage gate is scoped to the stable runtime packages for OSS v1.
- Preview and beta surfaces still run in the shared test suite and should continue gaining coverage over time.
