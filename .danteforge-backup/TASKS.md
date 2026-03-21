# TASKS.md

## Phase 3 Completion
1. Add checkpoint-backed verification graph persistence in `packages/core/src/verification-graph.ts`.
   Verify: `packages/core/src/verification-graph.test.ts` passes.
   Dependencies: none.
   Effort: S
2. Add benchmark persistence in `packages/core/src/verification-benchmark-store.ts`.
   Verify: `packages/core/src/verification-benchmark-store.test.ts` passes.
   Dependencies: Task 1.
   Effort: S
3. Extend `packages/core/src/qa-harness.ts` with generated QA cases.
   Verify: `packages/core/src/qa-harness.test.ts` passes.
   Dependencies: Task 1.
   Effort: S
4. Extend `packages/core/src/reasoning-chain.ts` and `packages/core/src/subagent-manager.ts` with verification/debate hooks.
   Verify: `packages/core/src/reasoning-chain.test.ts` and `packages/core/src/subagent-manager.test.ts` pass.
   Dependencies: Tasks 1-3.
   Effort: M
5. Persist CLI QA-suite benchmarks and render benchmark summaries in `packages/cli/src/slash-commands.ts`.
   Verify: `packages/cli/src/slash-commands.test.ts` passes.
   Dependencies: Tasks 2-4.
   Effort: S
6. Add the VS Code verification panel in `packages/vscode/src/verification-panel-provider.ts`, `packages/vscode/src/extension.ts`, and `packages/vscode/package.json`.
   Verify: `packages/vscode/src/vscode.test.ts` passes.
   Dependencies: Tasks 2-5.
   Effort: M
7. Rebuild and typecheck the affected packages.
   Verify: `npm run build` and `npm run typecheck` in `packages/core`, `packages/cli`, and `packages/vscode`.
   Dependencies: Tasks 1-6.
   Effort: S

## Done Criteria
- Verification traces are checkpointed and resumable.
- Benchmark runs are persisted and summarized across sessions.
- Reasoning-chain and subagent primitives feed directly into verification.
- CLI and VS Code surfaces expose the new persisted verification evidence.
- Focused tests pass for core, CLI, and VS Code, and affected packages build/typecheck cleanly.
