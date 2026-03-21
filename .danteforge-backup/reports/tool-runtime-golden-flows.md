# Tool Runtime Golden Flows

Date: 2026-03-19
Workflow: `/magic Docs/Qwen Gap PRD.md`

## Current Status

This file records what is actually proven today by tests after the scheduler/agent-loop refactor completed.

## Verified Today

### GF-01 Download -> Verify -> Read

Covered by:

- `packages/core/src/tool-runtime/acquire-url.test.ts`
  - `downloads a file and registers a verified artifact`
  - `supports AcquireUrl -> Read as a scheduler-owned golden flow`

Proves:

- `AcquireUrl` stores a real downloaded artifact with verification metadata
- the scheduler can execute `AcquireUrl` before a dependent `Read`
- the dependent `Read` sees the verified downloaded content

### GF-02 Search -> Fetch -> Edit

Covered by:

- `packages/core/src/tool-runtime/search-fetch-edit.test.ts`
  - `supports WebSearch -> WebFetch -> Edit as a scheduler-owned golden flow`

Proves:

- the scheduler can preserve ordered dependencies across `WebSearch`, `WebFetch`, and `Edit`
- fetched content can drive a real file edit through the scheduler-owned path
- the final edited file reflects the fetched patch content

### GF-Dependency Blocking

Covered by:

- `packages/core/src/tool-runtime/tool-runtime.test.ts`
  - `executeBatch marks blocked dependencies without invoking the executor`
- `packages/core/src/tool-runtime/dependency-graph.test.ts`
  - `tracks ready dependencies by call id`
  - `surfaces failed and missing dependencies separately`
  - `detects dependency cycles`
- `packages/core/src/tool-runtime/tool-runtime.test.ts`
  - `executeBatch honors explicit call-id dependencies even when the batch order is reversed`
  - `executeBatch blocks explicit call-id dependencies that never become satisfiable`

Proves:

- a dependent tool call can be marked `blocked_by_dependency`
- the executor is not invoked for the blocked call
- the scheduler now supports explicit `dependsOn` call IDs in addition to tool-name policy dependencies
- ready prerequisites can run first even when the original batch order is reversed
- missing, failed, and cyclic dependency states are distinguishable in core

### GF-Scheduler Lifecycle Ownership

Covered by:

- `packages/core/src/tool-runtime/tool-runtime.test.ts`
  - `executeBatch runs tool calls through scheduler lifecycle transitions`
- `packages/cli/src/agent-loop.test.ts`
  - `routes executable tool batches through the scheduler`

Proves:

- the scheduler now owns the lifecycle transitions for executed tool calls
- the CLI loop now routes executable tool calls through the scheduler entrypoint

### GF-Artifact Resume Persistence

Covered by:

- `packages/core/src/durable-run-store.test.ts`
  - `persists and restores tool-runtime artifacts for resume flows`
  - `persists and clears pending tool calls for background resume flows`

Proves:

- durable runs can persist artifact records for tool-runtime flows
- resume-safe artifact metadata can be loaded back from durable storage
- durable runs can also persist and clear queued tool calls that need to survive a pause/resume boundary
- durable runs can persist exact scheduler `ToolCallRecord` state for paused approval/dependency/verification flows

### GF-04 Resume During Approval

Covered by:

- `packages/core/src/tool-runtime/tool-runtime.test.ts`
  - `executeBatch moves approval-gated tools into awaiting_approval without invoking the executor`
- `packages/cli/src/agent-loop.test.ts`
  - `pauses the durable run when a tool call is awaiting approval`
  - `replays persisted tool calls when an approval-paused run continues`

Proves:

- approval-gated tool calls stop in `awaiting_approval` instead of executing
- the CLI pauses the durable run with `user_input_required`
- the paused run emits a resumable approval notice through the existing durable resume path
- the exact paused scheduler record is durably stored alongside the run
- after approval, `continue` can replay the persisted blocked tool batch instead of forcing the model to rediscover the action

### GF-05 Resume During Verification

Covered by:

- `packages/core/src/tool-runtime/tool-runtime.test.ts`
  - `resumeToolCalls normalizes executing calls with persisted success evidence into verifying`
  - `resumeToolCalls normalizes executing calls without persisted result evidence into error`
  - `resumeToolCalls finalizes verifying calls when persisted verification failed`
- `packages/cli/src/agent-loop.test.ts`
  - `pauses the durable run after verification retries are exhausted`
  - `persists normalized scheduler tool-call state when resuming an interrupted execution`

Proves:

- the scheduler now follows the PRD resume rules for `executing` and `verifying` tool-call records
- interrupted execution can resume into deterministic `verifying` or `error` state based on persisted evidence
- failed verification can finalize to `error` on resume without inventing new execution
- repeated verification failures stop the loop instead of drifting into another model round
- the CLI pauses the durable run with `verification_failed`
- the paused run emits a resumable verification notice through the existing durable resume path
- the CLI persists the normalized post-resume scheduler record before the next model round starts

### GF-03 Background Subagent Prerequisite Safety

Covered by:

- `packages/core/src/tool-runtime/subagent-prerequisite.test.ts`
  - `does not satisfy downstream dependencies while the sub-agent is still running in background mode`
  - `allows downstream dependencies after a synchronous sub-agent completes`
- `packages/cli/src/agent-loop.test.ts`
  - `pauses the durable run when a background sub-agent is launched`
  - `persists remaining tool calls after a background sub-agent pause`
  - `keeps a durable run paused when a background sub-agent is still running on continue`
  - `replays persisted tool calls after a background sub-agent completes`
- `packages/cli/src/tools.test.ts`
  - `returns a truthful launch message for background sub-agents`

Proves:

- a background `SubAgent` launch does not incorrectly satisfy downstream dependency checks in the same turn
- later tool calls stay blocked until the prerequisite is actually complete
- synchronous `SubAgent` execution still satisfies downstream dependencies normally
- the CLI now pauses the durable run as soon as a background `SubAgent` is launched
- queued follow-up tool calls are persisted when that pause happens
- `continue` stays in the durable wait state while that background task is still running
- once the background task completes, `continue` can replay the persisted follow-up tool calls before asking the model for more work
- background launch messaging is truthful and carries the resumable task ID forward

## Acceptance Status

GF-01 through GF-05 are now covered by focused tests in the live repo, including the previously remaining `resume during verifying` path.

## Optional Follow-On Tests

- `tests/integration/tool-runtime-resume.test.ts`
- `tests/integration/tool-runtime-verifying-resume.test.ts`
- `tests/integration/tool-runtime-scheduler-rehydrate.test.ts`

Those would add broader integration depth, but they are no longer blocking the PRD acceptance flows tracked here.
