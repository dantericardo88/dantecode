# EXECUTION PACKET: DanteThink — Configurable Reasoning Effort
## Model Reasoning Chains (8.0 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteThink |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/core` (ReasoningChain + ModelRouter) + `@dantecode/cli` (slash commands) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~400 source + ~200 tests |
| **Sprint Time** | 1-2 hours for Claude Code |

---

## 1. The Situation

DanteCode's reasoning infrastructure is the most mature subsystem in the codebase. It's been exercised every single round of every agent session:

| Component | LOC | Tests | What It Does |
|---|---|---|---|
| `reasoning-chain.ts` | 454 | 45 (411 LOC) | Full ReAct chain: Think→Critique→Distill→Act with tiered reasoning (quick/deep/expert) |
| `model-router.ts` | 350+ | — | Complexity analysis, extended thinking budget derivation, per-provider thinking config |

**What's already working:**
- 3 reasoning tiers: quick, deep, expert ✅
- `decideTier()` based on lexical complexity + error count + tool calls ✅
- PDSE-driven self-critique every N turns ✅
- Auto-escalation when PDSE score drops below threshold ✅
- Playbook distillation from successful patterns ✅
- Extended thinking budget derivation (2048/4096/8192 base, scaled by complexity) ✅
- Provider-specific thinking config (Anthropic thinking blocks, OpenAI reasoning_effort, xAI/Groq thinkingBudget) ✅
- `analyzeComplexity()` with keyword + length + multi-file heuristics ✅
- Chain injected into agent context every round ✅
- `reasoningEffort` config in `ModelConfig` (low/medium/high) ✅

**What's missing for 9.0 (5 targeted additions):**

1. **No `/think` command** — users can't override reasoning effort mid-session. The tier is auto-selected and the user has no control.
2. **No per-task reasoning override** — you can't say "think harder about this specific prompt." The effort level applies to the entire session.
3. **No cost-aware tier selection** — expert tier uses 8K+ thinking tokens. On Opus, that's expensive. The system doesn't factor cost into tier decisions.
4. **No reasoning chain visibility** — the chain runs invisibly. Users can't see what tier was selected, what the critique found, or what playbook bullets were distilled.
5. **No reasoning quality feedback loop** — when expert-tier reasoning produces better outcomes than quick-tier (measured by PDSE), that signal doesn't feed back to improve future tier selection.

---

## 2. Competitive Benchmark

### Claude Code (9.5)
- `reasoning_effort` parameter on API calls (low/medium/high)
- Extended thinking with configurable budget tokens
- Thinking blocks visible in VSCode (collapsed by default)
- Auto-escalation on complex tasks

### Codex (9.5)
- `reasoning.effort` in TOML config (low/medium/high)
- `reasoning.summary_model` for chain-of-thought distillation
- o1-class reasoning with visible thinking process
- Per-task override via `codex exec --reasoning=high`

### OpenCode (8.0)
- Think mode toggle (detailed vs concise reasoning)
- Visible reasoning blocks in TUI
- No per-task override
- No cost awareness

### DanteCode Current (8.0 feature / lower proven)
- Full reasoning chain with 3 tiers, self-critique, playbook distillation ✅
- Extended thinking budget derivation ✅
- Auto-escalation on low PDSE ✅
- Missing: user control, visibility, cost awareness, feedback loop

---

## 3. Component Specifications

### 3.1 — `/think` Slash Command

**File:** `packages/cli/src/slash-commands.ts` — ADD

