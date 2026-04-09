<div align="center">
  <h1>DanteCode</h1>
  <p><strong>AI coding agent with runtime-verified code quality — for everyone, not just developers</strong></p>

[![Version](https://img.shields.io/badge/version-0.9.2-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](tsconfig.json)

</div>

[![CI](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml/badge.svg)](https://github.com/dantericardo88/dantecode/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/dantericardo88/dantecode/graph/badge.svg?token=CODECOV_TOKEN)](https://codecov.io/gh/dantericardo88/dantecode)
[![npm](https://img.shields.io/npm/v/@dantecode/cli)](https://www.npmjs.com/package/@dantecode/cli)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Quality: 7.8/10](https://img.shields.io/badge/quality-7.8%2F10-yellow)](DIMENSION_ASSESSMENT.md)

A coding agent that writes, edits, and verifies code across any AI provider.

**Status:** Active development (0.9.2). Strong foundation with verification and git-awareness. Major gaps in benchmarks, UX polish, and security hardening. Working toward 9+ across all dimensions. See [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md) for real numbers, not estimates.

## What Makes It Different

Every other AI coding agent trusts its own output. DanteCode doesn't.

After every code change, **DanteForge** runs four checks before accepting the result:

1. **Completeness** — no TODO stubs, placeholder functions, or `pass` bodies
2. **Correctness** — no hallucinated APIs, type errors, or broken imports
3. **Clarity** — readable, not obfuscated
4. **Consistency** — matches the rest of the codebase

If any check fails, the agent loop retries with the failure as context. Results are stored in a cryptographic evidence chain (Merkle-tree receipts) so the quality claim is tamper-evident, not just self-reported. No other tool in this space does this.

## Quick Start

```bash
npm install -g @dantecode/cli
export ANTHROPIC_API_KEY=sk-ant-...
dantecode "build me a todo app"
```

Supports 12 providers: Anthropic, Grok, OpenAI, Google, Groq, Ollama, Mistral, DeepSeek, Together, Perplexity, OpenRouter, and any OpenAI-compatible endpoint.

## Current Strengths (7.5+/10)

- ✅ **Engineering Maturity** (8.8/10) - All tests passing, typecheck clean, multi-package architecture
- ✅ **Verification & Trust** (8.6/10) - DanteForge PDSE scoring, evidence chains, anti-confabulation guards
- ✅ **Extensibility** (8.5/10) - Skills system, MCP servers, plugin architecture
- ✅ **Git/Repo Awareness** (8.4/10) - Worktrees, repo maps, semantic indexing

## Critical Gaps (Need Immediate Work)

- ❌ **Benchmarks/Real-world** (6.5/10) — Pipeline ready, but no Linux results yet. 0/5 instances resolved on Windows due to C-extension issues.
- ❌ **UX/Ergonomics** (7.8/10) — Functional but rough. No fuzzy finder, basic error messages, feels prototype-like.
- ❌ **Security/Sandbox** (8.3/10) — Sandbox mandatory but network isolation incomplete. Not truly bulletproof.
- ❌ **Transparency** (8.5/10) — Good docs but inconsistent quality claims. Previous overclaiming undermines trust.

## Less Critical Gaps

- ⏳ **Community** — actively developed, no external contributors yet
- ⏳ **JetBrains plugin** — code complete but build artifact not published
- ⏳ **Web UI** — CLI only; no browser-based interface

## What It Does

- **Writes and edits code** in your repo with full git awareness — diffs, commits, worktrees.
- **Verifies its own output** to catch placeholders, hallucinations, and policy violations before accepting changes.
- **Routes between providers** so you can switch models mid-session or set fallback chains.
- **Imports reusable skills** from Claude Code, Continue, and OpenCode instead of copy-pasting prompts.

## Commands

| Command        | What it does                  |
| -------------- | ----------------------------- |
| `/help`        | Show all commands             |
| `/status`      | Version, health, active model |
| `/model <id>`  | Switch model mid-session      |
| `/add <file>`  | Add file to context           |
| `/drop <file>` | Remove file from context      |
| `/files`       | List files in context         |
| `/diff`        | Show unstaged changes         |
| `/commit`      | Auto-commit staged work       |
| `/undo`        | Undo last file edit           |
| `/compact`     | Free context space            |
| `/history`     | Past sessions                 |
| `/clear`       | Clear conversation            |
| `/cost`        | Token usage and cost          |

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

## What Works Today

- ✅ CLI functional, 9,500+ tests across 33 packages
- ✅ Multi-provider support (Anthropic, OpenAI, X.AI, Ollama, Groq, and more)
- ✅ PDSE verification and sandbox systems operational
- ✅ Git-native workflows, worktree isolation, semantic repo indexing
- ✅ Skills import/export, MCP server integration (35+ tools)
- ✅ Council multi-agent mode, Gaslight refinement loop, FearSet adversarial testing
- ✅ SWE-bench evaluation pipeline (weekly CI, `npm run benchmark`)

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

Evaluated on `princeton-nlp/SWE-bench_Verified` — real GitHub issues against production codebases.
Weekly CI job runs automatically (see [`.github/workflows/benchmark.yml`](.github/workflows/benchmark.yml)).

| Date       | Instances | Resolved | Rate | Platform      | Notes                                           |
| ---------- | --------- | -------- | ---- | ------------- | ----------------------------------------------- |
| 2026-04-08 | 5         | 0        | 0.0% | Windows local | Pipeline verified; C-ext packages require Linux |

**First Linux CI run pending** — trigger with `gh workflow run benchmark.yml --field instances=50` once `ANTHROPIC_API_KEY` is set in repo secrets. Results auto-commit to [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md).

> The pipeline is verified end-to-end: dataset loads from HuggingFace, repos clone correctly, agent runs per instance, pytest evaluates the patch. The 0/5 result on Windows is expected — Python packages like `astropy` require a C compiler unavailable on Windows. `/benchmark` runs the full suite.

### Code Quality (PDSE Score)

DanteCode is the **only AI coding tool** that cryptographically proves code quality:

- Anti-stub scanning: blocks empty functions and TODO stubs
- PDSE gate: 4-dimension quality score (Completeness, Correctness, Clarity, Consistency)
- Evidence chain: Merkle-tree receipts for tamper-evident session proofs

## How DanteCode Compares

| Feature                          |        DanteCode        | Cursor 3  |  Claude Code   | Aider  | OpenHands |
| -------------------------------- | :---------------------: | :-------: | :------------: | :----: | :-------: |
| PDSE Quality Verification        |         **#1**          |    No     |       No       |   No   |    No     |
| Mandatory Sandbox                |         **#1**          |    No     |       No       |   No   |  Partial  |
| SEARCH/REPLACE Editing           |           Yes           |  Partial  |    Partial     | **#1** |  Partial  |
| Multi-Model Support              |      12 providers       |    Yes    | Anthropic only |  Yes   |    Yes    |
| Voice Input                      |           Yes           |    No     |       No       |  Yes   |    No     |
| Arena Mode (multi-model compare) |           Yes           |    No     |       No       |   No   |    No     |
| Session Resume / Branching       |         **#1**          |  Partial  |    Partial     |   No   |  Partial  |
| Cost Tracking / Budget Gates     |         **#1**          |    No     |       No       |   No   |    No     |
| Hook / Event System              |        12 events        |    No     |       No       |   No   |  Partial  |
| Auto-Commit (opt-in)             |           Yes           |    No     |       No       |  Yes   |    No     |
| Desktop App                      | Electron (experimental) |  Native   |       No       |   No   |    No     |
| Parallel Agent Execution         |       Arena+Party       | 10 agents |    Partial     |   No   |  Partial  |

## Internals

- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md) - Package map and validation commands
- **Security**: [SECURITY.md](SECURITY.md) - Security model with source-file citations (shell injection elimination, prompt sanitizer, sandbox isolation, secret scanning)
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
