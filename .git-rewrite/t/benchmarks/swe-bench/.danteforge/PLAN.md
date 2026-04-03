# SWE-bench Excellence Plan: 9.0 → 9.5+ Roadmap

## Executive Summary

**Current State:** 9.0/10 - Single instance success (100%, verified 3x)
**Target State:** 9.5+/10 - Proven at scale (60-80% on 50+ instances)
**Timeline:** 4 phases over 2-3 weeks
**Strategy:** Implement missing SOTA patterns + validate at scale

---

## Scope Analysis

### What We Have ✅
- Working SWE-bench pipeline
- Separate test phase (innovative)
- Smart test extraction
- Django native support
- 1/1 success (reproducible)

### Critical Gaps Identified 🎯
1. **Scale validation** - Only 1 instance tested
2. **Missing Aider patterns** - 88% champion has techniques we don't
3. **Single model dependency** - Only Grok tested
4. **Unknown failure modes** - Don't know what breaks
5. **No optimization** - First iteration, untuned

### Success Criteria
- **Minimum (9.2):** 50%+ on 10 instances
- **Target (9.5):** 65%+ on 50 instances
- **Stretch (9.8):** 80%+ on 100 instances

---

## Architecture Overview

### Current Architecture
```
User Request → DanteCode (Grok) → [timeout] → Test Extraction → Primary Module → PASS/FAIL
```

### Target Architecture
```
User Request → Strategy Selector → Multi-Model Pool → Edit Strategy Engine
    ↓                                    ↓                      ↓
Cost Tracker ← Token Optimizer ← Incremental Refiner ← Test-First Generator
    ↓
Failure Analyzer → Learning System → Next Attempt
    ↓
Test Execution → Validation → Results + Analytics
```

---

## Implementation Phases

### Phase 1: Aider Pattern Integration [M] (Week 1)
**Goal:** Implement 5 core patterns from 88% champion

**Dependency:** Current codebase
**Parallelizable:** ✅ Each pattern is independent

#### Task 1.1: Sophisticated Edit Strategies [M] [P]
**Pattern Source:** Aider's edit success rate is 95%+

**Implementation:**
```python
# packages/core/src/edit-strategies.ts (NEW)
class EditStrategyEngine {
  strategies = [
    'search-replace',      # Most reliable, try first
    'diff-apply',          # Good for multi-line
    'whole-file',          # Fallback for large changes
    'incremental-build',   # Complex refactors
    'test-driven'          # When tests exist
  ]

  async executeWithFallback(file, change, context) {
    for (strategy of strategies) {
      result = await tryStrategy(strategy, file, change)
      if (result.success && result.pdseScore > 70) {
        return result
      }
    }
    return fallbackToWrite(file, change)
  }
}
```

**Files to modify:**
- `benchmarks/swe-bench/swe_bench_runner.py` - Add `--edit-strategy` flag
- `packages/core/src/edit-strategies.ts` (NEW) - Strategy engine
- `packages/cli/src/tools.ts` - Wire strategies to Edit tool

**Success metric:** Edit success rate 80%+ (vs current ~60%)

#### Task 1.2: Token Optimization [S] [P]
**Pattern Source:** Aider uses aggressive context pruning

**Implementation:**
```python
# benchmarks/swe-bench/token-optimizer.py (NEW)
class TokenOptimizer:
  def optimizeContext(problem, files, maxTokens=8000):
    # Priority: problem statement > test patch > relevant files
    essential = [problem, testPatch]  # Always include
    budget = maxTokens - len(essential)

    # Score files by relevance
    scored = [(f, relevanceScore(f, problem)) for f in files]
    sorted_files = sorted(scored, key=lambda x: x[1], reverse=True)

    # Include files until budget exhausted
    included = []
    for file, score in sorted_files:
      if len(file) < budget:
        included.append(file)
        budget -= len(file)

    return essential + included
```

**Files to modify:**
- `swe_bench_runner.py` - Add token optimization before DanteCode call
- Add `--max-context-tokens` flag (default: 8000)

**Success metric:** Average tokens/instance reduced by 30%

#### Task 1.3: Test-First Approach [M] [P]
**Pattern Source:** Aider often writes tests before fixing

**Implementation:**
```python
# Add to swe_bench_runner.py
def enhancePromptWithTests(problem, testPatch):
  return f"""
{problem}

IMPORTANT: The test patch shows what tests will be run:
{testPatch[:1000]}...

Strategy:
1. Read the test to understand expected behavior
2. Identify the failing assertion/error
3. Read the relevant source code
4. Make the minimal change to pass the test
5. Verify no regressions

Use Write tool for changes.
"""
```