```typescript
{
  name: "think",
  description: "Set reasoning effort level for next prompt or entire session",
  usage: "/think [quick|deep|expert|auto] [--session]",
  handler: thinkCommand,
}

/**
 * /think — control reasoning effort.
 *
 * Usage:
 *   /think              — show current reasoning tier + stats
 *   /think quick        — set quick reasoning for next prompt only
 *   /think deep         — set deep reasoning for next prompt only
 *   /think expert       — set expert reasoning for next prompt only
 *   /think auto         — reset to automatic tier selection (default)
 *   /think quick --session  — set quick reasoning for entire session
 *   /think stats        — show reasoning chain statistics
 *   /think chain        — show last N reasoning chain steps
 */
async function thinkCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const tier = parts[0]?.toLowerCase();
  const isSession = parts.includes("--session");

  // /think (no args) — show current state
  if (!tier || tier === "") {
    const current = state.reasoningOverride ?? "auto";
    const chain = state.reasoningChain;
    const budget = state.lastThinkingBudget;
    return [
      `${BOLD}Reasoning Effort${RESET}`,
      `  Current tier: ${formatTier(current)}`,
      `  Mode: ${state.reasoningOverride ? "manual override" : "automatic (decideTier)"}`,
      `  Scope: ${state.reasoningOverrideSession ? "session" : "next prompt only"}`,
      budget ? `  Last thinking budget: ${budget.toLocaleString()} tokens` : "",
      `  Chain depth: ${chain?.stepCount ?? 0} steps`,
      ``,
      `  ${DIM}Usage: /think [quick|deep|expert|auto] [--session]${RESET}`,
    ].filter(Boolean).join("\n");
  }

  // /think stats — show reasoning statistics
  if (tier === "stats") {
    return formatReasoningStats(state.reasoningChain);
  }

  // /think chain — show recent chain steps
  if (tier === "chain") {
    const limit = parseInt(parts[1] ?? "10", 10);
    return formatReasoningChain(state.reasoningChain, limit);
  }

  // /think <tier> — set reasoning tier
  const validTiers = ["quick", "deep", "expert", "auto"];
  if (!validTiers.includes(tier)) {
    return `${RED}Invalid tier: ${tier}. Options: ${validTiers.join(", ")}${RESET}`;
  }

  if (tier === "auto") {
    state.reasoningOverride = undefined;
    state.reasoningOverrideSession = false;
    return `${GREEN}Reasoning: automatic tier selection restored${RESET}`;
  }

  state.reasoningOverride = tier as ReasoningTier;
  state.reasoningOverrideSession = isSession;

  const scope = isSession ? "session" : "next prompt";
  const budgetHint = tier === "expert" ? " (high token usage)" : tier === "quick" ? " (minimal tokens)" : "";
  return `${GREEN}Reasoning set to ${BOLD}${tier}${RESET}${GREEN} for ${scope}${budgetHint}${RESET}`;
}

function formatTier(tier: string): string {
  switch (tier) {
    case "quick": return `${CYAN}quick${RESET} (fast, minimal reasoning)`;
    case "deep": return `${YELLOW}deep${RESET} (step-by-step analysis)`;
    case "expert": return `${RED}expert${RESET} (full decomposition + verification)`;
    case "auto": return `${GREEN}auto${RESET} (complexity-driven)`;
    default: return tier;
  }
}

function formatReasoningStats(chain: ReasoningChain | undefined): string {
  if (!chain) return `${DIM}No reasoning chain active.${RESET}`;

  const steps = chain.getSteps();
  const tiers = { quick: 0, deep: 0, expert: 0 };
  let totalCritiques = 0;
  let escalations = 0;
  let avgPdse = 0;
  let pdseCount = 0;

  for (const step of steps) {
    // Count tier usage from phases
    if (step.phase.content.startsWith("Consider the most direct")) tiers.quick++;
    else if (step.phase.content.startsWith("Analyze step-by-step")) tiers.deep++;
    else if (step.phase.content.startsWith("Deep analysis required")) tiers.expert++;
    if (step.phase.type === "critique") totalCritiques++;
    if (step.escalated) escalations++;
    if (step.phase.pdseScore !== undefined) {
      avgPdse += step.phase.pdseScore;
      pdseCount++;
    }
  }

  const avg = pdseCount > 0 ? (avgPdse / pdseCount * 100).toFixed(0) : "N/A";
  const playbook = chain.getPlaybook?.() ?? [];

  return [
    `${BOLD}Reasoning Statistics${RESET}`,
    `  Total steps: ${steps.length}`,
    `  Tier distribution: quick=${tiers.quick} deep=${tiers.deep} expert=${tiers.expert}`,
    `  Critiques: ${totalCritiques}`,
    `  Auto-escalations: ${escalations}`,
    `  Average PDSE: ${avg}`,
    playbook.length > 0 ? `  Playbook bullets: ${playbook.length}` : "",
  ].filter(Boolean).join("\n");
}

function formatReasoningChain(chain: ReasoningChain | undefined, limit: number): string {
  if (!chain) return `${DIM}No reasoning chain active.${RESET}`;

  const steps = chain.getSteps().slice(-limit);
  if (steps.length === 0) return `${DIM}Reasoning chain is empty.${RESET}`;

  const lines = [`${BOLD}Reasoning Chain (last ${steps.length} steps)${RESET}`, ""];
  for (const step of steps) {
    const icon = step.phase.type === "thinking" ? "💭"
      : step.phase.type === "critique" ? "🔍"
      : step.phase.type === "action" ? "⚡"
      : "👁";
    const pdse = step.phase.pdseScore !== undefined ? ` P:${(step.phase.pdseScore * 100).toFixed(0)}` : "";
    const esc = step.escalated ? ` ${YELLOW}↑escalated${RESET}` : "";
    lines.push(`  ${icon} #${step.stepNumber} [${step.phase.type}]${pdse}${esc}`);
    lines.push(`    ${DIM}${step.phase.content.slice(0, 120)}${RESET}`);
    if (step.rootCause) lines.push(`    ${RED}Root cause: ${step.rootCause}${RESET}`);
    if (step.playbookBullets?.length) {
      lines.push(`    ${GREEN}Playbook: ${step.playbookBullets[0]}${RESET}`);
    }
  }
  return lines.join("\n");
}
```

---

### 3.2 — Per-Task Reasoning Override in Agent Loop

**File:** `packages/cli/src/agent-loop.ts` — MODIFY

In the per-round reasoning chain block (~line 2080):

```typescript
// EXISTING:
const tier = reasoningChain.decideTier(lexicalComplexity, {
  errorCount: ...,
  toolCalls: ...,
});

