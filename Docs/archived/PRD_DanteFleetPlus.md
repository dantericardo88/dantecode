# EXECUTION PACKET: DanteFleet+ — Parallel Agent Execution Depth
## Agent Spawning / SubAgents (7.5 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteFleet+ |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/core` (council system) + `@dantecode/cli` (fleet UX) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~700 source + ~350 tests |
| **Sprint Time** | 2-3 hours for Claude Code |

---

## 1. The Situation

DanteCode's council/fleet system is already the most architecturally complete multi-agent system of any open-source competitor. The infrastructure:

| Component | LOC | What It Does |
|---|---|---|
| `council-orchestrator.ts` | 780+ | Full state machine (idle→planning→running→merging→verifying→completed) |
| `council-router.ts` | — | Lane assignment, overlap detection, file ownership |
| `merge-brain.ts` | — | Intelligent merge of multi-agent outputs |
| `merge-confidence.ts` | — | Confidence scoring on merge candidates |
| `overlap-detector.ts` | — | Detects when agents touch the same files |
| `worktree-observer.ts` | — | Monitors worktree changes during execution |
| `usage-ledger.ts` | — | Token/cost tracking per agent |
| `handoff-engine.ts` | — | Structured handoff packets between agents |
| 5 agent adapters | — | DanteCode (self), Claude Code, Codex, Antigravity, file-bridge |
| 4 YAML manifests | — | builder, reviewer, tester, planner with model + sandbox config |

Plus CLI: `dantecode council fleet "<objective>"` with `--agents`, `--no-worktree`, `--timeout`, worktree creation per agent, SIGINT detach with resume, and event-driven status output.

**What's working:**
- Worktree isolation per agent ✅
- YAML agent manifests ✅
- CouncilOrchestrator with state machine ✅
- MergeBrain for combining outputs ✅
- Agent adapters for external tools ✅
- Usage tracking per agent ✅
- Resume after detach ✅

**What's missing for 9.0 (5 targeted additions):**

1. **Per-lane DanteForge verification** — lanes complete and merge, but individual lane output isn't PDSE-scored before merge. Bad output from one agent contaminates the merge.
2. **Fleet-wide resource budget** — no aggregate token limit across all agents. A runaway agent can consume the entire budget.
3. **Live fleet progress dashboard** — fleet execution outputs `console.log` lines. No unified dashboard showing all lanes with progress, tokens, and status simultaneously.
4. **Dynamic task redistribution** — if an agent finishes early, it sits idle. No mechanism to reassign pending work from a slow/stuck agent to a free one.
5. **Agent nesting depth** — subAgents can spawn from the agent loop, but fleet agents can't spawn sub-agents. Max depth is 1 (parent → child). Codex supports configurable max_depth for nesting.

---

## 2. Competitive Benchmark

### Devin (10 — the benchmark)
- Cloud VM per agent with full environment
- Planner/Coder/Critic triad with multi-agent dispatch
- Fleet execution for parallel repo migrations
- Self-assessed confidence → human escalation
- 67% PR merge rate across thousands of deployments

### Codex (9.5)
- Declarative TOML subagent files with per-agent model/sandbox
- Nesting with `agents.max_depth` config (default: 1)
- Subagent approval requests surface in parent thread
- Per-agent SQLite state
- Cloud delegation via `codex cloud exec`

### Claude Code (9.5)
- Agent Teams with lead agent coordinating work
- Subagents with custom personas and context windows
- /simplify spawns 3 parallel review agents
- Each subagent runs in its own context

### Cursor (9.0)
- Up to 8 parallel cloud agents on Ubuntu VMs
- Git worktree per agent
- BugBot as always-on parallel reviewer
- Most tasks complete in <30 seconds

### DanteCode Current (7.5 feature / lower proven)
- Full orchestrator + adapters + manifests + worktrees ✅
- Sequential lane assignment (worktrees created in for loop)
- No per-lane verification
- No fleet budget
- No progress dashboard
- No dynamic redistribution
- No nesting depth

---

## 3. Component Specifications

### 3.1 — Per-Lane DanteForge Verification Gate

When a lane completes, its output must be PDSE-scored before being accepted into the merge candidate pool.

**File:** `packages/core/src/council/council-orchestrator.ts` — MODIFY

In the lane completion handler (when adapter reports "completed"):

