# Wave 4 Implementation Plan: Quality & Hygiene (FINAL WAVE)

**Status:** Planning
**Date:** 2026-03-28
**Estimated Duration:** 2 weeks (12 working days)
**Gaps Closed:** A7 + A8 (COMPLETES PHASE A)

---

## Task Breakdown

### Task 4.1: Post-Apply Lint Repair Loop (P0 - 3 days)

**Objective:** Auto-fix lint errors after code mutations

**Pattern source:** Aider `base_coder.py` lint repair sequence

**Implementation:**

1. Create `packages/core/src/repair-loop/lint-repair.ts`:
```typescript
export interface LintConfig {
  command: string;              // e.g., "npm run lint -- --fix"
  maxRetries: number;           // default: 3
  autoCommitFixes: boolean;     // default: true
}

export interface LintResult {
  success: boolean;
  errors: LintError[];
  fixesApplied: boolean;
  autoCommitHash?: string;      // Git commit of auto-fixes
}

export interface LintError {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export async function runLintRepair(
  changedFiles: string[],
  config: LintConfig,
  projectRoot: string,
  eventEngine?: EventEngine
): Promise<LintResult> {
  // 1. Run lint command on changed files
  // 2. Parse lint output (support ESLint, Prettier, TSC formats)
  // 3. If auto-fix available: run "lint --fix", commit changes
  // 4. If errors remain: return for model to fix
  // 5. Emit repair.lint.started/completed events
}
```

2. Lint output parsers:
```typescript
export function parseESLintOutput(output: string): LintError[];
export function parsePrettierOutput(output: string): LintError[];
export function parseTSCOutput(output: string): LintError[];
```

3. Wire into agent-loop.ts:
```typescript
// After apply round with file mutations
if (mutatedFiles.length > 0) {
  const lintConfig = config.repairLoop?.lint;
  if (lintConfig?.enabled) {
    const lintResult = await runLintRepair(mutatedFiles, lintConfig, projectRoot, eventEngine);

    if (!lintResult.success && lintResult.errors.length > 0) {
      // Feed lint errors back to model
      const lintFeedback = formatLintErrors(lintResult.errors);
      messages.push({
        role: 'user',
        content: `Lint errors detected:\n${lintFeedback}\nPlease fix these errors.`
      });
      // Retry loop (max 3 iterations)
      for (let i = 0; i < lintConfig.maxRetries; i++) {
        // ... model attempts fix
      }
    }
  }
}
```

4. Write 35 tests:
   - Lint execution (8 tests)
   - Output parsing (ESLint, Prettier, TSC) (12 tests)
   - Auto-fix + commit (6 tests)
   - Retry logic (5 tests)
   - Error formatting (4 tests)

**Files created:**
- `packages/core/src/repair-loop/lint-repair.ts`
- `packages/core/src/repair-loop/lint-repair.test.ts`
- `packages/core/src/repair-loop/lint-parsers.ts`
- `packages/core/src/repair-loop/lint-parsers.test.ts`

**Files modified:**
- `packages/cli/src/agent-loop.ts`
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 35/35 tests passing
- Auto-fix success rate >60%
- Lint errors block completion
- Max 3 retry iterations enforced

---

### Task 4.2: Post-Apply Test Repair Loop (P0 - 3 days)

**Objective:** Auto-fix test failures after code changes

**Pattern source:** Aider `base_coder.py` test repair sequence

**Implementation:**

1. Create `packages/core/src/repair-loop/test-repair.ts`:
```typescript
export interface TestConfig {
  command: string;              // e.g., "npm test"
  maxRetries: number;           // default: 3
  runBeforeMutations: boolean;  // baseline test run, default: true
}

export interface TestResult {
  success: boolean;
  failures: TestFailure[];
  baselineFailures?: TestFailure[]; // Failures before mutations
  newFailures: TestFailure[];       // New failures introduced
}

export interface TestFailure {
  testFile: string;
  testName: string;
  error: string;
  stackTrace?: string;
}

export async function runTestRepair(
  config: TestConfig,
  projectRoot: string,
  eventEngine?: EventEngine
): Promise<TestResult> {
  // 1. Run baseline tests (if configured)
  // 2. Run tests after mutations
  // 3. Compare: only repair NEW failures
  // 4. Feed failures to model for fixes
  // 5. Retry with max iterations
  // 6. Emit repair.test.started/completed events
}
```

