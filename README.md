# DanteCode

Open-source, model-agnostic AI coding agent with built-in quality gates.

DanteCode pairs an interactive REPL with **DanteForge** — a verification engine that enforces zero-stub discipline, PDSE quality scoring, and an iterative auto-correction loop (Autoforge IAL) so generated code is production-ready from the start.

## Features

- **Model-agnostic** — Anthropic, OpenAI, Grok (xAI), Ollama, or any OpenAI-compatible endpoint
- **Anti-Stub Doctrine** — Hard gate rejects TODO/FIXME/placeholder code before it lands
- **PDSE Scoring** — 4-dimension quality metric (Completeness, Correctness, Clarity, Consistency)
- **Autoforge IAL** — Iterative auto-correction: generate → scan → score → regenerate on failure
- **Constitution Checker** — Blocks hardcoded secrets, credential leaks, and policy violations
- **Skill Adapter** — Import skills from Claude Code, Continue, and OpenCode with automatic wrapping
- **Git Engine** — Diff parsing, auto-commit, worktree isolation, repo-map generation
- **Sandbox** — Docker container isolation with snapshot/restore (optional)
- **GStack** — Sequential guard pipeline: typecheck → lint → test → coverage

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.2+ (package manager and runtime)
- [Node.js](https://nodejs.org/) v20+ (for TypeScript compilation)
- An API key for at least one supported provider

### Install

```bash
git clone https://github.com/dantecode/dantecode.git
cd dantecode
bun install
```

### Set up an API key

```bash
# Pick your provider:
export ANTHROPIC_API_KEY="sk-ant-..."    # Anthropic (Claude)
export OPENAI_API_KEY="sk-..."           # OpenAI (GPT-4)
export GROK_API_KEY="xai-..."            # xAI (Grok)
# Ollama runs locally — no key needed
```

### Run

```bash
# Interactive REPL
bun run cli

# One-shot prompt
bun run cli "explain this codebase"

# Commands
bun run cli init              # Initialize .dantecode/ config
bun run cli skills list       # List imported skills
bun run cli config show       # Show current configuration
```

### Run the test suite

```bash
bun run test                  # 403 tests across 18 suites
bun run typecheck             # tsc --noEmit across all packages
bun run lint                  # ESLint
bun run format:check          # Prettier
```

## Architecture

```
packages/
  config-types/   Type definitions shared across all packages
  core/           Model router, provider builders, state management, audit logging
  danteforge/     Anti-stub scanner, PDSE scorer, constitution checker, autoforge IAL
  git-engine/     Git diff parser, commit helper, worktree manager, repo-map
  skill-adapter/  Skill importer, parser (Claude/Continue/OpenCode), registry, wrapper
  sandbox/        Docker container manager, command executor, local fallback
  cli/            Argument parser, REPL, slash commands, agent loop
  vscode/         VS Code extension (WIP)
  desktop/        Desktop app shell (WIP)
```

## Configuration

DanteCode reads configuration from `.dantecode/config.yaml` in your project root:

```yaml
model:
  provider: anthropic
  modelId: claude-sonnet-4-6
  maxTokens: 8192
  temperature: 0.1
  contextWindow: 200000

sandbox:
  enabled: false
  image: ghcr.io/dantecode/sandbox:latest

git:
  autoCommit: true
  worktree: false
```

Override the model at runtime with `--model`:

```bash
bun run cli --model grok/grok-3 "refactor this function"
bun run cli --model ollama/llama3 "explain this code"
```

## Quality Gates

Every code generation pass can be verified through the DanteForge pipeline:

1. **Anti-Stub Scan** — Regex + AST patterns detect TODO, FIXME, `as any`, `@ts-ignore`, placeholder functions
2. **Constitution Check** — Blocks hardcoded secrets, credential patterns, and policy violations
3. **PDSE Score** — Weighted quality metric: Completeness (35%), Correctness (30%), Clarity (20%), Consistency (15%)
4. **Autoforge IAL** — If scan or score fails, regenerate with feedback up to N iterations

## Supported Providers

| Provider   | Env Variable        | Models                                       |
| ---------- | ------------------- | -------------------------------------------- |
| Anthropic  | `ANTHROPIC_API_KEY` | claude-sonnet-4-6, claude-opus-4-6, etc.     |
| OpenAI     | `OPENAI_API_KEY`    | gpt-4.1, gpt-4.1-mini, o3, etc.              |
| Grok (xAI) | `GROK_API_KEY`      | grok-3, grok-3-mini                          |
| Ollama     | None (local)        | llama3, codellama, mistral, etc.             |
| Custom     | `OPENAI_API_KEY`    | Any OpenAI-compatible endpoint via `baseUrl` |

## Development

```bash
# Build all packages
bun run build

# Run tests with coverage
npx vitest run --coverage

# Lint and format
bun run lint
bun run format:check
bun run format                # Auto-fix formatting
```

## License

[MIT](LICENSE)
