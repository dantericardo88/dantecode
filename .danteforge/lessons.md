# Lessons Learned

_Auto-maintained by DanteForge — rules captured from corrections, failures, and refinements._

---

## [Workflow] Ensure: Constitution is not defined
_Added: 2026-04-14T14:31:35.709Z_
_Source: verify failure_

**Mistake:** Constitution is not defined
**Rule:** Ensure: Constitution is not defined

## [Workflow] Ensure: Repo review (CURRENT_STATE.md) missing
_Added: 2026-04-14T14:31:35.720Z_
_Source: verify failure_

**Mistake:** Repo review (CURRENT_STATE.md) missing
**Rule:** Ensure: Repo review (CURRENT_STATE.md) missing

## [Workflow] Ensure: Constitution (CONSTITUTION.md) missing
_Added: 2026-04-14T14:31:35.730Z_
_Source: verify failure_

**Mistake:** Constitution (CONSTITUTION.md) missing
**Rule:** Ensure: Constitution (CONSTITUTION.md) missing

## [Workflow] Ensure: Specification (SPEC.md) missing
_Added: 2026-04-14T14:31:35.740Z_
_Source: verify failure_

**Mistake:** Specification (SPEC.md) missing
**Rule:** Ensure: Specification (SPEC.md) missing

## [Workflow] Ensure: Clarification (CLARIFY.md) missing
_Added: 2026-04-14T14:31:35.751Z_
_Source: verify failure_

**Mistake:** Clarification (CLARIFY.md) missing
**Rule:** Ensure: Clarification (CLARIFY.md) missing

## [Workflow] Ensure: Execution plan (PLAN.md) missing
_Added: 2026-04-14T14:31:35.760Z_
_Source: verify failure_

**Mistake:** Execution plan (PLAN.md) missing
**Rule:** Ensure: Execution plan (PLAN.md) missing

## [Workflow] Ensure: Task breakdown (TASKS.md) missing
_Added: 2026-04-14T14:31:35.768Z_
_Source: verify failure_

**Mistake:** Task breakdown (TASKS.md) missing
**Rule:** Ensure: Task breakdown (TASKS.md) missing

## [Workflow] Ensure: No phase 1 tasks are recorded in STATE.yaml
_Added: 2026-04-14T14:31:35.776Z_
_Source: verify failure_

**Mistake:** No phase 1 tasks are recorded in STATE.yaml
**Rule:** Ensure: No phase 1 tasks are recorded in STATE.yaml

## [Workflow] Ensure: Workflow stage "initialized" is not execution-complete. Run "dantefor...
_Added: 2026-04-14T14:31:35.785Z_
_Source: verify failure_

**Mistake:** Workflow stage "initialized" is not execution-complete. Run "danteforge forge 1" before verify.
**Rule:** Ensure: Workflow stage "initialized" is not execution-complete. Run "danteforge forge 1" before verify.

## [Testing] Isolate low-level runtime mocks in dedicated wiring tests
_Added: 2026-04-16T17:15:00Z_
_Source: verify failure_

**Mistake:** Added `node:child_process` and filesystem write mocks to the shared `packages/cli/src/agent-loop.test.ts` harness, which destabilized unrelated smoke tests and obscured the real regression.
**Rule:** When proving a new CLI wiring path depends on low-level runtime mocks, add a dedicated focused test file instead of extending the giant shared smoke harness. Keep `agent-loop.test.ts` on its stable mocks unless the change is intentionally suite-wide.

## [Testing] Mirror async wait budgets between core and CLI integration coverage
_Added: 2026-04-16T19:20:00Z_
_Source: verify failure_

**Mistake:** Left `packages/cli/src/integration.test.ts` with a 100ms sleep and default `vi.waitFor` timeout for background-runner completion, so the file passed in lighter package runs but flaked under repo-root Turbo load.
**Rule:** Any CLI integration test that exercises shared async background infrastructure must wait on state transitions with an explicit timeout budget that matches the corresponding core coverage. Never use short fixed sleeps for task completion checks.

## [Testing] Keep extracted-module fixtures aligned with the narrowed public contract
_Added: 2026-04-17T03:08:00Z_
_Source: verify failure_

**Mistake:** Tightened `SystemPromptConfig` in the extracted `system-prompt` module but left the test helper returning extra fields and `null` values outside the public contract, which made `typecheck` fail even though runtime coverage was green.
**Rule:** When extracting a module behind a narrower interface, update test factories to return that exported type directly and remove any convenience fields the public contract does not expose. Do not loosen production types just to satisfy a stale fixture.

## [Refactor] Finish hotspot cleanup with an unused-import sweep
_Added: 2026-04-17T03:11:00Z_
_Source: verify failure_

**Mistake:** Removed the dead inline system-prompt builder from `agent-loop.ts` but left `getToolDefinitions` imported from the old path, so CLI `typecheck` failed on a stale symbol even though the extraction itself was correct.
**Rule:** After deleting a legacy block during module extraction, immediately run a targeted unused-import sweep on that file before leaving the refactor. Dead code removal is not finished until the surrounding imports and helpers are trimmed too.