2. Test output parsers:
```typescript
export function parseVitestOutput(output: string): TestFailure[];
export function parseJestOutput(output: string): TestFailure[];
export function parsePytestOutput(output: string): TestFailure[];
export function parseGoTestOutput(output: string): TestFailure[];
```

3. Wire into agent-loop.ts (after lint repair):
```typescript
// After lint repair passes or no lint config
const testConfig = config.repairLoop?.test;
if (testConfig?.enabled) {
  const testResult = await runTestRepair(testConfig, projectRoot, eventEngine);

  if (!testResult.success && testResult.newFailures.length > 0) {
    // Feed test failures back to model
    const testFeedback = formatTestFailures(testResult.newFailures);
    messages.push({
      role: 'user',
      content: `Test failures detected:\n${testFeedback}\nPlease fix these failures.`
    });
    // Retry loop (max 3 iterations)
  }
}
```

4. Write 40 tests:
   - Test execution (8 tests)
   - Output parsing (Vitest, Jest, Pytest, Go) (16 tests)
   - Baseline comparison (8 tests)
   - Retry logic (4 tests)
   - Error formatting (4 tests)

**Files created:**
- `packages/core/src/repair-loop/test-repair.ts`
- `packages/core/src/repair-loop/test-repair.test.ts`
- `packages/core/src/repair-loop/test-parsers.ts`
- `packages/core/src/repair-loop/test-parsers.test.ts`

**Files modified:**
- `packages/cli/src/agent-loop.ts`
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 40/40 tests passing
- Baseline comparison prevents false positives
- Test failures block completion
- Max 3 retry iterations enforced

---

### Task 4.3: DanteForge Final Gate (P0 - 2 days)

**Objective:** Run PDSE + anti-stub verification after repairs pass

**Pattern source:** DanteCode native (existing DanteForge integration)

**Implementation:**

1. Create `packages/core/src/repair-loop/final-gate.ts`:
```typescript
export interface FinalGateConfig {
  enabled: boolean;
  pdseThreshold: number;        // default: 70
  requireAntiStub: boolean;     // default: true
  requireEvidence: boolean;     // default: false (Wave 2 Evidence Chain)
}

export interface FinalGateResult {
  passed: boolean;
  pdseScore?: number;
  pdseDetails?: any;            // Per-dimension scores from DanteForge
  antiStubViolations: string[];
  evidenceChain?: string;       // Evidence bundle ID
  timestamp: string;
}

export async function runFinalGate(
  mutatedFiles: string[],
  config: FinalGateConfig,
  projectRoot: string,
  eventEngine?: EventEngine
): Promise<FinalGateResult> {
  // 1. Dynamic import @dantecode/danteforge
  // 2. Run PDSE scoring on mutated files
  // 3. Run anti-stub detection
  // 4. Optionally seal evidence chain
  // 5. Emit run.verification.completed event
  // 6. Return pass/fail with details
}
```

2. Wire into agent-loop.ts (after test repair):
```typescript
// After lint + test repairs pass
const gateConfig = config.repairLoop?.finalGate;
if (gateConfig?.enabled) {
  const gateResult = await runFinalGate(mutatedFiles, gateConfig, projectRoot, eventEngine);

  if (!gateResult.passed) {
    if (gateResult.pdseScore && gateResult.pdseScore < gateConfig.pdseThreshold) {
      logger.warn(`PDSE score ${gateResult.pdseScore} below threshold ${gateConfig.pdseThreshold}`);
      // Show per-dimension failures if available
    }
    if (gateResult.antiStubViolations.length > 0) {
      logger.error(`Anti-stub violations: ${gateResult.antiStubViolations.join(', ')}`);
    }
    // Mark as PARTIAL, offer rollback
  }
}
```

