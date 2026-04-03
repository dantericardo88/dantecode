# SWE-bench Baseline Decision Tree

**Purpose:** This document guides next steps based on 10-instance baseline results.

---

## Scenario 1: EXCELLENT (80%+ pass rate, 8-10/10 passing)

**Assessment:** Outstanding! Ready for immediate scale testing.

**Next Steps:**
1. ✅ Celebrate the success
2. Run 50-instance validation immediately:
   ```powershell
   .\RUN_BENCHMARK.ps1 -Limit 50
   ```
3. Expected results:
   - Cost: ~$0.08 (Grok-3)
   - Time: ~4-6 hours
   - Pass rate: 75-85% (consistent with baseline)
   - Score projection: 9.5-9.8/10

**Risks:** None significant. This outcome validates all work done.

**Budget:** $0.08 for full validation

**Timeline:** Run tonight, results by morning

---

## Scenario 2: GOOD (60-80% pass rate, 6-8/10 passing)

**Assessment:** Competitive with SOTA! Close to target.

**Next Steps:**
1. Analyze failure patterns:
   ```powershell
   .\analyze_baseline.ps1
   ```
2. Identify quick wins (1-2 hour fixes)
3. Consider two paths:

   **Path A: Scale Now (Recommended)**
   - Proceed to 50-instance validation as-is
   - Cost: ~$0.08
   - Expected score: 9.2-9.5/10
   - Rationale: 60-80% is already competitive

   **Path B: Optimize First**
   - Implement token optimization (4-6 hours)
   - Add test-first prompts (2-3 hours)
   - Re-run baseline (50 min, $0.016)
   - Then scale to 50
   - Additional cost: ~$0.10 total
   - Expected score: 9.5-9.8/10

**Recommendation:** Path A unless failures show obvious pattern

**Budget:** $0.08-$0.10

**Timeline:** 1-2 days

---

## Scenario 3: FAIR (40-60% pass rate, 4-6/10 passing)

**Assessment:** Needs optimization before scale testing.

**Next Steps:**
1. Analyze failure patterns in detail
2. Implement priority optimizations:
   - **Token Optimization** (4-6 hours)
     - Reduce context bloat
     - Smart file truncation
     - Essential context only
   - **Test-First Prompts** (2-3 hours)
     - Inject test expectations
     - Guide toward minimal changes
3. Re-run 10-instance baseline (50 min, $0.016)
4. If improved to >60%, proceed to 50 instances
5. If still <60%, implement edit strategies (8-12 hours)

**Budget:** $0.05-$0.10 (multiple baseline iterations)

**Timeline:** 3-5 days

**Key Question:** What are the failure modes?
- Timeouts → Token optimization critical
- Test failures → Test-first prompts critical
- Tool errors → Edit strategy changes needed

---

## Scenario 4: NEEDS WORK (<40% pass rate, <4/10 passing)

**Assessment:** Systematic debugging required.

**Next Steps:**
1. **Deep Failure Analysis:**
   - Categorize all failures (timeout/test/tool/other)
   - Identify root causes
   - Check if separate test phase is working correctly
   - Verify Write tool guidance is being followed

2. **Prioritize Fixes by Category:**

   **If mostly timeouts (>50% failures):**
   - Implement dynamic timeout calculation (2-3 hours)
   - Add early exit detection (3-4 hours)
   - Token optimization (4-6 hours)

   **If mostly test failures (>50% failures):**
   - Enhance test extraction logic (2-3 hours)
   - Improve test-first prompts (2-3 hours)
   - Add incremental refinement (8-12 hours)

   **If mostly tool errors (>50% failures):**
   - Review Edit vs Write tool usage
   - Enhance tool error recovery (3-4 hours)
   - Add tool confirmation loops (4-6 hours)

3. **Iterate Systematically:**
   - Fix highest-impact category
   - Re-run baseline
   - Measure improvement
   - Repeat until >40%

**Budget:** $0.10-$0.20 (multiple debugging iterations)

**Timeline:** 1-2 weeks

**Red Flags:**
- All instances timing out → Context management broken
- Random failures → Non-deterministic issues
- Same error every time → Fundamental approach problem

---

## Cost Summary by Scenario

| Scenario | Baseline Cost | Total Cost | Timeline | Target Score |
|----------|---------------|------------|----------|--------------|
| EXCELLENT (80%+) | $0.016 | $0.096 | 1 day | 9.5-9.8 |
| GOOD (60-80%) | $0.016 | $0.08-$0.10 | 2 days | 9.2-9.5 |
| FAIR (40-60%) | $0.016 | $0.05-$0.10 | 5 days | 9.0-9.5 |
| NEEDS WORK (<40%) | $0.016 | $0.10-$0.20 | 2 weeks | 8.5-9.2 |

---

## Success Metrics

**Minimum Viable (9.2 score):**
- 50%+ on 50 instances
- Cost <$1.00 total
- Reproducible results

**Target (9.5 score):**
- 65%+ on 50 instances
- Cost <$0.50 total
- Competitive with OpenHands (77.6%)

**Stretch (9.8 score):**
- 75%+ on 50 instances
- Cost <$0.20 total
- Competitive with Aider (88%)

---

## Confidence Indicators

**High Confidence (proceed with scale):**
- Pass rate >60%
- No systematic failures
- Consistent across different instance types
- Cost tracking working correctly

**Medium Confidence (optimize first):**
- Pass rate 40-60%
- Some patterns in failures
- Timeouts or test issues
- Quick fixes available

**Low Confidence (debug extensively):**
- Pass rate <40%
- No clear patterns
- Multiple failure modes
- Infrastructure issues

---

## Next Command Reference

```powershell
# Analyze baseline results
.\analyze_baseline.ps1

# Re-run baseline after fixes
.\run_baseline.ps1

# Scale to 50 instances
.\RUN_BENCHMARK.ps1 -Limit 50

# Run with different model
.\RUN_BENCHMARK.ps1 -Limit 50 -Model "anthropic/claude-sonnet-4-6"
```

---

**Decision Authority:** Baseline results determine the path. Trust the data.
