# SPEC.md - DanteCode Technical Spec

**Version:** OSS v1 prep  
**Date:** 2026-03-16  
**Status:** Local validation green, external release steps pending

## 1. System overview

DanteCode is a portable, model-agnostic skill runtime and coding agent with DanteForge as the verification layer.

High-level architecture:

```text
Client surfaces     -> CLI | VS Code (preview) | Desktop (beta)
Orchestration       -> core (model router, STATE.yaml, audit)
Verification        -> danteforge (PDSE, anti-stub, constitution, GStack, autoforge)
Execution helpers   -> git-engine | skill-adapter | sandbox
Foundation          -> config-types
```

The CLI is the Public OSS v1 ship surface. VS Code is preview. Desktop is beta.

## 2. Product direction

- Product center: portable skills and interoperability
- Default provider: Grok
- Product identity: model-agnostic
- Main wedge: Claude-style skill translation into a portable runtime
- Differentiator: DanteForge verification before trust

## 3. Package responsibilities

### `@dantecode/config-types`

Shared runtime interfaces, schemas, and config types used across every package.

### `@dantecode/core`

- `.dantecode/STATE.yaml` parsing and writing
- provider construction
- model routing with fallback and task overrides
- audit logging

### `@dantecode/danteforge`

- anti-stub scanner
- PDSE scoring
- constitution checks
- GStack command execution
- autoforge iteration loop
- lessons storage and retrieval

### `@dantecode/git-engine`

- diff parsing
- commit helpers
- worktree operations
- repository map generation

### `@dantecode/skill-adapter`

- skill registry
- adapter wrapping
- parser support for Claude, Continue, and OpenCode style inputs
- import orchestration

### `@dantecode/sandbox`

Docker-backed and local execution helpers. Useful, but not part of the OSS v1 coverage gate.

### `@dantecode/cli`

Primary Public OSS v1 interface for:

- REPL and one-shot prompts
- init/config/git/skills commands
- local runtime entrypoint

### `dantecode` VS Code extension

Preview extension for chat, diagnostics, inline completion, and skill import flows.

### `@dantecode/desktop`

Beta desktop shell around the runtime.

## 4. Canonical project state

The canonical project config path for OSS v1 is:

```text
.dantecode/STATE.yaml
```

The runtime schema uses camelCase keys. Example structure:

```yaml
version: "1.0.0"
projectRoot: "."
model:
  default:
    provider: grok
    modelId: grok-3
    maxTokens: 8192
    temperature: 0.1
    contextWindow: 131072
    supportsVision: false
    supportsToolCalls: true
  fallback: []
  taskOverrides: {}
pdse:
  threshold: 85
  hardViolationsAllowed: 0
  maxRegenerationAttempts: 3
autoforge:
  enabled: true
  maxIterations: 5
```

## 5. Verification flow

```text
Request
  -> Context assembly
  -> Model routing
  -> Anti-stub scan
  -> PDSE scoring
  -> Constitution check
  -> GStack validation
  -> Autoforge retry if needed
  -> Disk write
  -> Audit / lessons / git follow-up
```

Core rules:

- hard security violations fail immediately
- PDSE threshold defaults to `85`
- GStack executes sequential diagnostics for full visibility
- imported or generated workflows must pass verification to earn trust

## 6. Local validation contract

Root commands:

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run test:coverage
```

Current local baseline:

- 562 passing tests across 24 suites
- `npm test` covers all package suites
- coverage gate is enforced against stable runtime packages:
  - `core`
  - `danteforge`
  - `git-engine`
  - `skill-adapter`

Preview and beta surfaces still run in the shared test suite, but do not currently set the release coverage threshold.

## 7. Release model

Primary OSS v1 release path:

- publish npm packages
- use `@dantecode/cli` as the default install target
- package and optionally publish the VS Code extension

Not launch-critical for OSS v1:

- desktop distribution
- full binary release installer flow

## 8. External acceptance steps

These cannot be proven by the local codebase alone:

- first GitHub push and green Actions run
- registry secret configuration
- live provider smoke test with real credentials
- one real imported skill acceptance pass
