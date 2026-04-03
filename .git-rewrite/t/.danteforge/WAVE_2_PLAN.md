# Wave 2 Implementation Plan: Durable Truth Substrate

**Status:** Planning
**Date:** 2026-03-28
**Estimated Duration:** 2 weeks (10 working days)
**Gaps Closed:** A3 + A4

---

## Task Breakdown

### Task 2.1: Extend Event Vocabulary (P0 - 2 days)

**Objective:** Extend RuntimeEventKindSchema to cover all 14 pipeline stages

**Current state:**
- `packages/runtime-spine/src/runtime-events.ts` has ~20 event kinds
- Missing: full pipeline coverage (plan, decomposition, tool lifecycle, checkpoint, repair, worktree)

**Implementation:**

1. Add 22 new event kinds to `RuntimeEventKindSchema`:
```typescript
// Run lifecycle (A3 coverage)
"run.intake.created"       // ✅ Already added in Wave 1
"run.task.classified"
"run.mode.selected"
"run.mode.changed"

// Permissions (A3 coverage)
"run.permission.evaluated" // ✅ Already added in Wave 1
"run.permission.denied"

// Context & Skills (prep for Wave 3)
"run.context.assembled"
"run.skill.loaded"
"run.skill.executed"

// Planning (A3 coverage)
"run.plan.created"
"run.decomposition.started"
"run.decomposition.completed"

// Tool lifecycle (A3 coverage)
"run.tool.started"
"run.tool.completed"
"run.tool.failed"

// Checkpointing (A4 coverage)
"run.checkpoint.saved"
"run.checkpoint.restored"

// Repair loop (prep for Wave 4)
"run.repair.lint.started"
"run.repair.lint.completed"
"run.repair.test.started"
"run.repair.test.completed"

// Reporting (A3 coverage)
"run.report.written"

// Boundary (A3 coverage)
"run.boundary.drift"       // ✅ Already added in Wave 1

// Worktree (A4 coverage)
"run.worktree.created"
"run.worktree.merged"
"run.worktree.cleaned"
```

2. Add payload type definitions for each event kind in runtime-spine
3. Extend EventEngine emit() to support all new kinds
4. Write 25 tests (one per new event kind)

**Files modified:**
- `packages/runtime-spine/src/runtime-events.ts`
- `packages/runtime-spine/src/runtime-events.test.ts` (NEW)

**Success criteria:**
- All 25 new event kinds in schema
- Payload types defined and validated
- Tests passing for emit/parse cycle

---

### Task 2.2: DurableEventStore with JSONL (P0 - 3 days)

**Objective:** Implement append-only event store with JSONL persistence

**Pattern source:** OpenHands `EventStoreABC` with search and filtering

**Implementation:**

1. Create `packages/core/src/durable-event-store.ts`:
```typescript
export interface DurableEventStore {
  append(event: RuntimeEvent): Promise<number>;  // Returns event ID
  search(filter: EventFilter): AsyncIterable<RuntimeEvent>;
  getEvent(id: number): Promise<RuntimeEvent>;
  getLatestId(): Promise<number>;
  getEventsForRun(runId: string): AsyncIterable<RuntimeEvent>;
  flush(): Promise<void>;
}

export interface EventFilter {
  runId?: string;
  kind?: string | string[];
  afterId?: number;
  beforeId?: number;
  limit?: number;
}

export class JsonlEventStore implements DurableEventStore {
  constructor(sessionId: string, basePath?: string);
  // Implementation uses fs.appendFile for atomicity
}
```

2. Storage format:
   - Path: `.dantecode/events/<sessionId>.jsonl`
   - Format: `{"id":1,"timestamp":"...","kind":"...","payload":{...}}\n`
   - Each line is a complete JSON object

3. Implement search with streaming:
   - Read file line-by-line
   - Parse JSON per line
   - Filter based on EventFilter
   - Yield matching events

4. Integrate with EventEngine:
   - Add `eventStore?: DurableEventStore` to EventEngine constructor
   - On `emit()`, write to store if configured
   - Add `getEventStore()` accessor

