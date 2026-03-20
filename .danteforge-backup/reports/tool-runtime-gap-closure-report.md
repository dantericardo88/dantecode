# Tool Runtime Gap Closure Report

Date: 2026-03-19
Workflow: `/magic Docs/Qwen Gap PRD.md`

## Scope

This `/magic` packet focused on the highest-leverage remaining DTR gaps that were still not proven by tests in the live repo:

- moving tool-call lifecycle ownership into the scheduler path
- proving a real artifact-aware golden flow instead of only unit-level state transitions
- proving durable artifact persistence for resume flows
- proving `WebSearch -> WebFetch -> Edit` as a scheduler-owned golden flow
- making explicit per-call dependency graphs real instead of relying only on tool-name policy gates
- proving that background `SubAgent` work does not incorrectly unblock downstream prerequisites in the same turn
- making background `SubAgent` launches pause the durable run with a resumable task handle instead of drifting into another model turn
- making `continue` respect a still-running background `SubAgent` instead of re-entering the model prematurely
- making `continue` replay persisted pending tool calls after approval pauses and background completion
- persisting exact scheduler tool-call records for resume-safe durable state, not only pending tool calls
- normalizing resumed `executing` and `verifying` tool-call records into deterministic post-resume states
- proving that approval-gated tool calls pause the durable run instead of silently dead-ending
- proving that verification exhaustion also pauses into a resumable durable run
- restoring filtered `@dantecode/core` + `@dantecode/cli` verification after unrelated test-isolation and typecheck drift

The goal was to deepen confidence without destabilizing the existing CLI runtime.

## Verified Changes

Files changed:

- `packages/core/src/tool-runtime/tool-call-types.ts`
- `packages/core/src/tool-runtime/tool-scheduler.ts`
- `packages/core/src/tool-runtime/tool-runtime.test.ts`
- `packages/core/src/tool-runtime/dependency-graph.ts`
- `packages/core/src/tool-runtime/dependency-graph.test.ts`
- `packages/core/src/tool-runtime/acquire-url.test.ts`
- `packages/core/src/tool-runtime/search-fetch-edit.test.ts`
- `packages/core/src/tool-runtime/subagent-prerequisite.test.ts`
- `packages/core/src/durable-run-store.ts`
- `packages/core/src/durable-run-store.test.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/agent-loop.test.ts`
- `packages/cli/src/tools.ts`
- `packages/cli/src/tools.test.ts`
- `packages/core/src/web-search-orchestrator.test.ts`
- `packages/core/src/background-agent.test.ts`
- `packages/core/src/multi-agent.test.ts`
- `packages/cli/src/slash-commands.ts`
- `packages/core/src/handoff-engine.ts`
- `packages/core/src/smart-extractor.ts`

What changed:

- Added `blocked_by_dependency` as a terminal DTR state.
- Added `ToolScheduler.executeBatch(...)` so the scheduler owns submit, dependency gating, approval resolution, execute, verify, and terminal transition updates.
- Preserved caller-provided tool IDs in scheduler records so CLI tool-use messages and runtime records stay aligned.
- Added a real per-call dependency graph in core so tool calls can declare `dependsOn: string[]` by tool-call ID instead of depending only on coarse tool-name policy order.
- Updated the scheduler to queue unresolved dependency nodes, execute ready prerequisites first, and then drain explicit call-ID dependencies once they become satisfiable.
- Routed the CLI agent loop through `globalToolScheduler.executeBatch(...)` instead of directly executing tools and then consulting the scheduler afterward.
- Kept existing CLI safety rails, pipeline guards, and verification prompts intact while moving runtime state transitions into core.
- Added a real `AcquireUrl -> Read` integration test that downloads a local HTTP artifact, verifies it, and then reads it through the scheduler-owned execution path.
- Added a real `WebSearch -> WebFetch -> Edit` integration test that fetches patch content from a local HTTP server and applies it through the scheduler-owned path.
- Added background sub-agent prerequisite coverage and updated the scheduler so a `SubAgent` launched with `background: true` does not count as a satisfied dependency for later tool calls in the same turn.
- Updated the CLI `SubAgent` tool to report background launches truthfully instead of claiming those tasks already completed.
- Added background task persistence to the CLI sub-agent executor via `BackgroundTaskStore`, so background launches expose a durable task ID and status.
- Updated the CLI agent loop to pause the durable run immediately after a background `SubAgent` launch and to keep the run paused on `continue` while that background task is still running.
- Added durable pending-tool-call persistence to the run store so paused tool batches can survive a resume boundary.
- Updated the resume path so completed background tasks can replay persisted follow-up tool calls before re-entering the model, while failed background tasks still surface context without replaying work.
- Updated the resume path so approval-paused runs can replay their persisted blocked tool batch on `continue` after the user approves the action.
- Added durable artifact persistence coverage so resume flows can restore tool-runtime artifact records from the run store.
- Added durable persistence for exact `ToolCallRecord[]` snapshots so approval, dependency, and verification states survive as concrete runtime records instead of only as narrative resume hints.
- Updated `ToolScheduler.resumeToolCalls(...)` so resumed tool-call state now follows the PRD resume rules: `awaiting_approval` stays paused, `scheduled` stays scheduled, `executing` collapses to `verifying` or `error` based on persisted execution evidence, and `verifying` finalizes to `success` or `error` when persisted verification evidence exists.
- Updated the CLI resume path to persist the normalized scheduler records immediately after rehydration so the durable run reflects truthful post-resume state before any new model round begins.
- Updated the CLI agent loop to pause the durable run when the scheduler returns `awaiting_approval`, persist blocked-action evidence, and emit a resumable approval notice instead of only logging a blocked tool.
- Updated the CLI agent loop to persist the scheduler record after every tool scheduling decision, including paused states like `awaiting_approval`.
- Updated the CLI verification loop to pause the durable run with `verification_failed` after retry exhaustion, preserving a resumable next action instead of only appending a system warning.
- Hardened unrelated test isolation around persistent search cache and background-agent retry timing so filtered repo verification is stable again.
- Fixed the `AgentOutput.lane -> role` type drift in `core` and `cli` surfaces that was blocking filtered typecheck.