// NEW: Check for user override
let tier: ReasoningTier;
if (replState?.reasoningOverride) {
  tier = replState.reasoningOverride;
  // Clear single-prompt override (unless --session was used)
  if (!replState.reasoningOverrideSession) {
    replState.reasoningOverride = undefined;
  }
} else {
  tier = reasoningChain.decideTier(lexicalComplexity, {
    errorCount: ...,
    toolCalls: ...,
  });
}

// Override thinking budget based on manual tier
if (replState?.reasoningOverride) {
  const tierBudgets: Record<ReasoningTier, number> = {
    quick: 1024,
    deep: 4096,
    expert: 10240,
  };
  thinkingBudget = supportsExtendedThinking(modelConfig) ? tierBudgets[tier] : undefined;
}
```

---

### 3.3 — Cost-Aware Tier Selection

**File:** `packages/core/src/reasoning-chain.ts` — MODIFY `decideTier`

Add cost context to tier decisions:

```typescript
decideTier(
  taskComplexity: number,
  context: {
    errorCount: number;
    toolCalls: number;
    /** Estimated cost multiplier for thinking tokens. Default: 1.0.
     *  Opus ~5x more expensive than Haiku. When cost is high, bias toward lower tiers. */
    costMultiplier?: number;
    /** Remaining token budget for the session. When low, bias toward lower tiers. */
    remainingBudget?: number;
  },
): ReasoningTier {
  const costMult = context.costMultiplier ?? 1.0;
  const budgetPressure = context.remainingBudget !== undefined && context.remainingBudget < 50000;

  // If cost is high (Opus) or budget is low, increase the complexity threshold
  // for escalating to higher tiers
  const costBias = costMult > 3.0 ? 0.15 : costMult > 1.5 ? 0.05 : 0;
  const budgetBias = budgetPressure ? 0.1 : 0;
  const adjustedComplexity = taskComplexity - costBias - budgetBias;

  if (adjustedComplexity < 0.3 || (context.errorCount === 0 && context.toolCalls < 5)) {
    this.currentTier = "quick";
    return "quick";
  }
  if (adjustedComplexity < 0.7 || context.errorCount < 3) {
    this.currentTier = "deep";
    return "deep";
  }
  this.currentTier = "expert";
  return "expert";
}
```

**Wire cost multiplier from model config:**

In agent-loop.ts, when calling `decideTier`:
```typescript
const costMultiplier = getCostMultiplier(modelConfig);
const tier = reasoningChain.decideTier(lexicalComplexity, {
  errorCount: ...,
  toolCalls: ...,
  costMultiplier,
  remainingBudget: session.tokenBudget ? session.tokenBudget - session.totalTokens : undefined,
});
```

**File:** `packages/core/src/reasoning-chain.ts` — ADD helper

```typescript
/**
 * Approximate cost multiplier for a model's thinking tokens.
 * Used to bias tier selection toward cheaper reasoning on expensive models.
 */