3. Extend run-report.ts:
```typescript
export interface RunReport {
  // ... existing fields
  repairSummary?: {
    lintAttempts: number;
    testAttempts: number;
    finalGatePassed: boolean;
    pdseScore?: number;
    rollbackOffered: boolean;
  };
}
```

4. Write 25 tests:
   - PDSE scoring integration (8 tests)
   - Anti-stub detection (6 tests)
   - Threshold enforcement (5 tests)
   - Evidence chain sealing (3 tests)
   - Run report integration (3 tests)

**Files created:**
- `packages/core/src/repair-loop/final-gate.ts`
- `packages/core/src/repair-loop/final-gate.test.ts`

**Files modified:**
- `packages/cli/src/agent-loop.ts`
- `packages/core/src/run-report.ts`
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 25/25 tests passing
- PDSE threshold enforced
- Anti-stub violations block completion
- Run report includes repair summary

---

### Task 4.4: Same-Commit Readiness Guard (P1 - 2 days)

**Objective:** Validate readiness artifacts are fresh (same commit as code)

**Pattern source:** DanteCode native (release-doctor.mjs pattern)

**Implementation:**

1. Create `packages/core/src/readiness/freshness-guard.ts`:
```typescript
export interface ReadinessArtifact {
  name: string;
  path: string;
  gitCommit: string;
  timestamp: string;
  stale: boolean;
  staleDuration?: string;
}

export async function checkReadinessFreshness(
  artifactPaths: string[],
  projectRoot: string
): Promise<ReadinessArtifact[]> {
  const currentCommit = execSync('git rev-parse HEAD', { cwd: projectRoot }).toString().trim();

  const artifacts: ReadinessArtifact[] = [];
  for (const path of artifactPaths) {
    const content = await fs.readFile(path, 'utf-8');
    const artifact = JSON.parse(content);

    const stale = artifact.gitCommit !== currentCommit;
    artifacts.push({
      name: path.split('/').pop()!,
      path,
      gitCommit: artifact.gitCommit,
      timestamp: artifact.timestamp,
      stale,
      staleDuration: stale ? calculateDuration(artifact.timestamp) : undefined
    });
  }

  return artifacts;
}

export function warnStaleArtifacts(artifacts: ReadinessArtifact[]): void {
  const stale = artifacts.filter(a => a.stale);
  if (stale.length > 0) {
    console.warn(`⚠️  ${stale.length} readiness artifacts are STALE:`);
    stale.forEach(a => {
      console.warn(`   - ${a.name}: commit ${a.gitCommit.slice(0, 7)} (${a.staleDuration} old)`);
    });
    console.warn(`   Current commit: ${artifacts[0]?.gitCommit?.slice(0, 7) ?? 'unknown'}`);
    console.warn(`   Run: npm run generate-readiness`);
  }
}
```

2. Wire into release scripts:
```typescript
// In scripts/release-doctor.mjs
import { checkReadinessFreshness, warnStaleArtifacts } from '../packages/core/src/readiness/freshness-guard.js';

const artifacts = await checkReadinessFreshness([
  'artifacts/readiness/current-readiness.json',
  'artifacts/readiness/quickstart-proof.json',
  'artifacts/readiness/release-doctor.json'
], process.cwd());

warnStaleArtifacts(artifacts);

// Fail CI if stale in production
if (process.env.CI && artifacts.some(a => a.stale)) {
  console.error('❌ Stale readiness artifacts detected in CI');
  process.exit(1);
}
```

3. Add to readiness artifacts:
```json
{
  "gitCommit": "abc123...",
  "timestamp": "2026-03-28T12:00:00Z",
  // ... rest of artifact
}
```

4. Write 20 tests:
   - Freshness detection (8 tests)
   - Stale artifact warnings (5 tests)
   - CI enforcement (4 tests)
   - Duration formatting (3 tests)