## Tests Added

- `packages/core/src/tool-runtime/tool-runtime.test.ts`
  - `executeBatch runs tool calls through scheduler lifecycle transitions`
  - `executeBatch marks blocked dependencies without invoking the executor`
  - `executeBatch honors explicit call-id dependencies even when the batch order is reversed`
  - `executeBatch blocks explicit call-id dependencies that never become satisfiable`
- `packages/core/src/tool-runtime/dependency-graph.test.ts`
  - `tracks ready dependencies by call id`
  - `surfaces failed and missing dependencies separately`
  - `detects dependency cycles`
- `packages/core/src/tool-runtime/search-fetch-edit.test.ts`
  - `supports WebSearch -> WebFetch -> Edit as a scheduler-owned golden flow`
- `packages/core/src/tool-runtime/acquire-url.test.ts`
  - `downloads a file and registers a verified artifact`
  - `supports AcquireUrl -> Read as a scheduler-owned golden flow`
- `packages/core/src/tool-runtime/tool-runtime.test.ts`
  - `executeBatch moves approval-gated tools into awaiting_approval without invoking the executor`
  - `resumeToolCalls normalizes executing calls with persisted success evidence into verifying`
  - `resumeToolCalls normalizes executing calls without persisted result evidence into error`
  - `resumeToolCalls finalizes verifying calls when persisted verification failed`
- `packages/core/src/tool-runtime/subagent-prerequisite.test.ts`
  - `does not satisfy downstream dependencies while the sub-agent is still running in background mode`
  - `allows downstream dependencies after a synchronous sub-agent completes`
- `packages/core/src/durable-run-store.test.ts`
  - `persists and restores tool-runtime artifacts for resume flows`
  - `persists and clears pending tool calls for background resume flows`
  - `persists exact tool-call records for resume-safe scheduler state`
- `packages/cli/src/agent-loop.test.ts`
  - `routes executable tool batches through the scheduler`
  - `pauses the durable run when a tool call is awaiting approval`
  - `replays persisted tool calls when an approval-paused run continues`
  - `persists normalized scheduler tool-call state when resuming an interrupted execution`
  - `pauses the durable run when a background sub-agent is launched`
  - `persists remaining tool calls after a background sub-agent pause`
  - `keeps a durable run paused when a background sub-agent is still running on continue`
  - `replays persisted tool calls after a background sub-agent completes`
  - `pauses the durable run after verification retries are exhausted`
- `packages/cli/src/tools.test.ts`
  - `returns a truthful launch message for background sub-agents`

## Verification

Targeted RED -> GREEN checks:

- `npm test -- src/tool-runtime/tool-runtime.test.ts` in `packages/core`
- `npm test -- src/tool-runtime/dependency-graph.test.ts` in `packages/core`
- `npm test -- src/tool-runtime/acquire-url.test.ts` in `packages/core`
- `npm test -- src/tool-runtime/search-fetch-edit.test.ts src/tool-runtime/subagent-prerequisite.test.ts` in `packages/core`
- `npm test -- src/durable-run-store.test.ts` in `packages/core`
- `npm test -- src/agent-loop.test.ts` in `packages/cli`

Repo verification:

- `npx turbo run typecheck lint test --filter=@dantecode/core --filter=@dantecode/cli`

Result:

- `@dantecode/core`: pass
- `@dantecode/cli`: pass
- Combined verification command: pass

Observed package totals from the verified run:

- `@dantecode/core`: 85 test files, 1788 tests passing
- `@dantecode/cli`: 11 test files, 259 tests passing

## Deviations

The PRD asked for final-generation docs under `Docs/`. This repo treats the original `Docs/` directory as read-only reference material, so this evidence bundle was written under `.danteforge/reports/` instead.

## Completion Status

This `/magic` packet now closes the previously remaining blocking resume gap from the PRD packet:

- exact `ToolCallRecord` state is durably persisted
- the dependency graph is rebuilt from persisted tool-call records
- `awaiting_approval` resumes as `awaiting_approval`
- `scheduled` resumes as `scheduled`
- `executing` deterministically resumes as `verifying` or `error`
- `verifying` deterministically resumes as `success`, `error`, or an active `verifying` blocker depending on persisted evidence

No blocking gaps remain for the scoped DTR acceptance flows tracked in this report.

## Follow-On Opportunities

Optional follow-on work, not required for this PRD closure:

1. move more progress and batch orchestration out of the CLI loop and deeper into the scheduler
2. relax the intentionally conservative sequential queue only if the repo later needs true parallel-safe tool execution