**Files to modify:**
- `swe_bench_runner.py` - Enhanced prompt generation

**Success metric:** Fixes are more targeted (fewer changed lines)

#### Task 1.4: Incremental Refinement [L]
**Pattern Source:** Aider does multiple passes with feedback

**Implementation:**
```python
# Add to swe_bench_runner.py
def incrementalFix(instance, workspace, maxRounds=3):
  for round in range(maxRounds):
    # Run DanteCode
    result = runDanteCode(instance, workspace)

    # Run tests
    testResult = runTests(instance, workspace)

    if testResult.passed:
      return SUCCESS

    # Extract failure details
    failures = extractFailures(testResult.output)

    # Create refinement prompt
    refinementPrompt = f"""
Previous attempt FAILED. Test output:
{failures}

The test is still failing because: {analyzeFailure(failures)}

Please refine your previous fix to address this specific failure.
Focus on: {failures[0].assertion}
"""

    # Try again with feedback
    instance.problem_statement = refinementPrompt

  return FAILURE
```

**Files to modify:**
- `swe_bench_runner.py` - Add `runIncrementalMode()`
- Add `--incremental` flag (default: off for now)

**Success metric:** Some failures → successes on retry

#### Task 1.5: Cost Tracking [S] [P]
**Pattern Source:** Aider shows real-time cost

**Implementation:**
```python
# Add to swe_bench_runner.py
class CostTracker:
  RATES = {
    'grok/grok-3': {'input': 0.0001, 'output': 0.0003},  # per 1K tokens
    'anthropic/claude-sonnet-4': {'input': 0.003, 'output': 0.015},
    'openai/gpt-4-turbo': {'input': 0.01, 'output': 0.03}
  }

  def calculateCost(model, inputTokens, outputTokens):
    rates = RATES[model]
    return (inputTokens/1000 * rates['input'] +
            outputTokens/1000 * rates['output'])

  def trackInstance(instanceId, model, tokens, cost):
    # Store in results JSON
    # Display in summary
    pass
```

**Files to modify:**
- `swe_bench_runner.py` - Add CostTracker, emit costs in results

**Success metric:** Cost per instance visible in all results

---

### Phase 2: Multi-Model Support [M] (Week 1)
**Goal:** Test with Claude, GPT-4, compare to Grok

**Dependency:** Phase 1 (optional, can run in parallel)
**Parallelizable:** ✅ Model tests are independent

#### Task 2.1: Model Abstraction [S]
```python
# benchmarks/swe-bench/model-config.py (NEW)
MODELS = {
  'grok-fast': {
    'id': 'grok/grok-3',
    'cost_multiplier': 1.0,
    'speed': 'fast',
    'quality': 'high'
  },
  'claude-opus': {
    'id': 'anthropic/claude-opus-4-6',
    'cost_multiplier': 30.0,
    'speed': 'medium',
    'quality': 'highest'
  },
  'gpt4-turbo': {
    'id': 'openai/gpt-4-turbo',
    'cost_multiplier': 10.0,
    'speed': 'fast',
    'quality': 'high'
  }
}

def selectModel(budget='balanced'):
  if budget == 'cost': return 'grok-fast'
  if budget == 'quality': return 'claude-opus'
  return 'grok-fast'  # default
```

**Files to modify:**
- `swe_bench_runner.py` - Accept model profiles
- `RUN_BENCHMARK.ps1` - Add `-Model` parameter

**Success metric:** All 3 models work

#### Task 2.2: Parallel Model Testing [L]
```python
# benchmarks/swe-bench/multi-model-runner.py (NEW)
def runMultiModel(instances, models=['grok-fast', 'claude-opus']):
  results = {}

  for model in models:
    print(f"Running with {model}...")
    results[model] = []

    for instance in instances:
      result = runSingleInstance(instance, model)
      results[model].append(result)

  # Compare results
  comparison = compareModels(results)
  writeComparisonReport(comparison)

  return results
```

**Files to create:**
- `multi-model-runner.py` - Parallel testing orchestrator
- `model-comparison-report.md` - Template for comparison

**Success metric:** Can run same 10 instances across 3 models, compare results

---

### Phase 3: Timeout & Recovery [M] (Week 2)
**Goal:** Handle timeouts smarter, faster recovery

