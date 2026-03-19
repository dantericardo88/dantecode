# AUTOFORGE_GUIDANCE.md
**Generated:** 2026-03-19 | **Mode:** --score-only | **Autoforge Iteration:** 15
**Branch:** feat/dantecode-9plus-complete-matrix
**Scenario:** mid-project / gap-closure — reliability hardening complete, DTR gap confirmed

---

## 1. PDSE Artifact Scores

| Artifact | Source | Score | Status | Notes |
|----------|--------|-------|--------|-------|
| CONSTITUTION | `Docs/DanteCode_PRD_v1.0.md` D1 | 9.0 | ✅ PASS | Anti-stub doctrine, model agnosticism, NOMA, PDSE principles all present |
| SPEC | `Docs/DanteCode_PRD_v1.0.md` D2–D4 + Blade PRD | 8.5 | ✅ PASS | Strong architecture spec; tool-runtime scheduler was not yet in spec (now confirmed gap) |
| CLARIFY | User-provided Qwen gap analysis (2026-03-19) | 9.0 | ✅ PASS | Surgical PRD: 12 gaps identified, Qwen code read directly, FR1–FR14 defined |
| PLAN | CAPABILITIES.md + MEMORY.md wave records | 7.5 | ⚠ PARTIAL | Waves 1–6 complete; DTR (Deterministic Tool Runtime) has no PLAN artifact yet |
| TASKS | None for DTR | 3.0 | ❌ MISSING | No task breakdown for DTR phases; blocks autonomous execution |

**Overall PDSE Score: 7.4 / 10**
**Primary bottleneck:** TASKS artifact missing for DTR. Clarify and Spec are strong.

---

## 2. Current Workflow State

**Stage:** `mid-project → new-capability-gap`
**Completed waves (all committed):**
- Reliability hardening v1.0 (checkpointer, loop-detector, circuit-breaker, git-snapshot-recovery) ✅
- 9+ Universe Waves 1–6 (WebSearch/Fetch multi-provider, SubAgent, GitHub ops, reasoning chains, self-healing, integration) ✅
- Anti-confabulation guards v1, v2, v2b (GROK_CONFAB_RE, reads-only detection, nudges ×4) ✅
- Destructive loop fix v1 + v2 (DESTRUCTIVE_GIT_RE + rm -rf guard + regex gap) ✅
- Silent tool drop fix (extractToolCalls returns parseErrors[], system prompt verification guidance) ✅
- Sequential execution verification guidance in all DanteForge command files ✅

**Confirmed gap (not implemented):**
- No tool-call state machine (7-state lifecycle)
- No central ToolScheduler / request queue
- No approval gateway (WebFetch/Bash execute without approval state)
- No artifact/download verification contracts
- No typed dependency gating between tool steps
- No model capability registry (Ollama/vLLM/LM Studio need separate code)
- Tool results are untyped text, not structured ToolExecutionResult

---

## 3. Qwen Code Gap Analysis (from coreToolScheduler.ts audit)

**Reference:** `external/qwen-code/packages/core/src/core/coreToolScheduler.ts`

### Qwen's key patterns DanteCode lacks

| Qwen Feature | Location | DanteCode Gap |
|---|---|---|
| 7-state tool lifecycle union type | :70-147 | ❌ No state machine |
| `isRunning()` blocks new scheduling while active | :564-572 | ❌ No blocking semantics |
| `requestQueue` — queue-then-schedule | :637-671 | ❌ No queue |
| `_schedule()` validates entire batch first | :673-695 | ❌ No batch validation |
| `attemptExecutionOfScheduledCalls()`: Task tools concurrent, others sequential | :1068-1106 | ⚠ DanteCode serial but no abstraction |
| Truncation detection → reject before write | :753-760 | ❌ Missing (write blocker is size-based only) |
| `awaiting_approval` with resumable confirm handler | :128-136 | ❌ Missing |
| Typed `ToolExecutionResult` with structured evidence | throughout | ❌ Text-only output |

### DanteCode advantages Qwen lacks
- DurableRunStore with full persistence + checkpoint/resume
- Event-sourced checkpointer (LangGraph-style)
- Anti-confabulation guards (GROK_CONFAB_RE, reads-only, nudges)
- Parse error surfacing (malformed JSON → model retry)
- Pipeline continuation + wave orchestrator
- Approach memory (cross-session failure learning)
- WebSearch multi-provider RRF fusion + reranking

---

## 4. DTR Implementation Plan (6 Phases)

