# DanteCode PRD v1.0.0

**Product Requirements Document — Open-Source Model-Agnostic AI Coding Agent**
**Classification:** Internal Working Document | DanteForge Build Target
**Status:** Production-Ready | Zero Placeholders
**Date:** 2026-03-15

---

## Table of Contents

- [D1 Executive Summary & Vision](#d1-executive-summary--vision)
- [D2 Architecture & Tech Stack](#d2-architecture--tech-stack)
- [D3 Core Features](#d3-core-features)
- [D4 Detailed Technical Design](#d4-detailed-technical-design)
- [D5 Wave-Based Implementation Plan](#d5-wave-based-implementation-plan)
- [D6 Test Strategy & Verification](#d6-test-strategy--verification)
- [D7 Migration & Install Experience](#d7-migration--install-experience)
- [D8 Third-Party Notices & Attribution](#d8-third-party-notices--attribution)
- [D9 Anti-Stub Doctrine](#d9-anti-stub-doctrine)

---

## D1 Executive Summary & Vision

### 1.1 Product Statement

DanteCode is an open-source, model-agnostic AI coding agent. It competes directly with Claude Code, Aider, Continue.dev, and OpenHands by combining the best architectural primitives from all four while introducing **DanteForge** as its verification brain. It runs locally, does not phone home, defaults to Grok API for speed, supports any OpenAI-compatible model, and produces only complete, production-ready code. It installs in one command and runs from the terminal, a VS Code sidebar, and a desktop GUI.

### 1.2 The Problem with Existing Tools

| Tool             | Strengths                                                 | Fatal Weaknesses                                                 |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| **Claude Code**  | Smooth UX, stateful sessions, agent teams, repo awareness | Anthropic lock-in, no quality gates, stubs accepted, model fixed |
| **Aider**        | Auto-commits, diff review, 100+ model support             | No quality gates, no skill system, no agent orchestration        |
| **Continue.dev** | VS Code richness, inline edits, provider-agnostic UI      | No stateful agent loop, no git-native commits, no verification   |
| **OpenHands**    | Sandboxed execution, stateful tool-calling loops          | Heavy Docker dependency, no skill portability, no PDSE scoring   |

**None** of these tools enforce code quality. All of them happily accept stubs, TODOs, placeholder functions, and incomplete implementations. None of them have a lessons system that grows smarter over time. None of them have a constitutional quality gate.

### 1.3 DanteCode Thesis

> **DanteCode = Claude Code's UX smoothness + Aider's git-native commits + Continue.dev's VS Code richness + OpenHands's sandboxed execution + DanteForge's disciplined brain. Zero vendor lock-in. Zero stubs. Defaults to Grok.**

### 1.4 Core Principles

1. **Anti-Stub Absolute** — `TODO`, `FIXME`, `pass`, `...`, `raise NotImplementedError`, empty function bodies, and placeholder comments are build failures, not warnings.
2. **Model Agnosticism** — Any OpenAI-compatible endpoint. Default: Grok (`x-ai/grok-3`). Fallback: any Anthropic model. Zero hardcoded model strings in agent logic.
3. **Constitutional Guarantees** — Every generated file passes PDSE scoring before being written to disk. Fail-closed behavior: if the gate doesn't pass, the file is not written.
4. **Git-Native by Default** — Every accepted edit is auto-committed with a structured commit message. Worktree isolation for long-running tasks.
5. **Skill Portability** — Any Claude skill, Continue.dev agent definition, or OpenCode agent can be wrapped and run on any model through the DanteForge adapter.
6. **Evidence Chain** — Every decision, every gate score, every lesson learned is logged to an immutable append-only audit trail.
7. **NOMA Compliance** — Non-Overlapping Multi-Agent parallelism. No two agent lanes touch the same file. Merge conflicts are a build failure.

### 1.5 Target Users

- Solo founders running AI-heavy development (primary: Ricky and the Real Empanada Company model)
- Developers who want Claude Code quality without Anthropic dependency
- Teams that need model-agnostic agent workflows with verifiable output quality
- OSS contributors migrating skill libraries from Claude/Continue ecosystems

### 1.6 Success Metrics

| Metric                            | Target                 |
| --------------------------------- | ---------------------- |
| Install-to-first-edit time        | < 90 seconds           |
| Stub rate in generated code       | 0% (enforced)          |
| PDSE Clarity gate pass rate       | ≥ 95% on first attempt |
| Claude skill import success rate  | ≥ 98%                  |
| Model switch latency              | < 2 seconds            |
| VS Code extension activation time | < 500ms                |

---

## D2 Architecture & Tech Stack

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DanteCode System                          │
│                                                                  │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │  CLI Layer   │  │  VS Code Ext  │  │   Desktop App (TUI)  │  │
│  │  (Ink/React) │  │  (LSP+Sidebar)│  │   (Ink/React v3)     │  │
│  └──────┬───────┘  └──────┬────────┘  └──────────┬───────────┘  │
│         └─────────────────┴──────────────────────┘              │
│                            │                                      │
│                    ┌───────▼────────┐                            │
│                    │  DanteCode     │                            │
│                    │  Core (TS)     │                            │
│                    │  /packages/core│                            │
│                    └───────┬────────┘                            │
│         ┌──────────────────┼──────────────────────┐             │
│         │                  │                       │             │
│  ┌──────▼──────┐   ┌───────▼──────┐   ┌──────────▼──────────┐  │
│  │  Model      │   │  DanteForge  │   │  Git Engine         │  │
│  │  Router     │   │  Brain       │   │  (Aider-derived)    │  │
│  │  (Grok-     │   │  (PDSE +     │   │  Auto-commit +      │  │
│  │  first)     │   │  Autoforge)  │   │  Worktree mgmt      │  │
│  └──────┬──────┘   └───────┬──────┘   └──────────┬──────────┘  │
│         │                  │                       │             │
│  ┌──────▼──────────────────▼───────────────────────▼──────────┐ │
│  │                    Tool Executor                            │ │
│  │  (Bash · Read · Write · Edit · Glob · Grep · WebFetch ·    │ │
│  │   TodoWrite · Task · GitCommit · GitDiff · GStack·QA)      │ │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │               Sandbox Runtime (OpenHands-derived)           │ │
│  │   Docker container per session · Network isolation ·        │ │
│  │   Filesystem snapshot & rollback · Audit event stream       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Package Monorepo Structure

```
dantecode/
├── packages/
│   ├── core/               # TypeScript — all agent logic, model routing, PDSE
│   ├── cli/                # TypeScript/Ink — terminal UI and command parsing
│   ├── vscode/             # TypeScript — VS Code extension (LSP + sidebar)
│   ├── desktop/            # TypeScript/Electron — desktop GUI
│   ├── danteforge/         # TypeScript — PDSE, Autoforge, Gates, Lessons, GStack
│   ├── git-engine/         # TypeScript — Aider-derived commit/diff/worktree logic
│   ├── sandbox/            # TypeScript — OpenHands-derived Docker sandbox runtime
│   ├── skill-adapter/      # TypeScript — Claude/Continue skill import & wrapping
│   └── config-types/       # TypeScript — all shared interfaces and schemas
├── skills/                 # Built-in DanteCode skill library
├── agents/                 # Built-in agent definitions (AGENTS.dc.md format)
├── docs/                   # Documentation
├── scripts/                # Build, release, benchmark scripts
├── tests/                  # Integration and E2E tests
├── STATE.yaml              # Project-level state schema (see D4)
├── AGENTS.dc.md            # DanteCode agent context file (analogous to AGENTS.md)
├── package.json            # Bun workspace root
└── turbo.json              # Turborepo build config
```

### 2.3 Tech Stack

| Layer                 | Choice                                      | Rationale                                                                               |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Runtime**           | Bun v1.2+                                   | Speed, native TS, single binary distribution                                            |
| **Language**          | TypeScript 5.5+ (strict)                    | Matches opencode base, Continue.dev, type safety                                        |
| **CLI framework**     | Ink v5 (React for terminals)                | Opencode-derived, rich TUI without curses                                               |
| **VS Code extension** | VS Code Extension API v1.95+                | Continue.dev-derived sidebar + LSP integration                                          |
| **Desktop**           | Electron 33 + Ink renderer                  | Cross-platform GUI matching opencode architecture                                       |
| **AI SDK**            | Vercel AI SDK v4 core                       | Provider abstraction used in opencode; supports Grok, Anthropic, OpenAI, Gemini, Ollama |
| **Git**               | isomorphic-git + child_process git          | Programmatic commits; Aider-derived diff parsing                                        |
| **Sandbox**           | Docker SDK (dockerode)                      | OpenHands-derived container lifecycle management                                        |
| **State**             | YAML (STATE.yaml) + SQLite (lessons.db)     | YAML for human-readable project state, SQLite for lessons corpus                        |
| **LSP**               | vscode-languageclient/vscode-languageserver | Continue.dev LSP infrastructure adapted for DanteCode                                   |
| **Schema validation** | Zod v3                                      | All STATE.yaml reads and API responses validated at boundary                            |
| **Test runner**       | Vitest + Bun test                           | Vitest for unit/component, Bun test for integration                                     |
| **Build**             | Turborepo + tsup                            | Turborepo for monorepo orchestration, tsup for package bundling                         |
| **Package manager**   | Bun workspaces                              | Matches opencode toolchain                                                              |

### 2.4 Model Provider Support

| Provider              | Model ID Format               | Default Model  | Auth Method                          |
| --------------------- | ----------------------------- | -------------- | ------------------------------------ |
| **xAI (Grok)**        | `grok/grok-3`                 | ✅ **Default** | `GROK_API_KEY`                       |
| **Anthropic**         | `anthropic/claude-sonnet-4-6` | Fallback       | `ANTHROPIC_API_KEY`                  |
| **OpenAI**            | `openai/gpt-4.1`              | Optional       | `OPENAI_API_KEY`                     |
| **Google**            | `google/gemini-2.5-pro`       | Optional       | `GOOGLE_API_KEY`                     |
| **Groq**              | `groq/llama-3.3-70b`          | Speed tier     | `GROQ_API_KEY`                       |
| **Ollama**            | `ollama/qwen2.5-coder:32b`    | Local option   | No auth (local)                      |
| **Any OpenAI-compat** | `custom/<model>`              | User-defined   | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` |

### 2.5 DanteForge Brain Integration

DanteForge runs as an embedded sub-system within `packages/danteforge/`. It is not a separate process. Every code generation request passes through the DanteForge pipeline before any file is written:

```
User Request
    │
    ▼
Context Assembler (repo map, open files, AGENTS.dc.md)
    │
    ▼
Model Router (selects Grok-3 by default)
    │
    ▼
Generation (streaming)
    │
    ▼
Anti-Stub Scanner (PDSE Clarity gate — pre-write)
    │ FAIL → Regenerate with lesson injection (max 3 attempts)
    │ PASS ↓
PDSE Scorer (Completeness · Correctness · Clarity · Consistency)
    │ Score < threshold → Reject + log lesson
    │ Score ≥ threshold ↓
Constitution Check (security, no credential exposure, no background processes)
    │ FAIL → Hard reject
    │ PASS ↓
GStack Live QA (type-check + lint + test — if applicable)
    │ FAIL → Autoforge IAL loop (max 3 iterations)
    │ PASS ↓
Write to Disk
    │
    ▼
Auto-Commit (git-engine: structured commit message + HEREDOC)
    │
    ▼
Lessons Hook (record outcome to lessons.db)
    │
    ▼
Audit Log (append to .dantecode/audit.jsonl)
```

---

## D3 Core Features

### 3.1 Feature Overview

| Feature                      | Description                                                  | Source Inspiration            |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------- |
| **Model-agnostic inference** | Route any task to any provider; default Grok-3               | Opencode AI SDK layer         |
| **Stateful sessions**        | Persistent conversation + repo context across invocations    | Claude Code stateful CLI      |
| **Repo awareness**           | Automatic repo-map generation with file priority scoring     | Aider repo-map algorithm      |
| **Inline edits**             | Apply file edits with exact string replacement (no rewrites) | Claude Code Edit tool pattern |
| **VS Code sidebar**          | Chat + inline ghost text + diff review panel                 | Continue.dev GUI layer        |
| **Auto-commits**             | Every accepted edit becomes a structured git commit          | Aider auto-commit system      |
| **Worktree isolation**       | Long-running tasks run in git worktrees, merged on success   | Aider worktree support        |
| **Agent orchestration**      | Sub-agents spawned in parallel, NOMA lane enforcement        | Claude Code Task tool         |
| **Sandboxed execution**      | Docker container runtime for bash commands                   | OpenHands runtime             |
| **PDSE quality gates**       | Hard gate on Completeness/Correctness/Clarity/Consistency    | DanteForge                    |
| **Autoforge IAL**            | Autonomous iterative fix loop on gate failure                | DanteForge                    |
| **Anti-stub enforcement**    | Zero-tolerance stub/TODO scanner pre-write                   | DanteForge                    |
| **Lessons system**           | Growing corpus of project-specific learned patterns          | DanteForge                    |
| **GStack live QA**           | Post-generation typecheck + lint + test execution            | DanteForge                    |
| **Skill import**             | `dantecode skills import --from-claude` one-command          | Novel                         |
| **AGENTS.dc.md**             | Project-level agent context file (like AGENTS.md)            | Claude Code / Amp             |
| **TodoWrite**                | Task planning and progress tracking in-session               | Claude Code TodoWrite         |
| **Web fetch**                | Scrape URLs for context (Playwright + httpx fallback)        | Aider web scrape              |
| **MCP support**              | Connect any MCP server for tool extension                    | Opencode MCP layer            |
| **Skills system**            | Reusable agent definition files in `.dantecode/skills/`      | Continue.dev / Opencode       |

### 3.2 Command Reference Table

#### 3.2.1 Top-Level Commands

```
dantecode <command> [options]
```

| Command                     | Description                       | Example                                         |
| --------------------------- | --------------------------------- | ----------------------------------------------- |
| `dantecode`                 | Start interactive REPL session    | `dantecode`                                     |
| `dantecode "prompt"`        | One-shot execution                | `dantecode "add unit tests to auth.ts"`         |
| `dantecode --model <id>`    | Override model for session        | `dantecode --model anthropic/claude-sonnet-4-6` |
| `dantecode --no-git`        | Disable auto-commit               | `dantecode --no-git`                            |
| `dantecode --sandbox`       | Force Docker sandbox for all bash | `dantecode --sandbox`                           |
| `dantecode --worktree`      | Run in isolated git worktree      | `dantecode --worktree`                          |
| `dantecode --verbose`       | Show PDSE scores + audit events   | `dantecode --verbose`                           |
| `dantecode --config <path>` | Use specific config file          | `dantecode --config ./dante.config.yaml`        |

#### 3.2.2 Skills Sub-Commands

| Command                                   | Description                                 |
| ----------------------------------------- | ------------------------------------------- |
| `dantecode skills list`                   | List all available skills                   |
| `dantecode skills import --from-claude`   | Import all skills from `~/.claude/skills/`  |
| `dantecode skills import --from-continue` | Import from `.continue/agents/`             |
| `dantecode skills import --from-opencode` | Import from `.opencode/agent/`              |
| `dantecode skills import --file <path>`   | Import a single skill file                  |
| `dantecode skills wrap <skill-name>`      | Apply DanteForge adapter to existing skill  |
| `dantecode skills show <skill-name>`      | Print skill definition + adapter status     |
| `dantecode skills validate <skill-name>`  | Run anti-stub + constitution check on skill |
| `dantecode skills remove <skill-name>`    | Remove skill from project                   |

#### 3.2.3 Session Slash Commands (REPL only)

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `/help`         | Show all slash commands                      |
| `/model <id>`   | Switch model for current session             |
| `/add <file>`   | Add file to active context                   |
| `/drop <file>`  | Remove file from active context              |
| `/files`        | List files in current context                |
| `/diff`         | Show pending changes as unified diff         |
| `/commit`       | Manually trigger auto-commit                 |
| `/revert`       | Revert last committed change                 |
| `/undo`         | Undo last edit (pre-commit)                  |
| `/lessons`      | Show lessons learned for this project        |
| `/pdse <file>`  | Run PDSE scoring on a specific file          |
| `/qa`           | Run GStack live QA (typecheck + lint + test) |
| `/audit`        | Show recent audit log entries                |
| `/clear`        | Clear current conversation context           |
| `/tokens`       | Show current context token usage             |
| `/web <url>`    | Fetch URL and add to context                 |
| `/skill <name>` | Activate a skill for this session            |
| `/agents`       | List available agent definitions             |
| `/worktree`     | Create worktree for current task             |
| `/sandbox`      | Toggle Docker sandbox mode                   |

#### 3.2.4 Agent Sub-Commands

| Command                         | Description                   |
| ------------------------------- | ----------------------------- |
| `dantecode agent run <name>`    | Run a named agent definition  |
| `dantecode agent list`          | List available agents         |
| `dantecode agent create <name>` | Scaffold new agent definition |

#### 3.2.5 Config Sub-Commands

| Command                              | Description                                    |
| ------------------------------------ | ---------------------------------------------- |
| `dantecode config init`              | Initialize `dante.config.yaml` in project root |
| `dantecode config show`              | Print current resolved config                  |
| `dantecode config set <key> <value>` | Set a config value                             |
| `dantecode config models`            | List configured model providers                |

#### 3.2.6 Git Sub-Commands

| Command                    | Description                       |
| -------------------------- | --------------------------------- |
| `dantecode git status`     | Show DanteCode-managed git status |
| `dantecode git log`        | Show DanteCode commit history     |
| `dantecode git diff <ref>` | Show diff against ref             |

### 3.3 Grok API Integration

DanteCode defaults to Grok for all agent tasks. The routing logic is:

1. If `GROK_API_KEY` is set → use `grok/grok-3`
2. If `ANTHROPIC_API_KEY` is set → use `anthropic/claude-sonnet-4-6`
3. If `OPENAI_API_KEY` is set → use `openai/gpt-4.1`
4. If `OLLAMA_BASE_URL` is set → use `ollama/qwen2.5-coder:32b`
5. Else → error with clear message and setup instructions

The model router never hard-codes model selection in agent logic. All agent prompts are model-agnostic. PDSE scoring is always performed by the same model that generated the code (no cross-model scoring).

### 3.4 Skill Import — The Golden Feature

`dantecode skills import --from-claude` is a first-class CLI command that:

1. **Scans** `~/.claude/skills/*/SKILL.md` recursively
2. **Parses** each skill's frontmatter (`name`, `description`, `tools`, `model` hints)
3. **Wraps** each skill with the DanteForge adapter (see D4.6 for full adapter spec)
4. **Places** the wrapped skill at `.dantecode/skills/<skill-name>/SKILL.dc.md`
5. **Validates** the wrapped skill with anti-stub scan + constitution check
6. **Logs** import results to stdout and `.dantecode/audit.jsonl`

Wrapped skills run on any configured model (default Grok-3) while maintaining the original skill's intent. The adapter does not modify the skill's core instructions — it adds DanteForge enforcement blocks before and after.

### 3.5 VS Code Extension Features

- **Chat sidebar**: Full conversation UI matching Continue.dev's panel layout
- **Inline ghost text**: Tab-to-accept suggestions during editing
- **Inline diff review**: Accept/reject hunks before commit
- **File context pills**: `@filename` syntax in chat for adding files to context
- **Model selector**: Dropdown in sidebar to switch model without leaving VS Code
- **PDSE score overlay**: Shows gate scores in the Problems panel
- **Audit log panel**: Dedicated view for DanteCode's audit trail
- **Status bar item**: Shows current model, active skill, gate status
- **Keybindings**: `Ctrl+Shift+D` to open DanteCode panel

---

## D4 Detailed Technical Design

### 4.1 TypeScript Interfaces

```typescript
// packages/config-types/src/index.ts

// ─────────────────────────────────────────────
// Model & Provider Types
// ─────────────────────────────────────────────

export type ModelProvider =
  | "grok"
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "ollama"
  | "custom";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string; // e.g. "grok-3", "claude-sonnet-4-6"
  apiKey?: string; // resolved from env if not set
  baseUrl?: string; // for custom/ollama providers
  maxTokens: number; // default 8192
  temperature: number; // default 0.1 for code tasks
  contextWindow: number; // max context in tokens
  supportsVision: boolean;
  supportsToolCalls: boolean;
}

export interface ModelRouter {
  default: ModelConfig;
  fallback: ModelConfig[]; // tried in order if default fails
  overrides: Record<string, ModelConfig>; // per-task-type overrides
}

// ─────────────────────────────────────────────
// Session & Context Types
// ─────────────────────────────────────────────

export interface SessionMessage {
  id: string; // UUID v4
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  timestamp: string; // ISO 8601
  modelId?: string; // which model produced this
  toolUse?: ToolUseBlock[];
  toolResult?: ToolResultBlock[];
  pdseScore?: PDSEScore; // if message contains code
  tokensUsed?: number;
}

export interface ContentBlock {
  type: "text" | "image" | "document";
  text?: string;
  imageData?: string; // base64
  mimeType?: string;
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface Session {
  id: string; // UUID v4
  projectRoot: string; // absolute path
  messages: SessionMessage[];
  activeFiles: string[]; // absolute paths in current context
  model: ModelConfig;
  createdAt: string;
  updatedAt: string;
  worktreeRef?: string; // git worktree branch if active
  sandboxContainerId?: string; // Docker container ID if sandbox active
  agentStack: AgentFrame[]; // NOMA agent execution stack
  todoList: TodoItem[];
}

export interface AgentFrame {
  agentId: string;
  agentType: string;
  startedAt: string;
  touchedFiles: string[]; // NOMA enforcement: block overlap
  status: "running" | "complete" | "failed";
  subAgentIds: string[];
}

export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  parentId?: string; // for nested todos
}

// ─────────────────────────────────────────────
// PDSE Scoring Types
// ─────────────────────────────────────────────

export interface PDSEScore {
  completeness: number; // 0–100: no missing logic, no stubs
  correctness: number; // 0–100: types correct, logic sound
  clarity: number; // 0–100: no TODOs, no vague names
  consistency: number; // 0–100: matches repo style/conventions
  overall: number; // weighted average
  violations: PDSEViolation[];
  passedGate: boolean; // overall >= threshold AND no hard violations
  scoredAt: string;
  scoredBy: string; // model ID that did scoring
}

export interface PDSEViolation {
  type: ViolationType;
  severity: "hard" | "soft"; // hard = immediate reject
  file: string;
  line?: number;
  message: string;
  pattern?: string; // the regex or literal that matched
}

export type ViolationType =
  | "stub_detected" // TODO/FIXME/pass/... found
  | "incomplete_function" // function body empty or returns undefined stub
  | "missing_error_handling" // unhandled promise/exception
  | "type_any" // TypeScript `any` usage
  | "hardcoded_secret" // detected credential pattern
  | "background_process" // & operator or nohup in bash
  | "console_log_leftover" // debug console.log in production code
  | "test_skip" // .skip() or xit() in test files
  | "import_unused" // unused import detected
  | "dead_code"; // unreachable code block

export interface PDSEGateConfig {
  threshold: number; // minimum overall score (default 85)
  hardViolationsAllowed: number; // default 0
  maxRegenerationAttempts: number; // default 3
  weights: {
    completeness: number; // default 0.35
    correctness: number; // default 0.30
    clarity: number; // default 0.20
    consistency: number; // default 0.15
  };
}

// ─────────────────────────────────────────────
// DanteForge Autoforge Types
// ─────────────────────────────────────────────

export interface AutoforgeConfig {
  enabled: boolean; // default true
  maxIterations: number; // default 3
  gstackCommands: GStackCommand[];
  lessonInjectionEnabled: boolean; // inject relevant lessons on retry
  abortOnSecurityViolation: boolean; // default true
}

export interface GStackCommand {
  name: string; // e.g. "typecheck"
  command: string; // e.g. "bun run typecheck"
  runInSandbox: boolean;
  timeoutMs: number; // default 60000
  failureIsSoft: boolean; // soft = warn only, don't block
}

export interface AutoforgeIteration {
  iterationNumber: number; // 1-indexed
  inputViolations: PDSEViolation[];
  gstackResults: GStackResult[];
  lessonsInjected: Lesson[];
  outputScore: PDSEScore;
  succeeded: boolean;
  durationMs: number;
}

export interface GStackResult {
  command: GStackCommand;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

// ─────────────────────────────────────────────
// Lessons System Types
// ─────────────────────────────────────────────

export interface Lesson {
  id: string; // UUID v4
  projectRoot: string;
  pattern: string; // what went wrong
  correction: string; // what the fix was
  filePattern?: string; // glob pattern for relevance matching
  language?: string; // e.g. "typescript"
  framework?: string; // e.g. "react"
  occurrences: number; // how many times seen
  lastSeen: string;
  severity: "low" | "medium" | "high";
  source: "autoforge" | "manual" | "gstack_failure";
}

export interface LessonsQuery {
  projectRoot: string;
  filePattern?: string;
  language?: string;
  limit: number; // default 10
  minSeverity?: "low" | "medium" | "high";
}

// ─────────────────────────────────────────────
// Skill & Agent Types
// ─────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  tools?: string[]; // allowed tool names
  model?: string; // preferred model hint
  mode?: "primary" | "subagent"; // opencode mode convention
  hidden?: boolean;
  color?: string; // UI color hint
}

export interface SkillDefinition {
  frontmatter: SkillFrontmatter;
  instructions: string; // raw markdown instructions body
  sourcePath: string; // original file path
  wrappedPath?: string; // path to DanteForge-wrapped version
  isWrapped: boolean;
  importSource?: "claude" | "continue" | "opencode" | "native";
  adapterVersion: string; // DanteForge adapter semver
  constitutionCheckPassed: boolean;
  antiStubScanPassed: boolean;
}

export interface SkillAdapter {
  pdseGateBlock: string; // injected before instructions
  constitutionBlock: string; // injected after instructions
  lessonsBlock: string; // dynamic lessons injection marker
  antiStubBlock: string; // injected before any code generation
}

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  tools: string[]; // allowed tools
  subagents?: string[]; // agent names this can spawn
  nomaLane: string; // NOMA identifier (no two agents share a lane)
  fileLocks?: string[]; // glob patterns this agent can touch
  skillRefs?: string[]; // skills this agent activates
}

// ─────────────────────────────────────────────
// Git Engine Types
// ─────────────────────────────────────────────

export interface GitCommitSpec {
  message: string; // first line (≤72 chars)
  body?: string; // detailed description
  footer: string; // "🤖 Generated with DanteCode\nCo-Authored-By: DanteCode <noreply@dantecode.dev>"
  files: string[]; // files to stage
  allowEmpty: boolean; // default false
}

export interface WorktreeSpec {
  branch: string; // feature branch name
  baseBranch: string; // branch to fork from (default: current)
  sessionId: string; // linked session ID
  directory: string; // absolute path to worktree
}

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string; // unified diff text
  accepted?: boolean; // for interactive review
}

// ─────────────────────────────────────────────
// Audit Log Types
// ─────────────────────────────────────────────

export interface AuditEvent {
  id: string; // UUID v4
  sessionId: string;
  timestamp: string; // ISO 8601
  type: AuditEventType;
  payload: Record<string, unknown>;
  modelId: string;
  projectRoot: string;
}

export type AuditEventType =
  | "session_start"
  | "session_end"
  | "file_read"
  | "file_write"
  | "file_edit"
  | "bash_execute"
  | "git_commit"
  | "git_worktree_create"
  | "git_worktree_merge"
  | "pdse_gate_pass"
  | "pdse_gate_fail"
  | "autoforge_start"
  | "autoforge_iteration"
  | "autoforge_success"
  | "autoforge_abort"
  | "skill_import"
  | "skill_activate"
  | "lesson_record"
  | "lesson_inject"
  | "agent_spawn"
  | "agent_complete"
  | "noma_violation"
  | "constitution_violation"
  | "sandbox_start"
  | "sandbox_stop";

// ─────────────────────────────────────────────
// Sandbox Types
// ─────────────────────────────────────────────

export interface SandboxSpec {
  image: string; // default "ghcr.io/dantecode/sandbox:latest"
  workdir: string;
  networkMode: "none" | "bridge" | "host"; // default "bridge"
  mounts: SandboxMount[];
  env: Record<string, string>;
  memoryLimitMb: number; // default 2048
  cpuLimit: number; // default 2.0
  timeoutMs: number; // default 300000 (5 min)
}

export interface SandboxMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// ─────────────────────────────────────────────
// VS Code Extension Types
// ─────────────────────────────────────────────

export interface VSCodePanelMessage {
  type:
    | "chat_request"
    | "chat_response"
    | "file_add"
    | "file_drop"
    | "model_change"
    | "skill_activate"
    | "audit_event"
    | "pdse_score"
    | "diff_review"
    | "todo_update";
  payload: Record<string, unknown>;
  sessionId: string;
}

export interface InlineCompletionContext {
  filePath: string;
  prefix: string; // text before cursor
  suffix: string; // text after cursor
  language: string;
  cursorPosition: { line: number; character: number };
}
```

### 4.2 STATE.yaml Schema

The `STATE.yaml` file lives at `<project-root>/.dantecode/STATE.yaml`. It is the single source of truth for project-level DanteCode configuration, session state references, and PDSE configuration. It is read on every session start, updated on every session end, and written atomically (write to `.tmp` then rename).

```yaml
# .dantecode/STATE.yaml
# DanteCode Project State — Schema v1.0.0
# Auto-managed. Do not edit session_history or audit_ref manually.
# Safe to edit: model, pdse, autoforge, git, skills, agents sections.

version: "1.0.0"
project_root: "/absolute/path/to/project"
created_at: "2026-03-15T00:00:00Z"
updated_at: "2026-03-15T12:34:56Z"

# ── Model Configuration ────────────────────────────────────────────
model:
  default:
    provider: "grok" # grok | anthropic | openai | google | groq | ollama | custom
    model_id: "grok-3"
    max_tokens: 8192
    temperature: 0.1
    context_window: 131072
  fallback:
    - provider: "anthropic"
      model_id: "claude-sonnet-4-6"
      max_tokens: 8192
      temperature: 0.1
      context_window: 200000
  task_overrides: # override model per task type
    code_review: "grok/grok-3"
    documentation: "anthropic/claude-sonnet-4-6"
    quick_qa: "groq/llama-3.3-70b"

# ── PDSE Gate Configuration ────────────────────────────────────────
pdse:
  enabled: true
  threshold: 85 # minimum overall score (0–100) to pass gate
  hard_violations_allowed: 0 # zero hard violations tolerated
  max_regeneration_attempts: 3
  weights:
    completeness: 0.35
    correctness: 0.30
    clarity: 0.20
    consistency: 0.15
  # Patterns that trigger hard violations (regex, case-insensitive)
  stub_patterns:
    - "\\bTODO\\b"
    - "\\bFIXME\\b"
    - "\\bHACK\\b"
    - "\\bXXX\\b"
    - "raise NotImplementedError"
    - "pass\\s*#"
    - "\\.\\.\\." # Python ellipsis stub
    - "throw new Error\\(['\"]not implemented['\"]\\)"
    - "// @ts-ignore"
    - "as any"
    - "\\bplaceholder\\b"
    - "\\bshim\\b"

# ── Autoforge IAL Configuration ────────────────────────────────────
autoforge:
  enabled: true
  max_iterations: 3
  lesson_injection_enabled: true
  abort_on_security_violation: true
  gstack_commands:
    - name: "typecheck"
      command: "bun run typecheck"
      run_in_sandbox: false
      timeout_ms: 60000
      failure_is_soft: false
    - name: "lint"
      command: "bun run lint"
      run_in_sandbox: false
      timeout_ms: 30000
      failure_is_soft: false
    - name: "test"
      command: "bun run test"
      run_in_sandbox: true
      timeout_ms: 120000
      failure_is_soft: true # test failures warn, don't block

# ── Git Configuration ──────────────────────────────────────────────
git:
  auto_commit: true
  commit_footer: "🤖 Generated with DanteCode (https://dantecode.dev)\n\nCo-Authored-By: DanteCode <noreply@dantecode.dev>"
  worktree_enabled: true
  worktree_base_dir: ".dantecode/worktrees"
  push_on_commit: false # never push unless user explicitly requests
  branch_naming_pattern: "dc/{session_id_short}/{task_slug}"
  require_clean_worktree: true

# ── Sandbox Configuration ──────────────────────────────────────────
sandbox:
  enabled: false # default off; enabled per-session with --sandbox
  image: "ghcr.io/dantecode/sandbox:latest"
  network_mode: "bridge"
  memory_limit_mb: 2048
  cpu_limit: 2.0
  timeout_ms: 300000
  auto_cleanup: true

# ── Skills Configuration ───────────────────────────────────────────
skills:
  directory: ".dantecode/skills"
  adapter_version: "1.0.0"
  auto_wrap_on_import: true
  validate_on_import: true
  active_skills: [] # names of skills active in current session
  imported_from:
    claude: [] # list of claude skill names imported
    continue: []
    opencode: []
    native: []

# ── Agent Configuration ────────────────────────────────────────────
agents:
  directory: ".dantecode/agents"
  noma_enforcement: true # hard block on file lane overlap
  max_concurrent_agents: 4
  default_tools:
    - "Read"
    - "Write"
    - "Edit"
    - "Bash"
    - "Glob"
    - "Grep"
    - "TodoWrite"
    - "WebFetch"

# ── Audit Configuration ────────────────────────────────────────────
audit:
  log_path: ".dantecode/audit.jsonl"
  max_size_mb: 100
  rotate_on_exceed: true
  include_full_diffs: false # set true for deep debugging

# ── Session Registry ──────────────────────────────────────────────
# Auto-managed: do not edit manually
session_history:
  - id: "session-uuid-example"
    started_at: "2026-03-15T00:00:00Z"
    ended_at: "2026-03-15T01:00:00Z"
    model_used: "grok/grok-3"
    files_modified: []
    commits_made: 0
    pdse_gate_passes: 0
    pdse_gate_failures: 0
    lessons_recorded: 0

# ── Lessons DB ────────────────────────────────────────────────────
lessons:
  db_path: ".dantecode/lessons.db"
  max_lessons: 500
  min_severity_for_injection: "medium"

# ── Project Context ───────────────────────────────────────────────
project:
  name: "" # auto-detected from package.json or dir name
  language: "" # auto-detected: typescript | python | rust | go
  framework: "" # auto-detected: react | nextjs | fastapi | etc.
  agents_file: "AGENTS.dc.md" # project-level agent context file
  repo_map_enabled: true
  repo_map_max_files: 200 # max files in context window repo map
  ignore_patterns: # added to .gitignore-style matching
    - "node_modules/"
    - ".dantecode/worktrees/"
    - "dist/"
    - ".next/"
    - "__pycache__/"
```

### 4.3 Autoforge IAL Wiring

The Autoforge Iterative Autonomous Loop (IAL) is the self-healing engine within DanteForge. It activates whenever a PDSE gate fails or a GStack command returns non-zero.

```typescript
// packages/danteforge/src/autoforge.ts

import type {
  AutoforgeConfig,
  AutoforgeIteration,
  PDSEScore,
  PDSEViolation,
  GStackResult,
  Lesson,
  SessionMessage,
} from "@dantecode/config-types";
import { runPDSEScorer } from "./pdse-scorer";
import { runAntiStubScanner } from "./anti-stub-scanner";
import { runGStack } from "./gstack";
import { queryLessons, recordLesson } from "./lessons";
import { ModelRouter } from "../core/model-router";

export async function runAutoforgeIAL(
  code: string,
  context: SessionMessage[],
  config: AutoforgeConfig,
  router: ModelRouter,
  projectRoot: string,
): Promise<{ finalCode: string; iterations: AutoforgeIteration[]; succeeded: boolean }> {
  const iterations: AutoforgeIteration[] = [];
  let currentCode = code;

  for (let i = 1; i <= config.maxIterations; i++) {
    const antiStubResult = await runAntiStubScanner(currentCode, projectRoot);
    if (antiStubResult.hardViolations.length > 0 && i === config.maxIterations) {
      await recordLesson({
        projectRoot,
        pattern: antiStubResult.hardViolations.map((v) => v.pattern).join("; "),
        correction: "Generate complete implementation with no stubs or TODOs",
        severity: "high",
        source: "autoforge",
        occurrences: 1,
      });
      return { finalCode: currentCode, iterations, succeeded: false };
    }

    const gstackResults = await runGStack(currentCode, config.gstackCommands, projectRoot);
    const pdseScore = await runPDSEScorer(currentCode, router, projectRoot);

    const iteration: AutoforgeIteration = {
      iterationNumber: i,
      inputViolations: [...antiStubResult.hardViolations, ...antiStubResult.softViolations],
      gstackResults,
      lessonsInjected: [],
      outputScore: pdseScore,
      succeeded: false,
      durationMs: 0,
    };

    if (pdseScore.passedGate && gstackResults.every((r) => r.passed || r.command.failureIsSoft)) {
      iteration.succeeded = true;
      iterations.push(iteration);
      return { finalCode: currentCode, iterations, succeeded: true };
    }

    // Inject relevant lessons for next regeneration attempt
    if (config.lessonInjectionEnabled) {
      const lessons = await queryLessons({
        projectRoot,
        limit: 5,
        minSeverity: "medium",
      });
      iteration.lessonsInjected = lessons;

      const failureContext = buildFailureContext(pdseScore, gstackResults, lessons);
      const regenerated = await router.generate([
        ...context,
        { role: "user", content: failureContext },
      ]);
      currentCode = regenerated;
    }

    iterations.push(iteration);
  }

  return { finalCode: currentCode, iterations, succeeded: false };
}

function buildFailureContext(
  score: PDSEScore,
  gstackResults: GStackResult[],
  lessons: Lesson[],
): string {
  const violationSummary = score.violations
    .map((v) => `- [${v.severity.toUpperCase()}] ${v.type} at line ${v.line ?? "?"}: ${v.message}`)
    .join("\n");

  const gstackSummary = gstackResults
    .filter((r) => !r.passed)
    .map((r) => `- ${r.command.name} failed (exit ${r.exitCode}):\n${r.stderr.slice(0, 500)}`)
    .join("\n");

  const lessonSummary =
    lessons.length > 0
      ? `\nRelevant lessons from this project:\n${lessons.map((l) => `- ${l.pattern} → ${l.correction}`).join("\n")}`
      : "";

  return `Your previous generation failed the DanteForge quality gate.

PDSE Score: ${score.overall}/100 (threshold: 85)
Violations:
${violationSummary}

GStack Failures:
${gstackSummary}
${lessonSummary}

REQUIREMENTS:
1. Fix ALL violations listed above
2. Do NOT introduce any TODOs, FIXMEs, stubs, or placeholder code
3. Every function must have a complete, working implementation
4. Fix all typecheck and lint errors shown above
5. Do not use 'as any' or '@ts-ignore'

Regenerate the complete corrected implementation now.`;
}
```

### 4.4 Skill Import Flow

```
dantecode skills import --from-claude
         │
         ▼
   scan ~/.claude/skills/*/SKILL.md
         │
         ├─── for each skill found ────────────────────────┐
         │                                                   │
         ▼                                                   │
   parse frontmatter                                         │
   (name, description, tools, model)                        │
         │                                                   │
         ▼                                                   │
   read instructions body                                    │
         │                                                   │
         ▼                                                   │
   run anti-stub scan on instructions                        │
   (ensure skill itself has no stubs)                        │
         │                                                   │
         ├── stubs found ──► log warning, continue          │
         │                                                   │
         ▼                                                   │
   run constitution check                                    │
   (no credential exposure, no background processes)         │
         │                                                   │
         ├── constitution fail ──► skip skill, log error    │
         │                                                   │
         ▼                                                   │
   build DanteForge adapter:                                 │
   ┌──────────────────────────────────────┐                 │
   │ [DANTEFORGE ADAPTER — PREAMBLE]      │                 │
   │ PDSE gate: enforce before generating │                 │
   │ Anti-stub: zero TODO/FIXME/pass/...  │                 │
   │ Constitution: no secrets, no bg proc │                 │
   ├──────────────────────────────────────┤                 │
   │ [ORIGINAL SKILL INSTRUCTIONS]        │                 │
   │ (unmodified)                         │                 │
   ├──────────────────────────────────────┤                 │
   │ [DANTEFORGE ADAPTER — POSTAMBLE]     │                 │
   │ Lessons hook: inject on retry        │                 │
   │ GStack: typecheck + lint post-gen    │                 │
   │ Audit: log skill activation event   │                 │
   └──────────────────────────────────────┘                 │
         │                                                   │
         ▼                                                   │
   write to .dantecode/skills/<name>/SKILL.dc.md            │
         │                                                   │
         ▼                                                   │
   update STATE.yaml skills.imported_from.claude            │
         │                                                   │
         ▼                                                   │
   log AuditEvent { type: "skill_import", ... }             │
         │                                                   │
         └───────────────────────────────────────────────────┘
         │
         ▼
   print import summary:
   ✅ Imported: N skills
   ⚠️  Skipped (constitution fail): M skills
   📝 Written to: .dantecode/skills/
```

### 4.5 Anti-Stub Scanner Implementation

```typescript
// packages/danteforge/src/anti-stub-scanner.ts

import type { PDSEViolation } from "@dantecode/config-types";
import { readFile } from "fs/promises";
import { readStateYaml } from "./state";

const HARD_VIOLATION_PATTERNS: Array<{ pattern: RegExp; type: string; message: string }> = [
  {
    pattern: /\bTODO\b/i,
    type: "stub_detected",
    message: "TODO comment found — provide complete implementation",
  },
  {
    pattern: /\bFIXME\b/i,
    type: "stub_detected",
    message: "FIXME comment found — fix before committing",
  },
  {
    pattern: /\bHACK\b/i,
    type: "stub_detected",
    message: "HACK marker found — implement properly",
  },
  {
    pattern: /raise NotImplementedError/i,
    type: "stub_detected",
    message: "NotImplementedError stub — implement the method",
  },
  {
    pattern: /throw new Error\(['"]not implemented['"]\)/i,
    type: "stub_detected",
    message: "Not-implemented stub — implement the function",
  },
  {
    pattern: /\.\.\.\s*$/m,
    type: "incomplete_function",
    message: "Ellipsis body stub detected — provide full implementation",
  },
  {
    pattern: /^\s*pass\s*(#.*)?$/m,
    type: "stub_detected",
    message: "Python pass stub — implement function body",
  },
  {
    pattern: /\bas\s+any\b/,
    type: "type_any",
    message: "TypeScript 'as any' cast — use proper types",
  },
  {
    pattern: /@ts-ignore/,
    type: "stub_detected",
    message: "@ts-ignore suppresses type safety — fix the underlying type error",
  },
  {
    pattern: /\/\/ @ts-nocheck/,
    type: "stub_detected",
    message: "@ts-nocheck disables all type checking — remove and fix errors",
  },
  {
    pattern: /\bplaceholder\b/i,
    type: "stub_detected",
    message: "Placeholder detected — replace with real implementation",
  },
];

const SOFT_VIOLATION_PATTERNS: Array<{ pattern: RegExp; type: string; message: string }> = [
  { pattern: /\bXXX\b/, type: "stub_detected", message: "XXX marker found" },
  {
    pattern: /console\.log\(/,
    type: "console_log_leftover",
    message: "console.log found in production code — remove debug output",
  },
  { pattern: /\.skip\(/, type: "test_skip", message: ".skip() found in test — unskip or remove" },
  { pattern: /xit\(/, type: "test_skip", message: "xit() found — use it() for active tests" },
];

export interface AntiStubScanResult {
  hardViolations: PDSEViolation[];
  softViolations: PDSEViolation[];
  passed: boolean; // true only if zero hard violations
}

export async function runAntiStubScanner(
  content: string,
  projectRoot: string,
  filePath?: string,
): Promise<AntiStubScanResult> {
  const state = await readStateYaml(projectRoot);
  const hardPatterns = [
    ...HARD_VIOLATION_PATTERNS,
    ...(state.pdse.stub_patterns ?? []).map((p) => ({
      pattern: new RegExp(p, "im"),
      type: "stub_detected" as const,
      message: `Custom stub pattern matched: ${p}`,
    })),
  ];

  const lines = content.split("\n");
  const hardViolations: PDSEViolation[] = [];
  const softViolations: PDSEViolation[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNumber = lineIdx + 1;

    for (const { pattern, type, message } of hardPatterns) {
      if (pattern.test(line)) {
        hardViolations.push({
          type: type as PDSEViolation["type"],
          severity: "hard",
          file: filePath ?? "<generated>",
          line: lineNumber,
          message,
          pattern: pattern.source,
        });
      }
    }

    for (const { pattern, type, message } of SOFT_VIOLATION_PATTERNS) {
      if (pattern.test(line)) {
        softViolations.push({
          type: type as PDSEViolation["type"],
          severity: "soft",
          file: filePath ?? "<generated>",
          line: lineNumber,
          message,
          pattern: pattern.source,
        });
      }
    }
  }

  return {
    hardViolations,
    softViolations,
    passed: hardViolations.length === 0,
  };
}

export async function scanFile(filePath: string, projectRoot: string): Promise<AntiStubScanResult> {
  const content = await readFile(filePath, "utf-8");
  return runAntiStubScanner(content, projectRoot, filePath);
}
```

### 4.6 DanteForge Skill Adapter Specification

Every imported skill (from Claude, Continue, Opencode, or native) is wrapped with the following adapter blocks. The adapter is rendered into the final `SKILL.dc.md` file by `packages/skill-adapter/src/wrap.ts`.

```markdown
---
# SKILL.dc.md — DanteForge-Wrapped Skill
name: { original_name }
description: { original_description }
import_source: { claude|continue|opencode|native }
adapter_version: "1.0.0"
wrapped_at: "{ISO8601 timestamp}"
original_tools: [{ original tools list }]
dante_tools:
  ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "TodoWrite", "GStackQA", "LessonsInject"]
---

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- DANTEFORGE ADAPTER — PREAMBLE (DO NOT MODIFY)                  -->
<!-- ═══════════════════════════════════════════════════════════════ -->

## DanteForge Enforcement Contract

You are operating under the DanteForge quality constitution. Before generating
any code, you MUST comply with ALL of the following rules. Violations trigger
automatic rejection and regeneration.

### Anti-Stub Doctrine (ABSOLUTE — Zero Tolerance)

- NEVER write TODO, FIXME, HACK, XXX, or any placeholder comment
- NEVER write `pass`, `...`, `raise NotImplementedError`, or `throw new Error('not implemented')`
- NEVER write empty function bodies
- NEVER use TypeScript `as any` or `@ts-ignore`
- EVERY function must have a complete, working, tested implementation
- If you cannot fully implement something in this response, say so explicitly
  BEFORE generating code — do not generate a stub and leave it to later

### PDSE Clarity Gate (Score ≥ 85 Required)

- Completeness (35%): All logic present, no missing branches, no missing cases
- Correctness (30%): Types correct, no runtime errors, handles edge cases
- Clarity (20%): No vague names, no redundant comments, clear intent
- Consistency (15%): Matches repo code style, naming conventions, framework patterns

### Constitution Rules

- NEVER expose or log API keys, tokens, passwords, or any secrets
- NEVER use background processes (`&` operator, `nohup`, `disown`)
- NEVER push to git remotes unless the user explicitly requests it
- NEVER run `git rebase -i` or any interactive git command
- ALWAYS use absolute file paths in tool calls
- ALWAYS check existing code style before writing new code

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- ORIGINAL SKILL INSTRUCTIONS (UNMODIFIED)                       -->
<!-- ═══════════════════════════════════════════════════════════════ -->

{ORIGINAL_SKILL_INSTRUCTIONS_VERBATIM}

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- DANTEFORGE ADAPTER — POSTAMBLE (DO NOT MODIFY)                 -->
<!-- ═══════════════════════════════════════════════════════════════ -->

## Post-Generation Verification

After completing your primary task:

1. **GStack QA**: If this skill generated code, the GStack pipeline
   (typecheck → lint → test) will run automatically. Be prepared for the
   Autoforge IAL to invoke you again with failure context if GStack fails.

2. **Lessons Injection**: If this is a retry (Autoforge iteration > 1),
   project-specific lessons will be injected above. Incorporate every lesson.

3. **Audit Log**: Your completion will be recorded to `.dantecode/audit.jsonl`
   with the PDSE scores, gate result, and any violations found.

4. **Commit Hook**: All file writes will be staged and auto-committed with a
   structured message. Do not manually run `git add` or `git commit`.
```

### 4.7 Grok API Integration Details

```typescript
// packages/core/src/providers/grok.ts

import { createOpenAI } from "@ai-sdk/openai";
import type { ModelConfig } from "@dantecode/config-types";

export function buildGrokProvider(config: ModelConfig) {
  if (!process.env.GROK_API_KEY && !config.apiKey) {
    throw new Error(
      "Grok API key not found.\n" +
        "Set GROK_API_KEY environment variable or configure it in dante.config.yaml\n" +
        "Get your key at: https://console.x.ai/",
    );
  }

  // xAI Grok uses the OpenAI-compatible API format
  const provider = createOpenAI({
    apiKey: config.apiKey ?? process.env.GROK_API_KEY!,
    baseURL: "https://api.x.ai/v1",
    compatibility: "compatible",
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId); // e.g. "grok-3"
}

// packages/core/src/model-router.ts

import { generateText, streamText, type CoreMessage } from "ai";
import { buildGrokProvider } from "./providers/grok";
import { buildAnthropicProvider } from "./providers/anthropic";
import { buildOpenAIProvider } from "./providers/openai";
import { buildOllamaProvider } from "./providers/ollama";
import type { ModelConfig, ModelRouter, AuditEvent } from "@dantecode/config-types";
import { appendAuditEvent } from "../audit";

type ProviderBuilder = (config: ModelConfig) => ReturnType<typeof buildGrokProvider>;

const PROVIDER_BUILDERS: Record<string, ProviderBuilder> = {
  grok: buildGrokProvider,
  anthropic: buildAnthropicProvider,
  openai: buildOpenAIProvider,
  ollama: buildOllamaProvider,
};

export class ModelRouterImpl {
  constructor(
    private readonly router: ModelRouter,
    private readonly projectRoot: string,
    private readonly sessionId: string,
  ) {}

  async generate(
    messages: CoreMessage[],
    options: { maxTokens?: number; system?: string } = {},
  ): Promise<string> {
    const config = this.router.default;
    const builder = PROVIDER_BUILDERS[config.provider];

    if (!builder) {
      throw new Error(`Unknown model provider: ${config.provider}`);
    }

    const model = builder(config);

    try {
      const result = await generateText({
        model,
        messages,
        maxTokens: options.maxTokens ?? config.maxTokens,
        temperature: config.temperature,
        system: options.system,
      });

      await appendAuditEvent(this.projectRoot, {
        type: "session_start", // reuse session_start type for generation events
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        modelId: `${config.provider}/${config.modelId}`,
        projectRoot: this.projectRoot,
        payload: { tokensUsed: result.usage?.totalTokens ?? 0 },
      } satisfies Omit<AuditEvent, "id">);

      return result.text;
    } catch (error: unknown) {
      // Try fallback providers in order
      for (const fallbackConfig of this.router.fallback) {
        try {
          const fallbackBuilder = PROVIDER_BUILDERS[fallbackConfig.provider];
          if (!fallbackBuilder) continue;
          const fallbackModel = fallbackBuilder(fallbackConfig);
          const result = await generateText({
            model: fallbackModel,
            messages,
            maxTokens: options.maxTokens ?? fallbackConfig.maxTokens,
            temperature: fallbackConfig.temperature,
            system: options.system,
          });
          return result.text;
        } catch {
          continue;
        }
      }
      throw error;
    }
  }
}
```

### 4.8 VS Code Extension Manifest

```json
{
  "name": "dantecode",
  "displayName": "DanteCode",
  "description": "Open-source model-agnostic AI coding agent with DanteForge quality gates",
  "version": "1.0.0",
  "publisher": "dantecode",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/dantecode/dantecode"
  },
  "engines": {
    "vscode": "^1.95.0"
  },
  "categories": ["AI", "Programming Languages", "Other"],
  "keywords": ["ai", "coding", "agent", "grok", "model-agnostic", "danteforge"],
  "icon": "assets/icon.png",
  "activationEvents": [
    "onStartupFinished",
    "onView:dantecode.chatView",
    "onView:dantecode.auditView",
    "onCommand:dantecode.openChat",
    "onCommand:dantecode.importClaudeSkills",
    "onCommand:dantecode.runPDSE",
    "onCommand:dantecode.toggleSandbox",
    "onLanguage:typescript",
    "onLanguage:javascript",
    "onLanguage:python",
    "onLanguage:rust",
    "onLanguage:go"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "dantecode",
          "title": "DanteCode",
          "icon": "assets/sidebar-icon.svg"
        }
      ]
    },
    "views": {
      "dantecode": [
        {
          "type": "webview",
          "id": "dantecode.chatView",
          "name": "Chat",
          "when": "true"
        },
        {
          "type": "webview",
          "id": "dantecode.auditView",
          "name": "Audit Log",
          "when": "true"
        }
      ]
    },
    "commands": [
      { "command": "dantecode.openChat", "title": "DanteCode: Open Chat", "category": "DanteCode" },
      {
        "command": "dantecode.addFileToContext",
        "title": "DanteCode: Add File to Context",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.importClaudeSkills",
        "title": "DanteCode: Import Claude Skills",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.runPDSE",
        "title": "DanteCode: Run PDSE Score on File",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.runGStack",
        "title": "DanteCode: Run GStack QA",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.switchModel",
        "title": "DanteCode: Switch Model",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.toggleSandbox",
        "title": "DanteCode: Toggle Sandbox Mode",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.showLessons",
        "title": "DanteCode: Show Project Lessons",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.initProject",
        "title": "DanteCode: Initialize Project",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.acceptDiff",
        "title": "DanteCode: Accept Diff Hunk",
        "category": "DanteCode"
      },
      {
        "command": "dantecode.rejectDiff",
        "title": "DanteCode: Reject Diff Hunk",
        "category": "DanteCode"
      }
    ],
    "keybindings": [
      { "command": "dantecode.openChat", "key": "ctrl+shift+d", "mac": "cmd+shift+d" },
      {
        "command": "dantecode.addFileToContext",
        "key": "ctrl+shift+a",
        "mac": "cmd+shift+a",
        "when": "editorFocus"
      },
      {
        "command": "dantecode.runPDSE",
        "key": "ctrl+shift+p",
        "mac": "cmd+shift+p",
        "when": "editorFocus"
      }
    ],
    "configuration": {
      "title": "DanteCode",
      "properties": {
        "dantecode.defaultModel": {
          "type": "string",
          "default": "grok/grok-3",
          "description": "Default model for DanteCode. Format: provider/model-id"
        },
        "dantecode.grokApiKey": {
          "type": "string",
          "default": "",
          "description": "Grok API key (overrides GROK_API_KEY env var)"
        },
        "dantecode.anthropicApiKey": {
          "type": "string",
          "default": "",
          "description": "Anthropic API key (overrides ANTHROPIC_API_KEY env var)"
        },
        "dantecode.pdseThreshold": {
          "type": "number",
          "default": 85,
          "minimum": 0,
          "maximum": 100,
          "description": "Minimum PDSE score required to pass quality gate"
        },
        "dantecode.autoCommit": {
          "type": "boolean",
          "default": true,
          "description": "Automatically commit accepted edits to git"
        },
        "dantecode.sandboxEnabled": {
          "type": "boolean",
          "default": false,
          "description": "Run bash commands in Docker sandbox"
        },
        "dantecode.telemetry": {
          "type": "boolean",
          "default": false,
          "description": "Allow anonymous usage telemetry (never sends code or prompts)"
        }
      }
    },
    "menus": {
      "editor/context": [
        {
          "command": "dantecode.addFileToContext",
          "group": "dantecode",
          "when": "editorFocus"
        },
        {
          "command": "dantecode.runPDSE",
          "group": "dantecode",
          "when": "editorFocus"
        }
      ]
    },
    "statusBarItems": [
      {
        "id": "dantecode.statusModel",
        "text": "$(robot) Grok-3",
        "tooltip": "DanteCode active model — click to switch",
        "command": "dantecode.switchModel",
        "alignment": "right",
        "priority": 100
      }
    ]
  }
}
```

---

## D5 Wave-Based Implementation Plan

### Wave 1 — Foundation Skeleton (Weeks 1–3)

**Goal**: Working CLI with Grok routing, basic file edits, and git commits

#### Deliverables

1. Monorepo scaffold (`packages/` structure, Bun workspaces, Turborepo)
2. `packages/config-types` — all TypeScript interfaces from D4.1
3. `packages/core` — ModelRouter with Grok-first logic + Anthropic fallback
4. `packages/cli` — basic Ink REPL with `/help`, `/files`, `/diff`, `/commit`
5. `packages/git-engine` — auto-commit with HEREDOC message format
6. `STATE.yaml` parser and writer with Zod validation
7. Audit logger (`audit.jsonl` append-only)
8. `dantecode init` command (creates `.dantecode/`, writes `STATE.yaml`, `AGENTS.dc.md`)

#### Tool Set (Wave 1)

- `Read` — read files from disk
- `Write` — write new files
- `Edit` — exact string replacement (Claude Code Edit tool pattern)
- `Bash` — execute shell commands (no sandbox yet)
- `Glob` — file pattern matching
- `Grep` — search file contents
- `GitCommit` — structured commit via HEREDOC

#### Acceptance Criteria

- [ ] `dantecode "add a hello world function to src/index.ts"` edits the file and commits
- [ ] Commit message follows HEREDOC format with DanteCode footer
- [ ] `STATE.yaml` is created on first run and updated on session end
- [ ] `audit.jsonl` receives `session_start`, `file_edit`, `git_commit`, `session_end` events
- [ ] Model falls back to Anthropic when `GROK_API_KEY` not set
- [ ] All TypeScript compiles with `strict: true` and zero `any` casts

---

### Wave 2 — DanteForge Brain (Weeks 4–6)

**Goal**: PDSE scoring, anti-stub scanning, Autoforge IAL, GStack integration

#### Deliverables

1. `packages/danteforge` — full package implementation:
   - `anti-stub-scanner.ts` — all patterns from D4.5
   - `pdse-scorer.ts` — model-evaluated PDSE scoring with Zod-validated output
   - `gstack.ts` — runs configured GStack commands, captures stdout/stderr
   - `autoforge.ts` — IAL loop from D4.3
   - `lessons.ts` — SQLite-backed lessons DB with query and record operations
2. Integration of DanteForge into the core code generation pipeline
3. `PDSE` slash command in REPL
4. `GStack` slash command in REPL
5. `/verbose` mode showing gate scores in real-time
6. `dantecode skills validate <name>` command
7. Autoforge failure logging to `lessons.db`

#### Acceptance Criteria

- [ ] Generating code with a `TODO` triggers hard violation and Autoforge retry
- [ ] After 3 Autoforge failures, session aborts with clear error message + lesson recorded
- [ ] Generating `as any` triggers hard violation
- [ ] PDSE score shown in verbose output format: `[PDSE] C:92 R:88 Cl:95 Co:90 → 91/100 PASS`
- [ ] GStack typecheck failure → Autoforge retry with type error context injected
- [ ] Lessons from past failures are injected on retry (verified by log output)
- [ ] `lessons.db` grows after each autoforge failure
- [ ] Zero regressions from Wave 1 tests

---

### Wave 3 — Skill Import & Agent System (Weeks 7–9)

**Goal**: Full skill import pipeline, agent orchestration, NOMA enforcement

#### Deliverables

1. `packages/skill-adapter` — full skill import and wrapping pipeline
2. `dantecode skills import --from-claude` command (D4.4 flow)
3. `dantecode skills import --from-continue` (parses Continue `agents/*.md` format)
4. `dantecode skills import --from-opencode` (parses Opencode `agent/*.md` format)
5. `SKILL.dc.md` renderer with adapter injection
6. `dantecode agent run <name>` command
7. NOMA enforcement: `AgentFrame` tracking, file lane collision detection → hard abort
8. `TodoWrite` tool implementation (in-session todo tracking)
9. `Task` tool implementation (spawn sub-agents with NOMA registration)
10. Worktree isolation: `dantecode --worktree` flag, `git-engine` worktree lifecycle
11. Continue.dev `.continue/agents/` skill format parser
12. Opencode `.opencode/agent/` skill format parser

#### Acceptance Criteria

- [ ] `dantecode skills import --from-claude` imports all skills from `~/.claude/skills/`
- [ ] Each imported skill has DanteForge adapter preamble and postamble in `SKILL.dc.md`
- [ ] Imported skills run on Grok-3 by default regardless of original model hint
- [ ] Activating a skill changes agent behavior as per skill instructions
- [ ] Two agents touching the same file triggers NOMA violation + abort
- [ ] `dantecode --worktree` creates a new git worktree and runs the session in it
- [ ] TodoWrite tracks tasks visible in REPL output
- [ ] Sub-agents spawned via `Task` are registered with NOMA before touching files
- [ ] All Continue.dev built-in agents import cleanly (breaking-change-detector, test-coverage, etc.)

---

### Wave 4 — VS Code Extension & Desktop App (Weeks 10–13)

**Goal**: Full VS Code integration matching Continue.dev richness; Electron desktop app

#### Deliverables

1. `packages/vscode` — full VS Code extension (manifest from D4.8)
   - Chat webview panel (React + Tailwind, inline in VS Code sidebar)
   - Inline ghost text completions (InlineCompletionItemProvider)
   - Diff review panel (accept/reject hunks in VS Code diff editor)
   - PDSE score display in Problems panel
   - `@filename` context pills in chat
   - Model selector dropdown
   - Audit log panel (tailing `audit.jsonl`)
   - Status bar item showing current model + gate status
2. `packages/desktop` — Electron app wrapping the Ink CLI in a windowed UI
   - Cross-platform: macOS `.dmg`, Windows `.exe`, Linux `.AppImage`
   - Auto-update via `electron-updater`
3. LSP server integration for real-time diagnostics
4. `WebFetch` tool (Playwright primary, httpx fallback — Aider-derived)

#### Acceptance Criteria

- [ ] VS Code extension activates in < 500ms on `onStartupFinished`
- [ ] Chat panel sends messages to DanteCode core and renders streaming responses
- [ ] Inline suggestion appears within 2s of pause in typing
- [ ] Accepting a suggestion triggers DanteForge gate before writing
- [ ] PDSE violations appear as Problems panel entries with file + line
- [ ] `dantecode skills import --from-claude` command accessible from VS Code command palette
- [ ] Desktop app installs on macOS without admin privileges
- [ ] Auto-update checks on startup and prompts user
- [ ] `WebFetch` scrapes a URL and adds markdown content to context

---

### Wave 5 — Sandbox, Hardening & Release (Weeks 14–16)

**Goal**: Docker sandbox, full test coverage, one-command install, public release

#### Deliverables

1. `packages/sandbox` — Docker container lifecycle (OpenHands-derived)
   - Container start/stop/exec/cleanup
   - Filesystem snapshot before and after execution
   - Network isolation (bridge mode default, none optional)
   - Audit events for all sandbox operations
2. `dantecode --sandbox` flag wires all `Bash` tool calls through Docker
3. MCP server support (Opencode-derived MCP client integration)
4. `dantecode skills import --from-opencode` (MCP-aware agent wrapping)
5. Full benchmark suite (vs. Claude Code, Aider, Opencode on SWE-bench subset)
6. Install script: `curl -fsSL https://get.dantecode.dev | bash`
7. VS Code Marketplace submission
8. `homebrew` formula: `brew install dantecode`
9. `npm` global: `npm install -g dantecode`
10. Docker image: `docker run -it dantecode/dantecode`
11. CHANGELOG, security policy, LICENSE (MIT), contributor guide
12. Complete documentation site

#### Acceptance Criteria

- [ ] `curl -fsSL https://get.dantecode.dev | bash && dantecode` works in < 90 seconds
- [ ] `brew install dantecode` works on macOS
- [ ] `npm install -g dantecode` installs cleanly on Node 20+
- [ ] Sandbox: bash command runs in Docker, filesystem changes visible in worktree
- [ ] Sandbox: no network calls leak outside Docker bridge
- [ ] MCP: connecting an MCP server adds its tools to the active session
- [ ] Benchmark: DanteCode stub rate = 0% on 50-file generation test
- [ ] Benchmark: Claude Code stub rate measured as baseline
- [ ] Zero `TODO` or `FIXME` in DanteCode's own codebase (CI enforced)
- [ ] All 5 packages pass `bun run typecheck` and `bun run test` in CI

---

## D6 Test Strategy & Verification

### 6.1 Test Pyramid

```
                    ┌───────┐
                    │  E2E  │  5%  — real model calls, real git, real filesystem
                    │ Tests │
                   ┌┴───────┴┐
                   │Integrat.│ 20%  — mock model, real filesystem, real git
                   │  Tests  │
                  ┌┴─────────┴┐
                  │   Unit    │ 75%  — all pure functions, mock everything
                  │   Tests   │
                  └───────────┘
```

### 6.2 Unit Tests (Vitest)

Every function in `packages/danteforge/` has unit tests. Critical test cases:

**Anti-stub scanner:**

```typescript
describe("runAntiStubScanner", () => {
  it("detects TODO as hard violation", async () => { ... });
  it("detects 'as any' as hard violation", async () => { ... });
  it("detects raise NotImplementedError as hard violation", async () => { ... });
  it("detects '...' body stub as hard violation", async () => { ... });
  it("passes clean complete code", async () => { ... });
  it("loads custom patterns from STATE.yaml", async () => { ... });
});
```

**PDSE scorer:**

```typescript
describe("runPDSEScorer", () => {
  it("returns score >= 85 for complete correct code", async () => { ... });
  it("returns score < 85 for stub-filled code", async () => { ... });
  it("sets passedGate=false when hard violations present", async () => { ... });
  it("uses configured weights from STATE.yaml", async () => { ... });
});
```

**Autoforge IAL:**

```typescript
describe("runAutoforgeIAL", () => {
  it("succeeds on first iteration for clean code", async () => { ... });
  it("retries up to maxIterations on failure", async () => { ... });
  it("injects lessons on retry iteration", async () => { ... });
  it("returns succeeded=false after maxIterations exhausted", async () => { ... });
  it("injects GStack failure context in retry prompt", async () => { ... });
});
```

**Skill importer:**

```typescript
describe("importClaudeSkills", () => {
  it("scans ~/.claude/skills/ and finds SKILL.md files", async () => { ... });
  it("wraps each skill with DanteForge adapter blocks", async () => { ... });
  it("skips skills that fail constitution check", async () => { ... });
  it("writes wrapped skills to .dantecode/skills/", async () => { ... });
  it("updates STATE.yaml imported_from.claude list", async () => { ... });
  it("emits skill_import audit events for each skill", async () => { ... });
});
```

### 6.3 Integration Tests

- Full `dantecode "task"` invocation with mock model returning stub code → verify Autoforge fires
- Full `dantecode skills import --from-claude` with fixture skills directory
- Git worktree creation, task execution, merge back to main branch
- `STATE.yaml` write → restart → read → verify state preserved
- NOMA enforcement: two agents touching same file → verify hard abort

### 6.4 E2E Tests (CI, real model optional)

- `dantecode "add a function that returns the sum of two numbers to src/math.ts"` → file written, compiles, committed
- `dantecode skills import --from-claude` against fixture `~/.claude/skills/` → all wrapped correctly
- Install script on clean Ubuntu 24.04 → `dantecode --version` succeeds
- VS Code extension: opens chat panel, sends message, receives response, file in workspace modified

### 6.5 CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
  lint:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run lint
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run test
  anti-stub-self-check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install && bun run build
      - run: ./dist/dantecode skills validate --self-check
        # Runs anti-stub scanner on DanteCode's own source. Fails CI if any stubs found.
```

---

## D7 Migration & Install Experience

### 7.1 One-Command Install

```bash
# Primary: curl installer (macOS + Linux)
curl -fsSL https://get.dantecode.dev | bash

# Homebrew (macOS + Linux)
brew install dantecode

# npm global
npm install -g dantecode

# Bun global
bun install -g dantecode

# Docker
docker run -it -v $(pwd):/workspace dantecode/dantecode

# VS Code: search "DanteCode" in Extensions panel
```

The curl installer:

1. Detects OS and architecture
2. Downloads the correct pre-built Bun binary from GitHub Releases
3. Places it at `/usr/local/bin/dantecode` (or `~/.local/bin/dantecode` if no sudo)
4. Prints `✅ DanteCode installed. Run: dantecode`
5. Optionally runs `dantecode config init` if in a git repo

### 7.2 First Run Experience

```
$ dantecode

╔══════════════════════════════════════════════════════════════╗
║  DanteCode v1.0.0 — Open-Source AI Coding Agent             ║
║  Powered by DanteForge · Default model: Grok-3               ║
╚══════════════════════════════════════════════════════════════╝

No GROK_API_KEY found. Configure a model provider:

  1. Grok (fastest):    export GROK_API_KEY=your-key
  2. Anthropic:         export ANTHROPIC_API_KEY=your-key
  3. OpenAI:            export OPENAI_API_KEY=your-key
  4. Ollama (local):    export OLLAMA_BASE_URL=http://localhost:11434

Get your Grok key at: https://console.x.ai/

Run 'dantecode config init' to save settings to dante.config.yaml

>
```

### 7.3 Claude Code Migration Path

For users migrating from Claude Code:

```bash
# Step 1: Install DanteCode
brew install dantecode

# Step 2: Import all your Claude skills
dantecode skills import --from-claude
# Output: ✅ Imported 12 skills from ~/.claude/skills/
#         📝 Written to .dantecode/skills/
#         ℹ️  All skills wrapped with DanteForge adapter

# Step 3: Initialize project (creates STATE.yaml, AGENTS.dc.md)
dantecode config init

# Step 4: Set your model (Grok by default, or keep Anthropic)
export GROK_API_KEY=your-key
# OR to keep using Anthropic:
export ANTHROPIC_API_KEY=your-key

# Step 5: Run
dantecode
```

### 7.4 AGENTS.dc.md Format

Every project initialized with `dantecode config init` gets an `AGENTS.dc.md` file. This is DanteCode's equivalent of `AGENTS.md` (Claude Code) and `AGENTS.md` (Amp), providing persistent project context to the agent across sessions:

```markdown
# AGENTS.dc.md

# DanteCode project context — loaded automatically on every session start.

# Edit this file to give DanteCode permanent project knowledge.

## Project

Name: {project_name}
Language: {language}
Framework: {framework}

## Build Commands

- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Test: `bun run test`
- Build: `bun run build`
- Dev: `bun run dev`

## Code Style

- (Add project-specific code style rules here)

## Architecture Notes

- (Add project architecture notes here)

## DanteForge Gates

PDSE threshold: 85
Max Autoforge iterations: 3
GStack commands: typecheck, lint, test

## Important File Patterns

- Source: `src/**/*.ts`
- Tests: `tests/**/*.test.ts`
- Config: `*.config.ts`

## Do Not Touch

- (List any files or directories DanteCode should never modify)
```

---

## D8 Third-Party Notices & Attribution

DanteCode is built on the shoulders of these open-source projects. All licenses must be included in the distribution.

| Project            | License    | URL                                              | What We Harvest                                                                                                                    |
| ------------------ | ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **opencode**       | MIT        | https://github.com/anomalyco/opencode            | CLI skeleton, Ink TUI, Bun runtime, VS Code LSP integration, AI SDK model routing, MCP client, agent definition format             |
| **continue**       | Apache 2.0 | https://github.com/continuedev/continue          | VS Code sidebar UI patterns, inline completion architecture, provider-agnostic design, agent YAML format, Anti-slop check patterns |
| **aider**          | Apache 2.0 | https://github.com/Aider-AI/aider                | Auto-commit system, diff review mechanics, repo-map algorithm, web scrape with Playwright/httpx, multi-file edit patterns          |
| **OpenHands**      | MIT        | https://github.com/OpenHands/OpenHands           | Docker sandbox runtime, stateful agent loop design, tool-calling architecture, release management workflow                         |
| **Vercel AI SDK**  | Apache 2.0 | https://github.com/vercel/ai                     | Model provider abstraction (`generateText`, `streamText`, `createOpenAI`)                                                          |
| **Ink**            | MIT        | https://github.com/vadimdemedes/ink              | Terminal React renderer for CLI                                                                                                    |
| **isomorphic-git** | MIT        | https://github.com/isomorphic-git/isomorphic-git | Programmatic git operations                                                                                                        |
| **Zod**            | MIT        | https://github.com/colinhacks/zod                | Schema validation for STATE.yaml and API responses                                                                                 |
| **better-sqlite3** | MIT        | https://github.com/WiseLibs/better-sqlite3       | Lessons DB (SQLite)                                                                                                                |
| **dockerode**      | Apache 2.0 | https://github.com/apocas/dockerode              | Docker SDK for sandbox runtime                                                                                                     |
| **Turborepo**      | MIT        | https://github.com/vercel/turborepo              | Monorepo build orchestration                                                                                                       |
| **Bun**            | MIT        | https://github.com/oven-sh/bun                   | Runtime and package manager                                                                                                        |

### Attribution Notice (included in `--version` and README)

```
DanteCode incorporates code and design patterns from:
  opencode (MIT) — https://github.com/anomalyco/opencode
  continue (Apache-2.0) — https://github.com/continuedev/continue
  aider (Apache-2.0) — https://github.com/Aider-AI/aider
  OpenHands (MIT) — https://github.com/OpenHands/OpenHands

Full third-party license text available at:
  https://github.com/dantecode/dantecode/blob/main/THIRD_PARTY_LICENSES.md
```

### System Prompt Attribution

The agent behavior patterns (task management, concise output, git commit format, proactiveness balance) are informed by analysis of public agent system prompts, specifically the Claude Code 2.0 system prompt architecture (stateless operation, TodoWrite integration, HEREDOC commits, parallel tool calls, AGENTS.md context loading). These behavioral patterns are implemented independently in TypeScript and are not derivative works.

---

## D9 Anti-Stub Doctrine

### 9.1 The Law

> **Zero tolerance. No exceptions. Ever.**

A stub is any of the following:

- A `TODO`, `FIXME`, `HACK`, or `XXX` comment
- A function that contains only `pass`, `...`, or `raise NotImplementedError`
- A TypeScript function that returns `undefined` without a documented reason
- The use of `as any` or `@ts-ignore` without a code comment explaining the unavoidable necessity (even with a comment, it triggers a soft violation for review)
- The string `"not implemented"` or `"placeholder"` in any function body or comment
- An empty catch block without a comment explaining why silence is correct
- A `// TODO: implement` or `// coming soon` comment
- A React component that renders only `<div>TODO</div>` or similar

### 9.2 Enforcement Layers

DanteCode enforces the anti-stub doctrine at four independent layers. All four must pass before any file is written to disk.

#### Layer 1: Pre-Write Anti-Stub Scanner (Hard Gate)

- Runs synchronously before every `Write` or `Edit` tool call
- Blocks the write if any hard violation pattern is found
- Triggers Autoforge IAL automatically
- Cannot be bypassed by the user or the model
- Implemented in `packages/danteforge/src/anti-stub-scanner.ts`

#### Layer 2: PDSE Clarity Score (Quantitative Gate)

- PDSE Clarity dimension scores `0` if any stub patterns are present
- An overall PDSE score ≥ 85 is required; a Clarity score of 0 mathematically prevents a score ≥ 85 from being achievable
- This creates a second independent block on stub-containing code
- Implemented in `packages/danteforge/src/pdse-scorer.ts`

#### Layer 3: GStack Typecheck + Lint (Compiler Gate)

- TypeScript stubs often produce type errors (e.g., function declared as returning `string` but has no return statement)
- ESLint rules catch empty functions and `no-unused-vars` for placeholder imports
- GStack runs both tools post-generation; failures trigger Autoforge IAL
- Implemented in `packages/danteforge/src/gstack.ts`

#### Layer 4: CI Self-Check (Repository Gate)

- `anti-stub-self-check` CI job runs `dantecode skills validate --self-check` on every PR
- This scans DanteCode's own source code for stubs
- A PR cannot be merged if DanteCode's own code contains stubs
- This enforces that the developers building DanteCode are held to the same standard

### 9.3 Relationship to PDSE Clarity = 0

The mathematical relationship between anti-stubs and PDSE is intentional and load-bearing:

```
PDSE Overall = (Completeness × 0.35) + (Correctness × 0.30) + (Clarity × 0.20) + (Consistency × 0.15)

If any stub present → Clarity = 0
Maximum achievable PDSE when Clarity = 0:
  (100 × 0.35) + (100 × 0.30) + (0 × 0.20) + (100 × 0.15) = 80

80 < 85 (threshold) → Gate FAILS

Therefore: a single stub guarantees gate failure regardless of other scores.
```

This is not an accident. It is a design invariant. Do not change the weights or threshold without understanding this guarantee.

### 9.4 Verifier Gate Sequence

```
Code Generated
     │
     ▼
[Gate 1] Anti-Stub Scanner ─── FAIL ──► Autoforge IAL (retry)
     │ PASS                              │
     ▼                                   │ max retries exceeded
[Gate 2] PDSE Score ──────── FAIL ──►  │
     │ PASS                              ▼
     ▼                             Hard Reject:
[Gate 3] GStack QA ────────── FAIL ──► - Log to audit.jsonl
     │ PASS                        - Record lesson to lessons.db
     ▼                             - Print violation summary
[Gate 4] Constitution Check ─ FAIL ──► Abort (no retry for security)
     │ PASS
     ▼
Write to Disk ✅
```

### 9.5 Developer Contract

Every contributor to DanteCode signs this contract by submitting a PR:

1. **I will not write stubs.** If I cannot fully implement something, I will document what is missing in `AGENTS.dc.md` or a GitHub Issue — not in the code.
2. **I will not silence linters.** If the linter is wrong, I will open an issue. If the linter is right, I will fix the code.
3. **I will not use `as any`.** If TypeScript cannot infer a type, I will define the type.
4. **I will not leave `console.log` in production code.**
5. **I understand that the CI anti-stub-self-check will reject my PR if I violate any of the above.**

This contract is enforced by the same tools DanteCode uses on user code. The builder is held to the same standard as the user.

---

_DanteCode PRD v1.0.0 — End of Document_
_Prepared for DanteForge build pipeline ingestion._
_Zero placeholders. Zero stubs. Zero excuses._
