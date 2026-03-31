# Implementation Plan: 9.1 → 9.5+ Final Polish

**Version:** 1.0
**Date:** 2026-03-30
**Status:** Ready for execution
**Goal:** Implement remaining 6 OSS patterns + fix engineering maturity gaps → achieve 9.5+ across all dimensions

---

## Executive Summary

**Current State:** 9.1/10 (Mission Complete at 9.0+)
**Target State:** 9.5+ (Excellence tier with proof artifacts)
**Timeline:** 4-6 days (3 parallel lanes)
**Strategy:** Implement missing high-value patterns + harden infrastructure + generate proof

**What This Fixes:**
- Missing 6 OSS patterns (AsyncQueue, Retry, UI Components, Visual Regression, Observability, Benchmark Suite)
- Engineering maturity gaps (Windows packaging, external gates, proof chain)
- Benchmark execution (SWE-bench proof)

---

## Architecture Overview

### Input
- 6 missing OSS patterns identified in Blade Master Plan
- Engineering maturity gaps (Windows, CI, proof chain)
- Benchmark infrastructure (ready but not executed)

### Output
- **Lane 1 (Patterns):** 6 new packages/modules with full test coverage
- **Lane 2 (Infrastructure):** Windows-compatible packaging, CI external gates, same-commit proof
- **Lane 3 (Benchmarks):** SWE-bench score, live provider smoke tests, speed metrics

### Execution Model
- 3 parallel lanes (independent work streams)
- Each lane has sequential phases
- Total: 12-16 hours of work (parallelized to 4-6 days)

---

## Implementation Phases

### Lane 1: Missing OSS Patterns (6-8 hours)

#### Phase 1.1: AsyncQueue Concurrency Control [M] [P]
**Pattern Source:** Kilocode
**Location:** `packages/core/src/async-queue.ts`
**Dependencies:** None

**Implementation:**
```typescript
export class AsyncQueue<T> {
  async work<R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number
  ): Promise<R[]>
}
```

**Test Strategy:**
- Test concurrency limits (1, 2, 5, 10)
- Test error propagation
- Test empty array edge case
- Test timeout behavior

**Files to Create:**
- `packages/core/src/async-queue.ts` (120 LOC)
- `packages/core/src/async-queue.test.ts` (15 tests)

**Wire Into:**
- Council orchestrator (parallel lane execution)
- Background agent runner (queue processing)

**Success Criteria:** 15/15 tests passing, used in 2+ locations

---

#### Phase 1.2: Retry with Exponential Backoff [M] [P]
**Pattern Source:** Kilocode
**Location:** `packages/core/src/retry-with-backoff.ts`
**Dependencies:** None

**Implementation:**
```typescript
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryableErrors?: (error: unknown) => boolean;
    onRetry?: (attempt: number, error: unknown) => void;
  }
): Promise<T>
```

**Features:**
- Exponential backoff with jitter
- Header-aware (reads `retry-after-ms` from API errors)
- Configurable retryable error classification
- Retry callback for logging

**Test Strategy:**
- Test exponential growth (delay = baseDelayMs * 2^attempt)
- Test max delay cap
- Test retryable vs non-retryable errors
- Test retry-after header parsing

**Files to Create:**
- `packages/core/src/retry-with-backoff.ts` (100 LOC)
- `packages/core/src/retry-with-backoff.test.ts` (18 tests)

**Wire Into:**
- All API calls (provider adapters)
- MCP client requests
- External service calls

**Success Criteria:** 18/18 tests passing, all API calls wrapped

---

#### Phase 1.3: Interactive UI Components [L] [P]
**Pattern Source:** Kilocode
**Location:** `packages/ui/` (new package)
**Dependencies:** React (dev), Storybook (dev)

**Components:**
- Spinner (loading states)
- Progress bar (task completion)
- Toast notifications (user feedback)
- Modal dialogs (confirmations)

