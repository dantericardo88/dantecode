# PLAN.md — DanteCode Remaining Work

**Status:** Code-complete across 9 packages. Focus shifts to testing, hardening, and release.
**Date:** 2026-03-15

---

## Phase 1: Test Coverage (Current Priority)

### Goal: Achieve ≥80% unit test coverage across all packages

| Package | Status | Tests | Priority |
|---------|--------|------:|----------|
| config-types | ✅ No runtime code to test | 0 | N/A |
| core/audit | ✅ Covered | 12 | Done |
| core/state | ✅ Covered | 14 | Done |
| core/model-router | ✅ Covered | 10 | Done |
| danteforge/anti-stub | ✅ Covered | 22 | Done |
| danteforge/pdse-scorer | ✅ Covered | 14 | Done |
| danteforge/constitution | ✅ Covered | 28 | Done |
| danteforge/gstack | ✅ Covered | 21 | Done |
| danteforge/autoforge | ✅ Covered | 11 | Done |
| danteforge/lessons | ✅ Covered | 17 | Done |
| git-engine/diff | ✅ Covered | 9 | Done |
| git-engine/commit | ✅ Covered | 15 | Done |
| git-engine/worktree | ✅ Covered | 13 | Done |
| git-engine/repo-map | ✅ Covered | 13 | Done |
| skill-adapter/wrap | ✅ Covered | 22 | Done |
| skill-adapter/registry | ✅ Covered | 22 | Done |
| sandbox/* | ❌ Needs tests (mock Docker) | 0 | Low |
| cli/* | ❌ Needs tests | 0 | Low |
| vscode/* | ❌ Needs tests (VS Code test harness) | 0 | Low |
| desktop/* | ❌ Needs tests | 0 | Low |

**Deliverables:**
- [x] core/state.test.ts — read/write/initialize/update with Zod validation (14 tests)
- [x] core/model-router.test.ts — provider resolution, fallback, task overrides (10 tests)
- [x] danteforge/autoforge.test.ts — IAL loop with mocked model + gstack (11 tests)
- [x] danteforge/lessons.test.ts — SQLite record/query lifecycle (17 tests)
- [x] git-engine/commit.test.ts — commit message building, status parsing (15 tests)
- [x] git-engine/repo-map.test.ts — repo map generation and formatting (13 tests)
- [x] skill-adapter/wrap.test.ts — adapter preamble/postamble injection (22 tests)
- [x] skill-adapter/registry.test.ts — skill loading and validation (22 tests)
- [x] git-engine/worktree.test.ts — worktree create/remove/merge/detect (13 tests)

---

## Phase 2: CI/CD Hardening

### Goal: Green CI pipeline with all gates passing

**Deliverables:**
- [ ] Verify CI workflow runs correctly on GitHub Actions
- [ ] Add format check to CI (`prettier --check`)
- [x] Add ESLint configuration (typescript-eslint flat config, all packages updated)
- [ ] Add code coverage reporting (vitest --coverage)
- [ ] Verify anti-stub self-check job works against real codebase
- [ ] Add dependabot or renovate for dependency updates

---

## Phase 3: Integration Testing

### Goal: End-to-end validation of the DanteForge pipeline

**Deliverables:**
- [ ] Integration test: generate code → anti-stub scan → PDSE score → constitution check
- [ ] Integration test: autoforge IAL loop with real GStack commands
- [ ] Integration test: skill import from Claude fixture → adapter wrapping → validation
- [ ] Integration test: git worktree create → task → merge → cleanup

---

## Phase 4: Documentation & Distribution

### Goal: One-command install, published packages

**Deliverables:**
- [ ] npm publish workflow for @dantecode/* packages
- [ ] VS Code Marketplace extension publishing
- [ ] Install script (`curl -fsSL https://get.dantecode.dev | bash`)
- [ ] API documentation generation (TypeDoc or similar)
- [ ] CHANGELOG.md

---

## Phase 5: Benchmarking & Polish

### Goal: Competitive validation and UX refinement

**Deliverables:**
- [ ] Benchmark suite: stub rate comparison vs. raw model output
- [ ] Performance profiling: PDSE scoring latency, model routing latency
- [ ] CLI UX polish: colored output, progress indicators, error messages
- [ ] VS Code extension UX: sidebar polish, keybindings, settings UI

---

## Critical Path

```
Phase 1 (Tests) → Phase 2 (CI) → Phase 3 (Integration) → Phase 4 (Distribution) → Phase 5 (Polish)
```

Phases 1 and 2 can partially overlap. Phases 4 and 5 can run in parallel.