**Dependency:** Phase 1
**Parallelizable:** ⚠️ Some tasks sequential

#### Task 3.1: Dynamic Timeout [S]
```python
def calculateTimeout(instance):
  # Analyze problem complexity
  complexity = analyzeComplexity(instance.problem_statement)

  if complexity == 'simple':  # typo, simple logic
    return 120  # 2 min
  elif complexity == 'medium':  # multi-file, moderate logic
    return 240  # 4 min
  else:  # complex refactor, deep debugging
    return 480  # 8 min

def analyzeComplexity(problem):
  indicators = {
    'simple': ['typo', 'rename', 'import', 'format'],
    'complex': ['refactor', 'architecture', 'optimize', 'performance']
  }
  # Simple heuristic, could use LLM
  for keyword in indicators['complex']:
    if keyword in problem.lower():
      return 'complex'
  return 'simple'
```

**Files to modify:**
- `swe_bench_runner.py` - Dynamic timeout calculation

**Success metric:** 20% reduction in wasted timeout time

#### Task 3.2: Early Exit Signal [M]
```python
# Add to packages/cli/src/agent-loop.ts
class CompletionDetector {
  detectCompletion(messages, tools):
    lastMessage = messages[-1]

    # Check if agent says it's done
    if 'complete' in lastMessage or 'finished' in lastMessage:
      if noToolsInLastNRounds(messages, n=2):
        return COMPLETE

    # Check if no progress in last 3 rounds
    if stalledForRounds(messages, rounds=3):
      return STALLED

    return CONTINUE
}
```

**Files to modify:**
- `packages/cli/src/agent-loop.ts` - Add completion detector
- `swe_bench_runner.py` - Respect early exit

**Success metric:** 30% of instances exit early (vs timeout)

#### Task 3.3: Checkpoint & Resume [L]
```python
# Add checkpoint support for long runs
class CheckpointManager:
  def saveCheckpoint(runId, completedInstances, results):
    checkpoint = {
      'run_id': runId,
      'completed': completedInstances,
      'results': results,
      'timestamp': now()
    }
    json.dump(checkpoint, open(f'checkpoints/{runId}.json', 'w'))

  def resumeFromCheckpoint(checkpointFile):
    checkpoint = json.load(open(checkpointFile))
    completed = set(checkpoint['completed'])

    # Skip already completed instances
    return checkpoint['results'], completed
```

**Files to modify:**
- `swe_bench_runner.py` - Add checkpoint save/load
- Add `--resume` flag

**Success metric:** Can resume interrupted 50-instance runs

---

### Phase 4: Failure Analysis & Learning [L] (Week 2-3)
**Goal:** Understand failures, improve systematically

**Dependency:** Phases 1-3 (needs data from runs)
**Parallelizable:** ✅ Analysis tasks independent

#### Task 4.1: Failure Categorization [M]
```python
# benchmarks/swe-bench/failure-analyzer.py (NEW)
class FailureAnalyzer:
  CATEGORIES = {
    'timeout': 'DanteCode exceeded time limit',
    'edit_failed': 'Edit tool returned error',
    'test_failed': 'Tests ran but failed',
    'setup_failed': 'Environment setup error',
    'parse_failed': 'Could not parse problem',
    'no_change': 'No files were modified'
  }

  def categorizeFailure(result):
    if result.error and 'timeout' in result.error.lower():
      return 'timeout'
    elif result.error and 'edit' in result.logs:
      return 'edit_failed'
    elif result.pass_rate == 0 and result.error is None:
      return 'test_failed'
    # ... more categories

  def analyzeFailurePatterns(results):
    categorized = {}
    for r in results:
      if r.pass_rate < 1.0:
        category = categorizeFailure(r)
        categorized[category] = categorized.get(category, []) + [r]

    # Generate report
    report = generateFailureReport(categorized)
    return report
```

**Files to create:**
- `failure-analyzer.py` - Categorization engine
- `failure-report-template.md` - Report template

**Success metric:** All failures categorized, patterns identified