5. Write 35 tests:
   - Append events (10 tests)
   - Search with filters (15 tests)
   - Edge cases: empty store, corrupted lines, concurrent append (10 tests)

**Files created:**
- `packages/core/src/durable-event-store.ts`
- `packages/core/src/durable-event-store.test.ts`

**Files modified:**
- `packages/core/src/event-engine.ts`
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 100+ events append without data loss
- Search returns correct results for all filter types
- File survives process restart (durability test)
- Concurrent append test (spawn 10 writes, all succeed)

---

### Task 2.3: Versioned Checkpoints (P0 - 3 days)

**Objective:** Adopt LangGraph versioned checkpoint pattern with channel tracking

**Pattern source:** LangGraph `create_checkpoint()` with `versions_seen`

**Current state:**
- `packages/core/src/durable-execution.ts` has `DurableExecutionEngine` with checkpoint/resume
- `packages/core/src/checkpointer.ts` has basic checkpoint logic
- Gap: no versioning, no event ID watermarks, no channel tracking

**Implementation:**

1. Extend `DurableCheckpoint` interface in `packages/core/src/checkpointer.ts`:
```typescript
export interface DurableCheckpoint {
  version: number;                          // Checkpoint version (incremental)
  runId: string;
  sessionId: string;
  stepIndex: number;
  eventId: number;                          // Last event ID at checkpoint time
  worktreeRef?: string;                     // Git ref if worktree active
  gitSnapshotHash?: string;                 // Stash hash for rollback
  channelVersions: Record<string, number>;  // NEW: Per-channel versions
  completedReceipts: ApplyReceipt[];
  partialOutput?: string;
  timestamp: string;
}
```

2. Add channel versioning to `Checkpointer` class:
```typescript
export class Checkpointer {
  private channelVersions: Map<string, number> = new Map();

  updateChannel(name: string): void {
    const current = this.channelVersions.get(name) ?? 0;
    this.channelVersions.set(name, current + 1);
  }

  getChannelVersion(name: string): number {
    return this.channelVersions.get(name) ?? 0;
  }

  async save(checkpoint: Omit<DurableCheckpoint, 'channelVersions'>): Promise<void> {
    const versioned = {
      ...checkpoint,
      channelVersions: Object.fromEntries(this.channelVersions)
    };
    // Save to .dantecode/checkpoints/<sessionId>-v<version>.json
  }
}
```

3. Wire into agent-loop.ts:
   - After tool rounds: `checkpointer.updateChannel('tool-output')`
   - After model responses: `checkpointer.updateChannel('model-output')`
   - Periodic checkpoint: `checkpointer.save({ eventId: lastEventId, ... })`

4. Implement resume logic:
```typescript
export async function resumeFromCheckpoint(
  checkpointPath: string,
  eventStore: DurableEventStore
): Promise<ResumeContext> {
  const checkpoint = await loadCheckpoint(checkpointPath);
  const replayEvents = eventStore.search({
    afterId: checkpoint.eventId,
    runId: checkpoint.runId
  });
  // Rebuild state from events after checkpoint
  return { checkpoint, replayEvents };
}
```

5. Write 40 tests:
   - Channel version tracking (10 tests)
   - Checkpoint save/load with versions (10 tests)
   - Resume from checkpoint (10 tests)
   - Replay events after checkpoint (10 tests)

**Files modified:**
- `packages/core/src/checkpointer.ts`
- `packages/core/src/checkpointer.test.ts`
- `packages/cli/src/agent-loop.ts`

**Success criteria:**
- Channel versions increment correctly
- Resume rebuilds state from checkpoint + events
- Replay determinism: same events → same state

---

### Task 2.4: Recovery Manager (P1 - 2 days)

**Objective:** Detect stale sessions on startup and offer recovery options

**Pattern source:** agent-orchestrator's `RecoveryManager` with scan/validate/recover

**Implementation:**

