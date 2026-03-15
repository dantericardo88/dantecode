# SPEC.md — DanteCode Technical Specification

**Version:** 1.0.0
**Status:** Derived from PRD v1.0.0 + Codebase Analysis
**Date:** 2026-03-15

---

## S1 System Overview

DanteCode is an open-source, model-agnostic AI coding agent that combines Claude Code's UX, Aider's git-native commits, Continue.dev's VS Code integration, and OpenHands's sandboxed execution — with DanteForge as its quality verification brain.

**Architecture**: TypeScript Bun monorepo (9 packages) orchestrated by Turborepo.

```
Interface Layer    →  CLI (Ink REPL) | VS Code Extension | Desktop (Electron)
Orchestration      →  Core (Model Router, State, Audit)
Quality Layer      →  DanteForge (PDSE, Autoforge, Anti-Stub, Lessons, GStack)
Execution Layer    →  Git Engine | Sandbox | Skill Adapter
Foundation         →  Config Types (shared interfaces & schemas)
```

**Dependency order**: config-types → core → danteforge → git-engine → skill-adapter → sandbox → cli → vscode → desktop

---

## S2 Package Specifications

### S2.1 `@dantecode/config-types`

**Purpose**: Foundation type library. All shared TypeScript interfaces and type definitions.

**Key exports**:
- `ModelProvider` — Union: `"grok" | "anthropic" | "openai" | "google" | "groq" | "ollama" | "custom"`
- `ModelConfig` — Provider, modelId, apiKey, baseUrl, maxTokens (8192), temperature (0.1), contextWindow
- `SessionMessage` — id, role, content, timestamp, modelId, toolUse/Result blocks, PDSE scores
- `Session` — Project root, messages, activeFiles, model config, worktreeRef, agentStack, todoList
- `PDSEScore` — completeness, correctness, clarity, consistency (0-100), overall, violations, passedGate
- `PDSEViolation` — type, severity (hard|soft), file, line, message, pattern
- `AutoforgeIteration` — iteration number, violations, gstackResults, lessonsInjected, score, succeeded
- `GStackResult` — command, exitCode, stdout/stderr, durationMs, passed
- `Lesson` — id, pattern, correction, severity, occurrences, source
- `SkillDefinition` — frontmatter, instructions, importSource, adapterVersion, validation flags
- `AgentDefinition` — name, tools, subagents, nomaLane, fileLocks, skillRefs
- `GitCommitSpec` — message (≤72 chars), body, footer, files
- `WorktreeSpec` — branch, baseBranch, sessionId, directory
- `DiffHunk` — file, oldStart/Lines, newStart/Lines, content, accepted
- `AuditEvent` — id, sessionId, timestamp, type (25 event types), payload, modelId
- `SandboxSpec` — image, networkMode, mounts, env, memoryLimit, cpuLimit, timeout
- `VSCodePanelMessage` — type, payload, sessionId
- `InlineCompletionContext` — filePath, prefix/suffix, language, cursorPosition

**Dependencies**: None (foundation package).

---

### S2.2 `@dantecode/core`

**Purpose**: Model routing, STATE.yaml management, audit logging.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `state.ts` | Parse/write STATE.yaml with Zod validation, atomic writes, sensible defaults |
| `model-router.ts` | Resolve provider, generate text/stream, fallback cascade, audit logging |
| `audit.ts` | Append-only JSONL logger, filtering, pagination, rotation at 100MB |
| `providers/*.ts` | Per-provider adapters: grok, anthropic, openai, ollama |

**Model Router resolution order**:
1. Task-specific override (from `STATE.yaml model.task_overrides`)
2. Default provider (Grok-3)
3. Fallback chain (Anthropic → user-configured)

**State management**:
- Read: `loadState(projectRoot)` → parse YAML → validate with Zod → return typed config
- Write: `saveState(projectRoot, state)` → validate → write temp file → atomic rename
- Update: `updateState(projectRoot, partial)` → merge → save

**Dependencies**: `@dantecode/config-types`, `zod`, `yaml`

---

