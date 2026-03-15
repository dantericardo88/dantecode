# Changelog

All notable changes to DanteCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-03-15

### Added

- **Monorepo architecture** — 9 TypeScript packages managed with Turbo + Bun
  - `@dantecode/config-types` — Shared TypeScript interfaces and type definitions
  - `@dantecode/core` — Model router, audit logger, state management, provider adapters
  - `@dantecode/danteforge` — Anti-stub scanner, PDSE scorer, constitution checker, autoforge IAL, lessons system
  - `@dantecode/git-engine` — Git diff parser, commit builder, repo mapper, worktree manager
  - `@dantecode/skill-adapter` — Skill importer, registry, wrapper, parsers (Claude, Continue, Opencode)
  - `@dantecode/sandbox` — Docker-based sandbox executor with local fallback
  - `@dantecode/cli` — Interactive REPL and one-shot CLI with argument parsing
  - `dantecode` (VS Code extension) — 11 commands, inline completion, diagnostics, sidebar chat, audit panel
  - `@dantecode/desktop` — Electron shell with IPC bridge and native menus
- **Model-agnostic architecture** — Support for Grok, Anthropic, OpenAI, Google, and Ollama providers
- **DanteForge quality gates** — Anti-stub enforcement, PDSE scoring (4 dimensions), constitution checker
- **Autoforge IAL** — Iterative auto-correction loop with configurable max iterations
- **GStack** — Guard stack for sequential typecheck/lint/test command execution
- **Lessons system** — Persistent correction tracking with severity and occurrence counting
- **Audit logging** — JSONL-based event log with session tracking, filtering, and pagination
- **Skill adapter** — Import and wrap skills from Claude Code, Continue, and Opencode formats
- **Git integration** — Unified diff parsing, atomic commit building, repo mapping, worktree management
- **VS Code extension** — Inline ghost-text completions with PDSE annotation, diagnostics panel, chat sidebar
- **Desktop app** — Electron shell with context isolation, sandbox mode, native menus

### Infrastructure

- **CI pipeline** — GitHub Actions with 5 jobs: format, typecheck, lint, test+coverage, anti-stub self-check
- **Test suite** — 467 tests across 21 suites, 94.55% statement coverage, 99.09% function coverage
- **Code quality** — ESLint (typescript-eslint flat config) + Prettier with zero violations
- **Dependency management** — Dependabot configured for weekly npm and GitHub Actions updates
- **Coverage reporting** — V8 provider with text and JSON summary reporters

### Documentation

- `README.md` — Install, quickstart, architecture, configuration, supported providers
- `CONSTITUTION.md` — 10 immutable rules governing agent behavior
- `SPEC.md` — Package specifications and interface contracts
- `PLAN.md` — 5-phase implementation plan
- `TASKS.md` — Granular task breakdown with status tracking
- `AGENTS.dc.md` — Agent configuration and DanteForge directives
- `Docs/DanteCode_PRD_v1.0.md` — Comprehensive product requirements document (89KB)

[1.0.0]: https://github.com/dantecode/dantecode/releases/tag/v1.0.0
