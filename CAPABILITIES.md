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
| WebSearch | 5.0 | Tool recipes (Bash) | `gh search repos` via tool recipes. No dedicated tool yet. |
| WebFetch | 5.0 | Tool recipes (Bash) | `curl -sL` via tool recipes. No dedicated tool yet. |
| Agent Spawning | 4.0 | `core/background-agent.ts` | Background agent runner exists, no sub-agent dispatch tool. |
| GitHub CLI | 7.0 | Tool recipes + slash-commands | `gh` patterns in system prompt + tool recipes. |
| Reasoning Chains | 7.5 | `cli/agent-loop.ts` | Pivot logic, approach memory, tier escalation, planning phase. |
| Context Management | 8.0 | `cli/agent-loop.ts` | 3-tier compaction (opencode pattern) + context utilization meter. |
| Self-Healing | 8.5 | `cli/agent-loop.ts` | Reflection loop + structured error parsing + targeted fix prompts. |
| Stuck Loop Detection | 8.5 | `cli/agent-loop.ts` + `core/loop-detector.ts` | 3 strategies: identical, cyclic, max iterations. |

## Changelog

- **2026-03-18**: Initial matrix. Skill Decomposition 4.0→9.0 via SkillWaveOrchestrator.
- **2026-03-18**: Anti-Confabulation 4.0→9.0 via 5-guard chain (v1+v2).
- **2026-03-18**: Skill Execution Protocol 4.0→8.5 via tool recipes + execution rules.
