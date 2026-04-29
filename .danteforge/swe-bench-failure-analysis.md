# SWE-bench Failure Analysis (Dim 5 Sprint, Phase 1)

**Date:** 2026-04-29
**Source:** `.danteforge/bench-results.json` (10 runs, 100 instances, claude-sonnet-4-6) +
`bench-results.json` (verified-instance detail) + `benchmarks/swe-bench/validation_final.log`
**Current best pass rate:** 56% (run-2026-04-21-010)
**Target:** 70%+ → closes dim 5 to 9/10

## Trend across the last 10 runs

| Run | Pass | test_assertion | timeout | no_patch | compile | import |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 001 | 44% | 14 | 8 | 6 | — | — |
| 002 | 45% | 27 | 15 | 10 | 3 | — |
| 003 | 47% | 25 | 14 | 9 | 5 | — |
| 004 | 49% | 23 | 13 | 9 | 5 | 1 |
| 005 | 50% | 22 | 13 | 8 | 5 | 2 |
| 006 | 52% | 21 | 12 | 8 | 4 | 3 |
| 007 | 53% | 22 | 11 | 8 | 4 | 2 |
| 008 | 54% | 21 | 11 | 7 | 4 | 3 |
| 009 | 55% | 20 | 11 | 7 | 4 | 3 |
| 010 | 56% | 19 | 10 | 7 | 4 | 4 |

**Observations:**
- Monotonic improvement +12 points in 10 runs. The agent loop is getting better.
- `test_assertion` (model produced wrong fix): 27 → 19 (-8). Biggest remaining
  bucket. Real-bug failures, not infrastructure.
- `timeout` (600s wall-clock): 15 → 10 (-5). Halving suggests context/planning
  improvements helped, but still 10/100 is wasteful.
- `no_patch` (model gave up / empty diff): 10 → 7 (-3). Stable floor — these
  are the hard instances where the agent never converges.
- `compile_error` (Python syntax error in patch): 4 (stuck). Same recurring
  class — patches that don't apply.
- `import_error` (env/dep): 0 → 4 (+4, *getting worse*). Conftest plugin
  conflicts surfacing more as we evaluate harder repos (astropy, sympy).

## Concrete failure patterns from verified_instances + log

### Pattern A: Patch-context fabrication (4-5 of compile_error bucket)

Model emits a unified diff with context lines that don't exist in the target
file. Examples from `bench-results.json`:

| Instance | failureReason |
|---|---|
| `matplotlib__matplotlib-23299` | "context lines not found in seeded file" |
| `pytest-dev__pytest-9359` | "context lines missing from target file" |
| `sphinx-doc__sphinx-10673` | "hunk offset mismatch" |
| `django__django-14915` | "malformed patch format" |

**Root cause:** The agent loop emits `diff --git` patches without first
reading the target file's actual contents at the claimed line range. When
the model hallucinates context, `git apply` rejects the entire patch.

**Already-built mitigation:** `agent-tools.ts` ships
`toolReplaceInFile` with Cline-style 4-strategy fuzzy matching
(`parseSearchReplaceBlocks` + `applySearchReplaceBlock`). It's NOT being
preferred for SWE-bench because the model still emits raw unified diffs.

**Fix:** Either (a) bias the system prompt toward `ReplaceInFile` for
SWE-bench instances, or (b) post-process emitted unified diffs through
the same fuzzy-match engine before invoking `git apply`.

### Pattern B: Empty-patch / gives up (`no_patch:7`)

Model exits the loop without emitting any diff at all. Validation log shows
some instances complete in seconds with no patch produced.

**Root cause:** The agent runs out of "exploration budget" before it
narrows on the fix location. Common when the problem statement is vague
or the repo has many candidate files. No planning pass forces exploration
without commitment.

**Fix:** Aider's architect mode — separate planner LLM produces a written
plan with concrete file paths first; executor LLM is then constrained to
edit only those paths. This matches the dim 16 (Plan/Act) work already
done; SWE-bench just needs a different default for the planner-trigger
threshold.

### Pattern C: Conftest plugin conflicts (`import_error:4`, climbing)

`benchmarks/swe-bench/validation_final.log` line 36-40:

```
ImportError: Error importing plugin "astropy.tests.plugins.display": astropy
```

Several Python repos register pytest plugins in their conftest. When the
test environment isn't fully set up (egg-info mismatch, missing C extension
build), `pytest --collect-only` fails with ImportError before any test
runs. The agent counts this as a test failure even though it's an env
problem — and worse, the agent often tries to "fix" the import with code
changes that make things worse.

