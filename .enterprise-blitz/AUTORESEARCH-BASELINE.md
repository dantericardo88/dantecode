# Autoresearch Baseline Measurements

**Captured:** 2026-03-30  
**Purpose:** Baseline for autoresearch optimization experiments

---

## Metric 1: Bundle Size

**Goal:** Reduce total build artifact size from 24 MB → 12 MB (50% reduction)

**Measurement Script:** `.enterprise-blitz/measure-bundle-size.sh`

**Current Baseline:**
- CLI package dist: 180,939 bytes (~177 KB)
- Total across all packages: 25,671,030 bytes (24 MB)

**Breakdown by Package:**
```bash
find packages/*/dist -name "*.js" -type f -exec du -h {} + | sort -h
```

**Target:** < 12 MB total

**Impact:** Faster downloads, quicker cold starts, better edge deployment

---

## Metric 2: Memory Usage

**Goal:** Reduce baseline memory usage from 60 MB → 48 MB (20% reduction)

**Measurement Script:** `.enterprise-blitz/measure-memory.sh`

**Current Baseline:**
- Initial RSS: 63,262,720 bytes (~60 MB)

**Target:** < 50 MB baseline RSS

**Impact:** Lower resource requirements, better multi-agent scalability

---

## Metric 3: Test Suite Speed

**Goal:** Reduce core test suite runtime from 151s → 113s (25% faster)

**Measurement Script:** `.enterprise-blitz/measure-test-speed.sh`

**Current Baseline:**
- Core package tests: 151,011 ms (~151 seconds)
- Note: 31 pre-existing test failures (browser-agent, council worktree)

**Target:** < 120 seconds

**Impact:** Faster CI/CD, better developer experience

---

## Experiment Plan

**Phase 1: Bundle Size (2h)**
- Try: Dynamic imports for heavy dependencies
- Try: Externalize large dependencies (playwright, octokit)
- Try: Tree-shaking optimization
- Try: Remove unused dependencies
- Try: Minification improvements

**Phase 2: Memory (2h)**
- Try: Lazy initialization of heavy objects
- Try: WeakMap caching instead of Map
- Try: Reduce default buffer sizes
- Try: Stream processing instead of buffering
- Try: Pool reuse patterns

**Phase 3: Test Speed (2h)**
- Try: Parallelize test suites
- Try: Mock heavy operations
- Try: Reduce test timeout defaults
- Try: Skip slow integration tests in unit runs
- Try: Cache test fixtures

---

## Success Criteria

- Bundle < 12 MB (50% reduction)
- Memory < 50 MB (20% reduction)
- Tests < 120s (25% faster)
- No regressions in functionality
- All existing tests still pass
