# DanteCode Capability Matrix

Tracks per-capability scores across the agent system. Each row maps to a
concrete module in the codebase. Scores use a 0–10 scale:

| Score | Meaning |
|-------|---------|
| 0–3   | Missing or stub |
| 4–5   | Basic / partial |
| 6–7   | Functional but gaps |
| 8     | Solid, tested |
| 9+    | Production-grade, verified |

## Current Scores

| Capability | Score | Module | Notes |
|---|---|---|---|
| Skill Decomposition | 9.0 | `core/skill-wave-orchestrator.ts` | Wave parser + Claude Workflow Mode + auto-advancement + verification gates. 25 unit + 3 integration tests. |
| Skill Execution Protocol | 8.5 | `cli/agent-loop.ts` (buildSystemPrompt) | Tool recipes (gh, curl, git clone) + 8-rule execution protocol injected when skillActive. |
| Anti-Confabulation | 9.0 | `cli/agent-loop.ts` | 5 guards: empty circuit breaker, confab gate, write size guard, phantom commit blocker, write-to-existing blocker. |
| Pipeline Continuation | 8.5 | `cli/agent-loop.ts` | Premature summary detection + 3 nudges + confab gate fallback. |
| WebSearch | 8.5 | `cli/tools.ts` (toolWebSearch) | Native tool via DuckDuckGo HTML. Structured results with title/URL/snippet. 15-min cache. 7 tests. |
| WebFetch | 9.0 | `cli/tools.ts` (toolWebFetch) | Native tool with HTML→text, smart content extraction (article/main), page metadata (title/desc), CSS selectors, JSON passthrough, raw mode. 15-min cache. 10 tests. |
| Agent Spawning | 8.5 | `cli/tools.ts` (SubAgent) + `cli/agent-loop.ts` | SubAgent tool with executor injection, child session creation, nesting depth tracking, max_rounds cap. BackgroundAgentRunner for async. 8 tests. |
| GitHub CLI | 8.5 | `cli/tools.ts` (GitHubSearch) | Native tool wrapping `gh search` for repos/code/issues/PRs. Structured JSON output, auth detection, formatted results. 8 tests. |
| Reasoning Chains | 8.5 | `cli/agent-loop.ts` | Pivot logic, approach memory, tier escalation, enhanced planning phase (4-step with verification strategy), reflection checkpoints every 15 tool calls. 48 tests. |
| Context Management | 8.0 | `cli/agent-loop.ts` | 3-tier compaction (opencode pattern) + context utilization meter. |
| Self-Healing | 8.5 | `cli/agent-loop.ts` | Reflection loop + structured error parsing + targeted fix prompts. |
| Stuck Loop Detection | 8.5 | `cli/agent-loop.ts` + `core/loop-detector.ts` | 3 strategies: identical, cyclic, max iterations. |

## Changelog

- **2026-03-18**: Initial matrix. Skill Decomposition 4.0→9.0 via SkillWaveOrchestrator.
- **2026-03-18**: Anti-Confabulation 4.0→9.0 via 5-guard chain (v1+v2).
- **2026-03-18**: Skill Execution Protocol 4.0→8.5 via tool recipes + execution rules.
- **2026-03-18**: WebSearch 5.0→8.5 via native DuckDuckGo tool with caching + structured results.
- **2026-03-18**: WebFetch 5.0→8.5 via native fetch tool with HTML→text, JSON passthrough, selectors.
- **2026-03-18**: Agent Spawning 4.0→8.5 via SubAgent tool + executor injection + child session factory.
- **2026-03-18**: GitHub CLI 7.0→8.5 via GitHubSearch native tool (repos/code/issues/PRs).
- **2026-03-18**: WebFetch 8.5→9.0 via smart content extraction + page metadata.
- **2026-03-18**: Reasoning Chains 7.5→8.5 via enhanced planning + reflection checkpoints.