```typescript
// EXISTING: Lane marks as completed, output goes to merge pool
// NEW: Verify before accepting

private async onLaneCompleted(laneId: string, agentKind: AgentKind): Promise<void> {
  const lane = this.getLane(laneId);
  if (!lane) return;

  // Get the files changed by this lane
  const artifacts = await this.getAdapterFor(agentKind)?.getArtifacts(lane.sessionId);
  const changedFiles = artifacts?.touchedFiles ?? [];

  // Run DanteForge PDSE on changed files
  if (changedFiles.length > 0 && lane.worktreePath) {
    const verificationResult = await this.verifyLaneOutput(lane.worktreePath, changedFiles);
    lane.pdseScore = verificationResult.aggregateScore;
    lane.verificationPassed = verificationResult.aggregateScore >= this.pdseThreshold;

    this.emit("lane:verified", {
      laneId,
      agentKind,
      pdseScore: verificationResult.aggregateScore,
      passed: lane.verificationPassed,
      findings: verificationResult.findings,
    });

    if (!lane.verificationPassed) {
      // Option 1: Retry the lane (if retries remaining)
      if (lane.retryCount < (this.config.maxLaneRetries ?? 1)) {
        lane.retryCount++;
        this.emit("lane:retry", { laneId, agentKind, reason: `PDSE ${lane.pdseScore} below ${this.pdseThreshold}` });
        await this.retryLane(lane);
        return;
      }
      // Option 2: Accept with warning (merge brain considers score in confidence)
      this.emit("lane:accepted-with-warning", {
        laneId,
        agentKind,
        pdseScore: lane.pdseScore,
        warning: `Lane accepted despite PDSE ${lane.pdseScore} (below ${this.pdseThreshold}) — max retries exhausted`,
      });
    }
  }

  // Proceed to existing completion logic
  this.emit("lane:completed", { laneId, agentKind });
  await this.checkAllLanesComplete();
}

/**
 * Run DanteForge verification on a lane's output files.
 * Uses the same PDSE + anti-stub + constitution pipeline as the main agent loop.
 */
private async verifyLaneOutput(
  worktreePath: string,
  changedFiles: string[],
): Promise<{ aggregateScore: number; findings: string[] }> {
  // Import runLocalPDSEScorer from danteforge
  const { runLocalPDSEScorer } = await import("@dantecode/danteforge");
  
  let totalScore = 0;
  const allFindings: string[] = [];

  for (const file of changedFiles) {
    try {
      const content = await readFile(join(worktreePath, file), "utf8");
      const score = await runLocalPDSEScorer(content, file);
      totalScore += score.finalScore;
      if (score.issues) allFindings.push(...score.issues.map((i: { message: string }) => `${file}: ${i.message}`));
    } catch {
      // File might be deleted or binary — skip
    }
  }

  const aggregateScore = changedFiles.length > 0 ? totalScore / changedFiles.length : 100;
  return { aggregateScore, findings: allFindings };
}
```

---

### 3.2 — Fleet-Wide Resource Budget

Track aggregate token usage across all lanes and enforce a ceiling.

**File:** `packages/core/src/council/fleet-budget.ts` (NEW)

```typescript
/**
 * Fleet-wide resource budget — prevents runaway agents from consuming
 * the entire token/cost budget.
 *
 * When the aggregate budget is exhausted:
 * - Running lanes receive an abort signal
 * - Pending lanes are not started
 * - The fleet enters "budget-exhausted" state
 * - A report shows per-agent consumption
 */

export interface FleetBudgetConfig {
  /** Maximum total tokens across all agents. 0 = unlimited. */
  maxTotalTokens: number;
  /** Maximum tokens per individual agent. 0 = unlimited. */
  maxTokensPerAgent: number;
  /** Maximum total cost in USD. 0 = unlimited. */
  maxTotalCostUsd: number;
  /** Warning threshold (0-1): emit warning at this % of budget. Default: 0.8. */
  warningThreshold: number;
}

export interface FleetBudgetState {
  totalTokensUsed: number;
  totalCostUsd: number;
  perAgent: Map<string, { tokens: number; cost: number }>;
  exhausted: boolean;
  warningEmitted: boolean;
}

export class FleetBudget {
  private config: FleetBudgetConfig;
  private state: FleetBudgetState;

  constructor(config?: Partial<FleetBudgetConfig>);

  /** Record token usage for an agent. Returns false if budget exhausted. */
  record(agentId: string, tokens: number, costUsd: number): boolean;

  /** Check if an agent can continue (within per-agent and total limits). */
  canContinue(agentId: string): boolean;

  /** Check if the fleet-wide budget is approaching exhaustion. */
  isWarning(): boolean;

  /** Check if the fleet-wide budget is exhausted. */
  isExhausted(): boolean;

  /** Get a summary report. */
  report(): {
    totalTokens: number;
    totalCost: number;
    budgetRemaining: number;
    perAgent: Array<{ agentId: string; tokens: number; cost: number; pctOfTotal: number }>;
  };

  /** Get remaining budget for a specific agent. */
  remainingForAgent(agentId: string): { tokens: number; cost: number };
}
```