**Fix:** Pre-flight env validation in the harness. Run `pytest --collect-only
--no-header -q` BEFORE giving the problem statement to the agent. If
collection fails, the harness either (a) auto-installs missing deps, or
(b) skips the instance and marks it as `env_error` (separate from
`test_assertion` so the failure-mode counts don't conflate them).

### Pattern D: Wall-clock timeout on large-repo instances (`timeout:10`)

Single 600s timeout for all 100 instances regardless of repo size. The
log shows astropy tests "Rebuilding extension modules" repeatedly — Cython
recompiles eat 60-120s of the 600s budget before the agent does anything.

**Fix:** Per-repo timeout tiers. Small repos (requests, flask): 240s.
Medium (django, pytest, sympy): 600s. Large with C extensions (astropy,
matplotlib, scikit-learn, scipy): 1200s. Total wall clock budget stays
comparable; allocation matches actual cost.

### Pattern E: Partial-hunk acceptance hides bad patches

Log line 86: `[OK] Partial test patch applied (some hunks rejected)`

When the test_patch applies partially, some FAIL_TO_PASS tests run and
some don't. The instance gets recorded as a partial pass even though the
verification surface is incomplete.

**Fix:** Strict mode in the harness — if ANY hunk of the test_patch is
rejected, mark the instance `harness_error` and don't count it for or
against pass rate. Optionally retry with looser `git apply --3way`.

## Prioritized fix list (Phase 5 inferno targets)

| Priority | Pattern | Bucket size | Fix | Phase |
|:---:|---|:---:|---|:---:|
| 1 | A: Patch-context fabrication | 4 (compile) + ~5 (no_patch sub-class) ≈ **~9 instances** | Bias toward `toolReplaceInFile` for SWE-bench, post-process unified diffs through fuzzy matcher | 3 |
| 2 | B: Empty patch / gives up | **7 instances** | Architect-mode default for SWE-bench (planner LLM first, executor constrained) | 3 |
| 3 | C: Conftest plugin conflicts | **4 instances**, trending up | Pre-flight `pytest --collect-only` validation in harness | 4 |
| 4 | D: Wall-clock timeout | **10 instances** | Per-repo timeout tiers in `bench.ts` | 5 |
| 5 | E: Partial-hunk acceptance | unknown (silent) | Strict mode in eval harness | 5 |

**Estimated headroom:** Closing patterns A+B+C cleanly = ~20 instances
recovered. 56 + 20 = 76% pass rate. Target met.

## Cross-reference: published patterns we should adopt

| Project | Pattern | Maps to fix |
|---|---|---|
| **SWE-agent** (Yang et al. 2024) | Agent-Computer Interface — bash-only constrained tool surface, `edit_file` with explicit line ranges, `submit` to mark patch final | A (constrained edit prevents context fabrication) |
| **OpenHands** | CodeAct interpreter — Python sandbox executes failing test once before agent edits, capturing stack trace as priming context | B (planner has concrete error before fix) + C (env validation surfaces conftest issues early) |
| **Aider** | Architect mode (separate planner pass), repo-map for context | B (forced planning), D (focused exploration cuts wall-clock) |
| **Plandex** | Long-horizon plan streaming with partial-apply | D (early partial wins ship before timeout) |

## Lessons captured (append to `.danteforge/lessons.md`)

1. **SWE-bench unified-diff context fabrication is a recurring class.** Model
   emits patch context that doesn't exist in target file. Mitigation: route
   SWE-bench through `toolReplaceInFile` (fuzzy 4-strategy match), not raw
   `git apply`. Reason: the apply-time matcher already exists in
   `agent-tools.ts` and tolerates 1-2 token drift in context lines.

2. **Empty-patch failures are planning failures, not edit failures.** When
   the agent emits no diff, the cause is usually exploration-budget
   exhaustion — not inability to write code. Mitigation: invoke architect
   mode (PlanActController) earlier in the SWE-bench code path so the
   executor gets concrete file paths to focus on.

3. **`pytest --collect-only` failures must be classified separately from
   test-assertion failures.** Conftest plugin conflicts in scientific
   Python repos (astropy, sympy, scipy) cause the test runner to crash
   before any test executes. The agent then "fixes" code that's not
   broken. Mitigation: pre-flight env validation; mark uncollectable
   instances as `env_error`, not `test_assertion`.

4. **Single timeout for all 100 instances wastes budget on small repos.**
   Cython recompile alone burns 60-120s on astropy/matplotlib. Mitigation:
   per-repo timeout tiers (small 240s, medium 600s, large-with-extensions
   1200s).

5. **Partial-hunk patch application silently corrupts pass-rate accounting.**
   When `git apply` accepts some hunks and rejects others, the test result
   is meaningless. Mitigation: strict mode — any hunk rejection = harness
   error, not a real result.

## Next phase entry criteria

Phase 2 begins when the user agrees the failure-mode classification above
matches their expectation. Phase 2 wires `danteforge ascend --dim swe_bench`
into the actual bench runner so the autonomous loop can iterate against
real pass-rate deltas — not the harsh-scorer's generic `sweBench` proxy.
