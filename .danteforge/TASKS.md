# TASKS.md

## Phase 1 — Core Implementation (memory-engine package)

### Phase 1.1 — Memory Engine Package
1. Implement memory-engine package (`packages/memory-engine/`)
   - files: `packages/memory-engine/src/`
   - verify: `npm test --workspace=packages/memory-engine` passes, 88+ tests green
   - done-when: `@dantecode/memory-engine` exports memoryStore/memoryRecall/memorySummarize/memoryPrune/crossSessionRecall/memoryVisualize
   - effort: L
   - status: COMPLETE

### Phase 1.2 — Core Exports
2. Export new memory-engine types from `packages/core/src/index.ts`
   - files: `packages/core/src/index.ts`
   - verify: `npx tsc --noEmit -p packages/core/tsconfig.json` passes
   - done-when: MemoryOrchestrator, SemanticRecall, SessionMemory are importable from `@dantecode/core`
   - effort: S
   - status: COMPLETE

## Phase 2 — Verification & QA

### Phase 2.1 — Verification Suite
3. Implement verification spine (`packages/core/src/verification-*.ts`)
   - files: `packages/core/src/verification-*.ts`, `packages/core/src/confidence-synthesizer.ts`, `packages/core/src/metric-suite.ts`
   - verify: `npm test --workspace=packages/core` passes 90+ verification tests
   - done-when: ConfidenceSynthesizer, MetricSuite, VerificationCriticRunner all exported from core
   - effort: L
   - status: COMPLETE

### Phase 2.2 — Build Gate
4. Fix all TypeScript build errors across monorepo
   - files: `packages/mcp/src/default-tool-handlers.ts`
   - verify: `npx turbo build` exits 0
   - done-when: No TS2322/TS2345 errors in any package
   - effort: S
   - status: COMPLETE (schema string→JSON.parse fix)

## Phase 3 — Event Automation (git-engine)

### Phase 3.1 — Git Event Modules
5. Implement git-engine event spine (event-normalizer, event-queue, rate-limiter, multi-repo-coordinator)
   - files: `packages/git-engine/src/event-*.ts`, `packages/git-engine/src/rate-limiter.ts`, `packages/git-engine/src/multi-repo-coordinator.ts`
   - verify: `npm test --workspace=packages/git-engine` passes 53+ new tests (139 total)
   - done-when: EventQueue, RateLimiter, MultiRepoCoordinator exported from git-engine index
   - effort: L
   - status: COMPLETE

## Phase 4 — UX Polish

### Phase 4.1 — UX Polish Package
6. Implement ux-polish package (`packages/ux-polish/`)
   - files: `packages/ux-polish/src/`
   - verify: All 370+ tests pass, G1–G19 + GF-01–GF-07 golden flows green
   - done-when: RichRenderer, ProgressOrchestrator, OnboardingWizard, ThemeEngine all exported
   - effort: L
   - status: COMPLETE

## Dependencies
- Phase 2.2 (build gate) must pass before any verification CI run
- Phase 3.1 depends on git-engine index exports being updated
- Phase 4.1 integration bridges depend on Phase 1.2 core exports

## Phase Grouping
- Phase 1: memory-engine package + core exports (Session/Memory PRD v1 Part 5)
- Phase 2: verification suite + build gate (Verification/QA PRD v1 Part 3)
- Phase 3: git event automation (Git Enhancement PRD v1 Part 4)
- Phase 4: UX polish package (Developer UX PRD v1 Part 6)
