# DanteCode Finish-Cycle Specification
_Release-focused | Updated: 2026-04-16_

## What

DanteCode is a model-agnostic coding tool with a CLI, a VS Code extension, and a
shared runtime. This finish cycle does not try to win every feature race. It
finishes the product that already exists so the repo can ship credibly and stay
maintainable.

## Product Boundary

### Primary delivery targets

- `packages/core`: shared runtime behavior, provider policy, audit contracts, and
  repo intelligence.
- `packages/cli`: operator-facing commands, tool execution, review flow, and
  verification UX.
- `packages/vscode`: inline completion, inline edits, sidebar, code lens, and
  audit presentation.
- `packages/codebase-index`: indexing and retrieval APIs used by both CLI and
  VS Code.

### Support systems for this cycle

- `packages/config-types`, `packages/git-engine`, `packages/mcp`,
  `packages/sandbox`, and `packages/skill-adapter` remain important, but they are
  support packages for the release rather than primary finish targets.
- `packages/desktop` remains experimental and must not block the release.
- Local harvest repos, benchmark sandboxes, and agent worktrees are research
  inputs, not product surfaces.

### Explicit deferrals

- Closing all 50 competitive dimensions in one cycle.
- Enterprise collaboration and org admin flows.
- Broad OSS harvest expansion.
- New packages without a clear architectural need.

## Primary Users And Flows

### U1 - CLI operator

As a daily CLI user, I can run a task, inspect what happened, review diffs, and
trust the tool output because execution, validation, and completion gates are
consistent.

### U2 - VS Code user

As a daily VS Code user, I get fast inline completion, dependable inline edits,
coherent context retrieval, and clear audit feedback without the extension feeling
fragile or overloaded.

### U3 - Maintainer

As a maintainer, I can run the repo from a clean checkout, understand the product
boundary, and tell which changes are product work versus local/generated noise.

## Finish Criteria

This cycle is complete enough to release when all of the following are true:

1. Root `npm run lint`, `npm run typecheck`, and `npm test` pass repeatedly from a
   clean checkout.
2. CLI and VS Code both consume the same core contracts for tools, context, audit,
   and model routing.
3. The hottest orchestration files are split into modules with clear ownership.
4. Generated artifacts, benchmark sandboxes, and local worktrees are clearly
   separated from product code.
5. A contributor can follow the documented setup, validation, and release path
   without tribal knowledge.

## Non-Functional Targets

| Requirement | Target | Notes |
|---|---|---|
| Root verification stability | 3 consecutive green local runs | No pass-once claims |
| CLI contract consistency | 100% of execution paths record tools and validation the same way | Native, MCP, sandbox, and safe batch paths |
| VS Code inline responsiveness | Single-line completions feel sub-300ms on warm path | Measured in smoke/manual checks |
| Repo hygiene | Normal workflows do not dirty the tree with generated research artifacts | Worktrees and sandboxes stay out of source |
| Release repeatability | Clean checkout can run documented verification commands | No hidden setup steps |

## Acceptance Criteria

1. The docs consistently describe this cycle as a finish-and-stabilize release, not
   a 50-dimension score chase.
2. `packages/core`, `packages/cli`, `packages/vscode`, and
   `packages/codebase-index` are treated as the critical path in scope docs and
   execution tasks.
3. Repo hygiene guidance exists for `.claude/worktrees/`,
   `benchmarks/swe-bench/.swe-bench-workspace/`, `.danteforge/oss-repos/`,
   `.danteforge/evidence/`, `.danteforge/wiki/`, and similar local artifacts.
4. Phase-level tasks identify exact file targets, dependencies, and verification
   steps before implementation begins.
5. No release claim is made without repo-level verification passing.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope creep | The repo already has more ideas than finish capacity | Freeze the finish boundary and defer expansion work |
| Contract drift between surfaces | CLI and VS Code can report success differently | Put tool, audit, and routing contracts under shared tests |
| Dirty-tree blindness | Generated artifacts can masquerade as progress | Tighten ignore rules and document local-only paths |
| Hot-file fragility | Large orchestration files hide regressions | Split by responsibility and add focused tests |

## This Cycle Does Not Claim

- That every package is equally mature.
- That every experimental feature is release-ready.
- That the competitive matrix is closed.
- That new flagship features should land before the current runtime is stable.
