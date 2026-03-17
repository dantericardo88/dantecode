# TASKS.md - OSS v1 Execution Checklist

**Date:** 2026-03-17

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
- [x] Mark VS Code as preview primary surface and desktop as experimental
- [x] Remove the stale root `STATE.yaml` artifact
- [x] Add a machine-readable `release-matrix.json` and `npm run release:matrix`

## Phase 3 - Release path alignment

- [x] Make npm the official install path
- [x] Align `scripts/install.sh` with npm package distribution
- [x] Update publish workflow to validate root gates
- [x] Ensure publish workflow can be run as a dry-run path
- [x] Add `npm run release:doctor` for git, auth, provider, and publish readiness

## Phase 4 - External acceptance

- [x] Set real git identity for public history
- [x] Push to GitHub and verify first Actions run (CI green: all 8 jobs pass)
- [!] Add `NPM_TOKEN`
- [!] Add `VSCE_PAT`
- [ ] Run `npm run smoke:provider -- --require-provider` with real credentials
- [x] Add a scripted fixture-based Claude-style skill import acceptance pass

## Phase 5 - Market leader features (Day 4-6)

- [x] MCP protocol: `@dantecode/mcp` package (client, server, tool-bridge, config)
- [x] MCP CLI integration: `/mcp` command, tool-schemas merging, agent-loop dispatch
- [x] Background agent runner: `BackgroundAgentRunner` with queue and concurrency
- [x] Background agents CLI: `/bg` command (enqueue, list, cancel, clear)
- [x] Semantic code indexing: `CodeIndex` with TF-IDF and chunking
- [x] Code search CLI: `/index` and `/search` commands
- [x] Chat persistence: `SessionStore` file-based sessions
- [x] VS Code sidebar SessionStore integration (replaced globalState)
- [x] VS Code command polish: PDSE diagnostics fix, GStack STATE.yaml, Lessons empty-state, Init check
- [x] VS Code streaming UX: diff truncation, cancellation flag, error recovery
- [x] Integration tests: CLI + MCP (19 new tests)
- [x] vitest.config: MCP package added to coverage gate
- [x] Documentation: README features table, SPEC new packages, TASKS Phase 5, CHANGELOG
- [ ] Runtime catalog: model + provider metadata for UI dropdowns
- [x] First GitHub push + CI green (all 8 jobs: format, typecheck, lint, test x3, windows-smoke, anti-stub)
- [ ] Tag v1.0.0-beta.1

## Current local baseline

- [x] `npm run typecheck` — 16 packages, zero errors
- [x] `npm run lint` — 16 packages, zero violations
- [x] `npm test` — 828 tests passing across 37 suites
- [x] `npm run test:coverage` — coverage gate enforced for core, danteforge, git-engine, mcp, skill-adapter

## Notes

- The coverage gate is scoped to the stable runtime packages for OSS v1.
- Preview and beta surfaces still run in the shared test suite and should continue gaining coverage over time.
- 10 packages total (config-types, core, mcp, danteforge, git-engine, skill-adapter, sandbox, cli, vscode, desktop).