1. Create `packages/core/src/recovery-manager.ts`:
```typescript
export type SessionStatus = 'resumable' | 'stale' | 'corrupt';

export interface StaleSession {
  sessionId: string;
  checkpointPath: string;
  status: SessionStatus;
  reason?: string;
  lastEventId?: number;
  worktreeRef?: string;
}

export class RecoveryManager {
  async scanStaleSessions(): Promise<StaleSession[]> {
    // Scan .dantecode/checkpoints/ for *.json
    // For each checkpoint:
    //   - Check if worktree exists (git worktree list)
    //   - Check if event log exists
    //   - Classify as resumable/stale/corrupt
  }

  async validateCheckpoint(checkpoint: DurableCheckpoint): Promise<boolean> {
    // Validate git state matches checkpoint
    // Check if worktreeRef exists
    // Check if event log is readable
  }

  async offerRecovery(staleSessions: StaleSession[]): Promise<void> {
    // Present options to operator:
    // 1. Resume (if resumable)
    // 2. Fork (create new branch from checkpoint)
    // 3. Cleanup (delete checkpoint + worktree)
    // 4. Skip (leave as-is)
  }
}
```

2. Wire into `repl.ts` startup:
```typescript
const recoveryManager = new RecoveryManager();
const staleSessions = await recoveryManager.scanStaleSessions();
if (staleSessions.length > 0) {
  await recoveryManager.offerRecovery(staleSessions);
}
```

3. Add CLI command `/recover`:
```typescript
// packages/cli/src/slash-commands.ts
async function recoverCommand(replState: ReplState): Promise<void> {
  const recoveryManager = new RecoveryManager();
  const staleSessions = await recoveryManager.scanStaleSessions();
  // Interactive recovery UI
}
```

4. Write 25 tests:
   - Scan detects stale checkpoints (10 tests)
   - Validation logic (8 tests)
   - Recovery actions (7 tests)

**Files created:**
- `packages/core/src/recovery-manager.ts`
- `packages/core/src/recovery-manager.test.ts`

**Files modified:**
- `packages/cli/src/repl.ts`
- `packages/cli/src/slash-commands.ts`

**Success criteria:**
- Detects stale sessions on startup
- Validates git state correctly
- Offers recovery options (no auto-action)

---

### Task 2.5: Worktree Integration in Council (P0 - 3 days)

**Objective:** Wire worktree creation into council orchestrator for lane isolation

**Pattern source:** KiloCode `WorktreeManager` + agent-orchestrator worktree-per-agent

**Current state:**
- `packages/git-engine/src/worktree.ts` already has `WorktreeManager`
- `packages/core/src/council/council-orchestrator.ts` exists
- Gap: Council doesn't create worktrees per lane

**Implementation:**

1. Extend `AgentSessionState` in `packages/core/src/council/council-types.ts`:
```typescript
export interface AgentSessionState {
  id: string;
  adapter: AgentAdapter;
  status: AgentStatus;
  worktreePath?: string;     // NEW: Path to worktree
  worktreeBranch?: string;   // NEW: Branch name
  checkpointRef?: string;    // NEW: Checkpoint reference
  // ... existing fields
}
```

2. Modify `CouncilOrchestrator.executeLane()`:
```typescript
private async executeLane(lane: ParallelLane): Promise<void> {
  // Create worktree for this lane
  const worktreeBranch = `council/${this.sessionId}/${lane.id}`;
  const worktreePath = await this.worktreeManager.create(worktreeBranch);

  // Create agent with worktree context
  const agent = await this.createAgent(lane.task, {
    worktreePath,
    worktreeBranch
  });

  // Execute in worktree
  const result = await agent.execute();

  // If success + PDSE pass: merge worktree
  if (result.success && result.pdseScore >= threshold) {
    await this.worktreeManager.merge(worktreeBranch);
    await this.worktreeManager.remove(worktreePath);
  } else {
    // Leave worktree for manual review
    this.logger.warn(`Lane ${lane.id} failed - worktree preserved at ${worktreePath}`);
  }
}
```

3. Add worktree events:
```typescript
// In council-orchestrator.ts
this.eventEngine.emit({
  kind: 'run.worktree.created',
  payload: { laneId: lane.id, worktreePath, worktreeBranch }
});

this.eventEngine.emit({
  kind: 'run.worktree.merged',
  payload: { laneId: lane.id, worktreeBranch, commitSha }
});
```