export function getCostMultiplier(model: { provider: string; modelId: string }): number {
  const id = model.modelId.toLowerCase();
  // Opus-class models: highest cost
  if (id.includes("opus") || id.includes("o1-pro")) return 5.0;
  // Sonnet/GPT-4 class: moderate cost
  if (id.includes("sonnet") || id.includes("gpt-4") || id.includes("grok-3")) return 2.0;
  // Haiku/mini/small class: low cost
  if (id.includes("haiku") || id.includes("mini") || id.includes("flash")) return 0.5;
  // Default
  return 1.0;
}
```

---

### 3.4 — Reasoning Chain Visibility

**File:** `packages/cli/src/stream-renderer.ts` — MODIFY

Add reasoning tier display to the agent output header:

```typescript
// In the header section that prints at the start of each round:
if (options.reasoningTier) {
  const tierLabel = options.reasoningTier === "quick" ? "⚡ quick"
    : options.reasoningTier === "deep" ? "🧠 deep"
    : "🔬 expert";
  header += ` [${tierLabel}]`;
}

if (options.thinkingBudget) {
  header += ` ${DIM}(${options.thinkingBudget.toLocaleString()} thinking tokens)${RESET}`;
}
```

**File:** `packages/cli/src/agent-loop.ts` — MODIFY

Pass tier info to stream renderer:

```typescript
// When creating the stream renderer or calling write():
streamRenderer.writeHeader({
  modelLabel: modelConfig.modelId,
  reasoningTier: tier,
  thinkingBudget: thinkingBudget,
});
```

Also display auto-escalation events:

```typescript
// After selfCritique, if escalation happened:
if (critiqueResult.shouldEscalate) {
  process.stdout.write(
    `${YELLOW}[reasoning] Auto-escalated: ${previousTier} → ${tier} (PDSE: ${critiqueResult.score.toFixed(2)})${RESET}\n`
  );
}
```

---

### 3.5 — Reasoning Quality Feedback Loop

Track which tier produces the best outcomes (measured by final PDSE score) and bias future decisions.

**File:** `packages/core/src/reasoning-chain.ts` — ADD to class

```typescript
// Track tier → outcome mapping for adaptive selection
private tierOutcomes: Map<ReasoningTier, { totalPdse: number; count: number }> = new Map([
  ["quick", { totalPdse: 0, count: 0 }],
  ["deep", { totalPdse: 0, count: 0 }],
  ["expert", { totalPdse: 0, count: 0 }],
]);

/**
 * Record the outcome of a reasoning tier.
 * Called after each round completes with the PDSE score.
 */
recordTierOutcome(tier: ReasoningTier, pdseScore: number): void {
  const entry = this.tierOutcomes.get(tier);
  if (entry) {
    entry.totalPdse += pdseScore;
    entry.count++;
  }
}

/**
 * Get the average PDSE score for each tier.
 * Returns undefined for tiers with insufficient data (<3 samples).
 */
getTierPerformance(): Record<ReasoningTier, number | undefined> {
  const result: Record<ReasoningTier, number | undefined> = {
    quick: undefined,
    deep: undefined,
    expert: undefined,
  };
  for (const [tier, data] of this.tierOutcomes) {
    if (data.count >= 3) {
      result[tier] = data.totalPdse / data.count;
    }
  }
  return result;
}

/**
 * Get an adaptive bias for tier selection based on past outcomes.
 * Returns a complexity adjustment: positive = bias toward higher tier,
 * negative = bias toward lower tier.
 *
 * Logic: if quick-tier historically produces PDSE > 0.85, bias toward quick.
 * If expert-tier doesn't improve on deep, don't escalate.
 */