### S2.3 `@dantecode/danteforge`

**Purpose**: Quality verification brain — PDSE scoring, anti-stub enforcement, autoforge loop, lessons system, GStack runner.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `pdse-scorer.ts` | Score code on 4 dimensions, model-based + local heuristic fallback |
| `anti-stub-scanner.ts` | Detect stub patterns, classify hard/soft violations |
| `autoforge.ts` | Iterative auto-correction loop (max 3 iterations) |
| `gstack.ts` | Run typecheck/lint/test commands, capture results |
| `lessons.ts` | SQLite-backed pattern database, query by file/language/severity |
| `constitution.ts` | Security enforcement — credential detection, hard reject |

**PDSE Scoring**:
```
Overall = (Completeness × 0.35) + (Correctness × 0.30) + (Clarity × 0.20) + (Consistency × 0.15)
Threshold: 85 | Hard violations allowed: 0

If stub present → Clarity = 0 → Max achievable = 80 → Gate FAILS
(This is a load-bearing design invariant — do not change weights/threshold independently.)
```

**Scoring modes**:
1. **Model-based**: Send code to LLM, parse structured response with Zod validation
2. **Local heuristic fallback**: Analyze function length, error handling, naming, null checks, magic numbers, consistency

**Anti-Stub Scanner patterns**:
- Hard: `TODO`, `FIXME`, `HACK`, `XXX`, `NotImplementedError`, `pass #`, `...`, `throw Error("not implemented")`, `@ts-ignore`, `as any`, `placeholder`, `shim`
- Soft: Configurable via `STATE.yaml pdse.stub_patterns`

**Autoforge IAL loop**:
```
for iteration in 1..maxIterations:
  1. Check constitution (security scan)
  2. Run GStack commands (typecheck, lint, test)
  3. Run PDSE scoring
  4. If all pass → return success
  5. Build failure context from violations
  6. Inject relevant lessons from lessons.db
  7. Regenerate code with enriched prompt

If all iterations fail → record lesson, mark BLOCKED
```

**Dependencies**: `@dantecode/config-types`, `@dantecode/core`, `sql.js`, `zod`

---

### S2.4 `@dantecode/git-engine`

**Purpose**: Git-native operations — auto-commits, worktree management, diff parsing, repo-map generation.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `commit.ts` | Structured auto-commits with HEREDOC format, DanteCode footer |
| `worktree.ts` | Create/list/merge worktrees in `.dantecode/worktrees/` |
| `diff.ts` | Parse unified diffs, extract hunks, staged/unstaged diff retrieval |
| `repo-map.ts` | Aider-derived repository indexing, language detection, file scoring |

**Commit message format**:
```
<72-char subject>

<detailed body>

Generated with DanteCode (https://dantecode.dev)

Co-Authored-By: DanteCode <noreply@dantecode.dev>
```

**Worktree lifecycle**: create (branch from HEAD) → execute task → merge to main → cleanup

**Dependencies**: `@dantecode/config-types`, child_process (git CLI)

---

### S2.5 `@dantecode/skill-adapter`

**Purpose**: Import skills from Claude Code, Continue.dev, and OpenCode — wrap with DanteForge enforcement.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `importer.ts` | Scan source directories, orchestrate import pipeline |
| `registry.ts` | Load/validate skills from `.dantecode/skills/`, frontmatter extraction |
| `wrap.ts` | Inject DanteForge adapter (preamble + postamble) around skill instructions |
| `parsers/claude.ts` | Parse Claude Code SKILL.md format |
| `parsers/continue.ts` | Parse Continue.dev agent definitions |
| `parsers/opencode.ts` | Parse OpenCode agent format |

**Adapter wrapping**:
```
[PREAMBLE: Anti-Stub Doctrine + PDSE Clarity Gate + Constitution Rules]
[ORIGINAL SKILL INSTRUCTIONS — unmodified]
[POSTAMBLE: Post-Generation Verification + GStack QA + Lessons + Audit + Commit]
```

**Dependencies**: `@dantecode/config-types`, `@dantecode/core`, `@dantecode/danteforge`

