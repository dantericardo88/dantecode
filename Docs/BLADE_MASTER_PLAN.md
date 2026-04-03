# Blade Master Plan: DanteCode Ultimate Execution System

## Executive Summary

DanteCode possesses the strongest trust thesis in the AI coding agent space -- verification, receipts, evidence chains, PDSE scoring, anti-stub enforcement, and plain-language reporting. What it lacks is the execution discipline, operator control, and long-horizon reliability to match that trust posture. The Blade Master Plan closes every identified gap (A1-A8 from the Recombination Masterplan, plus MASTER_PRD remaining items) by surgically adopting proven patterns from 9 harvested OSS repos. The result is a 14-stage execution pipeline backed by an append-only event substrate, a permission engine that enforces hard mode boundaries by architecture (not prompt), worktree-isolated parallel agents, an Aider-grade repair loop, and a progressive-disclosure UX. DanteCode becomes the most trustworthy and the most capable execution system -- all strengths, no avoidable weaknesses.

---

## Design Principles

1. **Truth Flows One Way.** DanteForge owns all verification logic. DanteCode consumes it through a narrow interface (`verify`, `seal`, `timeline`, `replay`, `policy-check`, `skill-verify`, `skill-forge`, `lesson-store`). No duplicate truth engine.

2. **Events Are The Source of Truth.** Every material action emits a typed `RuntimeEvent` into an append-only log (inspired by OpenHands). Reports, receipts, readiness artifacts, and replay are all derived from the event stream, never from assistant prose.

3. **Modes Are Architecturally Enforced.** `plan` and `review` cannot mutate by construction. The permission engine (Qwen Code pattern) evaluates `allow/ask/deny` per tool, path, command, skill, and mode. No prompt-only mode safety.

4. **Worktrees Are The Isolation Primitive.** Every parallel agent, every long-horizon subtask, and every checkpoint-restorable branch uses a git worktree (KiloCode + agent-orchestrator patterns). The main working tree is never at risk.

5. **Repair Before Success.** No `COMPLETE` status until post-apply lint, build, and test repair loops pass (Aider pattern). Verification runs after repair, not before.

6. **Crash Never Destroys Truth.** All long-running work uses `try/finally` with durable checkpoints (LangGraph checkpoint pattern). Interrupted runs produce honest `PARTIAL` reports. Resume is a first-class operator action.

7. **Progressive Disclosure, Not Progressive Confusion.** Session 1 sees prompt and result. Session 3 unlocks advanced commands. The operator always knows: what mode am I in, what is allowed, what changed, what was verified (OpenCode + KiloCode UX discipline).

---

## Architecture Overview

```
+------------------------------------------------------------------+
|                         OPERATOR SURFACE                          |
|  CLI (REPL + serve)  |  VS Code Extension  |  Desktop (future)   |
+------------------------------------------------------------------+
           |                     |                     |
           v                     v                     v
+------------------------------------------------------------------+
|                    EXECUTION PIPELINE (14 stages)                 |
|  Intake -> Classify -> Mode -> Permission -> Context -> Skill    |
|  -> Plan -> Decompose -> Execute -> Checkpoint -> Verify         |
|  -> Repair -> Report -> Lessons                                  |
+------------------------------------------------------------------+
           |            |            |            |
           v            v            v            v
+------------------------------------------------------------------+
|                       COORDINATION LAYER                          |
| Council Orchestrator | SubAgent Manager | Handoff Engine          |
| WorktreeManager      | Fleet Budget     | Task Redistributor     |
+------------------------------------------------------------------+
           |            |            |            |
           v            v            v            v
+------------------------------------------------------------------+
|                    RUNTIME SUBSTRATE                               |
| Event Bus (runtime-spine)  | Durable Run Store | Checkpoint Store |
| Permission Engine          | Approval Gateway  | Execution Policy |
| Artifact Store             | Session Store     | Evidence Chain   |
+------------------------------------------------------------------+
           |            |            |
           v            v            v
+------------------------------------------------------------------+
|                    DANTEFORGE (Truth Engine)                       |
| PDSE Scorer | Anti-Stub | Constitution | GStack | Receipt Sealer |
| Evidence Chain | Replay | Skill Verify | Lesson Store            |
+------------------------------------------------------------------+
           |            |
           v            v
+------------------------------------------------------------------+
|                    INFRASTRUCTURE                                  |
| Git Engine (worktrees, diff, repo map) | Sandbox (Docker/local)  |
| Model Router (providers + cost)        | Memory Engine            |
+------------------------------------------------------------------+
```