getAdaptiveBias(): number {
  const perf = this.getTierPerformance();
  if (perf.quick === undefined || perf.deep === undefined) return 0;

  // If quick tier performs well (>0.85), bias toward quick (-0.1 = lower complexity threshold)
  if (perf.quick > 0.85) return -0.1;

  // If expert doesn't significantly beat deep (<5% improvement), bias away from expert
  if (perf.expert !== undefined && perf.deep !== undefined) {
    if (perf.expert - perf.deep < 0.05) return -0.05;
  }

  return 0;
}
```

**Wire into decideTier:**

```typescript
// In decideTier, before the tier selection logic:
const adaptiveBias = this.getAdaptiveBias();
const adjustedComplexity = taskComplexity - costBias - budgetBias + adaptiveBias;
```

**Wire into agent-loop.ts — record outcome after each round:**

```typescript
// After PDSE scoring completes for the round:
if (lastPdseScore !== undefined) {
  reasoningChain.recordTierOutcome(tier, lastPdseScore / 100);
}
```

---

## 4. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/core/src/reasoning-chain-feedback.test.ts` | 80 | Feedback loop + cost-aware tests |

### MODIFIED Files

| # | Path | Change | LOC Est. |
|---|---|---|---|
| 2 | `packages/core/src/reasoning-chain.ts` | Add cost-aware decideTier, tier outcome tracking, adaptive bias, getCostMultiplier | +100 |
| 3 | `packages/cli/src/slash-commands.ts` | Add /think command with stats, chain, and tier override | +150 |
| 4 | `packages/cli/src/agent-loop.ts` | Wire reasoning override from replState, pass costMultiplier, record tier outcomes, display tier in output | +50 |
| 5 | `packages/cli/src/stream-renderer.ts` | Display reasoning tier and thinking budget in output header | +20 |

### Total: 1 new file + 4 modified, ~400 LOC source + ~80 LOC tests

---

## 5. Tests

### `reasoning-chain-feedback.test.ts` (~10 tests)
1. `recordTierOutcome("quick", 0.9)` × 5 → `getTierPerformance().quick` ≈ 0.9
2. `getTierPerformance()` returns undefined for tiers with <3 samples
3. `getAdaptiveBias()` returns -0.1 when quick tier performs above 0.85
4. `getAdaptiveBias()` returns -0.05 when expert doesn't significantly beat deep
5. `getAdaptiveBias()` returns 0 with insufficient data
6. `getCostMultiplier("opus")` → 5.0
7. `getCostMultiplier("haiku")` → 0.5
8. Cost-aware decideTier: high cost model + low complexity → stays quick (doesn't escalate)
9. Budget pressure: low remaining budget → biases toward lower tier
10. Combined: high cost + budget pressure + moderate complexity → deep, not expert

### Additions to existing `reasoning-chain.test.ts` (~3 tests)
11. decideTier with costMultiplier → adjusts thresholds
12. decideTier with remainingBudget → adjusts thresholds
13. decideTier backward compatible: no costMultiplier → same behavior as before

**Total: ~13 tests**

---

## 6. Claude Code Execution Instructions

**Single sprint, 1-2 hours. 2 phases.**

```
Phase 1: Core Reasoning Upgrades (0.5-1h)
  1. Modify packages/core/src/reasoning-chain.ts:
     - Add costMultiplier + remainingBudget to decideTier context
     - Add getCostMultiplier() helper function
     - Add tierOutcomes tracking (recordTierOutcome, getTierPerformance, getAdaptiveBias)
     - Wire adaptiveBias into decideTier
  2. Create packages/core/src/reasoning-chain-feedback.test.ts
  3. Run: cd packages/core && npx vitest run
  GATE: All existing 45 reasoning-chain tests pass + new tests pass

Phase 2: CLI Surface + Wiring (0.5-1h)
  4. Add /think command to packages/cli/src/slash-commands.ts
  5. Add reasoningOverride + reasoningOverrideSession to ReplState
  6. Modify packages/cli/src/agent-loop.ts:
     - Check replState.reasoningOverride before decideTier
     - Pass costMultiplier to decideTier
     - Record tier outcome after PDSE scoring
     - Store lastThinkingBudget on replState for /think display
  7. Modify packages/cli/src/stream-renderer.ts — show tier + budget in header
  8. Run: npx turbo test
  GATE: Full test suite passes
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- **ZERO regressions on existing 45 reasoning-chain tests** — this is critical, the chain is battle-tested
- decideTier MUST be backward compatible — when costMultiplier and remainingBudget are undefined, behavior is identical to current
- getCostMultiplier uses approximate, not exact pricing — it's a heuristic, not a billing system
- Tier override clears after one prompt unless --session flag is used
- All feedback loop operations are synchronous (no async, no IO) — just in-memory tracking

---

## 7. UX Examples

**Current (invisible):**
```
> refactor the authentication module
[status] Starting grok/grok-3...
(agent works... user has no idea what reasoning tier is active)
```

**After DanteThink:**
```
my-session grok-3 🛡️ r5 ❯ refactor the authentication module

 ── grok/grok-3 [🧠 deep] (4,096 thinking tokens) ────────

  (agent works with visible tier indicator)

  ✓ DanteForge: PDSE 91 | Reasoning: deep → no escalation needed

my-session grok-3 🛡️ r6 ❯ /think expert
  Reasoning set to expert for next prompt (high token usage)

my-session grok-3 🛡️ r6 ❯ now redesign the database schema

 ── grok/grok-3 [🔬 expert] (10,240 thinking tokens) ────────

  (agent works with full decomposition + verification)

my-session grok-3 🛡️ r7 ❯ /think stats
  Reasoning Statistics
    Total steps: 14
    Tier distribution: quick=3 deep=8 expert=3
    Critiques: 2
    Auto-escalations: 1
    Average PDSE: 88

my-session grok-3 🛡️ r7 ❯ /think chain 5
  Reasoning Chain (last 5 steps)

  💭 #10 [thinking] P:91
    Analyze step-by-step: 1) What is being asked...
  🔍 #11 [critique] P:91
    Proceed with current approach
  💭 #12 [thinking] P:88
    Deep analysis required: 1) Decompose the problem...
  ⚡ #13 [action]
    Writing src/db/schema.ts with new table definitions
  🔍 #14 [critique] P:88 ↑escalated
    Minor adjustments recommended — consider index optimization
