# Execution And Benchmark Contract

## Goal

Keep DanteCode benchmark-safe and execution-safe by treating the shared execution policy and green proof gates as the only source of truth.

## Canonical Ownership

- `packages/core/src/execution-policy.ts` owns execution decisions.
- CLI and VS Code must delegate retry, no-tool nudges, confab blocking, and completion gating to that engine.
- Surface code may render or transport events differently, but it must not re-implement execution heuristics locally.

## Benchmark Runtime Contract

- Benchmark runs use `--execution-profile benchmark`.
- Benchmark profile is explicit runtime configuration, not prompt steering.
- Benchmark profile must remain:
  - non-interactive
  - fail-closed for workflow completion
  - safe against tool-approval hangs
  - deterministic enough for smoke and dry-run validation

## What Counts As Proof

Status markdown files are summaries, not acceptance criteria.

The required proof commands are:

```bash
npm run check:execution-quality
npm run check:benchmark-readiness
```

`check:execution-quality` proves:

- shared-engine typecheck
- CLI typecheck
- VS Code typecheck
- focused hot-path execution regressions
- the CLI agent-loop smoke suite that exercises the live execution path

`check:benchmark-readiness` proves:

- root build and typecheck
- execution-quality gate
- SWE-bench runner smoke
- SWE-bench dry-run coverage tests
- SWE-bench dry-run invocation with benchmark profile

## Benchmark Pass Semantics

The benchmark runner must not report success on test pass alone.

A run only counts as a true pass when:

- the repo tests pass, and
- verified writes exist beyond the applied SWE-bench test patch baseline

`verified_write_count` and `verified_write_paths` must be persisted into the structured benchmark result so post-run analysis can audit whether the pass was real.

If tests pass but no verified writes are detected, the run is classified as a verification failure.

## Failure Labels

Benchmark reporting should collapse failures into stable categories:

- `cli_crash`
- `tool_execution_failure`
- `verification_failure`
- `benchmark_task_failure`

These labels are for benchmark analysis and regression triage, not for hiding lower-level detail.
