# Decision Trees & Observable Reasoning

**Status:** Production-ready
**Last Updated:** 2026-03-29

## Overview

DanteCode records all agentic decisions in observable traces, enabling full explainability and debugging. Every decision point is logged with:

- **Options considered** - What choices were available?
- **Selection made** - Which option was chosen?
- **Reasoning** - Why was this option selected?
- **Confidence** - How certain is the agent (0-1 scale)?

---

## Decision Types

### 1. Model Selection Decisions

**When:** Choosing which model to use for a task

**Decision Point:** `model-selection`

**Options:**
- `claude-opus-4-6` - Most capable, expensive (complexity tier: expert)
- `claude-sonnet-4-6` - Balanced, fast (complexity tier: deep)
- `claude-haiku-4-5` - Fast, cheap (complexity tier: quick)

**Example:**
```json
{
  "decisionId": "dec_abc123",
  "point": "model-selection",
  "options": [
    { "name": "claude-opus-4-6", "score": 0.95, "reason": "Complex refactoring task" },
    { "name": "claude-sonnet-4-6", "score": 0.70, "reason": "Balanced option" },
    { "name": "claude-haiku-4-5", "score": 0.30, "reason": "Too simple for task" }
  ],
  "selected": "claude-opus-4-6",
  "reason": "Task complexity requires most capable model",
  "confidence": 0.95
}
```

**Trace Tree:**
```
└── agent-loop
    ├── model-selection → claude-opus-4-6 (95%)
    └── reasoning → Complex refactoring requires expert tier
```

---

### 2. Tool Selection Decisions

**When:** Choosing which tool to execute

**Decision Point:** `tool-selection`

**Options:**
- `Read` - Read file contents
- `Write` - Create new file
- `Edit` - Modify existing file
- `Bash` - Execute shell command
- `Glob` - Find files by pattern
- `Grep` - Search file contents

**Example:**
```json
{
  "point": "tool-selection",
  "options": [
    { "name": "Read", "score": 0.90, "reason": "Need to see current implementation" },
    { "name": "Edit", "score": 0.50, "reason": "Could modify blindly but risky" }
  ],
  "selected": "Read",
  "reason": "Must understand existing code before editing",
  "confidence": 0.90
}
```

**Trace Tree:**
```
└── agent-loop
    └── tool-batch
        ├── tool-selection → Read (90%)
        └── tool-execution: Read(src/index.ts)
```

---

### 3. Verification Decisions

**When:** Determining if generated code passes quality gates

**Decision Point:** `verification`

**Options:**
- `pass` - Code meets quality bar (PDSE >= 70)
- `fail` - Code needs refinement (PDSE < 70)

**Example:**
```json
{
  "point": "verification",
  "options": [
    { "name": "pass", "score": 1.0, "reason": "All verification checks passed" },
    { "name": "fail", "score": 0.0, "reason": "One or more verification checks failed" }
  ],
  "selected": "pass",
  "reason": "Verification successful, proceeding",
  "confidence": 1.0
}
```

**Trace Tree:**
```
└── agent-loop
    └── verification
        ├── verification-run: src/utils.ts
        │   └── PDSE score: 85/100 ✓
        └── decision → pass (100%)
```

---

### 4. Approach Selection Decisions

**When:** Choosing implementation strategy

**Decision Point:** `approach-selection`

**Options:**
- `incremental` - Small, safe changes
- `refactor` - Large restructuring
- `rewrite` - Start from scratch

**Example:**
```json
{
  "point": "approach-selection",
  "options": [
    { "name": "incremental", "score": 0.80, "reason": "Safest, preserves existing logic" },
    { "name": "refactor", "score": 0.60, "reason": "Cleaner but riskier" },
    { "name": "rewrite", "score": 0.20, "reason": "Too disruptive" }
  ],
  "selected": "incremental",
  "reason": "Minimize risk while achieving goal",
  "confidence": 0.80
}
```

---

### 5. Continuation Decisions

**When:** Deciding whether to continue iterating or stop

**Decision Point:** `continuation`

**Options:**
- `continue` - More work needed
- `stop` - Task complete

**Example:**
```json
{
  "point": "continuation",
  "options": [
    { "name": "continue", "score": 0.10, "reason": "All goals achieved" },
    { "name": "stop", "score": 0.90, "reason": "Tests passing, no errors" }
  ],
  "selected": "stop",
  "reason": "Task complete, all acceptance criteria met",
  "confidence": 0.90
}
```

---

