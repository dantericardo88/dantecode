# DanteCode

[![CI](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml/badge.svg)](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dantecode/cli)](https://www.npmjs.com/package/@dantecode/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

A coding agent that writes, edits, and verifies code across any AI provider.

## Quick Start

```bash
npm install -g @dantecode/cli
export ANTHROPIC_API_KEY=sk-ant-...
dantecode "build me a todo app"
```

Supports Anthropic, Grok, OpenAI, Google, Groq, Ollama, and any OpenAI-compatible endpoint.

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

## Internals

Architecture, package map, and validation commands: [ARCHITECTURE.md](ARCHITECTURE.md)

Scoring framework: [SCORING.md](SCORING.md)

## License

MIT. See [LICENSE](LICENSE).

The DanteForge engine (`packages/danteforge/`) is a compiled binary under a [proprietary license](packages/danteforge/LICENSE) — free within DanteCode, [DanteForge Pro](https://dantecode.dev/pro) for standalone use.
