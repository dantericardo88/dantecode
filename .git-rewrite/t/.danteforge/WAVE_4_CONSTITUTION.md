# Wave 4 Constitution: Quality & Hygiene (FINAL WAVE)

**Status:** Active
**Date:** 2026-03-28
**Gaps Addressed:** A7 (Aider-grade repair loop), A8 (Contract and hygiene sync)

---

## Core Principles

### 1. Repair Before Success
- No "COMPLETE" status until code passes all gates
- Lint → Test → Verify (in that order)
- Auto-fix what can be auto-fixed
- Ask operator for what cannot

### 2. Truth Must Be Fresh
- Readiness artifacts generated same-commit as code
- Stale artifacts flagged automatically
- No claims without current evidence

### 3. Contracts Must Sync
- Code changes invalidate old contracts
- Documentation reflects current implementation
- Test expectations match actual behavior

### 4. Quality Gates Are Mandatory
- Lint errors block completion
- Test failures block completion
- PDSE failures block completion
- All three must pass, no shortcuts

### 5. Rollback Beats Broken Code
- Failed repairs rollback to clean snapshot
- Partial success reported honestly
- Operator decides: accept partial or retry

---

## Pattern Sources

### Aider (Repair Loop)
- `base_coder.py` repair sequence
- Lint edited files first
- Auto-commit lint fixes
- Feed errors back to model for fixes
- Max 3 iterations per stage
- Test after lint passes

**What we adopt:** Lint → Test → Fix loop with iteration limits and auto-commit

### DanteCode Native (Verification)
- PDSE scoring after repairs
- Anti-stub detection
- Evidence chain sealing
- Receipt generation
- Same-commit freshness

**What we adopt:** DanteForge as final gate, same-commit validation

---

## Success Criteria

| Metric | Target | Validation |
|--------|--------|------------|
| Auto-repair success rate | >60% | Manual review of 100 repair attempts |
| Lint error detection | 100% | Synthetic errors in test suite |
| Test failure detection | 100% | Inject failing tests |
| Rollback reliability | 100% | Snapshot → mutate → rollback verification |
| Same-commit freshness | 100% | Artifact timestamp matches git HEAD |
| Doc-code drift detection | >90% | Compare docstrings vs implementations |

---

## Architecture Constraints

### Repair Loop Flow
```
1. Git Snapshot (stash create)
2. Apply mutations
3. Run lint on changed files
4. IF lint errors:
   a. Auto-commit lint fixes (if available)
   b. Feed errors to model
   c. Model attempts fix (max 3 iterations)
5. Run tests
6. IF test failures:
   a. Feed failures to model
   b. Model attempts fix (max 3 iterations)
7. Run DanteForge verification (PDSE + anti-stub)
8. IF all pass: COMPLETE
9. IF any exhausted: PARTIAL + rollback option
```

### Configuration Schema
```yaml
repairLoop:
  enabled: true
  lintCommand: "npm run lint -- --fix"
  testCommand: "npm test"
  maxLintRetries: 3
  maxTestRetries: 3
  autoCommitLintFixes: true
  pdseThreshold: 70
```

### Same-Commit Freshness
- Readiness artifacts MUST include `gitCommit` field
- On load: compare `artifact.gitCommit` vs `git rev-parse HEAD`
- If mismatch: flag as STALE with warning
- CI must regenerate artifacts on every commit

### Doc-Code Drift Detection
```typescript
interface DriftCheck {
  file: string;
  codeSignature: string;    // Function/class signatures from AST
  docSignature: string;     // Documented API from docstrings/README
  driftDetected: boolean;
  driftReason?: string;     // "parameter count mismatch", etc.
}
```

---

## Non-Goals for Wave 4

- ❌ Custom lint rule authoring (use existing linters)
- ❌ Test generation (use existing test frameworks)
- ❌ Doc generation (detect drift, don't auto-write docs)
- ❌ Performance profiling (quality only, not performance)
- ❌ Security scanning (separate concern)

---

## Dependencies

- ✅ Wave 1 complete (mode enforcement, permission engine)
- ✅ Wave 2 complete (event store, checkpoints, snapshots)
- ✅ Wave 3 complete (repo map, context, skills)
- ✅ `@dantecode/danteforge` exists (PDSE scorer)
- ✅ `GitSnapshotRecovery` exists in git-engine
- ✅ Lint/test commands configurable in STATE.yaml

---

## Risk Mitigation

### Risk: Infinite repair loops
**Mitigation:** Hard caps at 3 iterations per stage. Exhaustion triggers rollback + PARTIAL report.

### Risk: Lint fixes break functionality
**Mitigation:** Auto-commits are separate. Rollback discards both mutations and lint fixes if tests fail.

### Risk: Test failures unrelated to changes
**Mitigation:** Run tests before mutations (baseline). Only repair new failures.

### Risk: PDSE false positives
**Mitigation:** Threshold configurable (default: 70). Operator can override.

### Risk: Same-commit check breaks CI
**Mitigation:** CI regenerates artifacts automatically. Local dev can use `--skip-freshness-check`.

---

## Event Kinds (from Wave 2)

Already defined:
- `run.repair.lint.started`
- `run.repair.lint.completed`
- `run.repair.test.started`
- `run.repair.test.completed`
- `run.report.written`

No new event kinds needed for Wave 4.

---

**Status:** Ready for implementation
**Next Action:** Break into executable tasks

**THIS IS THE FINAL WAVE OF PHASE A**
