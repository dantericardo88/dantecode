# DanteCode

[![CI](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml/badge.svg)](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dantecode/cli)](https://www.npmjs.com/package/@dantecode/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Quality: 8.0/10](https://img.shields.io/badge/quality-8.0%2F10-green)](DIMENSION_ASSESSMENT.md)

A coding agent that writes, edits, and verifies code across any AI provider.

**Status:** Active development (8.0/10 quality score). Strong in verification, git-awareness, and extensibility. See [comprehensive assessment](DIMENSION_ASSESSMENT.md) for details.

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
