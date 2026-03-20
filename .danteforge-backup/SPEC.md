# SPEC.md

## Feature Name
C:\Projects\DanteCode\Docs\DanteCode Gaps PRD v1 part 3.md

## Constitution Reference
# DanteForge Constitution
- Always prioritize zero ambiguity
- Local-first & PIPEDA compliant
- Atomic commits only
- Always verify before commit
- Scale-adaptive: solo -> party mode automatically

## What & Why
Advance PRD part 3 from the initial reusable QA surface to the deeper integration slice the PRD still called for: checkpointed verification graphs, generated QA cases, cross-session benchmark tracking, reasoning-chain verification hooks, subagent-fed critic debates, and a VS Code verification dashboard preview.

## User Stories
1. As an operator, I want to verify a single output against task criteria and runtime rails, so that quality decisions are explicit and repeatable.
2. As a reviewer, I want to run a QA suite across multiple outputs and see aggregate failures, so that plans and batches can be gated consistently.
3. As a multi-agent workflow, I want critic verdicts to collapse into a consensus result, so that debate outcomes can feed verification decisions.
4. As an MCP client, I want dedicated verification tools, so that external agents can call DanteCode's QA capabilities directly.
5. As a CLI user, I want slash commands and persisted verification history, so that QA traces, confidence, and benchmark-like outcomes stay visible across sessions.
6. As an agent author, I want reasoning-chain steps and subagent results to plug directly into verification, so that quality checks can shape autonomy decisions instead of staying bolt-on.
7. As a VS Code user, I want a verification panel that surfaces recent runs and benchmark summaries, so that verification evidence is visible without leaving the editor.

## Non-functional Requirements
- Keep the implementation deterministic and fast for local verification flows.
- Preserve compatibility with current tool-runtime and MCP tests.
- Fail closed for hard rails, surface advisory findings for soft rails, and expose structured critique traces for observability.
- Persist new trace and benchmark artifacts under `.danteforge/reports/` so the feature remains local-first and inspectable.

## Acceptance Criteria
1. Core modules exist for checkpointed verification graphs and benchmark persistence.
2. The QA harness can generate deterministic verification cases from a task description.
3. `ReasoningChain` can verify a phase and auto-escalate based on QA results.
4. `SubAgentManager` can derive critic opinions from completed/failed tasks and feed them into debate consensus.
5. CLI `/qa-suite` persists benchmark runs, and `/verification-history` surfaces benchmark summaries.
6. VS Code exposes a verification webview with recent verification history and benchmark summaries.
7. Focused core, CLI, and VS Code verification tests pass, and the affected packages build/typecheck cleanly.

## Task Breakdown
1. Add `verification-graph.ts` and `verification-benchmark-store.ts` under `packages/core/src/`.
2. Extend `qa-harness.ts`, `reasoning-chain.ts`, and `subagent-manager.ts` with the missing integration hooks.
3. Export the new verification surface through `packages/core/src/index.ts` and rebuild `@dantecode/core`.
4. Extend CLI verification persistence so QA suites record benchmark runs and history displays benchmark summaries.
5. Add a VS Code verification panel provider and register it in the extension manifest/runtime.
6. Add focused tests for the new core, CLI, and VS Code behavior, then verify with builds and typechecks.

## Dependencies & Risks
- Depends on workspace package exports staying in sync between source and built artifacts.
- Risk: multimodal verification and automated PR-level QA remain future work outside this deterministic part 3 completion slice.
