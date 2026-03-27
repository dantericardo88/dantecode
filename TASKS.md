# TASKS.md - OSS v1 Execution Checklist

**Date:** 2026-03-18

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
- [x] CI green — all 9 CI jobs passing on GitHub Actions (feat/all-nines, run 23518615698)
- [!] Add `NPM_TOKEN`
- [!] Add `VSCE_PAT` for optional preview VS Code extension publish
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
- [x] Runtime catalog: model + provider metadata for UI dropdowns (7 providers, 22 models, 3 surfaces)
- [x] First GitHub push + CI green (all 8 jobs: format, typecheck, lint, test x3, windows-smoke, anti-stub)
- [x] Tag v1.0.0-beta.1

## Phase 6 - Competitive gap-closing sprint (Day 7)

- [x] WS1 Memory Bridge: auto-inject DanteForge lessons into system prompt, DANTE.md project notes, /remember command
- [x] WS2 Self-Healing Loop: structured error parser (TS/ESLint/Vitest), targeted fix prompts, error signature tracking
- [x] WS3 Event Gateway: webhook HTTP server (GitHub/Slack/API), /listen command, issue-to-PR wiring
- [x] WS4 Speed Completions: streaming FIM, debounce 500→200ms, multiline config, cache 50→100
- [x] WS5 Context Guardian: getContextUtilization(), CLI context meter, /compact, VS Code context bar
- [x] WS6 Autonomy Wire: EnqueueOptions (autoCommit/createPR), postCompletionHook, /bg --pr flag
- [x] Integration: 68 new tests (1,303→1,371), 16/16 typecheck, DanteForge binary rebuilt
- [x] Push to GitHub + CI green

## Current local baseline

- [x] `npm run typecheck` — requires fixing (exit 2)
- [x] `npm run lint` — all packages, zero violations
- [x] `npm test` — requires fixing (exit 1)
- [x] `npm run build` — all 26 packages built clean
- [x] `npm run smoke:cli` — passes without API keys (DANTECODE_NONINTERACTIVE)
- [x] `npm run smoke:install` — passes (packs and installs all publishable packages)
- [x] `npm run smoke:skill-import` — passes without API keys
- [x] `npm run smoke:external` — 7/7 fixture projects pass

## Completed verification artifacts (P2/P3 closure)

- [x] `artifacts/verification/samples/` — real DanteForge pipeline output (sample-pass.json, sample-stub-fail.json, README.md)
- [x] `scripts/generate-verification-samples.mjs` — regenerate via `npm run generate:samples`
- [x] `scripts/release-doctor.mjs` — Artifacts section now reads and reports `current-readiness.json`
- [x] `artifacts/readiness/quickstart-proof.json` / `artifacts/readiness/quickstart-proof.md` — generated via `npm run release:prove-quickstart` for same-commit README quickstart proof

## Notes

- The coverage gate is scoped to the stable runtime packages for OSS v1.
- Preview and experimental surfaces still run in the shared test suite and should continue gaining coverage over time.
- 26 packages currently live under `packages/`; OSS v1 ships the CLI and npm runtime packages first, keeps VS Code as preview, and leaves desktop out of ship scope.
- P2 verification spine is implemented and locally proven. Public ship proof still depends on the generated readiness surface staying green for same-commit external gates.
- P3 CLI golden flows are implemented and locally proven. Public GA remains partial until the provider-backed real run gate passes and the generated readiness artifact reaches `public-ready`.
