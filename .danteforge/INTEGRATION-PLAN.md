# Integration Plan: Execution Quality Hot-Path Activation

**Goal:** Wire RetryDetector, VerificationGates, StatusTracker, and CleanStreamRenderer into live agent-loop.ts execution path

**Status:** All modules built and tested (136 tests passing). Integration pending.

**Estimated Time:** 2-3 hours total

---

## Architecture Overview

### Current State (Before Integration)

```
User Prompt → agent-loop.ts → Model → Tool Calls → Execute → Response
                                                    ↓
                                              [NO CHECKS]
                                              [NO VERIFICATION]
                                              [NO UX POLISH]
```

### Target State (After Integration)

```
User Prompt → agent-loop.ts → RetryDetector Check → Model → Tool Calls
                                     ↓                           ↓
                               [STUCK?] → Escalate      CleanStreamRenderer
                                     ↓                           ↓
                               [WARNING?] → Warn           Execute Tools
                                                               ↓
                                                    VerificationGates
                                                               ↓
                                                    [Files exist?]
                                                    [Build passes?]
                                                    [Tests pass?]
                                                               ↓
                                                        StatusTracker
                                                               ↓
                                                    [Evidence verified?]
                                                    [Progress accurate?]
                                                               ↓
                                                          Response
```

---

## Implementation Phases

### Phase 1: Import & Initialize [S] [P]

**Goal:** Add imports and initialize instances

**File:** `packages/cli/src/agent-loop.ts`

**Changes:**
```typescript
// ADD after line 36 (after core imports)
import { RetryDetector, VerificationGates, StatusTracker } from "@dantecode/core";
import type { RetryStatus, GateConfig, Evidence } from "@dantecode/core";

// ADD after line 51 (after StreamRenderer import)
import { ICONS } from "./ux/icons.js";
import { renderProgressBar } from "./ux/progress-bar.js";

// ADD inside runAgentLoop function (after line 260)
const retryDetector = new RetryDetector();
const verificationGates = new VerificationGates();
const statusTracker = new StatusTracker();
```

**Effort:** 30 minutes  
**Risk:** Low (pure additions)  
**Tests:** TypeScript compilation

---

### Phase 2: Retry Detection Hook [M]

**Goal:** Detect retry loops before tool execution

**File:** `packages/cli/src/agent-loop.ts`

**Location:** Inside main loop, before tool execution (around line 1500-1600)

**Changes:**
```typescript
// BEFORE: for (const toolCall of toolCalls) {
// ADD:
for (const toolCall of toolCalls) {
  // Check for retry loop
  const retryStatus = retryDetector.detectLoop(
    { name: toolCall.name, args: toolCall.args },
    lastError // Pass error from previous attempt if exists
  );
  
  if (retryStatus === 'STUCK') {
    logger.error('Retry loop detected - same operation failed 5+ times', {
      tool: toolCall.name,
      history: retryDetector.getHistory().slice(-5)
    });
    
    // Render escalation notice
    streamRenderer.renderEscalation(
      `Stuck on ${toolCall.name} - tried 5+ times with same error`
    );
    
    // Stop execution and escalate (use existing AskUserQuestion pattern)
    // OR break the loop
    break;
  }
  
  if (retryStatus === 'WARNING') {
    logger.warn('Retry warning - operation failed 3+ times', {
      tool: toolCall.name,
      count: retryDetector.getSimilarCount({ name: toolCall.name, args: toolCall.args })
    });
    
    streamRenderer.renderRetryWarning(3, 5);
  }
  
  // Continue with normal tool execution...
```

**Effort:** 1-1.5 hours  
**Risk:** Medium (modifies hot path)  
**Tests:** Unit test for retry detection, integration test for escalation

---

### Phase 3: Verification Gates Hook [M]

**Goal:** Validate success claims with evidence

**File:** `packages/cli/src/agent-loop.ts`

**Location:** After agent claims task complete (search for "complete|finished|done")

**Changes:**
```typescript
// FIND: Detection of completion claims (around line 1800-2000)
// ADD after detecting completion message:

// Check if agent claims phase/task is complete
if (assistantMessage.match(/phase.*complete|task.*complete|finished|done/i)) {
  // Extract claimed files from message
  const claimedFiles = extractClaimedFiles(assistantMessage);
  
  // Build gate configuration
  const gateConfig: GateConfig = {
    files: {
      requiredFiles: claimedFiles,
      basePath: process.cwd()
    }
  };
  
  // Add build gate if TypeScript/build-related
  if (claimedFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) {
    gateConfig.build = {
      command: 'npm',
      args: ['run', 'typecheck'],
      cwd: process.cwd()
    };
  }
  
  // Run verification
  const gateResult = await verificationGates.run(gateConfig);
  
  if (!gateResult.passed) {
    logger.warn('Verification gates failed', {
      level: gateResult.level,
      errors: gateResult.errors
    });
    
    // Render escalation
    streamRenderer.renderEscalation(
      `Verification failed: ${gateResult.errors.join(', ')}`
    );
    
    // Add verification failure to context
    // Ask agent to fix issues before claiming complete
    conversationHistory.push({
      role: 'user',
      content: `Verification failed:\n${gateResult.errors.join('\n')}\nPlease fix these issues before marking complete.`
    });
    
    // Continue loop (don't mark complete yet)
    continue;
  }
  
  // Gates passed - mark as verified complete
  logger.info('Verification gates passed', { level: gateResult.level });
}
```

