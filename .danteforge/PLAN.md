# DanteCode Finish-Cycle Plan
_Execution-first | Updated: 2026-04-16_

## Architecture Overview

This cycle treats DanteCode as one shared runtime with two primary user surfaces:

- `core` owns provider policy, audit contracts, repo intelligence, and shared
  runtime behavior.
- `cli` owns operator workflows and tool execution UX.
- `vscode` owns inline assistance and editor-facing presentation.
- `codebase-index` owns indexing and retrieval primitives used by both surfaces.

Support packages stay stable, but they are not where the finish line is measured.

## Planning Rules

1. No new feature lands without tests, docs, and package-level verification.
2. No quality claim lands without root `lint`, `typecheck`, and `test`.
3. Work that increases dirty-tree noise is not considered progress.
4. Any task larger than one focused milestone gets split before implementation.

## Phase 0 - Scope Freeze And Repo Hygiene

### Goal

Turn the repo from "everything is in flight" into a project with a clear release
boundary and a trustworthy task list.

### Outputs

- Finish-cycle spec aligned with the real product boundary.
- Finish-cycle plan aligned with the masterplan.
- Executable tasks with file targets, dependencies, and verification steps.
- Ignore rules and contributor guidance for local-only artifacts.

### File Targets

- `.danteforge/SPEC.md`
- `.danteforge/PLAN.md`
- `.danteforge/TASKS.md`
- `README.md`
- `.gitignore`

### Exit Criteria

- Scope docs identify one release boundary.
- Old score-chasing execution language is removed from `.danteforge`.
- Ignore rules cover local worktrees, benchmark sandboxes, and harvested repos.

## Phase 1 - Harden Core Contracts

### Goal

Make tool execution, completion gating, and model-routing behavior consistent
enough that success states cannot drift across code paths.

### Workstreams

#### 1.1 Normalize tool execution contracts

- Align result recording, mutation recording, validation recording, and
  completion-gate behavior across native tools, MCP tools, sandbox tools, and
  safe parallel tools.
- Primary files:
  - `packages/cli/src/tools.ts`
  - `packages/cli/src/agent-loop.ts`
  - `packages/cli/src/safety.ts`
  - `packages/cli/src/sandbox-bridge.ts`
  - `packages/config-types/src/index.ts`

#### 1.2 Split orchestration hotspots

- Extract smaller modules from `packages/cli/src/agent-loop.ts` so prompt
  assembly, dispatch, safety, completion, and verification hooks are not tangled.
- Candidate modules:
  - `tool-dispatch.ts`
  - `completion-gate.ts`
  - `system-prompt.ts`
  - `loop-safety.ts`
  - `verification-hooks.ts`

#### 1.3 Simplify model-router ownership

- Move shared provider policy into `core`.
- Reduce CLI and VS Code router logic to thin surface adapters.
- Primary files:
  - `packages/core/src/model-router.ts`
  - `packages/core/src/runtime-catalog.ts`
  - `packages/cli/src/cost-tracker.ts`
  - `packages/vscode/src/fim-model-router.ts`

### Exit Criteria

- Package `cli` tests pass on their own and under the root workspace run.
- Shared tool and routing behaviors are covered by focused tests.
- `agent-loop.ts` materially shrinks without behavior loss.

## Phase 2 - Unify Context And Indexing

### Goal

Make indexing and context retrieval coherent instead of surface-specific.

### Workstreams

#### 2.1 Make `codebase-index` the single indexing truth

- Consolidate indexing, fusion, repo-map, and retrieval entry points.
- Primary files:
  - `packages/codebase-index/src/*`
  - `packages/core/src/repo-brain.ts`
  - `packages/vscode/src/codebase-index-manager.ts`
  - `packages/vscode/src/completion-context-retriever.ts`

#### 2.2 Clarify context-provider architecture

- Standardize one provider protocol and one fusion path for chat, inline
  completion, slash commands, and sidebar flows.
- Primary files:
  - `packages/vscode/src/context-provider.ts`
  - `packages/vscode/src/context-providers/*`
  - `packages/vscode/src/extension.ts`

### Exit Criteria

- One integration path powers repo map, search, and completion retrieval.
- Ranking, truncation, caching, and fallback behavior are covered by tests.

## Phase 3 - Finish Primary User Surfaces

### Goal

Make the CLI and VS Code experience dependable enough to be the release story.

### Workstreams

#### 3.1 CLI operator polish

- Tighten the day-to-day commands: run tasks, inspect results, review diffs,
  search context, and manage sessions.
- Primary files:
  - `packages/cli/src/commands/*.ts`
  - `packages/cli/src/slash-commands.ts`
  - `packages/cli/src/stream-renderer.ts`
  - `packages/cli/src/markdown-renderer.ts`
  - `packages/cli/src/terminal-diff-renderer.ts`

#### 3.2 VS Code flagship polish

- Prioritize inline completion, inline edit, code lens, sidebar, and audit panel
  latency and reliability.
- Primary files:
  - `packages/vscode/src/inline-completion.ts`
  - `packages/vscode/src/inline-edit-provider.ts`
  - `packages/vscode/src/codelens-provider.ts`
  - `packages/vscode/src/sidebar-provider.ts`
  - `packages/vscode/src/audit-panel-provider.ts`
  - `packages/vscode/src/extension.ts`

### Exit Criteria

- CLI smoke flows and extension smoke flows run cleanly.
- The release story can honestly center on CLI plus VS Code.

## Phase 4 - Ship Only Two New Capabilities

### Goal

Add the two missing high-leverage experiences only after the current tool is
stable.

### Workstreams

- Browser preview:
  - `packages/vscode/src/browser-preview.ts`
  - `packages/vscode/src/sidebar-provider.ts`
- Screenshot-to-code:
  - `packages/vscode/src/screenshot-to-code.ts`
  - `packages/core/src/vision-pipeline.ts`

### Exit Criteria

- Both features have real smoke coverage and clear failure paths.
- Neither feature regresses Phase 3 stability.

## Phase 5 - Release Engineering And Documentation

### Goal

Make shipping routine instead of heroic.

### File Targets

- `package.json`
- `scripts/*.mjs`
- package-level `package.json` files
- `README.md`
- package READMEs and release docs as needed

### Exit Criteria

- `npm run release:check` works from a clean checkout.
- Contributor docs cover setup, validation, and one smoke flow.

## Verification Matrix

Every phase exits only when all touched surfaces satisfy:

1. Root `npm run lint`
2. Root `npm run typecheck`
3. Root `npm test`
4. Package-specific tests or smoke flows for touched areas
5. No new suppressions or "temporary" success claims
6. Dirty-tree noise is either ignored, documented, or removed from the path

## Parallel Work That Is Allowed

- Repo-hygiene and docs cleanups can continue in parallel with code work.
- CLI surface cleanup can begin once Phase 1.2 is underway.
- VS Code surface cleanup can begin once Phase 2.2 is underway.

## Work That Stays Deferred

1. Enterprise collaboration and org admin features.
2. Broad OSS harvest expansion.
3. New packages that duplicate existing runtime responsibilities.
4. Competitive-score work that does not improve release quality.
