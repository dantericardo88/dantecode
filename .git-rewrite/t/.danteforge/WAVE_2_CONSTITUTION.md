# Wave 2 Constitution: Durable Truth Substrate

**Status:** Active
**Date:** 2026-03-28
**Gaps Addressed:** A3 (Durable truth substrate), A4 (Worktree-backed recovery)

---

## Core Principles

### 1. Events Are The Source of Truth
- Every meaningful action emits an event
- Events are append-only and immutable
- The event log is the authoritative record of what happened
- Reports derive from events, not from claims

### 2. Checkpoints Enable Resume
- Long-running work can be interrupted safely
- Resume points are versioned and git-aware
- Checkpoint state includes event IDs for replay
- Recovery options (resume/replay/fork) are explicit

### 3. Worktrees Provide Isolation
- Each council lane gets its own worktree
- Worktrees prevent mutation conflicts
- Git refs link checkpoints to branches
- Cleanup is explicit, not automatic

### 4. Recovery Is First-Class
- Stale sessions are detected on startup
- Recovery options are offered to the operator
- Git state validation prevents corruption
- Failed recovery escalates, doesn't fail silently

### 5. Storage Is Simple
- JSONL for events (one file per session)
- JSON for checkpoints (one file per checkpoint)
- No database dependencies
- Human-readable and git-friendly

---

## Pattern Sources

### OpenHands (Event Store)
- `Event` base class with monotonic IDs
- Source attribution and causal linking
- `search_events()` with filtering
- Append-only persistence

**What we adopt:** Event ID sequencing, search interface, append-only JSONL

### LangGraph (Checkpoints)
- `create_checkpoint()` with versioned channels
- `versions_seen` for deterministic replay
- Per-channel version tracking
- Restore from arbitrary checkpoint

**What we adopt:** Versioned channels, event ID watermarks, replay determinism

### KiloCode (Worktrees)
- `WorktreeManager` with session tracking
- Stats polling for resource monitoring
- Managed sessions tracking
- Checkpoint/restore integration

**What we adopt:** Worktree-per-session model, resource tracking, checkpoint integration

---

## Success Criteria

| Metric | Target | Validation |
|--------|--------|------------|
| Event vocabulary coverage | 100% of 14 stages | Manual review of RuntimeEventKindSchema |
| Event persistence | Every event appended to JSONL | Test with >100 events |
| Checkpoint versioning | Channel versions match event IDs | Resume from checkpoint, verify replay |
| Worktree isolation | Each council lane has unique worktree | Multi-lane test |
| Resume success rate | >95% for valid checkpoints | Interrupt + resume test suite |
| Recovery detection | Stale sessions detected on startup | Manual kill + restart test |

---

## Architecture Constraints

### Event Store
- **Storage:** `.dantecode/events/<sessionId>.jsonl`
- **Format:** One JSON object per line, newline-delimited
- **ID assignment:** Monotonic, starting from 1 per session
- **Search:** In-memory scan (acceptable for session-scoped searches)

### Checkpoint Format
```typescript
interface DurableCheckpoint {
  version: number;
  runId: string;
  sessionId: string;
  stepIndex: number;
  eventId: number;              // Last event ID at checkpoint time
  worktreeRef?: string;         // Git ref if worktree is active
  gitSnapshotHash?: string;     // Stash hash for rollback
  channelVersions: Record<string, number>;
  completedReceipts: ApplyReceipt[];
  partialOutput?: string;
  timestamp: string;
}
```

### Worktree Integration
- Council orchestrator creates worktrees via git-engine
- Worktree path stored in checkpoint
- Merge-back requires PDSE verification
- Cleanup requires explicit operator action or success confirmation

---

## Non-Goals for Wave 2

- ❌ Multi-session event aggregation (future)
- ❌ Event replay UI (CLI only for now)
- ❌ Automatic checkpoint garbage collection (manual for Wave 2)
- ❌ Distributed/shared event store (local only)
- ❌ Event encryption (trust boundary is filesystem)

---

## Dependencies

- ✅ Wave 1 complete (mode enforcement, RunIntake, boundary tracking)
- ✅ `runtime-spine` package (RuntimeEventKindSchema, event types)
- ✅ `git-engine` package (worktree management already exists)
- ✅ `core` package (EventEngine, DurableExecutionEngine exist)

---

## Risk Mitigation

### Risk: Event log grows unbounded
**Mitigation:** Session-scoped JSONL files. Old sessions can be archived/deleted by operator.

### Risk: Checkpoint corruption
**Mitigation:** Validate git state on resume. Offer fork option if worktree is gone.

### Risk: Worktree leaks
**Mitigation:** RecoveryManager scans for orphaned worktrees on startup.

### Risk: Concurrent writes to event log
**Mitigation:** Single-writer model (one agent per session). Council lanes write to parent session log.

---

**Status:** Ready for implementation
**Next Action:** Break into executable tasks
