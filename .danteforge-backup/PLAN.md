# PLAN.md

## Architecture Overview
- Add deterministic core modules for checkpointed verification traces and benchmark persistence under `packages/core/src/`.
- Extend the QA harness, reasoning chain, and subagent manager so verification becomes part of internal autonomy decisions.
- Keep benchmark history local-first by persisting JSONL reports under `.danteforge/reports/`.
- Add a VS Code verification view that reads the persisted benchmark and history artifacts through the exported core APIs.

## Implementation Phases
1. Add RED tests for verification graph, benchmark store, QA case generation, reasoning verification, subagent critic bridging, and VS Code verification view wiring.
2. Implement the new core modules and integrations in `packages/core/src/`.
3. Build `@dantecode/core` so downstream workspace imports pick up the new API.
4. Extend CLI history/benchmark persistence and benchmark summary rendering.
5. Add the VS Code verification panel provider and manifest registration.
6. Re-run focused tests, builds, and typechecks for the affected packages.

## File Plan
- `packages/core/src/qa-harness.ts`
- `packages/core/src/reasoning-chain.ts`
- `packages/core/src/subagent-manager.ts`
- `packages/core/src/verification-graph.ts`
- `packages/core/src/verification-benchmark-store.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/slash-commands.ts`
- `packages/vscode/src/verification-panel-provider.ts`
- `packages/vscode/src/extension.ts`
- `packages/vscode/package.json`
- `packages/core/src/*.test.ts` for the new verification modules and integrations
- `packages/cli/src/slash-commands.test.ts`
- `packages/vscode/src/vscode.test.ts`

## Technology Decisions
- Use deterministic heuristics for output QA metrics so the feature works locally without a provider.
- Reuse the existing `EventSourcedCheckpointer` to persist verification graph traces.
- Reuse weighted PDSE-style scoring for task outputs instead of introducing a second incompatible scoring model.

## Risk Mitigations
- Build `@dantecode/config-types` and `@dantecode/core` after export changes so workspace consumers do not see stale dist artifacts.
- Keep the new VS Code provider read-only and driven entirely from persisted report files.
- Keep CLI verification commands file-driven and schema-aligned with existing verification contracts to avoid brittle flag parsing.

## Testing Strategy
- Unit tests for verification graph persistence, benchmark aggregation, QA case generation, and critic consensus.
- Unit tests for reasoning-chain verification hooks and subagent critic derivation.
- CLI tests for slash-command benchmark persistence and history output.
- VS Code tests for verification view registration and provider refresh behavior.
- Package builds/typechecks for `@dantecode/core`, `@dantecode/cli`, and `dantecode` (VS Code).