**Implementation:**
- Create new `@dantecode/ui` package
- Storybook for documentation
- CLI uses ANSI equivalents (ora spinner, chalk colors)
- VS Code uses WebView components

**Files to Create:**
- `packages/ui/package.json`
- `packages/ui/src/Spinner.tsx` (60 LOC)
- `packages/ui/src/Progress.tsx` (80 LOC)
- `packages/ui/src/Toast.tsx` (90 LOC)
- `packages/ui/src/Modal.tsx` (120 LOC)
- `packages/ui/.storybook/` (config)
- `packages/ui/src/*.stories.tsx` (4 files)

**Test Strategy:**
- Storybook visual tests
- Unit tests for logic (progress %, toast timeout)
- Accessibility tests (ARIA labels)

**Success Criteria:** Storybook published to `docs/ui-components/`, used in CLI + VS Code

---

#### Phase 1.4: Visual Regression Testing [L]
**Pattern Source:** Kilocode
**Location:** `.github/workflows/visual-regression.yml`
**Dependencies:** Playwright, Storybook (from Phase 1.3)

**Implementation:**
- Playwright test runner
- Screenshot baseline generation
- Automated diff detection
- Git LFS for baseline storage

**Files to Create:**
- `.github/workflows/visual-regression.yml`
- `tests/visual/playwright.config.ts`
- `tests/visual/ui-components.spec.ts`
- `.gitattributes` (LFS config for `*.png`)

**Test Strategy:**
- Generate baselines for all Storybook stories
- Detect visual changes in CI
- Auto-update baselines on approval

**Success Criteria:** CI job passes, visual diffs detected and flagged

---

#### Phase 1.5: Observability System [M] [P]
**Pattern Source:** Agent-Orchestrator
**Location:** `packages/observability/` (new package)
**Dependencies:** None (zero-dep)

**Components:**
- MetricCounter (counters, gauges)
- TraceRecord (distributed tracing)
- HealthSurface (health checks)
- MetricExporter (Prometheus, JSON)

**Implementation:**
```typescript
export class MetricCounter {
  increment(name: string, tags?: Record<string, string>): void
  gauge(name: string, value: number): void
  histogram(name: string, value: number): void
}

export class TraceRecord {
  startSpan(name: string): Span
  endSpan(spanId: string): void
}
```

**Files to Create:**
- `packages/observability/src/metric-counter.ts` (80 LOC)
- `packages/observability/src/trace-record.ts` (120 LOC)
- `packages/observability/src/health-surface.ts` (60 LOC)
- `packages/observability/src/metric-exporter.ts` (90 LOC)
- `packages/observability/src/*.test.ts` (4 files, 40 tests total)

**Wire Into:**
- Agent loop (span per round, token counter)
- Model router (latency histogram)
- Council orchestrator (active lanes gauge)

**Success Criteria:** 40/40 tests passing, metrics exposed on `/metrics` endpoint

---

#### Phase 1.6: Benchmark Suite Integration [L]
**Pattern Source:** Aider
**Location:** `benchmarks/swe-bench/` (exists, needs execution)
**Dependencies:** Anthropic API key, SWE-bench test set

**Implementation:**
- Docker containerization for reproducibility
- Cost tracking per task
- Result aggregation (JSON + CSV)
- Comparison to baseline (Aider, OpenHands)

**Files Already Exist:**
- `benchmarks/swe-bench/swe_bench_runner.py`
- `benchmarks/swe-bench/cost_tracker.py`
- `benchmarks/swe-bench/verify_fix.py`

**Work Needed:**
- Run baseline: `python swe_bench_runner.py --subset verified --max-tasks 10`
- Generate `results.json` with score
- Create comparison chart (vs Aider 88%, OpenHands 77.6%)

**Success Criteria:** SWE-bench score published (target: 75%+), cost per task < $2

---

### Lane 2: Engineering Maturity Hardening (3-4 hours)

