# Third-Party Licenses

DanteCode incorporates code, design patterns, and architectural concepts from the following open-source projects.

## opencode (anomalyco)

- **License**: MIT
- **URL**: https://github.com/anomalyco/opencode
- **What we use**: CLI skeleton, Ink TUI patterns, Bun runtime approach, AI SDK model routing, MCP client patterns, agent definition format

## continue (continuedev)

- **License**: Apache 2.0
- **URL**: https://github.com/continuedev/continue
- **What we use**: VS Code sidebar UI patterns, inline completion architecture, provider-agnostic design, agent YAML format

## aider (Aider-AI)

- **License**: Apache 2.0
- **URL**: https://github.com/Aider-AI/aider
- **What we use**: Auto-commit system design, diff review mechanics, repo-map algorithm approach, web scraping patterns, multi-file edit patterns

## OpenHands (All-Hands AI)

- **License**: MIT
- **URL**: https://github.com/OpenHands/OpenHands
- **What we use**: Docker sandbox runtime design, stateful agent loop patterns, tool-calling architecture, release management approach

## Vercel AI SDK

- **License**: Apache 2.0
- **URL**: https://github.com/vercel/ai
- **What we use**: Model provider abstraction (`generateText`, `streamText`, `createOpenAI`)

## Ink

- **License**: MIT
- **URL**: https://github.com/vadimdemedes/ink
- **What we use**: Terminal React renderer for CLI

## Zod

- **License**: MIT
- **URL**: https://github.com/colinhacks/zod
- **What we use**: Schema validation for STATE.yaml and API responses

## better-sqlite3

- **License**: MIT
- **URL**: https://github.com/WiseLibs/better-sqlite3
- **What we use**: Lessons DB (SQLite)

## dockerode

- **License**: Apache 2.0
- **URL**: https://github.com/apocas/dockerode
- **What we use**: Docker SDK for sandbox runtime

## Turborepo

- **License**: MIT
- **URL**: https://github.com/vercel/turborepo
- **What we use**: Monorepo build orchestration

## Bun

- **License**: MIT
- **URL**: https://github.com/oven-sh/bun
- **What we use**: Runtime and package manager

---

## System Prompt Attribution

The agent behavior patterns (task management, concise output, git commit format, proactiveness balance) are informed by analysis of public agent system prompts, specifically the Claude Code system prompt architecture (stateless operation, TodoWrite integration, HEREDOC commits, parallel tool calls, AGENTS.md context loading). These behavioral patterns are implemented independently in TypeScript and are not derivative works.