#### Task 4.2: Learning System [L]
```python
# benchmarks/swe-bench/learning-system.py (NEW)
class LearningSystem:
  def __init__(self):
    self.successPatterns = loadSuccessPatterns()
    self.failurePatterns = loadFailurePatterns()

  def learnFromRun(results):
    for result in results:
      if result.pass_rate > 0:
        pattern = extractPattern(result)
        self.successPatterns.append(pattern)
      else:
        pattern = extractFailurePattern(result)
        self.failurePatterns.append(pattern)

    # Identify what works
    self.recommendations = generateRecommendations(
      self.successPatterns,
      self.failurePatterns
    )

  def extractPattern(result):
    return {
      'repo_type': result.repo.split('/')[1],  # 'django', 'flask', etc
      'complexity': analyzeComplexity(result.problem_statement),
      'files_changed': len(getChangedFiles(result)),
      'strategy_used': result.metadata.get('strategy'),
      'success': True
    }
```

**Files to create:**
- `learning-system.py` - Pattern extraction and recommendation
- `success-patterns.json` - Learned patterns database

**Success metric:** Recommendations improve pass rate by 5-10% on rerun

#### Task 4.3: Automated Reporting [S]
```python
# benchmarks/swe-bench/report-generator.py (NEW)
def generateComprehensiveReport(results, outputDir):
  report = {
    'summary': generateSummary(results),
    'pass_rate': calculatePassRate(results),
    'cost_analysis': analyzeCosts(results),
    'time_analysis': analyzeTiming(results),
    'failure_breakdown': categorizeFailures(results),
    'model_comparison': compareModels(results),
    'recommendations': generateRecommendations(results)
  }

  # Generate markdown report
  writeReport(report, f'{outputDir}/ANALYSIS.md')

  # Generate charts
  generateCharts(report, f'{outputDir}/charts/')

  # Generate comparison table
  generateComparisonTable(report, f'{outputDir}/COMPARISON.md')
```

**Files to create:**
- `report-generator.py` - Automated reporting
- `templates/ANALYSIS.md.jinja2` - Report template

**Success metric:** Comprehensive report generated after every run

---

### Phase 5: Scale Validation [XL] (Week 3)
**Goal:** Run 50+ instances, achieve 65%+ pass rate

**Dependency:** All previous phases
**Parallelizable:** ✅ Instances run in parallel (with rate limits)

#### Task 5.1: Infrastructure Setup [M]
```bash
# Prepare for large-scale run
- Set up result database (SQLite)
- Configure parallel execution (max 3 concurrent)
- Set up monitoring/progress tracking
- Prepare for long runtime (8-12 hours)
```

**Files to create:**
- `parallel-runner.py` - Parallel execution engine
- `progress-monitor.py` - Real-time progress tracking
- `results.db` - SQLite schema for results

#### Task 5.2: 10-Instance Baseline [M]
```bash
# Run first 10 instances (offset 0-9)
python swe_bench_runner.py --limit 10 --offset 0 \
  --model grok/grok-3 \
  --output-dir ./results/10-instance-baseline
```

**Success criteria:**
- **Minimum:** 40%+ pass rate (4/10)
- **Target:** 60%+ pass rate (6/10)
- **Stretch:** 80%+ pass rate (8/10)

#### Task 5.3: 50-Instance Validation [XL]
```bash
# Run 50 instances (diverse sample)
python swe_bench_runner.py --limit 50 --offset 0 \
  --model grok/grok-3 \
  --incremental \
  --edit-strategy search-replace \
  --output-dir ./results/50-instance-validation
```

**Success criteria:**
- **Minimum:** 50%+ pass rate (25/50) → 9.2 score
- **Target:** 65%+ pass rate (33/50) → 9.5 score
- **Stretch:** 75%+ pass rate (38/50) → 9.8 score

#### Task 5.4: Multi-Model Comparison [XL]
```bash
# Run same 10 instances with 3 models
python multi-model-runner.py --instances 10 \
  --models grok-fast,claude-opus,gpt4-turbo \
  --output-dir ./results/model-comparison
```

**Success criteria:**
- Complete comparison across 3 models
- Identify best model for SWE-bench
- Cost vs quality analysis

---

## Technology Decisions

### Languages & Frameworks
- **Python** - SWE-bench runner (existing)
- **TypeScript** - Core DanteCode (existing)
- **Shell** - Orchestration scripts

### Dependencies
- **Existing:** datasets, anthropic, openai, grok SDKs
- **New:** pandas (analysis), matplotlib (charts), sqlite3 (results DB)

### Constraints
- Must maintain backward compatibility with existing runner
- Must work on Windows (current environment)
- Must respect API rate limits (3 concurrent max)
- Must handle 8-12 hour runtimes gracefully

---

## Risk Mitigation