### Phase 1 — Core Types + Scheduler Spine ← **START HERE**

**New:** `packages/core/src/tool-runtime/`
- `tool-call-types.ts` — ToolCallState (7 states), ArtifactRecord, ToolExecutionResult, VerificationCheck
- `tool-scheduler.ts` — ToolScheduler: submit → validate → queue → execute → emit; isRunning(); requestQueue
- `approval-gateway.ts` — per-tool/domain/path rules; awaiting_approval state management
- `artifact-store.ts` — ArtifactRecord tracking (downloads, git clones, writes)

**Modified:**
- `packages/cli/src/agent-loop.ts` — replace direct for-loop with `scheduler.submit()` + `await scheduler.waitForAll()`
- `packages/vscode/src/sidebar-provider.ts` — same delegation
- `packages/core/src/index.ts` — export new tool-runtime module

### Phase 2 — Tool Adapters + Verification Layer

**New:**
- `packages/core/src/tool-runtime/tool-adapters.ts` — wrap Read/Write/Edit/Bash/WebSearch/WebFetch/SubAgent with ToolExecutionResult
- `packages/core/src/tool-runtime/verification-checks.ts` — `verifyFileExists()`, `verifyGitClone()`, `verifyArchiveExtracted()`

**Key behavior:** After `git clone X dir` via Bash, scheduler auto-calls `verifyGitClone(dir)` before marking `success`. After `Write`, verify file exists.

### Phase 3 — Artifact-Aware Tools

**New:**
- `packages/core/src/tool-runtime/acquire-url.ts` — AcquireUrl: download + size/hash verify + ArtifactRecord
- `packages/core/src/tool-runtime/acquire-archive.ts` — AcquireArchive: download + unzip + verify extracted

### Phase 4 — Durable Integration

**Modified:**
- `packages/core/src/durable-run-store.ts` — persist ToolCallState[], artifacts[], approval outcomes

### Phase 5 — Model Capability Registry

**New:**
- `packages/core/src/model-runtime/model-capabilities.ts` — unified registry: provider, baseUrl, local/cloud, supportsToolCalls, supportsStreaming, timeoutMs, retryProfile, safeForPlanner

### Phase 6 — Policy + Background Safety

**New:**
- `packages/core/src/tool-runtime/execution-policy.ts` — executionClass per tool, dependency blocking rules

---

## 5. Recommended Next Action

**Command:** `/party` (multi-agent, Phase 1 focus) or `/autoforge --auto --max-waves 3`

**Immediate priority:** Phase 1 (`tool-call-types.ts` → `tool-scheduler.ts` → agent-loop.ts refactor)

**Phase 1 acceptance criteria:**
- [ ] ToolScheduler unit tests: all 7 state transitions pass
- [ ] After `git clone X dir`, scheduler blocks until dir verified present
- [ ] agent-loop.ts no longer owns direct tool execution (delegates to scheduler)
- [ ] `tsc --noEmit` passes on cli + vscode + core
- [ ] No regression in existing 1500+ tests

---

## 6. Risk Register

| Risk | P | I | Mitigation |
|------|---|---|-----------|
| Scheduler refactor breaks existing 1500+ tests | M | H | Additive: add scheduler alongside loop; delegate in Phase 2+ |
| VSCode build fails during refactor | L | M | Typecheck before VSIX build; run both CLI and VSCode paths |
| Phase 1 types pollute config-types | L | L | New types in `tool-runtime/` sub-directory only |
| Grok ignores structured results | L | L | Structured result includes human-readable summary field |

---

## 7. Key Files for Implementation

```
# Reference (read-only)
external/qwen-code/packages/core/src/core/coreToolScheduler.ts

# Modify (Phase 1)
packages/cli/src/agent-loop.ts                   # lines 1842-2000 (current tool for-loop)
packages/vscode/src/sidebar-provider.ts          # lines 1287-1560 (current tool for-loop)
packages/core/src/durable-run-store.ts           # extend with tool-call state
packages/core/src/index.ts                       # add tool-runtime exports

# Create (Phase 1)
packages/core/src/tool-runtime/tool-call-types.ts
packages/core/src/tool-runtime/tool-scheduler.ts
packages/core/src/tool-runtime/approval-gateway.ts
packages/core/src/tool-runtime/artifact-store.ts
```

---

*Generated by `/autoforge --score-only` on 2026-03-19. To execute: `/party` or `/autoforge --auto --max-waves 3`*