#### Phase 2.1: Windows Packaging Fix [S]
**Problem:** `rm -rf` not cross-platform, breaks Windows builds
**Location:** All package.json scripts + CLI code
**Dependencies:** rimraf package

**Implementation:**
- Install `rimraf` as dev dependency
- Replace all `rm -rf` with `rimraf`
- Test on Windows CI runner

**Files to Modify:**
- Root `package.json` (scripts)
- All package `package.json` files (15 files)
- `packages/cli/src/commands/*.ts` (any shell rm usage)

**Success Criteria:** Build passes on Windows, VSIX packaging works

---

#### Phase 2.2: External Gate Runners [M]
**Problem:** No same-commit proof chain for external gates
**Location:** `.github/workflows/`
**Dependencies:** GitHub Actions secrets

**Implementation:**
- Create `.github/workflows/external-gates.yml`
- Add secrets: `NPM_TOKEN`, `VSCE_PAT`, `ANTHROPIC_API_KEY`
- Run on every push to main/feat branches
- Generate receipts: `windows-smoke.json`, `publish-dry-run.json`, `live-provider.json`

**Gates:**
1. Windows smoke test (install + basic command)
2. NPM publish dry-run (verify package)
3. Live provider test (Anthropic, OpenAI, Grok)

**Files to Create:**
- `.github/workflows/external-gates.yml` (120 LOC)

**Success Criteria:** 3/3 external gates passing, receipts in `artifacts/readiness/external/`

---

#### Phase 2.3: Same-Commit Proof Chain [S]
**Problem:** Readiness artifacts not regenerated on every commit
**Location:** CI + release scripts
**Dependencies:** None

**Implementation:**
- Add `npm run release:sync` to CI (after tests pass)
- Commit artifacts if changed
- Fail CI if artifacts out of sync

**Files to Modify:**
- `.github/workflows/ci.yml` (add release:sync step)
- `scripts/release/generate-readiness.mjs` (verify same-commit)

**Success Criteria:** Every commit has matching artifacts, CI fails on drift

---

### Lane 3: Benchmark Execution & Proof (2-3 hours)

#### Phase 3.1: SWE-bench Baseline Run [M]
**Work:** Execute existing infrastructure with real API key
**Location:** `benchmarks/swe-bench/`
**Dependencies:** Anthropic API key ($20-50 budget)

**Execution:**
```bash
cd benchmarks/swe-bench
export ANTHROPIC_API_KEY=sk-...
python swe_bench_runner.py --subset verified --max-tasks 20
```

**Expected Output:**
- `results/run-{timestamp}.json` (per-task results)
- `results/summary.json` (aggregate score)
- `results/cost-report.json` (token usage + cost)

**Success Criteria:** Score published (target: 75%+), cost per task < $2

---

#### Phase 3.2: Live Provider Smoke Tests [S] [P]
**Work:** Test Anthropic, OpenAI, Grok with real API calls
**Location:** `scripts/smoke-provider.mjs`
**Dependencies:** API keys

**Implementation:**
- Extend `scripts/smoke-provider.mjs` to test 3 providers
- Capture API logs + costs
- Generate `provider-smoke-{name}.json` receipts

**Tests:**
- Simple completion ("Write a function to add two numbers")
- Tool calling (if supported)
- Streaming (if supported)

**Success Criteria:** 3/3 providers tested, receipts in `artifacts/readiness/external/`

---

#### Phase 3.3: Speed Metrics Capture [S] [P]
**Work:** Measure and publish performance metrics
**Location:** `scripts/bench-speed.mjs`
**Dependencies:** None

**Metrics:**
- Time to first suggestion (cold start)
- Task completion time (average)
- Deploy time (build + test + package)

**Output:**
- `speed-metrics.json` with timings
- SVG chart for docs

**Success Criteria:** Metrics published to `docs/benchmarks/speed.md`

---

## Technology Decisions

