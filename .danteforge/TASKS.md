# TASKS.md - 9.7+ Final Polish Sprint

**Generated:** 2026-03-30
**Plan:** `.danteforge/PLAN.md`
**Status:** Ready to execute

---

## Execution Strategy

**Wave-based parallel execution:**
- **Wave 1 (3h):** All Phase 1.5 tests + all Phase 2.1 components in parallel
- **Wave 2 (1.5h):** CLI wiring + Storybook setup
- **Wave 3 (2h):** Storybook stories + Playwright setup
- **Wave 4 (3h):** Visual tests + CI workflow
- **Wave 5 (1h):** Final verification + UPR update

**Total:** 10.5 hours across 5 waves

---

## Wave 1: Tests + Components (Parallel) - 3h

### [1.5.1] Agent Loop Observability Tests
**File:** `packages/cli/src/agent-loop-observability.test.ts`
**Status:** ⏳ pending
**Effort:** 1.5h
**Parallel:** Yes

**Checklist:**
- [ ] Create test file structure
- [ ] Test: metrics collected on round start/end
- [ ] Test: round counter increments
- [ ] Test: tool call metrics per invocation
- [ ] Test: context tokens tracked
- [ ] Test: trace spans per round
- [ ] Test: spans include metadata
- [ ] Test: spans closed on completion
- [ ] Test: spans capture errors
- [ ] Run tests: 8/8 passing
- [ ] Coverage ≥ 85%

---

### [1.5.2] Model Router Observability Tests
**File:** `packages/core/src/model-router-observability.test.ts`
**Status:** ⏳ pending
**Effort:** 1h
**Parallel:** Yes

**Checklist:**
- [ ] Create test file with router fixtures
- [ ] Test: request metrics increment
- [ ] Test: token metrics (prompt/completion/total)
- [ ] Test: cost estimation (Anthropic/OpenAI/Grok)
- [ ] Test: latency gauge updates
- [ ] Test: retry counter on errors
- [ ] Test: trace spans with provider metadata
- [ ] Run tests: 6/6 passing
- [ ] Coverage ≥ 85%

---

### [1.5.3] Council Health Tests
**File:** `packages/core/src/council/council-health.test.ts`
**Status:** ⏳ pending
**Effort:** 0.5h
**Parallel:** Yes

**Checklist:**
- [ ] Create test file with orchestrator fixtures
- [ ] Test: healthy when all lanes succeed
- [ ] Test: degraded when some fail
- [ ] Test: unhealthy when all fail
- [ ] Test: fleet budget health
- [ ] Test: orchestrator state health
- [ ] Run tests: 5/5 passing
- [ ] Coverage ≥ 85%

---

### [1.5.4] Add Observability Reset Methods
**Files:**
- `packages/observability/src/metric-counter.ts`
- `packages/observability/src/trace-recorder.ts`

**Status:** ⏳ pending
**Effort:** 15min
**Parallel:** Yes

**Checklist:**
- [ ] Add resetMetrics() to MetricCounter
- [ ] Add resetTraces() to TraceRecorder
- [ ] Export from index.ts
- [ ] Test isolation works

---

### [2.1.1] Spinner Component
**File:** `packages/ux-polish/src/components/spinner.ts`
**Status:** ⏳ pending
**Effort:** 1h
**Parallel:** Yes

**Checklist:**
- [ ] Create spinner.ts with interface
- [ ] Implement start() with animation
- [ ] Implement update() text change
- [ ] Implement stop/succeed/fail/warn/info
- [ ] Add VSCode detection
- [ ] Create spinner.test.ts (4 tests)
- [ ] All tests passing

---

### [2.1.2] Toast Component
**File:** `packages/ux-polish/src/components/toast.ts`
**Status:** ⏳ pending
**Effort:** 1.5h
**Parallel:** Yes