---

### S2.6 `@dantecode/sandbox`

**Purpose**: Docker-based execution isolation with local fallback.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `container.ts` | Docker container lifecycle — pull, create, start, exec, stop |
| `executor.ts` | High-level command execution with timeout and audit |
| `fallback.ts` | Local (unsandboxed) executor when Docker unavailable |

**Container configuration**:
- Image: `ghcr.io/dantecode/sandbox:latest`
- Network: bridge mode (no host access)
- Memory: 2GB | CPU: 2 cores | Timeout: 5 minutes
- Bind mount: project directory → `/workspace` (read-write)
- Auto-cleanup on session end

**Dependencies**: `@dantecode/config-types`, child_process / dockerode

---

### S2.7 `@dantecode/cli`

**Purpose**: Terminal REPL with command routing, agent loop, slash commands, and tools.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `index.ts` | CLI argument parsing, route dispatch |
| `repl.ts` | Interactive readline loop, slash command routing |
| `agent-loop.ts` | Core agent interaction — system prompt, tool execution, streaming |
| `slash-commands.ts` | /help, /model, /pdse, /gstack, /diff, /commit, /lessons, etc. |
| `tools.ts` | Tool handlers — Read, Write, Edit, Bash, Glob, Grep, WebFetch |
| `commands/*.ts` | Sub-commands: init, skills, agent, config, git |

**CLI entry points**:
- `dantecode` — Start interactive REPL
- `dantecode "prompt"` — One-shot execution
- `dantecode --model <id>` — Override model
- `dantecode --worktree` — Run in git worktree
- `dantecode --sandbox` — Force Docker sandbox
- `dantecode init` — Initialize project
- `dantecode skills <subcommand>` — Skill management

**Dependencies**: `@dantecode/config-types`, `@dantecode/core`, `@dantecode/danteforge`, `@dantecode/git-engine`, `@dantecode/skill-adapter`, `@dantecode/sandbox`

---

### S2.8 `@dantecode/vscode`

**Purpose**: VS Code extension — chat sidebar, inline completions, PDSE diagnostics, audit panel.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `extension.ts` | Extension activation, provider registration, command binding |
| `sidebar-provider.ts` | Chat webview panel (React + Tailwind) |
| `inline-completion.ts` | InlineCompletionItemProvider for ghost text |
| `diagnostics.ts` | PDSE violations as VS Code diagnostics (Problems panel) |
| `audit-panel-provider.ts` | Audit log viewer webview |
| `status-bar.ts` | Model + gate status in status bar |

**Activation**: < 500ms target
**Inline suggestion**: < 2s latency target

**Dependencies**: `@dantecode/config-types`, `@dantecode/core`, `@dantecode/danteforge`, vscode API

---

### S2.9 `@dantecode/desktop`

**Purpose**: Electron wrapper for cross-platform desktop GUI.

**Modules**:

| Module | Responsibility |
|--------|---------------|
| `main.ts` | Electron main process, window management, IPC, menus |
| `preload.ts` | Secure IPC bridge (contextIsolation enabled) |

**Security**: contextIsolation=true, nodeIntegration=false
**Distribution**: macOS .dmg, Windows .exe, Linux .AppImage

**Dependencies**: `@dantecode/config-types`, `@dantecode/cli`, electron

---

## S3 DanteForge Pipeline

Complete flow for every code generation request:

```
User Request
    ↓
Context Assembler
    ├── Repo map (git-engine/repo-map.ts)
    ├── Open files / active context
    ├── AGENTS.dc.md project context
    └── Injected lessons (if retry)
    ↓
Model Router (core/model-router.ts)
    ├── Resolve provider (Grok-3 default)
    └── Stream generation
    ↓
Anti-Stub Scanner (danteforge/anti-stub-scanner.ts)
    ├── FAIL → Regenerate with lesson injection (max 3)
    └── PASS ↓
PDSE Scorer (danteforge/pdse-scorer.ts)
    ├── Score < 85 → Reject + record lesson
    └── PASS ↓
Constitution Check (danteforge/constitution.ts)
    ├── FAIL → Hard reject (no retry)
    └── PASS ↓
GStack Live QA (danteforge/gstack.ts)
    ├── FAIL → Autoforge IAL (danteforge/autoforge.ts, max 3)
    └── PASS ↓
Write to Disk
    ↓
Auto-Commit (git-engine/commit.ts)
    ↓
Lessons Hook (danteforge/lessons.ts)
    ↓
Audit Log (core/audit.ts)
```