**Wire into CouncilOrchestrator:**

```typescript
// In constructor:
this.budget = new FleetBudget(config.budget);

// In the poll loop that checks lane status:
for (const lane of this.activeLanes) {
  const usage = await this.getAdapterFor(lane.agentKind)?.getUsage(lane.sessionId);
  if (usage) {
    const canContinue = this.budget.record(lane.id, usage.tokens, usage.costUsd);
    if (!canContinue) {
      this.emit("budget:agent-limit", { laneId: lane.id, agentKind: lane.agentKind });
      await this.abortLane(lane.id, "Per-agent token budget exhausted");
    }
  }
}

if (this.budget.isExhausted()) {
  this.emit("budget:exhausted", this.budget.report());
  await this.fail("Fleet-wide token budget exhausted");
}

if (this.budget.isWarning() && !this.budgetWarningEmitted) {
  this.emit("budget:warning", this.budget.report());
  this.budgetWarningEmitted = true;
}
```

---

### 3.3 — Live Fleet Progress Dashboard

Replace `console.log` lines with a structured progress display.

**File:** `packages/cli/src/fleet-dashboard.ts` (NEW)

```typescript
/**
 * Live fleet progress dashboard for the terminal.
 * Shows all active lanes with: agent name, status, progress, tokens, PDSE.
 * Redraws on events from CouncilOrchestrator.
 *
 * Uses ANSI escape codes for in-place redraw (no Ink dependency).
 */

import type { ThemeEngine } from "@dantecode/ux-polish";

export interface FleetLaneDisplay {
  laneId: string;
  agentName: string;
  agentKind: string;
  status: "pending" | "running" | "completed" | "failed" | "verifying" | "retrying";
  progressHint?: string;      // e.g., "writing src/auth.ts" or "running tests"
  tokensUsed: number;
  pdseScore?: number;
  elapsedMs: number;
  worktreeBranch?: string;
}

export interface FleetDashboardState {
  objective: string;
  runId: string;
  lanes: FleetLaneDisplay[];
  totalTokens: number;
  budgetRemaining?: number;
  elapsedMs: number;
  status: string;              // orchestrator lifecycle status
}

/**
 * Render the fleet dashboard as a multi-line ANSI string.
 * Designed for in-place terminal redraw via cursor positioning.
 */
export function renderFleetDashboard(
  state: FleetDashboardState,
  theme?: ThemeEngine,
): string {
  const c = theme?.resolve() ?? { /* default ANSI colors */ };
  const lines: string[] = [];

  lines.push(`╭─ Fleet: ${state.objective.slice(0, 60)} ─${"─".repeat(Math.max(0, 55 - state.objective.length))}╮`);
  lines.push(`│  Run: ${state.runId.slice(0, 8)}  Status: ${formatStatus(state.status)}  Time: ${formatDuration(state.elapsedMs)}  Tokens: ${state.totalTokens.toLocaleString()}${state.budgetRemaining ? ` / ${state.budgetRemaining.toLocaleString()}` : ""}  │`);
  lines.push(`├${"─".repeat(68)}┤`);

  for (const lane of state.lanes) {
    const statusIcon = getStatusIcon(lane.status);
    const pdse = lane.pdseScore !== undefined ? `P:${lane.pdseScore}` : "P:--";
    const tokens = `${(lane.tokensUsed / 1000).toFixed(1)}K`;
    const elapsed = formatDuration(lane.elapsedMs);
    const progress = lane.progressHint?.slice(0, 25) ?? "";

    lines.push(
      `│  ${statusIcon} ${padRight(lane.agentName, 12)} ${padRight(lane.status, 10)} ${padRight(tokens, 7)} ${padRight(pdse, 6)} ${padRight(elapsed, 7)} ${progress}  │`
    );
  }

  lines.push(`╰${"─".repeat(68)}╯`);
  return lines.join("\n");
}

/**
 * Fleet dashboard that redraws in-place using ANSI cursor control.
 */
export class FleetDashboard {
  private state: FleetDashboardState;
  private lastLineCount = 0;
  private theme?: ThemeEngine;

  constructor(initialState: FleetDashboardState, theme?: ThemeEngine);

  /** Update a specific lane's state. */
  updateLane(laneId: string, patch: Partial<FleetLaneDisplay>): void;

  /** Update fleet-level state. */
  updateFleet(patch: Partial<Omit<FleetDashboardState, "lanes">>): void;

  /** Redraw the dashboard in place (ANSI cursor positioning). */
  draw(): void;

  /** Clear the dashboard from terminal. */
  clear(): void;
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "pending": return "⏳";
    case "running": return "🔄";
    case "completed": return "✅";
    case "failed": return "❌";
    case "verifying": return "🔍";
    case "retrying": return "🔁";
    default: return "❓";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}
```