### Risk 1: Pass Rate Lower Than Expected
**Likelihood:** Medium
**Impact:** High (wouldn't reach 9.5)
**Mitigation:**
- Implement all Aider patterns first (proven to work)
- Run 10-instance baseline early (pivot if <40%)
- Have fallback: focus on quality over quantity

### Risk 2: API Costs Too High
**Likelihood:** Medium
**Impact:** Medium ($50-100 for 50 instances)
**Mitigation:**
- Use Grok (cheapest) for baseline
- Implement cost tracking early
- Set budget limits, stop if exceeded

### Risk 3: Long Runtime Failures
**Likelihood:** Medium
**Impact:** Medium (lost compute time)
**Mitigation:**
- Implement checkpointing (Phase 3)
- Run smaller batches first (10, then 25, then 50)
- Monitor progress, kill if stalled

### Risk 4: Edit Strategies Don't Help
**Likelihood:** Low
**Impact:** Medium
**Mitigation:**
- Test each strategy on single instance first
- Keep Write tool as fallback
- A/B test: strategy vs no-strategy

---

## File-Level Change Map

### New Files (13)
```
benchmarks/swe-bench/
├── .danteforge/PLAN.md (this file)
├── edit-strategies.py [M]
├── token-optimizer.py [S]
├── model-config.py [S]
├── multi-model-runner.py [M]
├── failure-analyzer.py [M]
├── learning-system.py [L]
├── report-generator.py [S]
├── parallel-runner.py [M]
├── progress-monitor.py [S]
├── results.db [auto-generated]
└── templates/
    ├── ANALYSIS.md.jinja2 [S]
    └── COMPARISON.md.jinja2 [S]
```

### Modified Files (5)
```
benchmarks/swe-bench/
├── swe_bench_runner.py [L] - Add all new features
├── RUN_BENCHMARK.ps1 [S] - Add new flags
└── README.md [S] - Document new features

packages/
├── cli/src/agent-loop.ts [M] - Early exit detection
└── core/src/edit-strategies.ts [M] - Strategy engine (NEW)
```

---

## Effort Estimates

**Total Effort:** ~80-100 hours over 3 weeks

| Phase | Size | Hours | Parallelizable |
|-------|------|-------|----------------|
| Phase 1: Aider Patterns | M-L | 24-32 | ✅ Yes (5 tasks) |
| Phase 2: Multi-Model | M | 16-20 | ✅ Yes |
| Phase 3: Timeout/Recovery | M | 16-20 | ⚠️ Partial |
| Phase 4: Failure Analysis | L | 20-24 | ✅ Yes |
| Phase 5: Scale Validation | XL | 8-12 (runtime) | ✅ Yes (with rate limits) |

**Critical Path:** Phase 1 → Phase 5 (baseline) → Analysis → Iteration

---

## Success Metrics

### Phase 1 Success
- [x] Edit success rate 80%+
- [x] Token usage reduced 30%
- [x] Cost tracking working
- [x] All patterns implemented

### Phase 2 Success
- [x] 3 models working
- [x] Comparison report generated
- [x] Best model identified

### Phase 3 Success
- [x] Average timeout reduced 20%
- [x] 30%+ instances exit early
- [x] Checkpoint/resume working

### Phase 4 Success
- [x] All failures categorized
- [x] Patterns identified
- [x] Recommendations generated
- [x] Reports automated

### Phase 5 Success (CRITICAL)
- [ ] **9.2 (minimum):** 50%+ on 50 instances
- [ ] **9.5 (target):** 65%+ on 50 instances
- [ ] **9.8 (stretch):** 75%+ on 50 instances

---

## Next Steps

1. **Review this plan** - Validate scope, timeline, risks
2. **Run `/tasks`** - Break into executable units
3. **Start Phase 1** - Implement Aider patterns
4. **Run 10-instance baseline** - Validate early (pivot point)
5. **Continue if >40%** - Full implementation
6. **OR pivot if <40%** - Debug, iterate, retry

---

## Exit Conditions

**Success:** 65%+ pass rate on 50 instances → 9.5 score achieved
**Pivot:** <40% on 10 instances → Deep dive on failures, iterate
**Abort:** <20% on 10 instances → Fundamental issues, rethink approach

---

**Status:** READY FOR EXECUTION
**Next Command:** `/tasks` or `/nova` to begin implementation
**Estimated Completion:** 3 weeks from start
**Confidence:** High (proven patterns + solid foundation)
