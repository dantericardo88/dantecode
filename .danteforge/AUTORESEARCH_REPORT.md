# AutoResearch Report: Dim 5 + Dim 15 Competitor Analysis
**Date:** 2026-04-22 | **Branch:** dad-ready

## Key Finding
DanteCode has built all the infrastructure but **the verify-repair loop is orphaned from the main agent path**. This is why Dim 5 (correctness) and Dim 15 (autonomy) are stuck at 6-8 instead of 9+.

## Top 3 Wiring Targets

| Target | Dim Impact | Difficulty | Action |
|--------|-----------|-----------|--------|
| 1. Wire AutonomyOrchestrator verify-repair loop | Dim15 +2, Dim5 +1 | Medium | Wrap wave result with test-driven continuation |
| 2. Finish-rate-driven per-task budgets | Dim5+1, Dim15+1 | Low | Query finish-rate-log to set maxVerifyRetries |
| 3. Proof surfacing + stop gate | Dim5+1, Dim15+1 | Low | Surface test pass/fail proof before final response |

## Gap Matrix

| Behavior | Frontier Does | DanteCode Does | Gap |
|----------|--------------|----------------|-----|
| Verify-repair loop | Test output → inject fail → loop | Built in AutonomyOrchestrator; never called | Loop dormant in production |
| Stop condition | Test pass OR max rounds | Max rounds only; no test signal | Infinite loop risk |
| Proof surfacing | Visible test output + pass count | Logged only; confidence hidden | User must inspect logs |
| Task triage | Hard→more rounds | Classify only; no routing | Easy + hard use same budget |
| Completion gate | Test=oracle | Prompt-state=oracle (faulty) | No formal completion proof |

## Implementation Spec: Target 1 (Verify-Repair Loop)

**New file:** `packages/cli/src/verify-loop-driver.ts`
- `runWaveWithVerify(verifyFn, roundsUsed, maxRounds)` → returns `{success, shouldContinue, output}`

**Injection in agent-loop.ts ~line 1900:**
- After wave generation, call `runWaveWithVerify`
- If `shouldContinue`: inject test output as `## Test Output` system message, continue loop
- If not: surface proof, proceed to response formatting

**Implementation Spec: Target 2 (Budget Routing)**

After `classifyRequest` (~line 1608):
```ts
const taskDifficulty = classifyTaskDifficulty(prompt, estFileCount);
const finishStats = getFinishRateStats(loadFinishRates(projectRoot));
if (taskDifficulty === "hard") {
  maxVerifyRetries = finishStats.hardTaskFinishRate < 0.6 ? 4 : 3;
} else { maxVerifyRetries = 2; }
```

## Orphaned Module Status

| Function | Wired? | Note |
|----------|--------|------|
| detectTaskAmbiguity | ✓ YES | Line 1438 |
| computeMemoryDecisionInfluence | ✓ YES | Line 3602 |
| rankContextChunks | ✗ NO | Test only |
| verifyStepCompletion | ✗ NO | Test only |
| buildInlineEditQualityReport | ✗ NO | Test only |

Focus on loop wiring (Targets 1-3), not on new logging modules.
