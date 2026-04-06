<div align="center">
  <h1>DanteCode</h1>
  <p><strong>AI coding agent with runtime-verified code quality — for everyone, not just developers</strong></p>

  [![Version](https://img.shields.io/badge/version-0.9.3-blue.svg)](packages/vscode/CHANGELOG.md)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](tsconfig.json)
</div>

[![CI](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml/badge.svg)](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dantecode/cli)](https://www.npmjs.com/package/@dantecode/cli)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Quality: 8.0/10](https://img.shields.io/badge/quality-8.0%2F10-green)](DIMENSION_ASSESSMENT.md)

A coding agent that writes, edits, and verifies code across any AI provider.

**Status:** Active development (0.9.3). Strong in verification, git-awareness, and extensibility. See [comprehensive assessment](DIMENSION_ASSESSMENT.md) for details.

## Quick Start

```bash
npm install -g @dantecode/cli
export ANTHROPIC_API_KEY=sk-ant-...
dantecode "build me a todo app"
```

Supports Anthropic, Grok, OpenAI, Google, Groq, Ollama, and any OpenAI-compatible endpoint.

## What's Strong (8.5+/10)

- ✅ **Verification & Trust** (8.6/10) - DanteForge PDSE scoring, evidence chains, anti-confabulation guards
- ✅ **Extensibility** (8.5/10) - Skills system, MCP servers, plugin architecture
- ✅ **Git/Repo Awareness** (8.4/10) - Worktrees, repo maps, semantic indexing
- ✅ **Security/Sandbox** (8.3/10) - Mandatory DanteSandbox, policy enforcement
- ✅ **Model Flexibility** (8.2/10) - Provider abstraction, dynamic switching
- ✅ **Agentic Depth** (8.1/10) - Council/fleet, Gaslight refinement, FearSet, Skillbook

## What's In Progress (7.0-8.0/10)

- ⚠️ **UX/Ergonomics** (8.0/10) - CLI works, needs fuzzy finder + better error messages
- ⚠️ **Speed/Efficiency** (7.2/10) - Bundle optimized, needs benchmark proof
- ⚠️ **Transparency** (7.2/10) - Open source, needs published benchmarks + architecture docs
- ⚠️ **Benchmarks** (6.5/10) - Infrastructure ready, execution in progress

See [DIMENSION_ASSESSMENT.md](DIMENSION_ASSESSMENT.md) for detailed scoring and [PROGRESS_SUMMARY.md](PROGRESS_SUMMARY.md) for roadmap to 9+.

## What It Does

- **Writes and edits code** in your repo with full git awareness — diffs, commits, worktrees.
- **Verifies its own output** to catch placeholders, hallucinations, and policy violations before accepting changes.
- **Routes between providers** so you can switch models mid-session or set fallback chains.
- **Imports reusable skills** from Claude Code, Continue, and OpenCode instead of copy-pasting prompts.

## Commands

| Command | What it does |
|---------|--------------|
| `/help` | Show all commands |
| `/status` | Version, health, active model |
| `/model <id>` | Switch model mid-session |
| `/add <file>` | Add file to context |
| `/drop <file>` | Remove file from context |
| `/files` | List files in context |
| `/diff` | Show unstaged changes |
| `/commit` | Auto-commit staged work |
| `/undo` | Undo last file edit |
| `/compact` | Free context space |
| `/history` | Past sessions |
| `/clear` | Clear conversation |
| `/cost` | Token usage and cost |

Run `/help --all` to see every command.

## Configuration

`dantecode init` creates a `.dantecode/STATE.yaml` in your project root:

```yaml
model:
  default:
    provider: anthropic
    modelId: claude-sonnet-4-20250514
  fallback:
    - provider: grok
      modelId: grok-3
```

### Provider keys

Set at least one:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # Anthropic
export XAI_API_KEY="xai-..."            # Grok
export OPENAI_API_KEY="sk-..."          # OpenAI
```

Ollama runs locally without an API key.

### From source

```bash
git clone https://github.com/dantericardo88/dantecode.git
cd dantecode
npm ci && npm run build
npm run cli
```

## Production Readiness

**Current Status:** 8.0/10 - Good for development use, working toward 9+ for production

**What works now:**
- ✅ CLI functional, all 2000+ tests passing
- ✅ Multi-provider support (Anthropic, OpenAI, X.AI, Ollama)
- ✅ Verification and sandbox systems operational
- ✅ Git-native workflows, worktree isolation
- ✅ Skills import/export, MCP integration

**What's being finalized:**
- ⏳ Benchmark results (infrastructure ready, execution in progress)
- ⏳ Architecture documentation
- ⏳ External CI gates (windows, publish dry-run)
- ⏳ UX improvements (fuzzy finder, better errors)

See [PROGRESS_SUMMARY.md](PROGRESS_SUMMARY.md) for detailed roadmap.

## Benchmarks

### Verified Feature Score (Machine-Verified)
DanteCode uses `dantecode verify` — a static wiring auditor — to produce honest scores.
No feature is claimed as done without this confirmation.

Current score: **9/10** (machine-verified)
- 13 GREEN (wired and functional)
- 1 YELLOW (auto-commit: correctly opt-in, defaults to false)
- 0 RED

Run `dantecode /verify` to see the current state.

### SWE-bench (GitHub Issue Resolution)
Evaluated on SWE-bench Verified — real GitHub issues against production codebases.
Weekly CI job runs automatically every Monday.

| Metric | Score |
|--------|-------|
| Credible runs (credentials configured) | 100% (4/4) |
| Infrastructure runs (missing API keys) | 3.7% (4/108) |
| Unique instances tested | 1 (django__django-11477) |

> More diverse instances needed for statistical credibility. `/benchmark` shows full history.

### Code Quality (PDSE Score)
DanteCode is the **only AI coding tool** that cryptographically proves code quality:
- Anti-stub scanning: blocks empty functions and TODO stubs
- PDSE gate: 4-dimension quality score (Completeness, Correctness, Clarity, Consistency)
- Evidence chain: Merkle-tree receipts for tamper-evident session proofs

## How DanteCode Compares

| Feature | DanteCode | Cursor 3 | Claude Code | Aider | OpenHands |
|---------|:---------:|:--------:|:-----------:|:-----:|:---------:|
| PDSE Quality Verification | **#1** | No | No | No | No |
| Mandatory Sandbox | **#1** | No | No | No | Partial |
| SEARCH/REPLACE Editing | Yes | Partial | Partial | **#1** | Partial |
| Multi-Model Support | 9 providers | Yes | Anthropic only | Yes | Yes |
| Voice Input | Yes | No | No | Yes | No |
| Arena Mode (multi-model compare) | Yes | No | No | No | No |
| Session Resume / Branching | **#1** | Partial | Partial | No | Partial |
| Cost Tracking / Budget Gates | **#1** | No | No | No | No |
| Hook / Event System | 12 events | No | No | No | Partial |
| Auto-Commit (opt-in) | Yes | No | No | Yes | No |
| In-IDE Deployment | Deploy button | Partial | No | No | No |
| Parallel Agent Execution | Arena+Party | 10 agents | Partial | No | Partial |

## Internals

- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md) - Package map and validation commands
- **Scoring**: [SCORING.md](SCORING.md) - Quality framework
- **Dimensions**: [DIMENSION_ASSESSMENT.md](DIMENSION_ASSESSMENT.md) - All 11 dimensions scored
- **Progress**: [PROGRESS_SUMMARY.md](PROGRESS_SUMMARY.md) - Current status and roadmap

## Contributing

DanteCode is actively developed. Current priorities:
1. Run benchmark suite (SWE-bench, provider smoke tests, speed metrics)
2. Improve UX (fuzzy finder, error messages, /undo command)
3. Complete architecture documentation
4. Add external CI gates

See [DIMENSION_ASSESSMENT.md](DIMENSION_ASSESSMENT.md) for detailed gap analysis.

## License

MIT. See [LICENSE](LICENSE).

The DanteForge engine (`packages/danteforge/`) is a compiled binary under a [proprietary license](packages/danteforge/LICENSE) — free within DanteCode, [DanteForge Pro](https://dantecode.dev/pro) for standalone use.