### Pattern Implementation
- **AsyncQueue:** Zero-dep, Promise-based, TypeScript native
- **Retry:** Exponential backoff with jitter (standard industry pattern)
- **UI Components:** React for portability, Storybook for docs
- **Visual Regression:** Playwright (best-in-class, TypeScript native)
- **Observability:** Zero-dep, Prometheus-compatible export format
- **Benchmarks:** Docker for reproducibility, JSON for interchange

### Infrastructure
- **Windows Fix:** rimraf (cross-platform, battle-tested)
- **External Gates:** GitHub Actions (native, free for OSS)
- **Proof Chain:** Git-based (no external dependencies)

### Testing
- **Unit Tests:** Vitest (existing standard)
- **Visual Tests:** Playwright (Storybook integration)
- **Benchmarks:** SWE-bench verified set (industry standard)

---

## Risk Mitigations

### Risk 1: SWE-bench Score Too Low (<70%)
**Impact:** High - credibility issue
**Probability:** Medium
**Mitigation:**
- Start with small subset (10 tasks) to calibrate
- Enable DanteForge verification to boost score
- Document score with context ("DanteForge improves by X%")
- Fallback: Publish with honest assessment, not marketing spin

---

### Risk 2: UI Components Scope Creep
**Impact:** Medium - timeline slip
**Probability:** Medium
**Mitigation:**
- Start with Spinner only (smallest component)
- Use existing libraries (ora for CLI, chakra-ui patterns for React)
- Defer full Storybook setup if over budget
- Fallback: Ship Spinner + Progress only, defer Toast/Modal

---

### Risk 3: External Gates CI Secrets Not Available
**Impact:** Low - can run manually
**Probability:** Low
**Mitigation:**
- Document manual execution steps
- Generate receipts locally, commit to repo
- Fallback: Run gates on local machine, publish results

---

### Risk 4: Windows Packaging Still Broken After rimraf
**Impact:** Medium - blocks Windows users
**Probability:** Low
**Mitigation:**
- Test locally on Windows VM before committing
- Add Windows to CI matrix if failures persist
- Fallback: Document Windows as "experimental support"

---

## File-Level Change Map

### New Packages (2)
```
packages/ui/                           # Interactive UI components
├── package.json
├── src/
│   ├── Spinner.tsx
│   ├── Progress.tsx
│   ├── Toast.tsx
│   ├── Modal.tsx
│   └── *.stories.tsx
└── .storybook/

packages/observability/                # Metrics and tracing
├── package.json
├── src/
│   ├── metric-counter.ts
│   ├── trace-record.ts
│   ├── health-surface.ts
│   ├── metric-exporter.ts
│   └── *.test.ts
```

### New Modules in Existing Packages
```
packages/core/src/
├── async-queue.ts                     # AsyncQueue concurrency control
├── async-queue.test.ts
├── retry-with-backoff.ts              # Exponential backoff retry
└── retry-with-backoff.test.ts
```

### New CI/Infrastructure Files
```
.github/workflows/
├── external-gates.yml                 # External gate runners
└── visual-regression.yml              # Playwright visual tests

tests/visual/
├── playwright.config.ts
└── ui-components.spec.ts

.gitattributes                         # Git LFS for baselines
```

### Modified Files
```
package.json                           # Add rimraf, update scripts
package-lock.json                      # Dependency updates
packages/*/package.json                # Replace rm -rf with rimraf (15 files)
.github/workflows/ci.yml               # Add release:sync step
scripts/smoke-provider.mjs             # Extend for 3 providers
scripts/bench-speed.mjs                # Add speed metrics
packages/cli/src/agent-loop.ts         # Wire observability
packages/core/src/model-router.ts      # Add retry wrapper
packages/core/src/council/council-orchestrator.ts  # Use AsyncQueue
```

---

## Effort Estimates

### Lane 1: Patterns (6-8 hours)
- Phase 1.1: AsyncQueue [M] - 1.5 hours
- Phase 1.2: Retry with Backoff [M] - 1.5 hours
- Phase 1.3: UI Components [L] - 3 hours
- Phase 1.4: Visual Regression [L] - 2 hours
- Phase 1.5: Observability [M] - 2 hours
- Phase 1.6: Benchmark Suite [L] - 1 hour (execution only)