**Wire into council fleet command:**

Replace the `console.log` event handlers in `cmdFleet` with FleetDashboard:

```typescript
const dashboard = new FleetDashboard({
  objective,
  runId,
  lanes: selectedManifests.map(m => ({
    laneId: "",  // filled on lane assignment
    agentName: m.name,
    agentKind: manifestToAgentKind(m) as string,
    status: "pending",
    tokensUsed: 0,
    elapsedMs: 0,
  })),
  totalTokens: 0,
  elapsedMs: 0,
  status: "planning",
});

orchestrator.on("lane:completed", ({ laneId, agentKind }) => {
  dashboard.updateLane(laneId, { status: "completed" });
  dashboard.draw();
});

orchestrator.on("lane:verified", ({ laneId, pdseScore, passed }) => {
  dashboard.updateLane(laneId, { status: "verifying", pdseScore });
  dashboard.draw();
});

orchestrator.on("lane:retry", ({ laneId }) => {
  dashboard.updateLane(laneId, { status: "retrying" });
  dashboard.draw();
});

orchestrator.on("budget:warning", (report) => {
  dashboard.updateFleet({ budgetRemaining: report.budgetRemaining });
  dashboard.draw();
});

// Periodic redraw for elapsed time
const timer = setInterval(() => {
  dashboard.updateFleet({ elapsedMs: Date.now() - startTime });
  dashboard.draw();
}, 2000);
```

---

### 3.4 — Dynamic Task Redistribution

When an agent finishes early, attempt to redistribute pending work from slower agents.

**File:** `packages/core/src/council/task-redistributor.ts` (NEW)

```typescript
/**
 * Dynamic task redistribution — when an agent finishes early,
 * check if other agents have sub-tasks that could be redistributed.
 *
 * This is a lightweight optimization, not a full work-stealing scheduler.
 * It works by:
 * 1. Detecting when a lane completes while others are still running
 * 2. Checking if the slow lane's objective can be decomposed
 * 3. If yes, creating a new sub-lane for the idle agent
 *
 * Constraints:
 * - Only redistributes to agents of the same or higher capability tier
 * - Respects file ownership (no two agents touch the same files)
 * - Won't redistribute if the slow agent is >80% done (not worth the overhead)
 */

export interface RedistributionCandidate {
  fromLaneId: string;
  toLaneId: string;       // The idle lane that could take work
  subObjective: string;   // The piece of work to redistribute
  estimatedTokens: number;
  priority: "high" | "medium" | "low";
}

export interface RedistributionResult {
  redistributed: boolean;
  candidate?: RedistributionCandidate;
  reason: string;         // Why redistribution did or didn't happen
}

export class TaskRedistributor {
  /**
   * Check if work can be redistributed from busy lanes to an idle agent.
   * Returns a candidate if redistribution is possible, null otherwise.
   */
  async findRedistribution(
    idleLaneId: string,
    idleAgentKind: string,
    busyLanes: Array<{
      laneId: string;
      agentKind: string;
      objective: string;
      startedAt: number;
      estimatedCompletion?: number;  // 0-1 progress estimate
      ownedFiles: string[];
    }>,
  ): Promise<RedistributionCandidate | null>;

  /**
   * Decompose a lane's objective into sub-tasks.
   * Uses a lightweight heuristic: split by "and", "then", numbered steps.
   * Does NOT use LLM (too expensive for redistribution decisions).
   */
  decomposeObjective(objective: string): string[];
}
```