**Files created:**
- `packages/core/src/readiness/freshness-guard.ts`
- `packages/core/src/readiness/freshness-guard.test.ts`

**Files modified:**
- `scripts/release-doctor.mjs`
- `scripts/release/generate-readiness.mjs`
- `artifacts/readiness/*.json` (add gitCommit field)
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 20/20 tests passing
- Stale artifacts detected correctly
- CI fails on stale artifacts
- Warnings show helpful guidance

---

### Task 4.5: Doc-Code Drift Detection (P1 - 2 days)

**Objective:** Detect when documentation diverges from implementation

**Pattern source:** DanteCode native (inspired by contract testing)

**Implementation:**

1. Create `packages/core/src/drift/doc-code-drift.ts`:
```typescript
export interface DriftCheck {
  file: string;
  type: 'function' | 'class' | 'interface' | 'type';
  name: string;
  codeSignature: string;
  docSignature: string;
  driftDetected: boolean;
  driftReason?: string;
}

export async function detectDrift(
  sourceFiles: string[],
  projectRoot: string
): Promise<DriftCheck[]> {
  const checks: DriftCheck[] = [];

  for (const file of sourceFiles) {
    const source = await fs.readFile(path.join(projectRoot, file), 'utf-8');

    // Extract code signatures via tree-sitter (use parsers from Wave 3)
    const codeSymbols = extractSymbols(source, file);

    // Extract doc signatures via JSDoc/TSDoc/docstring parsing
    const docSymbols = extractDocSignatures(source);

    // Compare
    for (const codeSymbol of codeSymbols) {
      const docSymbol = docSymbols.find(d => d.name === codeSymbol.name);

      if (!docSymbol) {
        // Undocumented (not drift, just missing docs)
        continue;
      }

      const drift = compareSignatures(codeSymbol, docSymbol);
      if (drift.detected) {
        checks.push({
          file,
          type: codeSymbol.type,
          name: codeSymbol.name,
          codeSignature: codeSymbol.signature,
          docSignature: docSymbol.signature,
          driftDetected: true,
          driftReason: drift.reason
        });
      }
    }
  }

  return checks;
}

function compareSignatures(
  code: Symbol,
  doc: DocSymbol
): { detected: boolean; reason?: string } {
  // Check parameter count
  if (code.params.length !== doc.params.length) {
    return { detected: true, reason: 'parameter count mismatch' };
  }

  // Check parameter names
  for (let i = 0; i < code.params.length; i++) {
    if (code.params[i].name !== doc.params[i].name) {
      return { detected: true, reason: `parameter name mismatch: ${code.params[i].name} vs ${doc.params[i].name}` };
    }
  }

  // Check return type (if documented)
  if (doc.returnType && code.returnType !== doc.returnType) {
    return { detected: true, reason: 'return type mismatch' };
  }

  return { detected: false };
}
```

2. Add CLI command `/drift`:
```typescript
// In slash-commands.ts
async function driftCommand(replState: ReplState): Promise<void> {
  const sourceFiles = await glob('**/*.ts', { ignore: ['**/node_modules/**', '**/dist/**'] });
  const checks = await detectDrift(sourceFiles, projectRoot);

  const drifted = checks.filter(c => c.driftDetected);
  if (drifted.length === 0) {
    console.log('✅ No doc-code drift detected');
  } else {
    console.log(`⚠️  ${drifted.length} drift issues detected:`);
    drifted.forEach(check => {
      console.log(`   ${check.file}:${check.name}`);
      console.log(`      Code: ${check.codeSignature}`);
      console.log(`      Docs: ${check.docSignature}`);
      console.log(`      Issue: ${check.driftReason}`);
    });
  }
}
```

3. Wire into repair loop (optional warning, not blocking):
```typescript
// After final gate passes
if (config.repairLoop?.detectDrift) {
  const driftChecks = await detectDrift(mutatedFiles, projectRoot);
  const drifted = driftChecks.filter(c => c.driftDetected);
  if (drifted.length > 0) {
    logger.warn(`⚠️  ${drifted.length} doc-code drift issues detected (see /drift for details)`);
  }
}
```