**Effort:** 1.5 hours  
**Risk:** Medium (modifies completion detection)  
**Tests:** E2E test with fake "complete" claim, file missing scenario

---

### Phase 4: Status Tracker Integration [S]

**Goal:** Track progress with evidence

**File:** `packages/cli/src/agent-loop.ts`

**Location:** During phase/task management

**Changes:**
```typescript
// AFTER: Verification gates pass
// ADD:

// Mark phase complete with evidence
const evidence: Evidence = {
  filesCreated: claimedFiles,
  filesVerified: claimedFiles.filter(f => existsSync(resolve(process.cwd(), f))),
  buildPassed: gateResult.level >= 2,
  testsPassed: gateResult.level >= 3,
  timestamp: Date.now()
};

try {
  statusTracker.markPhaseComplete(currentPhaseName, evidence);
  
  // Render progress
  const progress = statusTracker.getActualProgress();
  streamRenderer.renderProgress(
    progress.completed,
    progress.total,
    'Overall Progress'
  );
} catch (error) {
  logger.error('Failed to mark phase complete', {
    phase: currentPhaseName,
    evidence,
    error: error.message
  });
}
```

**Effort:** 45 minutes  
**Risk:** Low (pure addition)  
**Tests:** Status tracking test

---

### Phase 5: Clean UX Renderer Integration [M]

**Goal:** Replace console.log with clean rendering

**File:** `packages/cli/src/agent-loop.ts`

**Location:** Throughout file (search for console.log)

**Changes:**
```typescript
// FIND: console.log calls (approximately 30-40 instances)
// REPLACE with appropriate streamRenderer calls:

// Tool execution start
- console.log(`Executing ${toolCall.name}...`);
+ streamRenderer.renderToolCall(toolCall);

// Phase transitions
- console.log(`Starting ${phaseName}...`);
+ streamRenderer.renderPhaseTransition(previousPhase, phaseName);

// Success messages
- console.log(`✅ ${message}`);
+ streamRenderer.renderSuccess(message);

// Error messages
- console.error(`Error: ${message}`);
+ streamRenderer.renderError(message);

// Warning messages
- console.warn(`Warning: ${message}`);
+ streamRenderer.renderWarning(message);

// Info messages
- console.log(message);
+ streamRenderer.renderInfo(message);
```

**Effort:** 1 hour (find and replace ~30-40 calls)  
**Risk:** Low (cosmetic changes)  
**Tests:** Visual inspection, integration tests

---

### Phase 6: E2E Integration Test [M]

**Goal:** Reproduce user's exact bug and verify fix

**File:** `packages/cli/src/e2e-execution-quality.test.ts` (NEW)

**Implementation:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAgentLoop } from './agent-loop.js';

describe('E2E: Execution Quality Fixes', () => {
  it('should detect and escalate retry loop (drizzle-kit scenario)', async () => {
    // Mock tool execution to fail 5x with same error
    const mockExecute = vi.fn()
      .mockRejectedValue(new Error('ENOENT: drizzle-kit not found'));
    
    // Run agent loop with mocked tools
    const result = await runAgentLoop({
      userPrompt: 'Set up database with drizzle-kit',
      mockTools: { Bash: mockExecute }
    });
    
    // Expectations:
    // 1. RetryDetector should detect STUCK status after 5 attempts
    expect(mockExecute).toHaveBeenCalledTimes(5);
    expect(result.status).toBe('STUCK');
    expect(result.escalated).toBe(true);
    
    // 2. Clean UX output (no JSON dumps)
    expect(result.output).not.toContain('"content":');
    expect(result.output).toContain('⚠️'); // Escalation icon
    
    // 3. Honest progress (0% not 100%)
    expect(result.progress.percent).toBe(0);
  });
  
  it('should block false completion claims', async () => {
    // Mock agent claiming "Database setup complete!"
    const mockGenerate = vi.fn()
      .mockResolvedValue({ text: 'Database setup complete! dev.db created.' });
    
    // But dev.db doesn't exist
    const result = await runAgentLoop({
      userPrompt: 'Set up database',
      mockGenerate,
      filesExist: [] // No files actually exist
    });
    
    // Expectations:
    // 1. VerificationGates should catch missing file
    expect(result.verificationFailed).toBe(true);
    expect(result.errors).toContain('dev.db');
    
    // 2. StatusTracker should NOT mark complete
    expect(result.phaseComplete).toBe(false);
    expect(result.progress.percent).toBe(0);
    
    // 3. Agent asked to fix
    expect(result.followUpPrompt).toContain('Verification failed');
  });
  
  it('should report accurate progress', async () => {
    // Set up 8 phases, complete only 1
    const result = await runAgentLoop({
      userPrompt: 'Multi-phase task',
      phases: ['setup', 'build', 'test', 'deploy', 'verify', 'document', 'optimize', 'ship'],
      completePhases: ['setup'] // Only first phase completes
    });
    
    // Expectations:
    // 1. Progress should be 1/8 = 12.5% ≈ 12%
    expect(result.progress.percent).toBeGreaterThanOrEqual(10);
    expect(result.progress.percent).toBeLessThanOrEqual(15);
    expect(result.progress.completed).toBe(1);
    expect(result.progress.total).toBe(8);
  });
});
```

**Effort:** 1 hour  
**Risk:** Low (test-only)  
**Tests:** 3 E2E scenarios

---

### Phase 7: Integration Verification [S]

**Goal:** Verify no regressions, all tests pass

**Tasks:**
1. Run full test suite: `npm test`
2. Run typecheck: `npm run typecheck`
3. Run build: `npm run build`
4. Manual smoke test: Run agent-loop with sample prompt
5. Verify output is clean (icons, progress bars)
6. Verify retry detection works
7. Verify verification gates work

**Effort:** 30 minutes  
**Risk:** Low  
**Tests:** Full suite

---

## Dependency Order

```
Phase 1 (Import) → Phase 2 (Retry) → Phase 5 (UX) → Phase 7 (Verify)
                ↘                   ↗
                  Phase 3 (Verification) → Phase 4 (Status) → Phase 6 (E2E)
