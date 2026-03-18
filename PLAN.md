# PLAN.md - DanteCode Public OSS v1 Ship Plan

**Date:** 2026-03-16  
**Target:** Public OSS v1

## Ship target

DanteCode ships first as a portable, model-agnostic skill runtime and coding agent with:

- stable CLI
- published npm libraries
- preview VS Code extension
- beta desktop shell

## Completed locally

### 1. Repo truth and root gates

- npm-first workspace flow is the canonical toolchain
- root `build`, `typecheck`, `lint`, and `test` paths are green
- package-local Vitest execution works
- Windows GStack execution now handles shell built-ins correctly
- root-only stale config references have been removed from runtime and docs

### 2. Public positioning

- product story now centers on portability and skill interoperability
- `.dantecode/STATE.yaml` is the canonical config path
- Grok is framed as the default provider, not the product boundary
- DanteForge is framed as the verification and trust layer

### 3. Release/install alignment

- npm is the official install path
- publish workflow validates the repaired root gates
- install script now aligns with npm package distribution instead of missing binaries

## Remaining external work

### 4. GitHub proof

- set real git identity
- create or confirm the public GitHub repo
- push and verify the first green Actions run

### 5. Registry and marketplace credentials

- add `NPM_TOKEN`
- add `VSCE_PAT`
- run publish workflow dry-run in GitHub Actions

### 6. Real-world acceptance

- run `npm run release:doctor` until no blockers remain
- run `npm run smoke:provider -- --require-provider` with a real API key
- optionally run one real third-party Claude-style skill import beyond the local fixture smoke test
- record the acceptance results in the repo

## Release criteria

OSS v1 is ready when:

1. Local root gates are green.
2. GitHub Actions is green on first push.
3. npm publish dry-run succeeds.
4. One live provider route succeeds.
5. The scripted skill-import smoke test is green, plus one real-world import if desired.

## Non-goals for this release

- full desktop GA
- full VS Code GA
- binary installer distribution
- every surface held to the same coverage threshold as the core runtime
