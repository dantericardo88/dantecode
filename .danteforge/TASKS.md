# DanteCode Finish Tasks
_Executable tranche | Updated: 2026-04-16_

## Status Legend

- `[x]` complete in this tranche
- `[ ]` pending
- `[P]` parallelizable after dependencies clear

## Phase 0 - Scope Freeze And Repo Hygiene

### T0.1 Freeze the finish boundary
Status: `[x]`  
Effort: `M`  
Dependencies: none

What:
- Replace the old competitive-matrix framing with a release-focused finish scope.

Where:
- `.danteforge/SPEC.md`
- `.danteforge/PLAN.md`
- `README.md`

Why:
- The repo was still describing an "improve everything" project when the real need
  is to finish the existing tool.

Verification:
- Scope docs consistently identify `core`, `cli`, `vscode`, and `codebase-index`
  as the critical path.
- README distinguishes primary surfaces from support or experimental ones.

### T0.2 Replace the fake task sheet with an executable one
Status: `[x]`  
Effort: `M`  
Dependencies: `T0.1`

What:
- Replace the score-chasing `.danteforge/TASKS.md` with dependency-ordered tasks
  that identify real files, real verifications, and real deferrals.

Where:
- `.danteforge/TASKS.md`

Why:
- A task list that cannot actually be executed is management theater, not project
  control.

Verification:
- Each task includes what, where, why, verification, dependencies, and effort.
- Future work is grouped by the same phases as `.danteforge/MASTERPLAN.md`.

### T0.3 Tighten repo-boundary rules
Status: `[x]`  
Effort: `S`  
Dependencies: `T0.1`

What:
- Add ignore coverage and contributor guidance for local worktrees, benchmark
  sandboxes, and harvested-repo scratch space.

Where:
- `.gitignore`
- `README.md`

Why:
- Local artifacts are still muddying the working tree and making review harder than
  it should be.

Verification:
- `git check-ignore -v .claude/worktrees/example`
- `git check-ignore -v benchmarks/swe-bench/.swe-bench-workspace/example`
- `git check-ignore -v .danteforge/oss-repos/example`

### T0.4 Audit tracked noise that ignore rules cannot fix
Status: `[x]`  
Effort: `M`  
Dependencies: `T0.3`

What:
- Inventory already-tracked files that live in local-only areas and decide whether
  they should be deleted, moved, or retained as intentional fixtures.

Where:
- `.claude/worktrees/`
- `.danteforge/oss-repos/`
- `benchmarks/swe-bench/.swe-bench-workspace/`
- ad hoc root research directories such as `repo/`, `screenshot-to-code/`,
  `twinny/`, and `void/`

Why:
- `.gitignore` only helps new files. Tracked noise still needs an explicit cleanup
  decision.

Verification:
- `.danteforge/REPO_HYGIENE_AUDIT.md` names the tracked directories and the chosen
  cleanup action for each one.

### T0.5 Remove tracked gitlinks from local-only paths
Status: `[x]`  
Effort: `M`  
Dependencies: `T0.4`

What:
- Remove tracked gitlinks from local-only worktree, harvest, benchmark-workspace,
  and scratch-clone paths so the repo boundary is enforced by git, not just by
  documentation.

Where:
- `.claude/worktrees/`
- `.danteforge/oss-repos/`
- `benchmarks/swe-bench/.swe-bench-workspace/`
- `repo`

Why:
- Ignore rules stop future clutter, but tracked gitlinks keep bleeding local state
- into every review until they are removed from the index.

Verification:
- `git ls-files .claude/worktrees .danteforge/oss-repos benchmarks/swe-bench/.swe-bench-workspace repo`
- `git check-ignore -v .claude/worktrees/example .danteforge/oss-repos/example benchmarks/swe-bench/.swe-bench-workspace/example repo/`

## Phase 1 - Harden Core Contracts

### T1.1 Audit tool-result consistency before changing code
Status: `[x]`  
Effort: `M`  
Dependencies: `T0.1`, `T0.2`, `T0.3`

What:
- Document every tool execution path and identify where result recording,
  validation recording, mutation recording, or completion gating diverge.