---

## OSS Pattern Harvest Summary

### 9 Repos Analyzed (All MIT/Apache 2.0 Licensed)

**Set 1:**
1. **LangGraph** - Graph-based stateful workflows, durable execution, versioned checkpoints
2. **agent-orchestrator** - Fleet coordination with git worktrees, parallel agents, recovery manager
3. **VoltAgent** - Workflow engine, nested workflow execution, suspend/resume
4. **CrewAI** - Task-based orchestration, sequential/hierarchical processes, async execution

**Set 2:**
5. **Qwen Code** - Approval modes (allow/ask/deny), subagent delegation, skill system, permission manager
6. **OpenCode** - Plan/Build split, permission engine, agent/session mental model, config layering
7. **OpenHands** - Append-only event system, persistence/resume, workspace abstraction, event store
8. **Aider** - Repo map with PageRank, repair loop (lint→test→fix), diff/undo culture, git-native

**Set 3:**
9. **KiloCode** - Custom modes, checkpoints, codebase indexing, agent manager, worktree lifecycle

---

## Phase 1: Execution Pipeline Redesign

**Gap closed: A1 (Task-boundary obedience), A2 (Hard mode system)**

### 1.1 Task Intake and Intent Boundary (Stage 1-2)

**Pattern source:** OpenCode session creation with parentSessionID tracking, agent-orchestrator task classification

**Implementation:**

- Extend `AgentLoopConfig` to require a `RunIntake` object created before any model call:
  ```typescript
  interface RunIntake {
    runId: string;
    userAsk: string;           // Original prompt, immutable
    classification: TaskClass; // explain | analyze | review | change | long-horizon | background
    requestedScope: string[];  // Files/paths mentioned
    allowedBoundary: ModeConstraints;
    parentRunId?: string;      // For subtask lineage
  }
  ```
- Task classification uses the existing `TaskComplexityRouter` extended with an intent classifier
- Boundary drift detection: After each tool round, compare actual mutations against `requestedScope`. Emit `runtime.boundary.drift` event if scope expands beyond 120% without explicit approval

### 1.2 Hard Mode System (Stage 3)

**Pattern source:** Qwen Code approval modes (allow/ask/deny/default), OpenCode approval mode integration

**Current state:** DanteCode has `CanonicalApprovalMode` with `review/apply/autoforge/plan/yolo` defined. The `plan` mode correctly denies write tools at approval-gateway level.

**Implementation:**

- Make `plan` and `review` deny at tool registration, not just approval. When mode is `plan`, the tool schemas returned by `getAISDKTools()` must exclude `Write`, `Edit`, `NotebookEdit`, `Bash`, `GitCommit`, `GitPush`, `SubAgent` entirely from the model's available tool list. The model cannot call what it cannot see.

- `review` mode allows Read, Glob, Grep, and produces diff proposals and task lists but never mutates. Tool exclusion is identical to `plan`.

- Mode transitions require explicit user action: `/mode apply`, `/mode autoforge`. Never automatic. Mode is persisted in session state and visible in the status bar.

- VS Code parity: The sidebar provider must read the same mode state and apply the same tool exclusion logic.

### 1.3 Permission Engine (Stage 4)

**Pattern source:** Qwen Code `PermissionManager` with allow/ask/deny decisions, rule parsing, shell-semantics-aware matching, plus OpenCode's channel-based grant/deny with session auto-approve

**Implementation:**

- Create `@dantecode/permission-engine` by extracting and extending the existing `ApprovalGateway` and `ExecutionPolicy`.

- Adopt Qwen Code's rule types:
  ```typescript
  interface PermissionRule {
    raw: string;
    toolName: string;
    specifier?: string;           // Path, command glob, skill name
    specifierKind: 'command' | 'path' | 'domain' | 'skill' | 'literal';
  }
  interface PermissionCheck {
    toolName: string;
    command?: string;
    filePath?: string;
    skillName?: string;
    mode: CanonicalApprovalMode;
    subagentId?: string;
  }
  ```