```

---

## 8. Success Criteria

| Criteria | Target |
|---|---|
| `/think` shows current reasoning state | ✅ |
| `/think expert` overrides tier for next prompt | ✅ |
| `/think deep --session` overrides for entire session | ✅ |
| `/think auto` restores automatic selection | ✅ |
| `/think stats` shows tier distribution + PDSE averages | ✅ |
| `/think chain` shows recent reasoning steps | ✅ |
| Cost-aware decideTier: expensive models bias toward lower tiers | ✅ |
| Budget-aware decideTier: low remaining budget biases toward lower tiers | ✅ |
| Feedback loop: tier outcomes tracked and bias future decisions | ✅ |
| Reasoning tier visible in agent output header | ✅ |
| Auto-escalation events visible to user | ✅ |
| Existing 45 reasoning-chain tests | 0 regressions |
| decideTier backward compatible | ✅ |

---

## 9. How This Completes the Matrix

DanteThink is the final PRD. With all 8 PRDs executed, every dimension in the scoring matrix has a path from current state to 9.0+ Feature Parity (Score A):

| Dimension | Before | After All PRDs |
|---|---|---|
| WebSearch | 8.0 | 8.0 (already strong) |
| WebFetch | 7.5 | 7.5 (already strong) |
| Agent Spawning | 7.5 | 9.0 (DanteFleet+) |
| GitHub CLI | 7.5 | 7.5 (already strong) |
| Skill Decomposition | 7.0 | 9.0 (DanteSkills) |
| Model Reasoning | 8.0 | 9.0 (DanteThink) |
| Verification/QA | 8.5 | 8.5 (already strongest) |
| Agent Autonomy | 8.0 | 9.0 (DanteEvents + DanteFleet+) |
| Inline Completions | 7.0 | 9.0 (DanteComplete) |
| Event Automation | 7.5 | 9.0 (DanteEvents) |
| Sandbox/Isolation | 7.0 | 7.0 (needs battle-testing, not features) |
| IDE Integration | 7.0 | 9.0 (DanteServe) |
| Session/Memory | 7.5 | 9.0 (DanteSession) |
| Production Maturity | 7.0 | 7.0 (needs battle-testing, not features) |
| Security/Safety | 7.0 | 7.0 (needs battle-testing, not features) |
| Developer UX | 7.0 | 9.0 (DanteTUI) |
| Debug Memory | 6.5 | 6.5 (needs PRD B Phases 2-4) |

The remaining gaps (Sandbox, Production Maturity, Security, Debug Memory) aren't feature gaps — they're battle-testing gaps. Score B moves when autoresearch runs against real workloads and proves the infrastructure works.

---

*"The best reasoner isn't the one that always thinks the hardest. It's the one that knows when to think hard and when to move fast."*