## Tracing Decisions in Practice

### Example: Complete Agent Loop Trace

**Task:** "Refactor utils.ts to use async/await"

**Trace:**
```
agent-loop (success, 12500ms)
├── model-selection
│   ⚡ model-selection: claude-opus-4-6 (95%)
│      Reason: Complex refactoring requires expert tier
│
├── reasoning
│   • Starting model inference with native tools
│   • Analyzing code structure
│   • Planning refactoring strategy
│
├── approach-selection
│   ⚡ approach-selection: incremental (80%)
│      Reason: Minimize risk while achieving goal
│
├── tool-batch
│   ├── Read(packages/cli/src/utils.ts)
│   ├── Edit(packages/cli/src/utils.ts)
│   └── Bash(npm test -- utils.test.ts)
│
├── verification
│   ├── DanteForge PDSE check: 88/100 ✓
│   └── ⚡ verification: pass (100%)
│          Reason: Verification successful, proceeding
│
└── continuation
    ⚡ continuation: stop (90%)
       Reason: Task complete, all acceptance criteria met
```

**Command to View:**
```bash
dantecode trace tree abc12345 --decisions
```

---

## Decision Confidence Calibration

### Confidence Levels

| Range | Meaning | Example |
|-------|---------|---------|
| **0.9-1.0** | Very High | Verification passed (100% certain) |
| **0.7-0.9** | High | Model selection based on clear complexity signals |
| **0.5-0.7** | Medium | Tool choice with trade-offs |
| **0.3-0.5** | Low | Uncertain approach, may need iteration |
| **0.0-0.3** | Very Low | Risky choice, likely to fail |

### Confidence Sources

1. **Deterministic** (1.0) - No ambiguity
   - Verification pass/fail (based on PDSE score)
   - Continuation after error (must continue)

2. **Heuristic** (0.7-0.9) - Clear signals
   - Model selection (based on lexical complexity)
   - Tool selection (based on task analysis)

3. **Contextual** (0.5-0.7) - Depends on context
   - Approach selection (trade-offs present)
   - Retry strategy (depends on error type)

4. **Uncertain** (0.3-0.5) - Multiple valid options
   - Provider selection (when multiple work)
   - Reasoning tier (when task complexity unclear)

---

## Using Decisions for Debugging

### Scenario 1: Agent Chose Wrong Tool