4. Write 25 tests:
   - Signature extraction (code) (8 tests)
   - Signature extraction (docs) (7 tests)
   - Drift detection (6 tests)
   - CLI command (4 tests)

**Files created:**
- `packages/core/src/drift/doc-code-drift.ts`
- `packages/core/src/drift/doc-code-drift.test.ts`

**Files modified:**
- `packages/cli/src/slash-commands.ts`
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 25/25 tests passing
- Drift detection >90% accurate
- CLI command shows actionable output
- Optional integration (warning only)

---

## Test Plan

### Unit Tests
- Lint repair: 35 tests
- Test repair: 40 tests
- Final gate: 25 tests
- Freshness guard: 20 tests
- Doc-code drift: 25 tests

**Total new tests: 145**

### Integration Tests
- End-to-end repair loop (lint → test → verify) (5 tests)
- Rollback on exhaustion (3 tests)
- Same-commit enforcement in CI (2 tests)

**Total integration tests: 10**

**Total Wave 4 tests: 155**

### Manual Validation
- [ ] Introduce lint errors, verify auto-fix + commit
- [ ] Introduce test failures, verify repair iterations
- [ ] Fail PDSE threshold, verify rollback offered
- [ ] Commit code without regenerating artifacts, verify stale warning
- [ ] Change function signature, verify drift detection

---

## Success Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Auto-repair success | >60% | 100 repair attempts |
| Lint error detection | 100% | Synthetic error injection |
| Test failure detection | 100% | Synthetic test failures |
| Rollback reliability | 100% | Snapshot restore tests |
| Same-commit freshness | 100% | Artifact validation |
| Doc-code drift | >90% | Manual signature review |

---

## Critical Files

### New Files (10)
- `packages/core/src/repair-loop/lint-repair.ts`
- `packages/core/src/repair-loop/lint-repair.test.ts`
- `packages/core/src/repair-loop/lint-parsers.ts`
- `packages/core/src/repair-loop/test-repair.ts`
- `packages/core/src/repair-loop/test-repair.test.ts`
- `packages/core/src/repair-loop/test-parsers.ts`
- `packages/core/src/repair-loop/final-gate.ts`
- `packages/core/src/readiness/freshness-guard.ts`
- `packages/core/src/drift/doc-code-drift.ts`
- Plus 5 test files

### Modified Files (5)
- `packages/cli/src/agent-loop.ts` (integrate repair loop)
- `packages/core/src/run-report.ts` (repair summary)
- `packages/cli/src/slash-commands.ts` (/drift command)
- `scripts/release-doctor.mjs` (freshness check)
- `scripts/release/generate-readiness.mjs` (add gitCommit)

**Total files: 15 (10 new + 5 modified)**

---

## Dependencies

- ✅ Wave 1 complete (mode enforcement)
- ✅ Wave 2 complete (events, checkpoints, snapshots)
- ✅ Wave 3 complete (tree-sitter parsers for drift detection)
- ✅ `@dantecode/danteforge` exists (PDSE scoring)
- ✅ `GitSnapshotRecovery` exists
- ✅ STATE.yaml configuration system exists

---

## Risk Mitigation

### Risk: Repair loops never converge
**Mitigation:** Hard iteration caps (3 per stage). Exhaustion triggers rollback.

### Risk: Lint fixes break tests
**Mitigation:** Test after lint. Rollback discards both if tests fail.

### Risk: CI blocked by stale artifacts
**Mitigation:** Auto-regenerate in CI pipeline (npm run generate-readiness).

### Risk: Drift detection false positives
**Mitigation:** Manual review of drift reports. Warning only, not blocking.

---

**Status:** Ready for task breakdown
**Next Action:** Create WAVE_4_TASKS.md and begin implementation

**THIS COMPLETES PHASE A OF THE BLADE MASTER PLAN**