4. Write 30 tests:
   - Worktree creation per lane (10 tests)
   - Worktree merge on success (8 tests)
   - Worktree preservation on failure (7 tests)
   - Event emission (5 tests)

**Files modified:**
- `packages/core/src/council/council-orchestrator.ts`
- `packages/core/src/council/council-types.ts`
- `packages/core/src/council/council-orchestrator.test.ts`

**Success criteria:**
- Each lane gets unique worktree
- Successful lanes merge back
- Failed lanes preserve worktree for inspection
- No worktree leaks

---

### Task 2.6: CLI Resume/Replay Commands (P1 - 2 days)

**Objective:** Add operator commands for checkpoint resume/replay/fork

**Implementation:**

1. Add `/resume` command to slash-commands.ts:
```typescript
async function resumeCommand(replState: ReplState, sessionId?: string): Promise<void> {
  const recoveryManager = new RecoveryManager();
  const sessions = await recoveryManager.scanStaleSessions();

  if (!sessionId) {
    // Show list of resumable sessions
    displaySessionList(sessions.filter(s => s.status === 'resumable'));
    return;
  }

  // Resume specific session
  const checkpoint = sessions.find(s => s.sessionId === sessionId);
  if (!checkpoint) throw new Error(`Session ${sessionId} not found`);

  const context = await resumeFromCheckpoint(checkpoint.checkpointPath, eventStore);
  // Continue agent loop with resumed context
}
```

2. Add `/replay` command:
```typescript
async function replayCommand(replState: ReplState, sessionId: string): Promise<void> {
  const eventStore = new JsonlEventStore(sessionId);
  const events = await eventStore.search({ runId: sessionId });

  // Display event timeline
  for await (const event of events) {
    console.log(`[${event.id}] ${event.kind} - ${event.timestamp}`);
  }
}
```

3. Add `/fork` command:
```typescript
async function forkCommand(replState: ReplState, sessionId: string): Promise<void> {
  const checkpoint = await loadCheckpoint(sessionId);
  const newBranch = `fork-${sessionId}-${Date.now()}`;

  // Create new branch from checkpoint's git ref
  if (checkpoint.worktreeRef) {
    execSync(`git branch ${newBranch} ${checkpoint.worktreeRef}`);
  }

  // Create new session with forked state
  // ...
}
```

4. Update `/help` to document new commands

5. Write 20 tests:
   - /resume command (8 tests)
   - /replay command (6 tests)
   - /fork command (6 tests)

**Files modified:**
- `packages/cli/src/slash-commands.ts`
- `packages/cli/src/slash-commands.test.ts`

**Success criteria:**
- /resume continues from checkpoint
- /replay shows event timeline
- /fork creates new branch with preserved state

---

### Task 2.7: VS Code Parity (P1 - 2 days)

**Objective:** Add checkpoint/resume UI to VS Code extension

**Implementation:**

1. Add checkpoint indicator to sidebar:
```typescript
// packages/vscode/src/sidebar-provider.ts
private updateCheckpointBadge(): void {
  const checkpointCount = this.checkpointer.getAvailableCheckpoints().length;
  this.statusBarItem.text = `$(history) ${checkpointCount} checkpoint(s)`;
}
```

2. Add "Resume Session" command:
```typescript
// packages/vscode/src/extension.ts
context.subscriptions.push(
  vscode.commands.registerCommand('dantecode.resumeSession', async () => {
    const recoveryManager = new RecoveryManager();
    const sessions = await recoveryManager.scanStaleSessions();

    const selected = await vscode.window.showQuickPick(
      sessions.map(s => ({ label: s.sessionId, description: s.status }))
    );

    if (selected) {
      await resumeFromCheckpoint(selected.label, eventStore);
    }
  })
);
```

3. Add checkpoint tree view in sidebar showing available resume points

4. Write 15 tests:
   - Checkpoint badge display (5 tests)
   - Resume command (5 tests)
   - Checkpoint tree view (5 tests)

**Files modified:**
- `packages/vscode/src/sidebar-provider.ts`
- `packages/vscode/src/extension.ts`
- `packages/vscode/src/vscode.test.ts`

