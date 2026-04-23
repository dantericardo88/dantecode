# DanteCode Masterplan
_Execution-first finish plan | Generated: 2026-04-16_

## Purpose

This masterplan replaces "improve everything at once" with a finishable path.
The goal is not to win every competitive dimension immediately. The goal is to
ship a trustworthy, fast, daily-driver coding tool that is easier to maintain,
easier to verify, and easier to extend.

## Progress Snapshot

As of `2026-04-16`, the finish cycle has real momentum:

1. Phase 0 is complete. Repo-boundary rules, local-only gitlinks, and finish-scope docs are in place.
2. Phase 1.1 is materially complete. Native, MCP, sandbox, safe-tool, and OpenHands-compatibility paths now feed the same execution ledger and completion gate.
3. Phase 1.2 has real traction. Request classification, completion-gate policy, execution-evidence recording, action/tool dispatch normalization, loop-safety policy, and system-prompt assembly now live in dedicated CLI modules with focused tests instead of only giant smoke coverage.
4. Root `npm run lint`, `npm run typecheck`, and `npm test` are green on the current branch, so the next work is simplification rather than rescue.

## North Star

DanteCode should be excellent at three things before it expands further:

1. Reliable code execution and verification in the CLI.
2. High-quality inline completion, edit assistance, and context retrieval in VS Code.
3. Predictable, testable shared runtime behavior across `core`, `cli`, and `vscode`.

## Finish Criteria

The tool is "finished enough" for the next release when all of the following are true:

1. Root `npm run lint`, `npm run typecheck`, and `npm test` are stable across repeated runs.
2. CLI and VS Code both use the same core contracts for tools, context, audit, and model routing.
3. The hottest files are split into maintainable modules with clear ownership.
4. Generated artifacts, benchmark sandboxes, and agent worktrees are isolated from product code.
5. The release flow works from a clean checkout using documented commands.

## Non-Goals For This Finish Cycle

These are valuable, but they should not block the finish line:

1. Closing all 28 competitive dimensions to 9+ in one cycle.
2. Building net-new surfaces before the current surfaces are stable.
3. Adding more packages unless there is a hard architectural need.
4. Shipping enterprise collaboration before the core user loop is excellent.

## Guiding Principles

1. Prefer consolidation over expansion.
2. Prefer fewer stronger abstractions over more packages.
3. No score claims without passing repo-level gates.
4. New features must land with tests, docs, and release-path verification.
5. Anything that is flaky under Turbo is not done.

## Critical Path

### Phase 0 - Scope Freeze And Repo Hygiene
Effort: M
Dependencies: None

#### 0.1 Define the product boundary for this cycle
What:
- Freeze the finish scope around `packages/core`, `packages/cli`, `packages/vscode`, and `packages/codebase-index`.
- Mark secondary packages as support systems, not primary delivery targets.
Where:
- [.danteforge/SPEC.md](/C:/Projects/DanteCode/.danteforge/SPEC.md)
- [.danteforge/PLAN.md](/C:/Projects/DanteCode/.danteforge/PLAN.md)
- [package.json](/C:/Projects/DanteCode/package.json)
Why:
- The current plan is too broad and encourages score chasing over shipping.
Verification:
- Updated docs describe one release target and one finish definition.

#### 0.2 Clean repo boundaries
What:
- Separate source, generated data, local worktrees, benchmark sandboxes, and harvested repos.
- Add or tighten ignore rules and contributor guidance.
Where:
- Root `.gitignore` if present, or create/update ignore strategy docs
- `.claude/worktrees/`
- `benchmarks/swe-bench/.swe-bench-workspace/`
- `.danteforge/oss-repos/`
Why:
- The current dirty tree hides signal and makes review harder than it should be.
Verification:
- A clean checkout only shows intentional product changes after standard workflows.

### Phase 1 - Harden The Core Contracts
Effort: L
Dependencies: Phase 0

#### 1.1 Normalize tool execution contracts
What:
- Make `ToolResult`, tool call recording, mutation recording, validation recording, and completion gating fully consistent across all execution paths.
- Remove remaining special-case behavior between native tools, MCP tools, sandboxed tools, and safe parallel tools.
Current progress:
- Completed for the highest-risk paths: native tools, MCP tools, sandbox validation, safe-tool batching, and OpenHands-style action compatibility all now land in the same proof path.
- Remaining work is cleanup and consolidation, not basic correctness.
Where:
- [packages/cli/src/tools.ts](/C:/Projects/DanteCode/packages/cli/src/tools.ts)
- [packages/cli/src/agent-loop.ts](/C:/Projects/DanteCode/packages/cli/src/agent-loop.ts)
- [packages/cli/src/safety.ts](/C:/Projects/DanteCode/packages/cli/src/safety.ts)
- [packages/cli/src/sandbox-bridge.ts](/C:/Projects/DanteCode/packages/cli/src/sandbox-bridge.ts)
- [packages/config-types/src/index.ts](/C:/Projects/DanteCode/packages/config-types/src/index.ts)
Why:
- This is the highest-risk area and the easiest place for fake success states to creep back in.
Verification:
- Add or strengthen tests around MCP, sandbox, safe-tool batching, no-op writes, repeated Bash outputs, and completion gate failures.
- `packages/cli` test suite passes independently and from repo root.

