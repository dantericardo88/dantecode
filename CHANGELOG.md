# Changelog

All notable changes to DanteCode are documented here.

## [Unreleased] - 2026-03-17

### Added (Phase 5 — Market Leader Features)

- **MCP Protocol** (`@dantecode/mcp`): New package with MCP client manager (stdio/SSE), tool bridge (JSON Schema to Zod), and DanteCode MCP server exposing DanteForge tools to external agents.
- **Background Agents** (`@dantecode/core`): `BackgroundAgentRunner` with task queue, concurrency control, progress callbacks, and cancellation. CLI `/bg` command for task management.
- **Semantic Code Indexing** (`@dantecode/core`): `CodeIndex` with TF-IDF scoring, function/class boundary chunking, cosine similarity search, and persistence. CLI `/index` and `/search` commands.
- **Chat Persistence** (`@dantecode/core`): `SessionStore` with file-based session storage in `.dantecode/sessions/`. VS Code sidebar now persists chat history to disk with automatic globalState migration.
- **MCP CLI Integration**: `/mcp` command, MCP tool merging in `getAISDKTools()`, 3-way tool dispatch (MCP/sandbox/native) in agent loop.
- **VS Code Command Polish**: PDSE diagnostics now correctly populate the Problems panel. GStack reads commands from STATE.yaml. Lessons shows empty-state guidance. Init checks for already-initialized projects.
- **VS Code Streaming UX**: Diff truncation at 80 lines, cancellation flag on `chat_response_done`, error recovery to prevent stuck loading.
- **Integration Tests**: 19 new integration tests covering background agents, code indexing, session persistence, MCP tool bridge, and config parsing.
- **Runtime Catalog** (`@dantecode/core`): Model and provider metadata with support tiers for UI model pickers.

### Validation

- `npm run typecheck` — 16 packages, zero errors
- `npm run lint` — 16 packages, zero violations
- `npm test` — 828 tests across 37 suites (up from 562)
- Coverage gate now includes `@dantecode/mcp`

---

## [Unreleased] - 2026-03-16

### Changed

- Repositioned DanteCode as a portable, model-agnostic skill runtime and coding agent.
- Reframed DanteForge as the verification and differentiation layer.
- Standardized the repo on npm-first install, validation, and publish guidance.
- Made `.dantecode/STATE.yaml` the only public-facing canonical config path.
- Scoped the strict coverage gate to the stable OSS v1 runtime packages.

### Fixed

- Repaired workspace-local Vitest execution so package test scripts discover their own suites.
- Updated integration tests to match the current `ModelConfig` schema.
- Replaced unsafe bare `Function` helper types in desktop and sandbox tests.
- Fixed Windows GStack execution for shell built-ins such as `echo`.
- Removed stale `dante.config.yaml` references from provider errors and shared type comments.

### Added

- `VISION.md` to capture the portability-first product direction.
- `RELEASE.md` to give OSS v1 a single public release runbook.
- Publish workflow validation for build, typecheck, lint, tests, and coverage.
- npm-aligned installer script for the CLI package.
- Cross-platform npm runner and smoke scripts for CLI/install/publish release validation.
- A single `npm run release:check` command for the full local ship-readiness sweep.
- `npm run release:doctor` to surface git identity, remote, provider, and publish blockers before shipping.
- Fixture-based skill import smoke validation and a provider smoke harness for external acceptance.

### Validation

- Local root gates are green on Node/npm.
- `npm run release:check` passes locally, including CLI smoke, install smoke, and publish dry-run.
- `npm run smoke:skill-import` passes locally and validates import, wrap, registry, and skill checks.
- `npm test` passes with 562 tests across 24 suites.
- Coverage gate is enforced for `core`, `danteforge`, `git-engine`, and `skill-adapter`.

### Still external

- First GitHub push and Actions proof
- npm and VS Code Marketplace credentials
- live provider smoke validation with real credentials