Where:
- `packages/cli/src/tools.ts`
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/safety.ts`
- `packages/cli/src/sandbox-bridge.ts`
- `packages/config-types/src/index.ts`
- `packages/cli/src/__tests__/`

Why:
- The highest-risk failure mode in this repo is a code path that claims success
  without having earned it.

Verification:
- Add focused failing tests for each discovered divergence before implementation.
- `npm --workspace @dantecode/cli test`

Completion notes:
- Added focused regression coverage for MCP, sandbox validation, and OpenHands-style action normalization.
- Proof recording now stays consistent across native, MCP, sandbox, and compatibility paths.

### T1.2 Extract completion-gate and dispatch modules
Status: `[ ]`  
Effort: `L`  
Dependencies: `T1.1`

What:
- Split `agent-loop.ts` into narrower modules so completion gating, dispatch, and
  verification hooks can be reasoned about independently, while continuing to
  peel loop-control and prompt-assembly policy out of the hotspot.

Where:
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/tool-dispatch.ts`
- `packages/cli/src/completion-gate.ts`
- `packages/cli/src/verification-hooks.ts`
- `packages/cli/src/loop-safety.ts`
- `packages/cli/src/system-prompt.ts`

Why:
- The current hotspot is too large to review confidently and too easy to regress.

Verification:
- New module tests cover the extracted responsibilities.
- `npm --workspace @dantecode/cli test`
- Root `npm test`

Completion notes:
- `packages/cli/src/completion-gate.ts` owns request classification and completion-gate evaluation.
- `packages/cli/src/tool-dispatch.ts` owns OpenHands/native normalization and inline action result handling.
- `packages/cli/src/verification-hooks.ts` owns execution-ledger merge and proof-recording bookkeeping.
- `packages/cli/src/loop-safety.ts` owns round-budget, auto-continuation, and empty-response guard policy.
- `packages/cli/src/system-prompt.ts` owns prompt assembly and hot-context selection, and the stale inline legacy builder has been removed from `agent-loop.ts`.

#### T1.2a Extract request classification and completion gate
Status: `[x]`
Effort: `S`
Dependencies: `T1.1`

What:
- Move request classification and completion-gate evaluation into a dedicated module with direct unit coverage.

Where:
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/completion-gate.ts`
- `packages/cli/src/completion-gate.test.ts`

Why:
- This policy was important enough that it should not live only inside a giant smoke-tested file.

Verification:
- `npm exec vitest run --config vitest.package.config.ts packages/cli/src/completion-gate.test.ts`
- `npm exec vitest run --config vitest.package.config.ts packages/cli/src/agent-loop.test.ts packages/cli/src/mcp-wiring.test.ts packages/cli/src/sandbox-wiring.test.ts packages/cli/src/action-dispatcher-wiring.test.ts`
- `npm --workspace @dantecode/cli run typecheck`

#### T1.2b Extract action and tool dispatch normalization
Status: `[x]`
Effort: `M`
Dependencies: `T1.2a`

What:
- Move OpenHands/native tool normalization and dispatch preparation out of `agent-loop.ts` into a dedicated module.

Where:
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/tool-dispatch.ts`
- focused wiring tests as needed

Why:
- Compatibility adapters should be explicit and reviewable instead of hidden in the main loop.

Verification:
- Existing action/MCP/sandbox wiring tests still pass.
- `npm --workspace @dantecode/cli test`

Completion notes:
- `packages/cli/src/tool-dispatch.ts` now owns OpenHands/native normalization and inline action result handling.
- `packages/cli/src/tool-dispatch.test.ts` and `packages/cli/src/action-dispatcher-wiring.test.ts` cover both pure normalization and proof-recording integration.

#### T1.2c Extract execution-evidence recording hooks
Status: `[x]`
Effort: `M`
Dependencies: `T1.2a`

What:
- Move execution-ledger merging and proof-recording hooks into a dedicated module or helper with focused tests.