### Lane 2: Infrastructure (3-4 hours)
- Phase 2.1: Windows Fix [S] - 1 hour
- Phase 2.2: External Gates [M] - 2 hours
- Phase 2.3: Same-Commit Proof [S] - 1 hour

### Lane 3: Benchmarks (2-3 hours)
- Phase 3.1: SWE-bench Run [M] - 1.5 hours
- Phase 3.2: Provider Smoke Tests [S] - 0.5 hours
- Phase 3.3: Speed Metrics [S] - 0.5 hours

**Total Sequential:** 11-15 hours
**Total Parallel (3 lanes):** 4-6 days

**Parallelizable Work:** All phases marked [P] can run concurrently

---

## Success Metrics: 9.1 → 9.5+

### Before (Current 9.1)
| Dimension | Score | Evidence |
|-----------|-------|----------|
| Engineering Maturity | 8.5 | Some Windows issues, manual gates |
| Benchmark/Real-world | 7.5 | Infrastructure ready, not executed |
| Agentic Depth | 9.1 | Features wired, verified |
| UX/Ergonomics | 8.0 | CLI functional, no UI polish |
| Extensibility | 8.6 | Patterns complete |
| Transparency | 8.8 | Honest docs |

**Average:** 9.1/10

### After (Target 9.5+)
| Dimension | Score | Evidence |
|-----------|-------|----------|
| Engineering Maturity | 9.5 | Windows ✓, External gates ✓, Proof chain ✓ |
| Benchmark/Real-world | 9.2 | SWE-bench score published, provider tests ✓ |
| Agentic Depth | 9.3 | All patterns implemented |
| UX/Ergonomics | 9.0 | UI components, visual regression |
| Extensibility | 9.0 | AsyncQueue, Retry, Observability |
| Transparency | 9.0 | Benchmark proof, honest metrics |

**Average:** 9.5/10

---

## Next Steps

**Option A: Execute Immediately**
```bash
# Clone this plan as tasks
danteforge tasks --from-plan

# Execute all lanes in parallel
danteforge nova
```

**Option B: Phased Execution**
```bash
# Lane 1: Patterns (highest value)
danteforge tasks --phase "Lane 1"

# Lane 2: Infrastructure (unblocks Windows)
danteforge tasks --phase "Lane 2"

# Lane 3: Benchmarks (proof artifacts)
danteforge tasks --phase "Lane 3"
```

**Option C: Cherry-Pick High-Value**
```bash
# Implement AsyncQueue + Retry (2 hours)
# Run SWE-bench baseline (1 hour)
# Fix Windows packaging (1 hour)
# Total: 4 hours for biggest wins
```

---

## Recommended Execution Order

1. **Start with Lane 1 Phase 1.1 + 1.2** (AsyncQueue + Retry) - 3 hours
   - Highest value/effort ratio
   - Immediately improves council and API reliability

2. **Parallel: Lane 3 Phase 3.1** (SWE-bench) - 1.5 hours
   - Generates proof artifacts
   - Can run while implementing patterns

3. **Lane 2 Phase 2.1** (Windows fix) - 1 hour
   - Unblocks Windows users
   - Simple, high-impact

4. **Lane 1 Phase 1.5** (Observability) - 2 hours
   - Production-readiness signal
   - Enables monitoring

5. **Defer to v1.1:** UI Components, Visual Regression
   - Nice to have, not critical for 9.5+
   - Bigger time investment

**Critical Path:** 1 → 2 → 3 → 4 = 7.5 hours to 9.5+

---

## Plan Metadata

**Created:** 2026-03-30
**Author:** Claude Opus 4.6
**Approval:** Pending execution
**PDSE Score:** N/A (planning artifact)
**Estimated Completion:** 2026-04-05 (if parallel execution)