**Success criteria:**
- Checkpoint count visible in sidebar
- Resume command works from VS Code
- Checkpoint tree shows available sessions

---

## Test Plan

### Unit Tests
- Event vocabulary: 25 tests
- DurableEventStore: 35 tests
- Versioned checkpoints: 40 tests
- Recovery Manager: 25 tests
- Worktree integration: 30 tests
- CLI commands: 20 tests
- VS Code integration: 15 tests

**Total new tests: 190**

### Integration Tests
- End-to-end checkpoint/resume flow (5 tests)
- Multi-lane council with worktrees (3 tests)
- Recovery from crash (3 tests)

**Total integration tests: 11**

**Total Wave 2 tests: 201**

### Manual Validation
- [ ] Interrupt agent-loop mid-execution, verify checkpoint saved
- [ ] Restart CLI, verify resume offered
- [ ] Council with 3 lanes, verify 3 worktrees created
- [ ] Kill process during council, verify worktrees preserved
- [ ] Resume from checkpoint, verify state matches

---

## Success Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Event vocabulary coverage | 22 new kinds + 3 existing = 25 total | Manual review of schema |
| Event persistence rate | 100% | Integration test with 200+ events |
| Checkpoint versioning | Channel versions match event watermarks | Resume test suite |
| Worktree isolation | 1 worktree per council lane | Multi-lane test |
| Resume success rate | >95% | 40 checkpoint resume tests |
| Recovery detection | 100% of stale sessions | Manual kill test |
| CLI/VS Code parity | Resume works in both | Manual cross-platform test |
| Test coverage | >90% | Vitest coverage report |

---

## Critical Files

### New Files
- `packages/runtime-spine/src/runtime-events.test.ts`
- `packages/core/src/durable-event-store.ts`
- `packages/core/src/durable-event-store.test.ts`
- `packages/core/src/recovery-manager.ts`
- `packages/core/src/recovery-manager.test.ts`

### Modified Files
- `packages/runtime-spine/src/runtime-events.ts` (event vocabulary)
- `packages/core/src/event-engine.ts` (event store integration)
- `packages/core/src/checkpointer.ts` (versioned checkpoints)
- `packages/core/src/checkpointer.test.ts` (40 new tests)
- `packages/core/src/council/council-orchestrator.ts` (worktree integration)
- `packages/core/src/council/council-types.ts` (worktree fields)
- `packages/core/src/council/council-orchestrator.test.ts` (30 new tests)
- `packages/cli/src/agent-loop.ts` (checkpoint wiring)
- `packages/cli/src/slash-commands.ts` (resume/replay/fork commands)
- `packages/cli/src/slash-commands.test.ts` (20 new tests)
- `packages/cli/src/repl.ts` (recovery manager on startup)
- `packages/vscode/src/sidebar-provider.ts` (checkpoint UI)
- `packages/vscode/src/extension.ts` (resume command)
- `packages/vscode/src/vscode.test.ts` (15 new tests)
- `packages/core/src/index.ts` (exports)

**Total files: 18 (5 new + 13 modified)**

---

## Dependencies

- ✅ Wave 1 complete (RunIntake, boundary tracking, permission engine)
- ✅ `packages/git-engine` has WorktreeManager
- ✅ `packages/core` has EventEngine + Checkpointer
- ✅ `packages/runtime-spine` has RuntimeEventSchema

---

## Risk Mitigation

### Risk: Event log file corruption
**Mitigation:** Each event is a complete JSON object on one line. Corrupted lines can be skipped during search.

### Risk: Checkpoint-event ID mismatch
**Mitigation:** Validate eventId exists in log before resume. Offer fork if mismatch detected.

### Risk: Worktree accumulation
**Mitigation:** RecoveryManager scans for orphaned worktrees on startup. Offer cleanup action.

### Risk: Concurrent checkpoint writes
**Mitigation:** Single-writer model (one checkpointer per session). No shared state.

---

**Status:** Ready for task breakdown
**Next Action:** Create WAVE_2_TASKS.md and begin implementation