Where:
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/verification-hooks.ts`
- focused unit tests

Why:
- The loop still owns too much low-level bookkeeping for mutations, validations, and first-proof timing.

Verification:
- Focused tests cover ledger merging and first-proof timing.
- `npm --workspace @dantecode/cli test`

Completion notes:
- `packages/cli/src/verification-hooks.ts` now owns execution-ledger merge and persistence bookkeeping.
- Focused direct coverage lives in `packages/cli/src/verification-hooks.test.ts`.

#### T1.2d Extract loop-safety and continuation policy
Status: `[x]`
Effort: `M`
Dependencies: `T1.2a`

What:
- Move round-budget setup, auto-continuation refill rules, and empty-response guard policy into a dedicated helper with direct tests.

Where:
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/loop-safety.ts`
- `packages/cli/src/loop-safety.test.ts`

Why:
- Loop-control policy is risky and hard to reason about when it is embedded directly inside the main execution loop.

Verification:
- `npm exec vitest run --config vitest.package.config.ts packages/cli/src/loop-safety.test.ts packages/cli/src/agent-loop.test.ts`
- `npm --workspace @dantecode/cli run typecheck`

Completion notes:
- `packages/cli/src/loop-safety.ts` now owns initial round budgets, auto-continuation gating, refill behavior, and empty-response evaluation.

#### T1.2e Extract system-prompt assembly
Status: `[x]`
Effort: `M`
Dependencies: `T1.2a`

What:
- Move system-prompt assembly and repo-memory hot-context selection into a dedicated module with focused tests, then remove the stale inline builder from `agent-loop.ts`.