**Symptom:** Agent used `Edit` but should have used `Write` (file didn't exist)

**Investigation:**
```bash
dantecode trace show abc123
```

**Output:**
```
Decision: tool-selection
  Selected: Edit (confidence: 0.60)
  Reason: Assuming file exists based on context
  Options:
    - Write (score: 0.40) - Create new file
    - Edit (score: 0.60) - Modify existing ← WRONG CHOICE
```

**Root Cause:** Agent incorrectly assumed file exists

**Fix:** Improve context (mention "new file" explicitly in prompt)

---

### Scenario 2: Agent Stopped Too Early

**Symptom:** Task incomplete but agent stopped

**Investigation:**
```bash
dantecode trace tree def456 --decisions
```

**Output:**
```
└── agent-loop
    └── continuation
        ⚡ continuation: stop (0.75)
           Reason: Primary file complete, missed secondary file
```

**Root Cause:** Confidence too high despite incomplete work

**Fix:** Improve acceptance criteria clarity in prompt

---

### Scenario 3: Wrong Model Selected

**Symptom:** Simple task used expensive Opus model

**Investigation:**
```bash
dantecode trace show ghi789
```

**Output:**
```
Decision: model-selection
  Selected: claude-opus-4-6 (confidence: 0.85)
  Reason: Task complexity tier: expert
  Complexity Signals:
    - Lexical complexity: 0.45 (medium)
    - Code modification: true
    - Test required: true
    → Triggered expert tier
```

**Root Cause:** Complexity heuristic too aggressive

**Fix:** Use `/think quick` to override for simple tasks

---

## Decision Patterns & Anti-Patterns

### ✅ Good Decision Patterns

1. **Read Before Edit**
   ```
   tool-batch
   ├── Read(file.ts) ← Understand first
   └── Edit(file.ts) ← Modify second
   ```

2. **Verify Before Continue**
   ```
   verification
   ├── PDSE check ← Gate
   └── decision: pass ← Only proceed if passed
   ```

3. **Retry with Strategy**
   ```
   error-recovery
   ├── initial-attempt: Edit(file.ts) → failed
   ├── decision: retry-with-read
   └── retry-attempt: Read + Edit → success
   ```

### ❌ Anti-Patterns

1. **Blind Edit** (skipping Read)
   ```
   tool-batch
   └── Edit(file.ts) ← No prior Read, risky!
   ```

2. **Premature Stop**
   ```
   continuation
   └── decision: stop (confidence: 0.55) ← Too uncertain!
   ```

3. **Wrong Model for Task**
   ```
   model-selection
   └── claude-haiku-4-5 for complex refactoring ← Underpowered!
   ```

---

## Inspecting Decisions

### CLI Commands

```bash
# List recent traces
dantecode trace list

# Show trace summary with decisions
dantecode trace show <traceId>

# Show full decision tree
dantecode trace tree <traceId> --decisions

# Show aggregate stats
dantecode trace stats
```

### Programmatic Access

```typescript
import { getGlobalTraceLogger } from "@dantecode/core";

const logger = getGlobalTraceLogger();
const trace = logger.getTrace(traceId);

// Get all decisions
for (const decision of trace.decisions) {
  console.log(`${decision.point}: ${decision.selected}`);
  console.log(`  Confidence: ${decision.confidence}`);
  console.log(`  Reason: ${decision.reason}`);

  // Analyze options
  for (const option of decision.options) {
    console.log(`    - ${option.name}: ${option.score}`);
  }
}
```

---

## Decision Metrics

### Key Metrics to Track

1. **Decision Accuracy** - How often does the selected option succeed?
   ```
   accuracy = successful_decisions / total_decisions
   ```

2. **Average Confidence** - Is the agent well-calibrated?
   ```
   avg_confidence = sum(confidence) / total_decisions
   Target: 0.75-0.85 (not too confident, not too uncertain)
   ```

3. **Confidence Calibration** - Does high confidence predict success?
   ```
   When confidence >= 0.9 → success rate should be >= 90%
   When confidence 0.7-0.9 → success rate should be 70-90%
   ```

4. **Decision Latency** - How long does decision-making take?
   ```
   Measured via span.durationMs for decision spans
   Target: < 100ms per decision (shouldn't be bottleneck)
   ```

### Viewing Metrics

```bash
# Aggregate stats across all traces
dantecode trace stats

# Output:
# Total Decisions: 150
# Average Confidence: 0.82
# Decisions per Trace: 5.2
```

---

## Integration with Other Systems

### 1. FearSet Integration

**Decision Point:** `fearset-recommendation`

FearSet fears can influence decisions:
```json
{
  "point": "approach-selection",
  "options": [
    { "name": "rewrite", "score": 0.20, "reason": "FearSet identified high data-loss risk" },
    { "name": "incremental", "score": 0.80, "reason": "Safer based on FearSet analysis" }
  ],
  "selected": "incremental",
  "confidence": 0.85
}
```

### 2. Gaslight Integration

**Decision Point:** `gaslight-refinement`

Gaslight critique triggers iteration decisions:
```json
{
  "point": "gaslight-refinement",
  "options": [
    { "name": "accept", "score": 0.30, "reason": "Critic found edge case bugs" },
    { "name": "refine", "score": 0.70, "reason": "Needs one more iteration" }
  ],
  "selected": "refine",
  "confidence": 0.75
}
```

### 3. Skillbook Integration

**Decision Point:** `lesson-application`

Skillbook lessons influence approach:
```json
{
  "point": "approach-selection",
  "options": [
    { "name": "direct-edit", "score": 0.40, "reason": "Skillbook lesson: always read first" },
    { "name": "read-then-edit", "score": 0.90, "reason": "Matches successful lesson pattern" }
  ],
  "selected": "read-then-edit",
  "confidence": 0.90
}
```

---

## Future Enhancements

**Potential improvements:**

1. **Decision Replay** - Re-run trace with different decisions to see outcomes
2. **Decision Diff** - Compare decision trees across two traces
3. **Decision Suggestions** - "Agent chose X, but Y had higher success rate historically"
4. **Visual Decision Tree** - SVG/HTML rendering of decision graph
5. **Decision Export** - Export traces to external tools (Weights & Biases, LangSmith)

---

## References

- [Trace Logger Implementation](../../packages/core/src/trace-logger.ts)
- [Trace Commands](../../packages/cli/src/commands/trace.ts)
- [Agent Loop Instrumentation](../../packages/cli/src/agent-loop.ts)
- [Observable Agentic Systems (Research)](https://arxiv.org/abs/2401.12345) _(hypothetical)_
