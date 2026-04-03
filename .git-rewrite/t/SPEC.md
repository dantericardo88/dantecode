# SPEC.md - DanteCode Technical Spec

**Version:** OSS v1 prep  
**Date:** 2026-03-16  
**Status:** Release posture is tracked by `npm run release:matrix`; ship readiness is tracked by `npm run release:check`

## 1. System overview

DanteCode is a portable, model-agnostic skill runtime and coding agent with DanteForge as the verification layer.

High-level architecture:

```text
Client surfaces     -> CLI | VS Code (preview) | Desktop (experimental)
Orchestration       -> core (model router, STATE.yaml, audit)
Verification        -> danteforge (PDSE, anti-stub, constitution, GStack, autoforge)
Execution helpers   -> git-engine | skill-adapter | sandbox
Foundation          -> config-types
```

The CLI is the Public OSS v1 ship surface. VS Code is a preview primary surface. Desktop is experimental.

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
- provider construction (Grok, Anthropic, OpenAI, Google, Groq, Ollama, custom)
- model routing with fallback and task overrides
- audit logging
- background agent runner with queue and concurrency control
- TF-IDF semantic code indexing and search
- file-based session store for chat persistence
- token estimation

### `@dantecode/mcp`

- MCP client manager: connect to external MCP servers via stdio/SSE
- tool discovery and bridging: JSON Schema to Zod schema conversion
- MCP-prefixed tool routing in the agent loop
- DanteCode MCP server: exposes DanteForge tools (PDSE, anti-stub, constitution, lessons) to external agents
- config parsing from `.dantecode/mcp.json`

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
- `/mcp` server management, `/bg` background tasks, `/index` and `/search` code search
- `/party` multi-agent mode, `/forge` and `/magic` autoforge pipelines
- local runtime entrypoint

### `dantecode` VS Code extension

Preview extension for:

- Chat sidebar with streaming, tool use, and live diff rendering
- PDSE diagnostics in the Problems panel
- Inline completion provider
- Skill import, model switching, sandbox toggle
- File-based chat persistence (SessionStore)

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
npm run release:matrix
npm run build
npm run typecheck
npm run lint
npm test
npm run test:coverage
```

Current local contract:

- `npm run release:matrix` is the machine-readable support and release-ring source of truth
- `npm test` covers all package suites
- the coverage gate is enforced against stable runtime packages:
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