**Checklist:**
- [ ] Create toast.ts with ToastManager
- [ ] Implement queue (max 3)
- [ ] Implement auto-dismiss timers
- [ ] Implement info/success/warning/error
- [ ] Add themed rendering
- [ ] Create toast.test.ts (5 tests)
- [ ] Export singleton instance
- [ ] All tests passing

---

### [2.1.3] Menu Component
**File:** `packages/ux-polish/src/components/menu.ts`
**Status:** ⏳ pending
**Effort:** 1.5h
**Parallel:** Yes

**Checklist:**
- [ ] Create menu.ts with interface
- [ ] Implement readline keyboard input
- [ ] Implement arrow navigation
- [ ] Implement search/filter
- [ ] Implement multi-select
- [ ] Add themed rendering
- [ ] Create menu.test.ts (6 tests)
- [ ] All tests passing

---

### [WAVE1.COMMIT] Commit Wave 1
**Status:** ⏳ pending
**Dependencies:** All Wave 1 tasks complete

**Checklist:**
- [ ] Run typecheck
- [ ] Run lint
- [ ] Run all tests
- [ ] Create commit: "feat: observability tests + UI components (Wave 1)"
- [ ] Verify gates green

---

## Wave 2: CLI Wiring + Storybook - 1.5h

### [2.1.4] Wire Components into CLI
**Files:**
- `packages/cli/src/slash-commands.ts`
- `packages/cli/src/repl.ts`
- `packages/cli/src/fuzzy-finder.ts`

**Status:** ⏳ pending
**Effort:** 1h
**Dependencies:** 2.1.1, 2.1.2, 2.1.3

**Checklist:**
- [ ] Add Spinner to /forge
- [ ] Add Spinner to /party
- [ ] Add Toast to command success/error
- [ ] Replace fuzzy-finder with Menu
- [ ] Export from ux-polish/index.ts
- [ ] Test /forge shows spinner
- [ ] Test /find uses Menu

---

### [2.2.1] Install Storybook
**Status:** ⏳ pending
**Effort:** 30min
**Parallel:** Can run with 2.1.4

**Checklist:**
- [ ] Install Storybook deps
- [ ] Create .storybook/main.ts
- [ ] Create .storybook/preview.tsx
- [ ] Test `npm run storybook`
- [ ] Verify localhost:6006

---

### [WAVE2.COMMIT] Commit Wave 2
**Status:** ⏳ pending
**Dependencies:** 2.1.4, 2.2.1

**Checklist:**
- [ ] Run tests
- [ ] Create commit: "feat: wire UI components + Storybook setup (Wave 2)"
- [ ] Verify gates green

---

## Wave 3: Stories + Playwright Setup - 2h

### [2.2.2] Create Component Stories
**Files:**
- `packages/ux-polish/src/components/spinner.stories.tsx`
- `packages/ux-polish/src/components/toast.stories.tsx`
- `packages/ux-polish/src/components/menu.stories.tsx`

**Status:** ⏳ pending
**Effort:** 1.5h
**Dependencies:** 2.2.1, 2.1.1, 2.1.2, 2.1.3

**Checklist:**
- [ ] Create React wrapper helper
- [ ] Create spinner.stories.tsx (3 stories)
- [ ] Create toast.stories.tsx (3 stories)
- [ ] Create menu.stories.tsx (3 stories)
- [ ] Verify all render correctly
- [ ] ANSI → HTML working

---

### [2.3.1] Install Playwright
**Status:** ⏳ pending
**Effort:** 15min
**Parallel:** Yes (with 2.2.2)

**Checklist:**
- [ ] Install @playwright/test
- [ ] Install chromium
- [ ] Create playwright.config.ts
- [ ] Verify config

---

### [WAVE3.COMMIT] Commit Wave 3
**Status:** ⏳ pending
**Dependencies:** 2.2.2, 2.3.1

**Checklist:**
- [ ] Verify Storybook builds
- [ ] Create commit: "feat: component stories + Playwright (Wave 3)"

---

## Wave 4: Visual Tests + CI - 3h

