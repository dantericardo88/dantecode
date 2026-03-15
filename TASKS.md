# TASKS.md — DanteCode Executable Task List

**Generated:** 2026-03-15 | **Source:** PLAN.md | **Autoforge Wave:** 24

---

## Legend

- `[ ]` — Not started
- `[~]` — In progress
- `[x]` — Complete
- `[!]` — Blocked

---

## Phase 1: Test Coverage

### 1.1 Core Package Tests

| # | Task | File | Status | Tests |
|---|------|------|--------|------:|
| 1.1.1 | Audit event logging tests | `core/src/audit.test.ts` | [x] | 12 |
| 1.1.2 | State YAML read/write/init/update tests | `core/src/state.test.ts` | [x] | 15 |
| 1.1.3 | Model router provider resolution, generate, stream, fallback | `core/src/model-router.test.ts` | [x] | 33 |
| 1.1.4 | Provider builder tests (anthropic, openai, grok, ollama) | `core/src/providers/providers.test.ts` | [x] | 21 |

### 1.2 DanteForge Package Tests

| # | Task | File | Status | Tests |
|---|------|------|--------|------:|
| 1.2.1 | Anti-stub scanner + scanFile + custom patterns | `danteforge/src/anti-stub-scanner.test.ts` | [x] | 36 |
| 1.2.2 | PDSE scorer dimension & threshold tests | `danteforge/src/pdse-scorer.test.ts` | [x] | 32 |
| 1.2.3 | Constitution checker security detection tests | `danteforge/src/constitution.test.ts` | [x] | 34 |
| 1.2.4 | GStack command runner tests | `danteforge/src/gstack.test.ts` | [x] | 15 |
| 1.2.5 | Autoforge IAL context builder & loop tests | `danteforge/src/autoforge.test.ts` | [x] | 22 |
| 1.2.6 | Lessons SQLite CRUD lifecycle tests | `danteforge/src/lessons.test.ts` | [x] | 17 |

### 1.3 Git-Engine Package Tests

| # | Task | File | Status | Tests |
|---|------|------|--------|------:|
| 1.3.1 | Diff parser + getDiff/getStagedDiff/applyDiff | `git-engine/src/diff.test.ts` | [x] | 23 |
| 1.3.2 | Commit message builder & status parsing | `git-engine/src/commit.test.ts` | [x] | 15 |
| 1.3.3 | Worktree create/cleanup lifecycle | `git-engine/src/worktree.test.ts` | [x] | 13 |
| 1.3.4 | Repo-map file tree generation | `git-engine/src/repo-map.test.ts` | [x] | 13 |

### 1.4 Skill-Adapter Package Tests

| # | Task | File | Status | Tests |
|---|------|------|--------|------:|
| 1.4.1 | Adapter preamble/postamble injection | `skill-adapter/src/wrap.test.ts` | [x] | 22 |
| 1.4.2 | Skill loading and validation | `skill-adapter/src/registry.test.ts` | [x] | 22 |
| 1.4.3 | Parser tests (claude, continue, opencode) | `skill-adapter/src/parsers/parsers.test.ts` | [x] | 30 |
| 1.4.4 | Import orchestrator tests | `skill-adapter/src/importer.test.ts` | [x] | 28 |

### 1.5 Remaining Package Tests (Lower Priority)

| # | Task | Package | Status | Tests |
|---|------|---------|--------|------:|
| 1.5.1 | Sandbox Docker mock tests | `sandbox` | [ ] | 0 |
| 1.5.2 | CLI argument parsing & routing | `cli` | [ ] | 0 |
| 1.5.3 | VS Code extension tests | `vscode` | [ ] | 0 |
| 1.5.4 | Desktop app tests | `desktop` | [ ] | 0 |

**Phase 1 Summary:** 403/403 tests passing across 18 suites (9/9 packages with runtime code covered, 94.15% stmt coverage, 99.09% func coverage)

---

## Phase 2: CI/CD Hardening

| # | Task | Status |
|---|------|--------|
| 2.1 | Verify CI workflow runs correctly on GitHub Actions | [ ] |
| 2.2 | Add `prettier --check` format gate to CI | [x] |
| 2.3 | Configure ESLint with real rules (replace typecheck duplicate) | [x] |
| 2.4 | Add `vitest --coverage` reporting to CI | [x] |
| 2.5 | Verify anti-stub self-check CI job against real codebase | [ ] |
| 2.6 | Add Dependabot or Renovate for dependency updates | [ ] |

---

## Phase 3: Integration Testing

| # | Task | Status |
|---|------|--------|
| 3.1 | E2E: generate code → anti-stub scan → PDSE score → constitution check | [ ] |
| 3.2 | E2E: autoforge IAL loop with real GStack commands | [ ] |
| 3.3 | E2E: skill import → adapter wrapping → validation | [ ] |
| 3.4 | E2E: git worktree create → task → merge → cleanup | [ ] |

---

## Phase 4: Documentation & Distribution

| # | Task | Status |
|---|------|--------|
| 4.1 | npm publish workflow for @dantecode/* packages | [ ] |
| 4.2 | VS Code Marketplace extension publishing | [ ] |
| 4.3 | Install script (`curl -fsSL https://get.dantecode.dev \| bash`) | [ ] |
| 4.4 | API documentation generation (TypeDoc or similar) | [ ] |
| 4.5 | CHANGELOG.md | [ ] |

---

## Phase 5: Benchmarking & Polish

| # | Task | Status |
|---|------|--------|
| 5.1 | Benchmark suite: stub rate comparison vs. raw model output | [ ] |
| 5.2 | Performance profiling: PDSE scoring latency, model routing latency | [ ] |
| 5.3 | CLI UX polish: colored output, progress indicators, error messages | [ ] |
| 5.4 | VS Code extension UX: sidebar polish, keybindings, settings UI | [ ] |

---

## Immediate Next Actions

1. ~~**Initial git commit**~~ — Done (Wave 16, commit `410b70e`)
2. ~~**Task 2.2**~~ — Done (Wave 17, commit `4f6ad62`)
3. ~~**Task 2.4**~~ — Done (Wave 18, commit `827d33c`)
3b. ~~**Coverage expansion**~~ — Done (Wave 19-21, commit `0b37f24`; 64.77% → 81.71% stmts)
3c. ~~**Coverage expansion II**~~ — Done (Wave 22-24, commit `dbb21c1`; 81.71% → 94.15% stmts)
4. **Task 2.1** — Push to GitHub, verify CI workflow runs green
5. **Task 2.5** — Verify anti-stub self-check CI job against real codebase
6. **Task 2.6** — Add Dependabot or Renovate for dependency updates