- Decision priority: deny > ask > default > allow (matching Qwen Code's `DECISION_PRIORITY`)

- Every permission decision emits a `RuntimeEvent` with kind `runtime.permission.evaluated` into the event bus

**Critical files:**
- `packages/core/src/approval-modes.ts` - Must enforce tool exclusion per mode
- `packages/cli/src/tool-schemas.ts` - Must filter available tools by mode
- `packages/core/src/tool-runtime/approval-gateway.ts` - Must wire permission engine

---

## Phase 2: Tool Orchestration Layer

**Gap closed: A7 (Aider-grade repair loop), partial A3 (Durable truth substrate)**

### 2.1 Tool Registration and Validation

**Pattern source:** DanteCode's existing `ExecutionPolicy` with execution classes, extended with VoltAgent's step-based workflow model

**Implementation:**

- Every tool registers with an `ExecutionClass` (read_only, file_write, process, network, acquire, agent, vcs) -- this already exists in `BUILTIN_TOOL_POLICIES`.

- Wire the `ToolScheduler` into the agent loop so that:
  - `read_only` tools run in parallel
  - `file_write` tools are serialized with each other
  - `vcs` tools are serialized and wait for all pending `file_write` tools
  - `agent` tools create isolated contexts

- Post-execution verification: For tools with `verifyAfterExecution: true`, automatically run the DanteForge verification pipeline after the tool completes.

### 2.2 Aider-Grade Repair Loop (Stage 12 in pipeline)

**Pattern source:** Aider's `base_coder.py` -- lint edited files, auto-commit lint fixes, ask to fix lint errors, then run tests and ask to fix test errors

**Implementation:**

After each apply round where files were edited, the repair loop runs:

```
1. Take git snapshot (existing GitSnapshotRecovery)
2. Run configured lint command on edited files
3. If lint errors:
   a. Auto-commit lint fixes (diff is visible in report)
   b. Feed lint errors back to model as "reflected_message"
   c. Model attempts fix (max 3 iterations)
4. Run configured test command
5. If test errors:
   a. Feed test errors back to model as "reflected_message"
   b. Model attempts fix (max 3 iterations)
6. Run DanteForge verification (PDSE, anti-stub, constitution)
7. If all pass: mark COMPLETE
8. If repair exhausted: mark PARTIAL, rollback to snapshot
```

Configuration lives in `STATE.yaml` or `.dantecode/config.json`:
```yaml
repairLoop:
  enabled: true
  lintCommand: "npm run lint -- --fix"
  testCommand: "npm test"
  maxLintRetries: 3
  maxTestRetries: 3
  autoCommitLintFixes: true
```

**Key difference from Aider:** DanteCode's repair loop runs DanteForge verification as the final gate. The loop is lint → test → verify, not just lint → test.

### 2.3 Diff/Undo Culture

**Pattern source:** Aider's git stash create approach, DanteCode's existing `GitSnapshotRecovery`

**Implementation:**

- Every apply round creates a snapshot before mutations begin
- `/undo` command restores to the most recent snapshot using `git checkout -- . && git stash apply <hash>`
- `/diff` command shows the diff between current state and last snapshot
- All diffs are included in the run report under "Files Changed" with green/red coloring in the TUI

**Critical files:**
- `packages/cli/src/agent-loop.ts` - Must integrate repair loop after apply rounds
- `packages/core/src/git-snapshot-recovery.ts` - Already exists, needs integration

---

## Phase 3: Agent Coordination System

**Gap closed: A1 (Task-boundary obedience for subagents), partial A4 (Worktree-backed recovery)**

### 3.1 Multi-Agent Decomposition

**Pattern source:** agent-orchestrator's `TaskNode` with hierarchical IDs and lineage context, CrewAI's `Process.sequential` and `Process.hierarchical`

**Implementation:**

Extend the existing `SubAgentManager` and `HandoffEngine` with:

```typescript
interface SubAgentScope {
  taskId: string;          // Hierarchical: "1", "1.2", "1.2.3"
  role: 'planner' | 'implementer' | 'tester' | 'reviewer' | 'docs';
  allowedTools: string[];  // Subset of parent's tools
  allowedPaths: string[];  // File/directory scope
  contextFiles: string[];  // Files this agent can read
  worktreeId?: string;     // Isolated worktree
  lineage: string[];       // Parent task descriptions
  mode: CanonicalApprovalMode;
  budget: { maxTokens: number; maxRounds: number; maxDurationMs: number };
}
```

- Each subagent receives its own permission scope derived from the parent's scope, narrowed by the task decomposition
- A subagent can never exceed its parent's permissions (Qwen Code pattern)
- Handoff summaries between agents are structured, not raw transcripts

### 3.2 Worktree Isolation

**Pattern source:** KiloCode's `WorktreeManager`, agent-orchestrator's session-per-worktree model

**Implementation:**

- DanteCode already has `GitSnapshotRecovery` and the `git-engine` package with worktree logic. The gap is wiring worktrees into the agent coordination layer.

- Extend the Council Orchestrator so that when `WorkflowWorktreePolicy` is `preferred` or `required`, each lane automatically creates a worktree via:
  ```
  git worktree add .dantecode/worktrees/<agentId> -b agent/<agentId> HEAD
  ```

- Worktree lifecycle follows KiloCode's pattern:
  1. Create worktree on agent spawn
  2. Agent works in isolated worktree
  3. On completion, verify in worktree (DanteForge)
  4. If verified, merge worktree branch back to parent
  5. Clean up worktree

### 3.3 Fleet Budget and Redistribution

**Current state:** Already built at `packages/core/src/council/fleet-budget.ts` and `packages/core/src/council/task-redistributor.ts`. These are tested but not wired into runtime.

**Implementation:** Wire `FleetBudget` into the council orchestrator so that `budget:warning` events trigger a notification to the operator, and `budget:exhausted` events halt spawning of new agents.

**Critical files:**
- `packages/core/src/council/council-orchestrator.ts` - Must integrate worktree creation per lane
- `packages/git-engine/src/worktree.ts` - Already exists, needs wiring
- `packages/core/src/subagent-manager.ts` - Must extend with SubAgentScope

---

## Phase 4: State & Recovery Infrastructure

**Gap closed: A3 (Durable truth substrate), A4 (Worktree-backed recovery)**

### 4.1 Append-Only Event Bus

**Pattern source:** OpenHands' `Event` base class with monotonically increasing IDs, source attribution, and causal linking, `EventStoreABC` with `search_events` and filtering

**Current state:** DanteCode has `RuntimeEventSchema` with Zod validation and an `EventEngine`. The gap: events are not persisted durably, and the event vocabulary does not cover the full pipeline.

**Implementation:**

Extend `RuntimeEventKindSchema` to cover all 14 pipeline stages:
```typescript
// New event kinds to add:
"run.intake.created"
"run.task.classified"
"run.mode.selected"
"run.mode.changed"
"run.permission.evaluated"
"run.permission.denied"
"run.context.assembled"
"run.skill.loaded"
"run.skill.executed"
"run.plan.created"
"run.decomposition.started"
"run.decomposition.completed"
"run.tool.started"
"run.tool.completed"
"run.tool.failed"
"run.checkpoint.saved"
"run.checkpoint.restored"
"run.repair.lint.started"
"run.repair.lint.completed"
"run.repair.test.started"
"run.repair.test.completed"
"run.report.written"
"run.boundary.drift"
"run.worktree.created"
"run.worktree.merged"
"run.worktree.cleaned"
```

Create `DurableEventStore`:
```typescript
interface DurableEventStore {
  append(event: RuntimeEvent): Promise<number>;  // Returns event ID
  search(filter: EventFilter): AsyncIterable<RuntimeEvent>;
  getEvent(id: number): Promise<RuntimeEvent>;
  getLatestId(): Promise<number>;
  getEventsForRun(runId: string): AsyncIterable<RuntimeEvent>;
}
```

**Storage:** Append-only JSONL at `.dantecode/events/<sessionId>.jsonl` (one file per session). This is lightweight, debuggable, and git-friendly. No database dependency.

### 4.2 Durable Checkpointing

**Pattern source:** LangGraph's `create_checkpoint()` with versioned channel values and `versions_seen`, VoltAgent's `WorkflowCheckpointStepData` and suspend/resume controller

**Current state:** `DurableExecutionEngine` exists with checkpoint/resume logic. It saves to `.dantecode/checkpoints/{sessionId}.json`.

**Implementation:**

Adopt LangGraph's versioning concept:

```typescript
interface DurableCheckpoint {
  version: number;
  runId: string;
  sessionId: string;
  stepIndex: number;
  eventId: number;           // Last event ID at checkpoint time
  worktreeRef?: string;      // Git ref if worktree is active
  gitSnapshotHash?: string;  // Stash hash for rollback
  channelVersions: Record<string, number>;  // Per-channel versions
  completedReceipts: ApplyReceipt[];
  partialOutput?: string;
  timestamp: string;
}
```

Resume flow: On session start, check for existing checkpoint. If found, offer `resume`, `replay`, or `fork` to the operator.

### 4.3 Recovery Manager

**Pattern source:** agent-orchestrator's recovery system which scans sessions, validates state, and executes recovery actions (recover, cleanup, escalate, skip)

**Implementation:**

Create a `RecoveryManager` that runs on session startup:
1. Scan `.dantecode/checkpoints/` for incomplete sessions
2. For each, validate the checkpoint against git state (does the worktree/branch still exist?)
3. Classify: `resumable`, `stale`, `corrupt`
4. Offer recovery options to operator

Integrate with the existing `RecoveryEngine` for re-read + context recovery, and `GitSnapshotRecovery` for rollback.

**Critical files:**
- `packages/runtime-spine/src/runtime-events.ts` - Must be extended with full event vocabulary
- `packages/core/src/event-engine.ts` - Must wire DurableEventStore
- `packages/core/src/durable-execution.ts` - Must adopt LangGraph versioned checkpoints

---

## Phase 5: Trust & Verification Integration

**Gap closed: A8 (Contract and hygiene sync), MASTER_PRD items (PDSE contract in UI, DanteThink cost-aware tier selection, Skillbook quality scorer)**

### 5.1 PDSE Contract in UI

**Current state:** PDSE scoring exists in `@dantecode/danteforge`. The gap is surface: when PDSE fails, the user sees a number, not a diagnosis.

**Implementation:**

When `PDSE < threshold`, the report and TUI must show per-dimension breakdown:
```
PDSE FAIL: 67/100
  Completeness  41/100 - createProduct() is an empty stub
  Correctness   82/100 - OK
  Clarity       73/100 - 2 unnamed parameters in processOrder()
  Consistency   72/100 - mixed naming convention (camelCase + snake_case)
```

This requires extending the PDSE scorer in `@dantecode/danteforge` to return dimension-level failure reasons, not just scores.

### 5.2 DanteThink Cost-Aware Tier Selection

**Current state:** `TaskComplexityRouter` classifies tasks and applies cost multipliers but does not factor remaining budget.

**Implementation:**

Add `remainingBudgetUsd` and `sessionCostSoFar` to the tier decision:
```typescript
function decideTier(signals: TaskSignals, budget?: BudgetContext): ThinkTier {
  const base = classifyComplexity(signals); // existing logic
  if (budget && budget.remaining < budget.total * 0.2) {
    // Last 20% of budget: downgrade opus -> sonnet, sonnet -> haiku
    return downgrade(base);
  }
  return base;
}
```

Track tier outcomes: `recordTierOutcome(tier, pdseScore, success)` feeds into `getAdaptiveBias()` which adjusts future tier selection based on historical performance.

### 5.3 Skillbook Quality Scorer

**Current state:** `@dantecode/dante-skillbook` exists with ACE reflection loop. Missing: version history, pruning policy enforcement, quality score trends.

**Implementation:**

- Add `.dantecode/skillbook/versions/` directory with timestamped snapshots
- Quality score per skill: `(recency * 0.3) + (successRate * 0.4) + (pdseAvg * 0.3)`
- Pruning: Skills below quality threshold after 30 days are moved to `.dantecode/skillbook/archived/`

---

## Phase 6: UX & Developer Experience

**Gap closed: A5 (Skills runtime v2), A6 (Repo awareness v2), MASTER_PRD items (Progressive disclosure, Memory auto-retain, Live provider smoke matrix, Golden flows)**

### 6.1 Skills Runtime v2

**Pattern source:** Qwen Code skills with explicit invocation, DanteCode's existing skill parsers, KiloCode's codebase indexing

**Implementation:**

- Skill loading emits `run.skill.loaded` events with provenance (source, license, trust tier)
- `/skills list` shows verified inventory with trust badges
- `/skills run <name>` executes with full permission and receipt tracking
- Skill composition: chain skills with `$input`/`$previous.output` substitution. DanteForge gates between steps
- The existing 8 format parsers in `packages/skill-adapter/src/parsers/` remain
- Add visible "skill loaded" and "skill used" events in reports

### 6.2 Repo Awareness v2

**Pattern source:** Aider's `RepoMap` with tree-sitter-based tag extraction and PageRank scoring

**Current state:** DanteCode has `RepoMapAST` using regex-based symbol extraction and import-graph PageRank. This is functional but less precise than Aider's tree-sitter approach.

**Implementation:**

Dual system:
1. **Immediate:** Keep the regex-based repo map for fast startup (current implementation). Upgrade to use tree-sitter parsers where available for better precision.
2. **Background:** Build a semantic block index asynchronously. Use the existing `code-index.ts` infrastructure. Show index readiness in the status bar.

Context pressure visibility: Add a `contextPressure` gauge to the TUI status bar showing `[ctx: 72%]`. When pressure exceeds 80%, automatically condense older context.

### 6.3 Progressive Disclosure

**Implementation:**

Track successful session count in `.dantecode/state.json`:
```json
{ "successfulSessions": 0, "unlockedTier": 1 }
```

- **Tier 1** (default): Basic commands (`/help`, `/mode`, `/diff`, `/undo`, `/skills`)
- **Tier 2** (after 3 successful sessions): `/fleet`, `/council`, `/gaslight`, `/fearset`, `/automate`
- **Tier 3** (after 10): `/serve`, `/teleport`, full fleet dashboard

`/help` output changes based on tier. Commands in higher tiers are hidden, not just greyed out.

### 6.4 Memory Auto-Retain

**Implementation:**

After each agent round, auto-capture to session memory (try/catch, never blocks):
```typescript
async function autoRetainMemory(roundResult: RoundResult): Promise<void> {
  try {
    await memoryEngine.store({
      toolsUsed: roundResult.tools,
      pdseScore: roundResult.pdse,
      filesChanged: roundResult.changedFiles,
      timestamp: new Date().toISOString(),
      sessionId: roundResult.sessionId,
    });
  } catch { /* never block the loop */ }
}
```

### 6.5 Live Provider Smoke Matrix

**Implementation:**

`/provider test` runs a minimal completion against each configured provider and reports:
```
Provider        Status  Latency  Model
anthropic       PASS    420ms    claude-sonnet-4-20250514
openai          PASS    380ms    gpt-4o
grok            FAIL    timeout  grok-4.2
ollama          PASS    120ms    llama3.2:latest
```

Results written to `artifacts/readiness/provider-smoke.json` for CI validation.

---

## Implementation Roadmap

### Wave 1 (Weeks 1-3): Foundation -- Closes A1 + A2

**Priority:** Highest. Without mode enforcement, nothing else is trustworthy.

| Task | Package | Effort | Donor Pattern |
|------|---------|--------|---------------|
| Hard mode enforcement (tool exclusion per mode) | `core`, `cli` | M | Qwen Code |
| RunIntake creation before any model call | `core`, `cli` | S | OpenCode |
| Boundary drift detection | `core` | M | agent-orchestrator |
| Mode visibility in status bar and VS Code | `cli`, `vscode` | S | KiloCode |
| Permission engine with allow/ask/deny | `core` | L | Qwen Code + OpenCode |

**Dependencies:** None. This is the starting point.

### Wave 2 (Weeks 3-5): Durable Truth -- Closes A3 + A4

| Task | Package | Effort | Donor Pattern |
|------|---------|--------|---------------|
| Extend RuntimeEventKindSchema for full pipeline | `runtime-spine` | S | OpenHands |
| DurableEventStore (append-only JSONL) | `core` | M | OpenHands |
| Wire events into agent-loop (emit on every material action) | `cli` | L | OpenHands |
| Checkpoint versioning with channel tracking | `core` | M | LangGraph |
| Resume/replay/fork operator commands | `cli` | M | VoltAgent |
| RecoveryManager for stale session detection | `core` | M | agent-orchestrator |
| Worktree integration in council orchestrator | `core`, `git-engine` | L | KiloCode |

**Dependencies:** Wave 1 (mode enforcement determines which events to emit).

### Wave 3 (Weeks 5-7): Skills + Repo Awareness -- Closes A5 + A6

| Task | Package | Effort | Donor Pattern |
|------|---------|--------|---------------|
| Skill load/use event emission | `skills-runtime`, `cli` | M | Qwen Code |
| Skill composition with DanteForge gating | `skills-runtime` | M | VoltAgent workflow chain |
| Tree-sitter repo map upgrade | `core` | L | Aider |
| Background semantic index with readiness gauge | `core` | M | KiloCode |
| Context condensing before pressure collapse | `core` | M | KiloCode |

**Dependencies:** Wave 2 (events must exist for skill tracking).

### Wave 4 (Weeks 7-9): Repair Loop + Hygiene -- Closes A7 + A8

| Task | Package | Effort | Donor Pattern |
|------|---------|--------|---------------|
| Post-apply lint repair loop | `cli`, `core` | L | Aider |
| Post-apply test repair loop | `cli`, `core` | M | Aider |
| DanteForge verification as final repair gate | `cli` | S | DanteCode native |
| Same-commit readiness freshness guard | `scripts` | M | DanteCode native |
| Doc-vs-code drift detection | `scripts` | M | DanteCode native |

**Dependencies:** Wave 2 (checkpoint/snapshot needed for rollback on repair failure).

### Wave 5 (Weeks 9-11): Intelligence + UX Polish -- Closes MASTER_PRD items

| Task | Package | Effort | Donor Pattern |
|------|---------|--------|---------------|
| PDSE per-dimension failure explanations | `danteforge` | M | DanteCode native |
| DanteThink cost-aware tier selection | `core` | S | DanteCode native |
| Skillbook quality scorer + versioning | `dante-skillbook` | M | DanteCode native |
| Progressive disclosure (3-tier unlock) | `cli`, `vscode` | S | KiloCode |
| Memory auto-retain per round | `core`, `cli` | S | DanteCode native |
| Live provider smoke matrix | `cli`, `core` | S | DanteCode native |

**Dependencies:** Waves 1-4 (the intelligence layer sits on top of the pipeline).

### Wave 6 (Weeks 11-13): Golden Flow Validation + Ship Prep

| Task | Package | Effort | Donor Pattern |
|------|---------|--------|---------------|
| GF-01: Clean install to first success | integration test | M | - |
| GF-02: Bugfix with verification receipt | integration test | M | - |
| GF-03: Multi-file refactor with guardrails | integration test | L | - |
| GF-04: Skill import and execution | integration test | M | - |
| GF-05: Provider failover | integration test | M | - |
| GF-06: Background task completion | integration test | L | - |

**Dependencies:** All waves. Golden flows validate the entire pipeline end-to-end.

---

## Success Metrics

| Dimension | Metric | Target | Measurement |
|-----------|--------|--------|-------------|
| Mode Safety | `plan`/`review` mutation rate | 0% | Test suite: attempt all write tools in plan mode, verify all denied |
| Boundary Obedience | Boundary drift detection rate | >95% | Synthetic prompts that intentionally expand scope |
| Repair Effectiveness | Auto-repair success rate | >60% | Count of lint/test failures auto-fixed vs. manual |
| Recovery Reliability | Resume success rate | >90% | Kill agent mid-run, resume, verify completion |
| Verification Trust | PDSE false-positive rate | <5% | Compare PDSE scores against human review |
| Skill Safety | Policy bypass rate for skills | 0% | Attempt skill execution with denied tools |
| Context Efficiency | Large-repo context quality | No regression | Measure completion quality on 100K+ LOC repos |
| Operator Clarity | Mode/state always visible | 100% | Automated screenshot tests for CLI and VS Code |

---

## Risk Mitigation

### Risk 1: Over-engineering the event bus delays Wave 2

**Mitigation:** JSONL files with Zod validation. No database. No external dependencies. The event bus is a thin append + search layer over files. If performance becomes an issue on very long sessions (>10K events), add SQLite as a Phase C optimization.

### Risk 2: Tree-sitter integration is too expensive for Wave 3

**Mitigation:** Keep regex-based repo map as the always-available fallback. Tree-sitter is an optional precision upgrade. The dual system (immediate regex + background semantic) means the user never waits.

### Risk 3: Repair loop creates infinite retry spirals

**Mitigation:** Hard caps: `maxLintRetries: 3`, `maxTestRetries: 3`. If exhausted, rollback to pre-mutation snapshot and report `PARTIAL`. The Aider pattern already handles this with a simple iteration count.

### Risk 4: Permission engine creates too much friction

**Mitigation:** Default configuration is permissive for `apply` mode (matches current behavior). `plan` and `review` are strict by architecture. Users who want stricter `apply` mode can configure rules in `.dantecode/config.json`. The goal is zero friction increase for current users, strict enforcement for modes that promise safety.

### Risk 5: Worktree management adds complexity and failure modes

**Mitigation:** Worktrees are `preferred`, not `required`, by default. Single-agent runs use the main worktree (current behavior). Worktree isolation only activates for multi-agent (`/party`, `/council`) runs. Follow KiloCode's proven pattern of `.dantecode/worktrees/` directory with metadata files per worktree. Git worktree cleanup runs on session end, with a stale-worktree scanner on startup (agent-orchestrator recovery pattern).

---

## Critical Files for Implementation

### Wave 1 (Mode Enforcement)
- `packages/core/src/approval-modes.ts` -- Must be extended to enforce tool exclusion per mode, not just approval gating. **This is the single most important file for A2 (hard mode system).**
- `packages/cli/src/tool-schemas.ts` -- Must filter tool list by mode before sending to model
- `packages/vscode/src/sidebar-provider.ts` -- Must apply same mode-based tool filtering

### Wave 2 (Event Bus & Checkpointing)
- `packages/runtime-spine/src/runtime-events.ts` -- Must be extended with the full pipeline event vocabulary. **Every other component (reports, receipts, replay, recovery) derives from these events.**
- `packages/core/src/event-engine.ts` -- Must wire DurableEventStore
- `packages/cli/src/agent-loop.ts` -- **The main execution loop must be instrumented with RunIntake creation, event emission, repair loop integration, and boundary drift detection. This is the integration point for Phases 1, 2, and 4.**
- `packages/core/src/durable-execution.ts` -- Must be extended with LangGraph-style versioned checkpoints and integrated with the event store for replay/resume

### Wave 3 (Skills & Repo Map)
- `packages/skills-runtime/src/run-skill.ts` -- Must emit skill load/use events
- `packages/core/src/repo-map-ast.ts` -- Must upgrade to tree-sitter where available

### Wave 4 (Repair Loop)
- `packages/cli/src/agent-loop.ts` -- Must integrate post-apply repair loop (lint → test → verify)
- `packages/core/src/git-snapshot-recovery.ts` -- Already exists, needs rollback integration

### Wave 5 (Intelligence)
- `packages/core/src/task-complexity-router.ts` -- Must add budget-aware tier downgrading
- `packages/dante-skillbook/` -- Must add quality scorer + versioning

### Wave 6 (Golden Flows)
- `packages/cli/src/__tests__/golden-flows.test.ts` -- Must implement all 6 golden flow tests

---

## Pattern Attribution

Every design decision above traces to a specific OSS pattern:

- **Qwen Code:** Permission engine (allow/ask/deny), approval modes, skill invocation, subagent scoping
- **OpenCode:** Plan/Build mode split, permission config layering, session/agent mental model
- **OpenHands:** Append-only event log, durable state, persistence/resume, event filtering
- **Aider:** Repo map with PageRank, lint/test repair loop, git snapshot/undo, tree-sitter precision
- **KiloCode:** Worktree lifecycle, codebase indexing, progressive disclosure, checkpoint UI
- **LangGraph:** Versioned checkpoints with channel tracking, stateful workflow graphs
- **agent-orchestrator:** Fleet coordination, recovery manager, task decomposition, worktree isolation
- **VoltAgent:** Nested workflow execution, suspend/resume, workflow step composition
- **CrewAI:** Sequential/hierarchical task orchestration, async execution, role-based agents

DanteCode's unique contribution: **DanteForge verification as the final gate in every pipeline stage.**

---

## Conclusion

This is not a redesign. This is surgical augmentation of DanteCode's existing architecture with battle-tested patterns from 9 top OSS repos. The moat -- DanteForge's verification spine -- remains untouched. What changes is execution discipline, operator control, and long-horizon reliability.

**Blade = All strengths, no weaknesses.**

- Qwen's control → Mode enforcement
- Kilo's polish → UX + worktrees
- OpenCode's clarity → Plan/apply split
- OpenHands' substrate → Event-driven truth
- Aider's rigor → Repair loop
- Agent Skills portability → Skill runtime v2

The result: **The most trustworthy AND the most capable coding agent.**

---

**Document Status:** Implementation-ready
**Next Action:** Begin Wave 1 (Mode Enforcement)
**Primary Maintainer:** DanteCode Core Team
**Last Updated:** 2026-03-28
