# Claude Code Guide for DanteCode

Onboarding doc for Claude (or any Claude-style agent — Sonnet, Opus, Haiku) about
to work in this repository. Read once, reference as needed.

## What this repo is

DanteCode is a portable, model-agnostic coding agent + skill runtime. It ships
as four surfaces:

- `@dantecode/cli` — terminal REPL agent (`packages/cli/`)
- `dantecode` (VS Code extension) — chat sidebar, inline completion, PDSE
  diagnostics, live diffs (`packages/vscode/`)
- `@dantecode/desktop` — Electron shell (`packages/desktop/`)
- `@dantecode/danteforge` — verification engine (`packages/danteforge/`,
  compiled binary; source in a separate repo)

The core (`packages/core/`) is the agent loop, model router, and tool runtime
shared by all surfaces.

## Working in this monorepo

- **Package manager**: npm workspaces. Run `npm install` once at the root.
- **Build**: `npm run build` (turbo) or per-package `npm run build --workspace=packages/<name>`.
- **Test**: `npm run test --workspace=packages/<name>`. Vitest 3.x with
  `vitest.package.config.ts` per package.
- **Type check**: `npm run typecheck --workspace=packages/<name>` (`tsc --noEmit`).
- **Lint/format**: `npm run lint`, `npm run format`.
- **Build pre-commit hook**: full test suite gate. Pre-existing failures from
  refactor drift may block commits — fix them, or `--no-verify` only when the
  failures are documented and unrelated.

## File layout you will encounter

```
packages/
  core/           # Agent loop, providers, tool runtime, resilience, validation
    src/
      errors.ts                   # Custom Error hierarchy + recovery hints
      resilience.ts               # retry, withTimeout, parallelWithLimit
      input-validation.ts         # Boundary-point sanitizers (path/URL/shell/HTML)
      agent-loop.ts               # The model-tool round-trip orchestrator
      tool-runtime/               # Verification, scheduler, approval gateway
      memory-engine               # Sub-package for session memory (5-organ)
  vscode/         # The "dantecode" extension
    src/
      sidebar-provider.ts         # Chat panel + chat orchestration
      webview-html.ts             # Webview HTML/CSS/JS template (extracted)
      ascend-orchestrator.ts      # /ascend autonomous improvement loop
      audit-panel-provider.ts     # Audit event stream UI
      __tests__/regression-guard.test.ts   # Anti-revert assertions
  cli/            # Terminal REPL
  danteforge/     # Compiled verification engine
  skill-adapter/  # Claude/Continue/OpenCode skill import
  mcp/            # MCP client + server
```

## Conventions

- **TypeScript everywhere**, ESM modules. Add `.js` extension to imports
  (`./input-validation.js` even though the file is `.ts`).
- **Discriminated unions over exceptions** for boundary-point validation
  (`{ ok: true; value } | { ok: false; reason }`). Throw only when the caller
  fundamentally cannot continue (`assertValid*` variants).
- **Custom errors** extend `DanteCodeError` (in `errors.ts`) with a stable code
  and `recovery` hint (`retry` | `abort` | `user-action` | `model-correction`).
  `retry()` from `resilience.ts` honors these hints.
- **No comments that restate code**. Comment only when the *why* is non-obvious
  (a hidden constraint, a workaround, surprising behavior). Don't comment out
  removed code.
- **Tests sit next to source** (`*.test.ts` colocated). The top-level `tests/`
  directory holds integration / smoke tests only.
- **Regression-guard pattern**: when fixing a bug that has reverted before,
  add an assertion to `packages/vscode/src/__tests__/regression-guard.test.ts`
  with the symptom in the test description.

## Common workflows

### Adding a feature

1. Read related files (`Read` over `Grep` once you have the path).
2. Plan the change before editing — list affected files + risk.
3. Make the smallest change that closes the gap. No drive-by refactors.
4. Add or update tests in the same commit.
5. Run typecheck on the touched package.
6. Commit with an imperative subject + a short body explaining *why*.

### Fixing a bug

1. Reproduce or write a failing test first.
2. Find the root cause — don't paper over symptoms with try/catch.
3. Fix the root cause. Add a regression-guard assertion if the bug class is
   one that has reverted before (refactor drift, silent CSP break, etc.).
4. Verify the failing test passes and nothing else broke.

### Score-driven improvement (`danteforge ascend`)

DanteForge runs a harsh-scorer over 19 dimensions. Each cycle:
1. Pick the worst non-ceiling dimension.
2. Apply a targeted change that closes the gap.
3. Re-score. Commit if score moved.

Common evidence files the scorer looks for:
- `CLAUDE.md` (this file) — Developer Experience.
- `examples/` directory — Developer Experience.
- `SECURITY.md` — Security.
- `packages/core/src/input-validation.ts` — Security (boundary-point
  sanitization infrastructure).
- `packages/core/src/errors.ts` + `resilience.ts` — Error Handling.

## Models you'll see

DanteCode routes across providers; you'll see code paths for:

- **Anthropic** (Claude Sonnet 4.6, Opus 4.7, Haiku 4.5) — preferred for
  disciplined tool use, long-context reasoning, low fabrication.
- **xAI Grok** — fast and cheap; default but more fabrication-prone.
- **OpenAI** (GPT-4o, o-series) — strong general-purpose fallback.
- **Ollama** (local) — privacy-sensitive workloads.
- **OpenRouter / Google / DeepSeek / Mistral / Azure OpenAI** — supplementary.

When working on provider-specific code, prefer Anthropic models for the
agent-loop work itself (lower fabrication during multi-turn tool use).

## Known sensitive areas

- `sidebar-provider.ts` — has reverted multiple times in recent sessions.
  Always check `regression-guard.test.ts` before claiming a fix landed.
- Antigravity (Google's VS Code fork) silently blocks nonce-based CSP. The
  CSP must use `'unsafe-inline'`. The regression guard enforces this.
- Pre-commit hook `dantecode test` may fail on pre-existing test drift in
  `ui-polish.test.ts`, `status-bar.test.ts`, `checkpoint-manager.test.ts`.
  Fix or document as out-of-scope before bypassing.
- Webview templates — when interpolating user data into HTML, use
  `escapeHtml` from `@dantecode/core` or DOM construction with
  `textContent`. Never `innerHTML +=` raw user data.

## Quick reference

| Need | Tool |
|------|------|
| Validate a user-supplied path | `validateRelativePath` from `@dantecode/core` |
| Validate a URL (block SSRF) | `validateHttpUrl` |
| Sanitize a shell argument | `validateShellArg` |
| Escape HTML for webview | `escapeHtml` |
| Retry a flaky external call | `retry()` from `@dantecode/core` |
| Wrap with timeout | `withTimeout()` |
| Bounded parallel fan-out | `parallelWithLimit()` |
| Throw a structured error | `new DanteCodeError(code, message, { recovery })` |

## Where to find more

- `README.md` — user-facing intro and feature matrix.
- `SECURITY.md` — vulnerability reporting and security policy.
- `packages/<pkg>/README.md` — per-package usage where present.
- `.danteforge/PRIME.md` — autogenerated. Current score, P0 gaps, lessons
  learned. Refresh with `danteforge prime`.
