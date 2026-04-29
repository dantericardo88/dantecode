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

## [SWE-bench] Unified-diff context fabrication is a recurring failure class
_Added: 2026-04-29T00:00:00Z_
_Source: dim 5 sprint Phase 1 analysis_

**Mistake:** Agent emits `diff --git` patches with context lines that don't exist in the target file. `git apply` rejects the entire patch (compile_error bucket, 4/100). Examples: matplotlib-23299 ("context lines not found in seeded file"), pytest-9359 ("context lines missing"), sphinx-10673 ("hunk offset mismatch"), django-14915 ("malformed patch format").
**Rule:** Route SWE-bench instance fixes through `toolReplaceInFile` (Cline-style 4-strategy fuzzy match) instead of raw `git apply`. The fuzzy matcher tolerates 1-2 token drift in context lines. Alternatively: post-process model-emitted unified diffs through `parseSearchReplaceBlocks` + `applySearchReplaceBlock` before invoking `git apply`.

## [SWE-bench] Empty-patch failures are planning failures, not edit failures
_Added: 2026-04-29T00:00:00Z_
_Source: dim 5 sprint Phase 1 analysis_

**Mistake:** `no_patch:7` bucket — model exits the agent loop without emitting any diff. Common when the problem statement is vague or the repo has many candidate files. The agent runs out of exploration budget before narrowing on the fix location.
**Rule:** For SWE-bench instances, lower the planner-trigger threshold so `PlanActController` runs an architect pass before edit. The planner LLM produces a plan with concrete file paths; the executor LLM is then constrained to edit only those paths. This matches the dim 16 (Plan/Act) work — SWE-bench just needs a different default policy.

## [SWE-bench] Conftest plugin conflicts must be classified separately from test_assertion
_Added: 2026-04-29T00:00:00Z_
_Source: dim 5 sprint Phase 1 analysis_

**Mistake:** Scientific Python repos (astropy, sympy, scipy) register pytest plugins in conftest. When the test environment isn't fully set up (egg-info mismatch, missing C extension build), `pytest --collect-only` fails with `ImportError` before any test runs. The agent counts this as `test_assertion` failure and tries to "fix" working code, often making things worse.
**Rule:** Run `pytest --collect-only --no-header -q` BEFORE giving the problem statement to the agent. If collection fails, mark the instance `env_error` (separate from `test_assertion`) and either (a) auto-install missing deps from `pip-requirements`, or (b) skip with a clear failure reason.

## [SWE-bench] Per-repo timeout tiers; one global value wastes budget
_Added: 2026-04-29T00:00:00Z_
_Source: dim 5 sprint Phase 1 analysis_

**Mistake:** Single 600s timeout for all 100 instances. Cython recompile alone burns 60-120s on astropy/matplotlib before the agent does anything. 10/100 instances time out at 600s; many of those would resolve at 1200s.
**Rule:** Tier the timeout by repo class — small repos (requests, flask, sympy/core): 240s. Medium (django, pytest, scikit-learn pure-Python paths): 600s. Large with C extensions (astropy, matplotlib, scipy with extension rebuilds): 1200s. Total wall-clock budget across 100 instances stays comparable; allocation matches actual cost.

## [SWE-bench] Partial-hunk patch application silently corrupts pass-rate accounting
_Added: 2026-04-29T00:00:00Z_
_Source: dim 5 sprint Phase 1 analysis_

**Mistake:** When `git apply` accepts some hunks of the test_patch and rejects others (validation log: "Partial test patch applied (some hunks rejected)"), the verification surface is incomplete — some FAIL_TO_PASS tests run, some don't. The instance is recorded as a partial pass even though the result is meaningless.
**Rule:** Strict mode in the eval harness — if ANY hunk of test_patch is rejected, mark the instance `harness_error` (excluded from pass-rate denominator) instead of letting it count for or against. Optionally retry once with `git apply --3way` before giving up.