**Wire into CouncilOrchestrator — in the lane completion handler:**

```typescript
// After lane verification passes:
if (this.activeLanes.some(l => l.status === "running")) {
  const redistributor = new TaskRedistributor();
  const candidate = await redistributor.findRedistribution(
    completedLane.id,
    completedLane.agentKind,
    this.activeLanes.filter(l => l.status === "running").map(l => ({
      laneId: l.id,
      agentKind: l.agentKind,
      objective: l.objective,
      startedAt: l.startedAt,
      ownedFiles: l.ownedFiles ?? [],
    })),
  );

  if (candidate) {
    this.emit("redistribution", candidate);
    // Create a new sub-lane for the idle agent
    await this.assignLane({
      preferredAgent: completedLane.agentKind,
      objective: candidate.subObjective,
      worktreePath: completedLane.worktreePath, // Reuse the worktree
      branch: completedLane.branch,
      baseBranch: "main",
      taskCategory: "coding",
      ownedFiles: [],
    });
  }
}
```

---

### 3.5 — Configurable Nesting Depth

Allow agents to spawn sub-agents during fleet execution, with configurable max depth.

**File:** `packages/core/src/council/council-types.ts` — MODIFY

Add nesting config:

```typescript
export interface CouncilConfig {
  // ... existing fields ...

  /** Maximum nesting depth for agent spawning. Default: 1 (parent → child only).
   *  0 = no sub-agents. 2 = parent → child → grandchild. */
  maxNestingDepth?: number;

  /** Maximum retries per lane on verification failure. Default: 1. */
  maxLaneRetries?: number;

  /** Fleet-wide resource budget. */
  budget?: Partial<FleetBudgetConfig>;
}
```

**File:** `packages/core/src/council/council-orchestrator.ts` — MODIFY

Track current nesting depth when spawning sub-lanes:

```typescript
// In assignLane:
async assignLane(request: LaneAssignmentRequest & { nestingDepth?: number }) {
  const depth = request.nestingDepth ?? 0;
  const maxDepth = this.config.maxNestingDepth ?? 1;

  if (depth > maxDepth) {
    return {
      accepted: false,
      reason: `Nesting depth ${depth} exceeds max ${maxDepth}`,
      laneId: "",
    };
  }

  // ... existing logic ...

  // When creating the SelfLaneExecutor for this lane, pass depth + 1
  // so the child can also spawn, up to the limit
}
```

**File:** `.dantecode/STATE.yaml` — add config:

```yaml
council:
  maxNestingDepth: 2    # parent → child → grandchild
  maxLaneRetries: 1
  budget:
    maxTotalTokens: 500000
    maxTokensPerAgent: 150000
    warningThreshold: 0.8
```

---

## 4. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/core/src/council/fleet-budget.ts` | 120 | Fleet-wide resource budget |
| 2 | `packages/cli/src/fleet-dashboard.ts` | 150 | Live terminal dashboard for fleet progress |
| 3 | `packages/core/src/council/task-redistributor.ts` | 100 | Dynamic task redistribution |
| 4 | `packages/core/src/council/fleet-budget.test.ts` | 100 | Budget tests |
| 5 | `packages/cli/src/fleet-dashboard.test.ts` | 80 | Dashboard render tests |
| 6 | `packages/core/src/council/task-redistributor.test.ts` | 80 | Redistribution tests |

### MODIFIED Files

| # | Path | Change | LOC Est. |
|---|---|---|---|
| 7 | `packages/core/src/council/council-orchestrator.ts` | Add per-lane verification, budget integration, redistribution hook, nesting depth | +100 |
| 8 | `packages/core/src/council/council-types.ts` | Add CouncilConfig fields (maxNestingDepth, maxLaneRetries, budget) | +15 |
| 9 | `packages/cli/src/commands/council.ts` | Wire FleetDashboard into cmdFleet, replace console.log | +50 |
| 10 | `packages/core/src/council/index.ts` or equivalent | Export new modules | +5 |

### Total: 6 new files + 4 modified, ~700 LOC source + ~260 LOC tests

---

## 5. Tests

