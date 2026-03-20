# OSS Harvest Report — Autonomous Agents Reliability Hardening v1.0

**Date**: 2026-03-18
**Target**: DanteCode Autonomous Agents Reliability Score 6.8 → 8+
**Focus**: Checkpoint/resume, circuit-breaker, recovery-engine, stuck-loop detection

## Repos Scanned

| Repo | License | Stars | Relevant Patterns |
|------|---------|-------|-------------------|
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | MIT | 1k+ | Checkpointer interface, CheckpointTuple, incremental putWrites |
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) | MIT | 1k+ | Event-sourced state, base_state.json + events/ directory, file-per-event |
| [CrewAI](https://github.com/crewAIInc/crewAI) | MIT | 25k+ | Max iterations ceiling, force-final-answer, tool usage limits |
| [Aider](https://github.com/Aider-AI/aider) | Apache-2.0 | 30k+ | Exponential backoff (125ms initial, 60s timeout), .aiderignore filtering |
| [Continue.dev](https://github.com/continuedev/continue) | Apache-2.0 | 25k+ | withRetry decorator, connection state guard, promise deduplication |

## Patterns Extracted

### P0 — Implemented

1. **Event-Sourced Checkpointer** (LangGraph + OpenHands)
   - Source: LangGraph BaseCheckpointSaver interface + OpenHands event log directory
   - File: `packages/core/src/checkpointer.ts`
   - Pattern: `base_state.json` + `events/event-{index}-{id}.json` per-event files
   - Features: `put()`, `putWrite()`, `getTuple()`, `list()`, `resume()`, auto-compaction
   - Deduplication: Identical taskId+channel writes are skipped (LangGraph pattern)
   - Version tracking: Monotonic channelVersions per channel (LangGraph pattern)

2. **Stuck-Loop Detection Middleware** (CrewAI-inspired, enhanced)
   - Source: CrewAI iteration counter + clean-room action fingerprinting
   - File: `packages/core/src/loop-detector.ts`
   - Three detection strategies (beyond CrewAI's simple counter):
     - Identical consecutive actions (fingerprint matching, threshold-based)
     - Cyclic pattern detection (ABAB, ABCABC cycles in sliding window)
     - Max iterations ceiling (CrewAI fallback)
   - Exception types: "continue" and "empty" exempt from identical detection
   - Action normalization: case, whitespace, numbers stripped for fingerprinting

3. **Exponential Backoff on Circuit Breaker** (Aider-style)
   - Source: Aider RETRY_TIMEOUT pattern
   - File: `packages/core/src/task-circuit-breaker.ts` (enhanced)
   - New method: `getBackoffDelay()` — starts at 125ms, doubles, caps at 60s
   - Timeout detection: cumulative delay tracking with `timedOut` flag
   - Per-error-hash tracking: different errors get independent backoff state
   - Resets on success/reset()

### P1 — Not Yet Implemented (candidates for next wave)

4. **File-based locking for concurrent writes** (OpenHands `.eventlog.lock`)
5. **Promise-based deduplication guard** (Continue.dev connection state machine)
6. **Abort signal support** (Continue.dev AbortController pattern)

### P2/P3 — Deferred

7. **Tool usage limits** (CrewAI `max_usage_count`) — not relevant to current architecture
8. **.aiderignore-style filtering** (Aider) — already have protected roots

## Test Coverage

| Module | Tests Added | Total Tests |
|--------|-------------|-------------|
| `checkpointer.ts` | 24 | 24 (new) |
| `loop-detector.ts` | 24 | 24 (new) |
| `task-circuit-breaker.ts` | 10 | 34 (24 existing + 10 new) |
| **Total new tests** | **58** | **82** |

Combined with existing 65 reliability tests → **147 total reliability-focused tests**.

## Verification Status

- Typecheck: PASS
- Core tests: 796/796 PASS (39 test files)
- New module tests: 82/82 PASS
- Prettier format: PASS
- No new failures introduced

## Files Changed/Created

### New Files
- `packages/core/src/checkpointer.ts` — Event-sourced checkpointer (312 lines)
- `packages/core/src/checkpointer.test.ts` — 24 tests
- `packages/core/src/loop-detector.ts` — Stuck-loop detector (235 lines)
- `packages/core/src/loop-detector.test.ts` — 24 tests

### Modified Files
- `packages/core/src/task-circuit-breaker.ts` — Added exponential backoff
- `packages/core/src/task-circuit-breaker.test.ts` — Added 10 backoff tests
- `packages/core/src/index.ts` — Wired new exports

## Clean-Room Declaration

All implementations are clean-room. No code was copied from any scanned repository.
Patterns were studied for architecture and interface design only.
All code was written fresh for DanteCode's TypeScript/Node.js architecture.