```

**Parallelizable:**
- Phases 2, 3, 4, 5 can be worked on simultaneously (different code sections)
- Phase 6 (E2E test) can be written in parallel

**Sequential Dependencies:**
- Phase 1 must complete first (imports)
- Phase 7 must be last (verification)

---

## Risk Mitigation

### Risk 1: Breaking Existing Flow
**Mitigation:** 
- Add new code as pure additions first
- Use feature flags for gradual rollout
- Keep backup of agent-loop.ts before changes

### Risk 2: Performance Impact
**Mitigation:**
- RetryDetector: O(10) history check (constant time)
- VerificationGates: Short-circuit on first failure
- StatusTracker: In-memory Map (fast)
- Total overhead: <10ms per operation

### Risk 3: Test Failures
**Mitigation:**
- Update existing tests to expect new behavior
- Add mocking for new dependencies
- Comprehensive E2E tests

### Risk 4: UX Regression
**Mitigation:**
- Preserve --verbose flag for debugging
- Add --silent flag for tests
- Visual inspection before merge

---

## File Change Map

```
packages/cli/src/
├── agent-loop.ts                    [MAJOR MODIFY] +150 lines
│   ├── Add imports (Phase 1)
│   ├── Initialize instances (Phase 1)
│   ├── Retry detection hook (Phase 2)
│   ├── Verification gates hook (Phase 3)
│   ├── Status tracker integration (Phase 4)
│   └── UX renderer calls (Phase 5)
│
├── e2e-execution-quality.test.ts    [NEW] 200 lines
│   ├── Retry loop test
│   ├── False completion test
│   └── Accurate progress test
│
└── agent-loop.test.ts               [MODIFY] Update mocks

packages/core/src/
└── (No changes - modules already exported)

packages/cli/src/ux/
└── (No changes - already created)
```

---

## Success Criteria

- [ ] RetryDetector active in hot path
- [ ] VerificationGates validate all completions
- [ ] StatusTracker tracks all phases
- [ ] CleanStreamRenderer used for all output
- [ ] E2E tests pass (3 scenarios)
- [ ] Full test suite passes (all existing + new)
- [ ] No TypeScript errors
- [ ] Build succeeds
- [ ] Manual smoke test succeeds
- [ ] Visual inspection confirms clean UX

---

## Rollout Strategy

1. **Dev Branch:** Implement all changes on `feat/execution-quality-integration`
2. **Testing:** Run full suite + E2E tests
3. **Review:** Code review (optional: use /review skill)
4. **Merge:** Merge to `feat/all-nines` after approval
5. **Validation:** Run load tests, verify no regressions
6. **Deploy:** Ready for production use

---

## Effort Summary

| Phase | Effort | Duration |
|-------|--------|----------|
| 1. Import & Initialize | S | 30 min |
| 2. Retry Detection | M | 1-1.5 hours |
| 3. Verification Gates | M | 1.5 hours |
| 4. Status Tracker | S | 45 min |
| 5. UX Renderer | M | 1 hour |
| 6. E2E Tests | M | 1 hour |
| 7. Verification | S | 30 min |

**Total:** 6-7 hours (with parallelization: 2-3 hours)

---

## Next Steps

1. **Create branch:** `git checkout -b feat/execution-quality-integration`
2. **Run `/tasks`** to break this plan into executable units
3. **Execute phases** (can parallelize 2-5)
4. **Run E2E tests** to validate
5. **Merge and ship** 🚀

**Alternative:** Use `/inferno` to execute all phases in parallel with autonomous agents

---

**Saved to:** `.danteforge/INTEGRATION-PLAN.md`