#### 1.2 Split the orchestration hotspots
What:
- Break the giant loop into smaller modules with narrow responsibilities.
Current progress:
- `completion-gate.ts` now owns request classification and completion-gate evaluation.
- `verification-hooks.ts` now owns execution-ledger merge and persistence bookkeeping.
- `tool-dispatch.ts` now owns OpenHands/native normalization and inline action result handling.
- `loop-safety.ts` now owns round-budget, auto-continuation, and empty-response guard policy.
- `system-prompt.ts` now owns prompt assembly and repo-memory hot-context selection, and the stale inline legacy builder has been removed from `agent-loop.ts`.
- The next extractions should target the remaining orchestration slices: session mutation, round telemetry, and verification-cycle coordination.
Where:
- [packages/cli/src/agent-loop.ts](/C:/Projects/DanteCode/packages/cli/src/agent-loop.ts)
- Candidate extractions:
  - `session-state.ts`
  - `round-telemetry.ts`
  - `verification-cycle.ts`
Why:
- The file is doing too much: prompt assembly, loop control, tool routing, verification, metrics, and session mutation.
Verification:
- File size drops materially.
- Existing tests still pass without snapshot churn or behavior regression.

#### 1.3 Simplify model router ownership
What:
- Clarify what belongs in `core` vs `cli` vs `vscode` for routing, provider policy, cost tracking, and thinking budgets.
Where:
- [packages/core/src/model-router.ts](/C:/Projects/DanteCode/packages/core/src/model-router.ts)
- [packages/core/src/runtime-catalog.ts](/C:/Projects/DanteCode/packages/core/src/runtime-catalog.ts)
- [packages/cli/src/cost-tracker.ts](/C:/Projects/DanteCode/packages/cli/src/cost-tracker.ts)
- [packages/vscode/src/fim-model-router.ts](/C:/Projects/DanteCode/packages/vscode/src/fim-model-router.ts)
Why:
- Routing logic is strategically important and should not drift by surface area.
Verification:
- Shared provider behavior is covered by tests in `core`.
- Surface-specific wrappers become thin adapters.

### Phase 2 - Unify Context And Indexing
Effort: L
Dependencies: Phase 1

#### 2.1 Make `codebase-index` the single indexing truth
What:
- Consolidate BM25, TF-IDF, symbol extraction, repo maps, notebook extraction, and fusion logic behind stable APIs.
Where:
- `packages/codebase-index/src/*`
- [packages/core/src/repo-brain.ts](/C:/Projects/DanteCode/packages/core/src/repo-brain.ts)
- [packages/vscode/src/codebase-index-manager.ts](/C:/Projects/DanteCode/packages/vscode/src/codebase-index-manager.ts)
- [packages/vscode/src/completion-context-retriever.ts](/C:/Projects/DanteCode/packages/vscode/src/completion-context-retriever.ts)
Why:
- Context quality is a core differentiator, but it is currently spread across layers.
Verification:
- One integration path powers repo map, search, and completion retrieval.
- Cold start, warm load, and incremental update behavior are tested.

#### 2.2 Clarify context-provider architecture
What:
- Define one provider protocol and one fusion path for inline completion, chat, slash commands, and sidebar features.
Where:
- [packages/vscode/src/context-provider.ts](/C:/Projects/DanteCode/packages/vscode/src/context-provider.ts)
- `packages/vscode/src/context-providers/`
- [packages/vscode/src/extension.ts](/C:/Projects/DanteCode/packages/vscode/src/extension.ts)
Why:
- Context plumbing is too fragmented for a tool that wants to feel coherent.
Verification:
- Context-provider tests cover ranking, truncation, caching, and fallback behavior.

### Phase 3 - Finish The Primary User Surfaces
Effort: L
Dependencies: Phase 2

#### 3.1 CLI as a trustworthy operator
What:
- Finish the command surface around the things users actually do every day:
  - run tasks
  - inspect results
  - review diffs
  - search context
  - manage sessions
- De-emphasize novelty commands that are not release-critical.
Where:
- `packages/cli/src/commands/*.ts`
- [packages/cli/src/slash-commands.ts](/C:/Projects/DanteCode/packages/cli/src/slash-commands.ts)
- [packages/cli/src/stream-renderer.ts](/C:/Projects/DanteCode/packages/cli/src/stream-renderer.ts)
- [packages/cli/src/markdown-renderer.ts](/C:/Projects/DanteCode/packages/cli/src/markdown-renderer.ts)
- [packages/cli/src/terminal-diff-renderer.ts](/C:/Projects/DanteCode/packages/cli/src/terminal-diff-renderer.ts)
Why:
- The CLI is already powerful enough to matter; it now needs consistency, discoverability, and release confidence.
Verification:
- Smoke tests cover startup, command help, session flow, search flow, benchmark flow, and review flow.

