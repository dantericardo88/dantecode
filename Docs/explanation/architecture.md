# Architecture Overview

This document explains how DanteCode works internally: the agent loop, tool execution model, model routing, and context management.

## High-level structure

DanteCode is a monorepo with three main layers:

```
packages/
  core/        — shared logic: agent loop, tools, providers, memory, context
  cli/         — terminal interface, command routing, streaming output
  vscode/      — VSCode extension: sidebar, preview panel, FIM completions
```

The `core` package is provider-agnostic and has no runtime dependency on any specific AI SDK. It defines interfaces (`LLMProvider`, `ToolDefinition`, `AgentSession`) that the CLI and VSCode layers implement.

## The agent loop

The central abstraction is the **agent loop** in `packages/cli/src/agent-loop.ts`. It works like this:

```
User prompt
    │
    ▼
Plan phase: build system prompt + tool definitions
    │
    ▼
Model call: send messages to provider
    │
    ▼
Parse response: extract text + tool calls
    │
    ▼
Execute tools: file reads/writes, bash, search, git
    │
    ▼
Append results: add tool outputs to message history
    │
    ├── (more tool calls?) → back to Model call
    │
    └── (no more tool calls) → Stream final response to user
```

The loop runs until the model stops calling tools or the session budget is exhausted. A `LoopDetector` watches for repeated tool sequences (Jaccard similarity > 0.85 over a window of 5 turns) and breaks loops automatically.

## Tool execution

Tools are defined in `packages/cli/src/tools.ts` as objects implementing:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}
```

Built-in tools include: `read_file`, `write_file`, `edit_file`, `bash`, `glob`, `grep`, `git_commit`, `git_push`, `web_search`, `screenshot_to_code`, `start_dev_server`, and more.

Tool execution is wrapped with:
- **Latency tracking** (`LatencyTracker`) — records p50/p95 per tool category
- **Approval gateway** — diffs are shown to the user before any write
- **Artifact store** — outputs of write/bash operations are logged for verification

## Model routing

`packages/core/src/model-router.ts` selects which provider and model to use for each call based on:

1. Task type (FIM vs. chat vs. review vs. generation)
2. Token budget remaining (cheaper models when budget is low)
3. Provider health (circuit breaker bypasses failing providers)
4. Per-task overrides in `STATE.yaml`

The router falls back to the next configured model if the primary fails (429, 5xx, timeout).

## Context management

Context is managed by `packages/core/src/context-budget.ts`. Each session has a token budget. As the conversation grows, older messages are summarized and removed from the active context window using a sliding-window strategy.

Key constraints:
- **System prompt**: always included (never evicted)
- **Most recent 3 turns**: always included (never evicted)
- **Tool results**: included until budget pressure forces summarization
- **File contents**: included on demand, evicted first under pressure

The `ContextRanker` scores file chunks by relevance to the current query using BM25 and includes the top-K chunks up to the remaining budget.

## FIM completions

Fill-in-the-middle completions follow this path:

```
Cursor position in editor
    │
    ▼
FIM ranker: score nearby code context by relevance
    │
    ▼
Build FIM prompt: prefix (text before cursor) + suffix (text after cursor)
    │
    ▼
Model call (fast model, no tool use)
    │
    ▼
Ghost text rendered in editor
    │
    ▼
User accepts (Tab) or dismisses (Escape)
    │
    ▼
Acceptance logged → FIM ranker learns from feedback
```

For Ollama with FIM models, the native `/api/generate` endpoint with `<PRE>/<SUF>/<MID>` token format is used, which is significantly faster than the chat completion path.

## Memory and lessons

DanteCode maintains two memory systems:

**Session memory** (`packages/core/src/session-memory.ts`): facts observed during the current session — files read, decisions made, errors encountered. Stored in-process, lost when the session ends.

**Lesson store** (`packages/core/src/approach-memory.ts`): lessons learned across sessions — patterns that worked, approaches to avoid, per-project conventions. Persisted to `.dantecode/lessons/` using JSONL. Retrieved by Jaccard similarity to the current prompt.

At the start of each agent loop turn, relevant lessons are injected into the system prompt as brief hints.

## Security model

DanteCode operates under these constraints:

- **No network calls outside the configured provider** — all web search goes through the search orchestrator which rate-limits and audits outbound requests
- **No shell execution without approval** — `bash` tool calls are shown to the user before execution
- **Dependency scanning** — `npm audit` is run before any `npm install` action
- **Secret detection** — file writes are scanned for patterns matching API keys, passwords, and tokens

The `packages/core/src/security-scanner.ts` module implements OWASP-aligned checks for the most common vulnerability classes (injection, XSS, SSRF, IDOR, open redirect).

## State and configuration

Two YAML/JSON files track project state:

- `.dantecode/STATE.yaml` — agent-managed project state: model config, git context, feature flags, per-task model overrides. Read and written by the agent.
- `.dantecode/config.json` — user-managed tool config: provider, API key, UI preferences. Read by the agent, written by the user via `dantecode config set`.

The two files are kept separate so the agent can update its operational state without touching user-managed credentials.

## Extension points

DanteCode is extensible at several layers:

- **Skills** — task templates that inject custom system prompts and tool restrictions
- **MCP servers** — external tools exposed via the Model Context Protocol
- **Custom providers** — implement the `LLMProvider` interface in `packages/core/src/provider.ts`
- **Hooks** — pre/post tool execution hooks for audit logging, approval workflows, or custom validation
