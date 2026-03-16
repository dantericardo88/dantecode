# Changelog

All notable changes to DanteCode are documented here.

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