#### 3.2 VS Code as the flagship experience
What:
- Prioritize latency, stability, and clarity of:
  - inline completion
  - inline edits
  - code lens
  - sidebar
  - audit panel
- Keep secondary panels and experiments behind that baseline.
Where:
- [packages/vscode/src/inline-completion.ts](/C:/Projects/DanteCode/packages/vscode/src/inline-completion.ts)
- [packages/vscode/src/inline-edit-provider.ts](/C:/Projects/DanteCode/packages/vscode/src/inline-edit-provider.ts)
- [packages/vscode/src/codelens-provider.ts](/C:/Projects/DanteCode/packages/vscode/src/codelens-provider.ts)
- [packages/vscode/src/sidebar-provider.ts](/C:/Projects/DanteCode/packages/vscode/src/sidebar-provider.ts)
- [packages/vscode/src/audit-panel-provider.ts](/C:/Projects/DanteCode/packages/vscode/src/audit-panel-provider.ts)
- [packages/vscode/src/extension.ts](/C:/Projects/DanteCode/packages/vscode/src/extension.ts)
Why:
- If the extension does not feel fast and dependable, the rest of the platform narrative collapses.
Verification:
- Add performance-oriented tests where practical.
- Run extension-focused smoke flows on a sample repo.

### Phase 4 - Ship Only Two New Flagship Capabilities
Effort: L
Dependencies: Phase 3

#### 4.1 Browser preview
What:
- Deliver live preview in-editor for generated or running apps.
Where:
- `packages/vscode/src/browser-preview.ts`
- [packages/vscode/src/sidebar-provider.ts](/C:/Projects/DanteCode/packages/vscode/src/sidebar-provider.ts)
- Supporting `core` runtime files as needed
Why:
- This is a real user-facing gap and a meaningful differentiator.
Verification:
- Manual smoke on a sample web app.
- Clear fallback when preview dependencies are unavailable.

#### 4.2 Screenshot-to-code
What:
- Deliver one polished screenshot-to-component flow instead of a half-finished generative side path.
Where:
- `packages/vscode/src/screenshot-to-code.ts`
- `packages/core/src/vision-pipeline.ts`
- Supporting UI and prompt utilities
Why:
- This is one of the few genuinely high-leverage missing capabilities.
Verification:
- Golden-input tests for prompt construction and output handling.
- Manual acceptance on a small component gallery.

### Phase 5 - Release Engineering And Documentation
Effort: M
Dependencies: Phase 4

#### 5.1 Make release verification boring
What:
- Ensure release scripts, smoke scripts, and package-level checks work from a clean checkout.
Where:
- [package.json](/C:/Projects/DanteCode/package.json)
- `scripts/*.mjs`
- package-level `package.json` files
Why:
- Shipping should be routine, not a one-off heroic act.
Verification:
- `npm run release:check` passes from a clean branch.

#### 5.2 Publish an operator-friendly contributor path
What:
- Document setup, core architecture, test strategy, and release flow.
Where:
- Root `README.md`
- `.danteforge/` docs
- package README files where needed
Why:
- The project is large enough that undocumented behavior becomes hidden architecture.
Verification:
- A new contributor can run build, test, and one smoke flow using docs alone.

## Parallel Workstreams

These can run in parallel once their dependencies are satisfied:

- [P] CLI surface cleanup after Phase 1.2 begins.
- [P] VS Code surface cleanup after Phase 2.2 begins.
- [P] Repo hygiene and docs during Phases 1 through 5.
- [P] Browser preview and screenshot-to-code only after Phase 3 exits green.

## Explicit Deferrals

These should be parked until the finish line above is crossed:

1. Enterprise collaboration and org admin flows.
2. Broad OSS harvest expansion.
3. New packages that duplicate existing runtime responsibilities.
4. Score-maximization work that is not tied to release quality.

## Verification Matrix

Every phase exits only when these are true:

1. Root `npm run lint` passes.
2. Root `npm run typecheck` passes.
3. Root `npm test` passes.
4. Package-specific smoke tests for touched surfaces pass.
5. No new warning suppressions are introduced without justification.
6. Dirty-tree noise from generated artifacts is understood and documented.

## Recommended Execution Order

1. Finish Phase 0 in one short cleanup branch.
2. Run Phase 1 as the main stabilization milestone.
3. Do Phase 2 before any major new feature work.
4. Treat Phase 3 as the release candidate milestone.
5. Ship Phase 4 only if Phase 3 is still green and maintainable.
6. Close with Phase 5 and cut the release.

## Final Recommendation

Do not try to finish every dream in the current `.danteforge/PLAN.md`.
Finish the product that already exists, make it trustworthy, and only then spend
expansion budget on the two missing flagship experiences that matter most.