---

## S4 State Schema (STATE.yaml)

```yaml
version: "1.0.0"
project_root: "."

model:
  default: { provider, model_id, max_tokens, temperature, context_window }
  fallback: [{ provider, model_id, ... }]
  task_overrides: { code_review: "grok/grok-3", documentation: "anthropic/claude-sonnet-4-6" }

pdse:
  enabled: true
  threshold: 85
  hard_violations_allowed: 0
  max_regeneration_attempts: 3
  weights: { completeness: 0.35, correctness: 0.30, clarity: 0.20, consistency: 0.15 }
  stub_patterns: [regex patterns...]

autoforge:
  enabled: true
  max_iterations: 3
  lesson_injection_enabled: true
  abort_on_security_violation: true
  gstack_commands:
    - { name: "typecheck", command: "bun run typecheck", timeout_ms: 60000, failure_is_soft: false }
    - { name: "lint",      command: "bun run lint",      timeout_ms: 30000, failure_is_soft: false }
    - { name: "test",      command: "bun run test",      timeout_ms: 120000, failure_is_soft: true }

git:
  auto_commit: true
  worktree_enabled: true
  push_on_commit: false
  branch_naming_pattern: "dc/{session_id_short}/{task_slug}"

sandbox:
  enabled: false
  image: "ghcr.io/dantecode/sandbox:latest"
  memory_limit_mb: 2048
  cpu_limit: 2.0
  timeout_ms: 300000

skills: { directory, adapter_version, auto_wrap_on_import, validate_on_import }
agents: { directory, noma_enforcement, max_concurrent_agents: 4, default_tools }
audit: { log_path, max_size_mb: 100, rotate_on_exceed }
lessons: { db_path, max_lessons: 500, min_severity_for_injection: "medium" }
project: { name, language, framework, agents_file, repo_map_enabled }
```

---

## S5 Test Strategy

### Test Pyramid

| Layer | Coverage | Runner | Scope |
|-------|----------|--------|-------|
| Unit | 75% | Vitest | Pure functions, mocked I/O |
| Integration | 20% | Vitest | Real filesystem/git, mocked model |
| E2E | 5% | Vitest + Bun | Real model calls, real git |

### Critical Test Suites

**Anti-Stub Scanner**: Detects all hard patterns (TODO, FIXME, as any, etc.), passes clean code, loads custom patterns.

**PDSE Scorer**: Returns ≥85 for complete code, <85 for stub-filled code, passedGate=false on hard violations, respects configured weights.

**Autoforge IAL**: Succeeds on first iteration for clean code, retries up to max, injects lessons, returns failed after exhaustion.

**Skill Importer**: Scans source dirs, wraps with adapter, skips constitution failures, emits audit events.

**Model Router**: Resolves default provider, falls back on failure, applies task overrides.

**State Manager**: Reads/writes/updates STATE.yaml, validates with Zod, atomic writes.

### CI Pipeline

```yaml
Jobs:
  typecheck: npx turbo run typecheck
  lint: npx turbo run lint
  test: npx turbo run test
  anti-stub-self-check: scan own source for stubs (zero tolerance)
```

---

## S6 Success Metrics

| Metric | Target |
|--------|--------|
| Install-to-first-edit | < 90 seconds |
| Stub rate in generated code | 0% (enforced) |
| PDSE first-attempt pass rate | ≥ 95% |
| Claude skill import success | ≥ 98% |
| Model switch latency | < 2 seconds |
| VS Code activation | < 500ms |
| Inline suggestion latency | < 2 seconds |
| Typecheck pass | 100% (all 9 packages) |