### `fleet-budget.test.ts` (~8 tests)
1. Record usage → total increases
2. Per-agent limit reached → canContinue returns false
3. Fleet-wide limit reached → isExhausted returns true
4. Warning threshold at 80% → isWarning true
5. Unlimited budget (0) → never exhausts
6. Report shows per-agent breakdown with percentages
7. remainingForAgent returns correct values
8. Multiple agents tracked independently

### `fleet-dashboard.test.ts` (~6 tests)
1. renderFleetDashboard with 3 lanes → correct format
2. updateLane changes status → re-render shows new status
3. Completed lane shows ✅ icon
4. Failed lane shows ❌ icon
5. PDSE score displayed when available
6. Budget remaining shown when configured

### `task-redistributor.test.ts` (~5 tests)
1. One idle + one busy → redistribution candidate found
2. All lanes complete → no candidate (nothing to redistribute)
3. Busy lane at 90% progress → no redistribution (not worth overhead)
4. decomposeObjective splits on "and" → correct sub-tasks
5. File ownership conflict → no redistribution

### Additional in `council.test.ts` (~4 tests)
6. Per-lane verification: PDSE below threshold → lane retried
7. Per-lane verification: retry exhausted → accepted with warning
8. Nesting depth: depth 2 with maxDepth 1 → rejected
9. Nesting depth: depth 1 with maxDepth 2 → accepted

**Total: ~23 tests**

---

## 6. Claude Code Execution Instructions

**Single sprint, 2-3 hours. 2 phases.**

```
Phase 1: Core Infrastructure (1.5-2h)
  1. Create packages/core/src/council/fleet-budget.ts
  2. Create packages/core/src/council/task-redistributor.ts
  3. Create both test files
  4. Modify packages/core/src/council/council-orchestrator.ts:
     - Add verifyLaneOutput() method
     - Wire budget checking into poll loop
     - Add redistribution check on lane completion
     - Add nesting depth enforcement to assignLane
  5. Modify packages/core/src/council/council-types.ts — add config fields
  6. Run: npx vitest run packages/core/src/council/
  GATE: All existing council tests pass (CRITICAL) + new tests pass

Phase 2: Dashboard + CLI Wiring (0.5-1h)
  7. Create packages/cli/src/fleet-dashboard.ts
  8. Create fleet-dashboard.test.ts
  9. Modify packages/cli/src/commands/council.ts:
     - Import and initialize FleetDashboard in cmdFleet
     - Wire orchestrator events to dashboard updates
     - Replace console.log with dashboard.draw()
  10. Run: npx turbo test
  GATE: Full test suite passes
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- **ZERO regressions on existing council tests** — these test a complex state machine
- FleetBudget is purely synchronous (no async, no IO) — just arithmetic and state
- TaskRedistributor.decomposeObjective uses heuristics only, NOT LLM calls (too expensive)
- Dashboard rendering is pure (state in → string out) — draw() is the only side effect
- Per-lane verification uses dynamic import of @dantecode/danteforge (avoids circular deps)

---

## 7. Success Criteria

| Criteria | Target |
|---|---|
| Per-lane PDSE verification before merge | ✅ |
| Lane retry on PDSE failure (configurable max retries) | ✅ |
| Fleet-wide token budget with per-agent limits | ✅ |
| Live dashboard with per-lane status, tokens, PDSE | ✅ |
| Dynamic redistribution when agent finishes early | ✅ |
| Configurable nesting depth in STATE.yaml | ✅ |
| Existing council tests | 0 regressions |
| All new files | PDSE ≥ 85, anti-stub clean |

---

## 8. The Moat

Cursor runs 8 parallel cloud agents. Codex has subagent nesting. Claude Code has Agent Teams. Devin has fleet execution. They all run agents in parallel.

**None of them PDSE-score each agent's output before merging.** They merge blindly and hope. When Agent A produces a stub and Agent B produces clean code, the merge includes both. The stub passes because nobody checked.

DanteFleet+ verifies every lane's output constitutionally before it enters the merge pool. A lane that produces anti-stub code gets retried. A lane that burns too many tokens gets budget-capped. A lane that finishes early gets redistributed work. The fleet is constitutionally governed, not just parallelized.

**Fleet parallelism is table stakes. Fleet verification is the moat.**

---

*"The best fleet isn't the fastest. It's the one where every ship arrives with cargo you can trust."*