### [2.3.2] Create Visual Tests
**File:** `tests/visual/components.spec.ts`
**Status:** ⏳ pending
**Effort:** 2h
**Dependencies:** 2.3.1, 2.2.2

**Checklist:**
- [ ] Create tests/visual/ directory
- [ ] Test: Spinner default
- [ ] Test: Spinner success
- [ ] Test: Toast info
- [ ] Test: Toast error
- [ ] Test: Menu single-select
- [ ] Test: Menu multi-select
- [ ] Generate baselines
- [ ] Run tests: 6/6 passing
- [ ] Commit baseline screenshots

---

### [2.3.3] Add CI Workflow
**File:** `.github/workflows/visual-regression.yml`
**Status:** ⏳ pending
**Effort:** 45min
**Dependencies:** 2.3.2

**Checklist:**
- [ ] Create workflow file
- [ ] Configure Playwright steps
- [ ] Add artifact upload
- [ ] Test on sample PR
- [ ] Verify workflow runs

---

### [WAVE4.COMMIT] Commit Wave 4
**Status:** ⏳ pending
**Dependencies:** 2.3.2, 2.3.3

**Checklist:**
- [ ] Run visual tests
- [ ] Create commit: "feat: visual regression tests + CI (Wave 4)"
- [ ] Verify CI workflow

---

## Wave 5: Final Verification - 1h

### [FINAL.1] Run Full Verification
**Status:** ⏳ pending
**Effort:** 30min
**Dependencies:** All waves complete

**Checklist:**
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → 0 errors (16 warnings OK)
- [ ] `npm run test` → all passing
- [ ] `npm run format` → all formatted
- [ ] `npx playwright test` → 6/6 passing
- [ ] Count total tests (expect: 363)

---

### [FINAL.2] Update UPR.md
**Status:** ⏳ pending
**Effort:** 30min
**Dependencies:** FINAL.1

**Checklist:**
- [ ] Document Phase 1.5 results (19 tests)
- [ ] Document Phase 2.1 results (15 tests)
- [ ] Document Phase 2.2 results (9 stories)
- [ ] Document Phase 2.3 results (6 visual tests)
- [ ] Update test count totals
- [ ] Update score estimate (9.5 → 9.7+)

---

### [FINAL.3] Create Release Commit
**Status:** ⏳ pending
**Effort:** 15min
**Dependencies:** FINAL.2

**Checklist:**
- [ ] Stage all changes
- [ ] Create commit: "feat: complete 9.7+ polish sprint - observability tests, UI components, visual regression"
- [ ] Tag: v1.0.0-rc1
- [ ] Push to remote

---

## Progress Tracking

### Test Count Progression
- **Start:** 323 CLI tests
- **After Phase 1.5:** +19 observability tests = 342
- **After Phase 2.1:** +15 component tests = 357
- **After Phase 2.3:** +6 visual tests = 363
- **Target:** 363 total tests

### Score Progression
- **Start:** 9.5/10 (Phase 1.4 complete)
- **After Phase 1.5:** 9.6/10 (observability validated)
- **After Phase 2.1:** 9.7/10 (professional UI)
- **After Phase 2.2-2.3:** 9.7+/10 (visual regression protection)
- **Target:** 9.7+ confirmed by ChatGPT

---

## Quick Reference

**Start a wave:**
```bash
# Wave 1: Parallel execution
npm run test:watch --workspace=packages/cli  # Terminal 1
npm run test:watch --workspace=packages/core  # Terminal 2
npm run test:watch --workspace=packages/ux-polish  # Terminal 3
```

**Verify progress:**
```bash
npm run typecheck  # Should be 0 errors
npm run test       # Count passing tests
git status         # See changed files
```

**Commit a wave:**
```bash
git add -A
git commit -m "feat: <wave description> (Wave N)"
git push
```

---

**END OF TASKS**

**Next action:** Execute Wave 1 tasks in parallel or use /autoforge to automate.