Where:
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/system-prompt.ts`
- `packages/cli/src/system-prompt.test.ts`

Why:
- Prompt assembly is one of the noisiest responsibilities in the hotspot and deserves direct, contract-level coverage.

Verification:
- `npm exec vitest run --config vitest.package.config.ts packages/cli/src/system-prompt.test.ts packages/cli/src/agent-loop.test.ts`
- `npm --workspace @dantecode/cli run typecheck`

Completion notes:
- `packages/cli/src/system-prompt.ts` now owns prompt assembly and repo-memory hot-context selection.
- The stale inline legacy builder has been removed from `packages/cli/src/agent-loop.ts`, shrinking the main loop instead of leaving a dead fallback behind.

### T1.3 Centralize model-router ownership in core
Status: `[ ]`  
Effort: `M`  
Dependencies: `T1.1`

What:
- Move shared provider policy, fallback logic, and budget behavior into `core`,
  leaving CLI and VS Code as adapters.

Where:
- `packages/core/src/model-router.ts`
- `packages/core/src/runtime-catalog.ts`
- `packages/cli/src/cost-tracker.ts`
- `packages/vscode/src/fim-model-router.ts`
- `packages/core/src/__tests__/`

Why:
- Surface-specific routing drift makes the product feel inconsistent and makes bugs
  harder to pin down.

Verification:
- Shared routing tests live in `core`.
- `npm --workspace @dantecode/core test`
- Root `npm run typecheck`

## Phase 2 - Unify Context And Indexing

### T2.1 Make `codebase-index` the single indexing truth
Status: `[ ]`  
Effort: `L`  
Dependencies: `T1.2`, `T1.3`

What:
- Consolidate index building, fusion, repo-map, and retrieval APIs behind
  `codebase-index`.

Where:
- `packages/codebase-index/src/*`
- `packages/core/src/repo-brain.ts`
- `packages/vscode/src/codebase-index-manager.ts`
- `packages/vscode/src/completion-context-retriever.ts`

Why:
- The repo has too many partial retrieval paths for a tool that claims codebase
  understanding as a strength.

Verification:
- Integration tests cover cold start, warm load, and incremental updates.
- `npm --workspace @dantecode/codebase-index test`

### T2.2 Standardize the VS Code context-provider path
Status: `[ ]`  
Effort: `L`  
Dependencies: `T2.1`

What:
- Define one provider protocol and one fusion path for chat, inline completion,
  slash commands, and sidebar features.

Where:
- `packages/vscode/src/context-provider.ts`
- `packages/vscode/src/context-providers/*`
- `packages/vscode/src/extension.ts`
- `packages/vscode/src/__tests__/`

Why:
- Context quality is fragmented enough right now that it risks feeling accidental.

Verification:
- Tests cover ranking, truncation, caching, and fallback behavior.
- `npm --workspace @dantecode/vscode test`

## Phase 3 - Finish Primary User Surfaces

### T3.1 CLI surface cleanup
Status: `[ ]`  
Effort: `L`  
Dependencies: `T1.2`, `T2.1`

What:
- Polish the commands users actually rely on: task execution, result inspection,
  diff review, context search, and session management.

Where:
- `packages/cli/src/commands/*.ts`
- `packages/cli/src/slash-commands.ts`
- `packages/cli/src/stream-renderer.ts`
- `packages/cli/src/markdown-renderer.ts`
- `packages/cli/src/terminal-diff-renderer.ts`

Why:
- The CLI is the release surface, so it needs consistency more than novelty.

Verification:
- Smoke tests cover startup, help, session flow, search flow, and review flow.
- `npm run smoke:cli`

### T3.2 VS Code flagship polish
Status: `[ ]`  
Effort: `L`  
Dependencies: `T2.2`

What:
- Prioritize latency, reliability, and clarity for inline completion, inline edit,
  code lens, sidebar, and audit panel.

Where:
- `packages/vscode/src/inline-completion.ts`
- `packages/vscode/src/inline-edit-provider.ts`
- `packages/vscode/src/codelens-provider.ts`
- `packages/vscode/src/sidebar-provider.ts`
- `packages/vscode/src/audit-panel-provider.ts`
- `packages/vscode/src/extension.ts`

Why:
- If the extension feels fragile, the product story collapses no matter how many
  features exist on paper.

Verification:
- Extension-focused smoke flow on a sample repo.
- `npm --workspace @dantecode/vscode test`

## Phase 4 - New Capabilities After Stability

### T4.1 [P] Browser preview
Status: `[ ]`  
Effort: `M`  
Dependencies: `T3.2`

What:
- Ship a real in-editor browser preview with explicit fallback behavior.

Where:
- `packages/vscode/src/browser-preview.ts`
- `packages/vscode/src/sidebar-provider.ts`

Why:
- It is one of the few missing experiences that materially improves the product.

Verification:
- Manual smoke on a sample app plus extension tests for unavailable dependency
  cases.

### T4.2 [P] Screenshot-to-code
Status: `[ ]`  
Effort: `M`  
Dependencies: `T3.2`

What:
- Ship one polished screenshot-to-component flow instead of a half-finished
  generative branch.

Where:
- `packages/vscode/src/screenshot-to-code.ts`
- `packages/core/src/vision-pipeline.ts`

Why:
- This is high-leverage only if it is polished and testable.

Verification:
- Golden-input tests for prompt construction and output handling.
- Manual acceptance on a small component gallery.

## Phase 5 - Release Engineering And Docs

### T5.1 Make release verification boring
Status: `[ ]`  
Effort: `M`  
Dependencies: `T3.1`, `T3.2`

What:
- Make clean-checkout verification and package smoke paths repeatable.

Where:
- `package.json`
- `scripts/*.mjs`
- package-level `package.json`

Why:
- Shipping should be routine, not a rescue mission.

Verification:
- `npm run release:check`

### T5.2 Publish an operator-friendly contributor path
Status: `[ ]`  
Effort: `M`  
Dependencies: `T5.1`

What:
- Update public docs so a new contributor can set up the repo, run validation, and
  understand the release boundary without guessing.

Where:
- `README.md`
- release docs
- package READMEs as needed

Why:
- Hidden architecture is still architecture, just harder to maintain.

Verification:
- A fresh contributor can follow the docs and complete one build/test/smoke loop.

## Global Verification Gate

Every phase exits only when all of the following are true:

1. Root `npm run lint`
2. Root `npm run typecheck`
3. Root `npm test`
4. Package-specific tests or smoke flows for touched areas
5. No new suppressions or hand-waved success claims
6. Dirty-tree noise from generated artifacts is understood and documented
