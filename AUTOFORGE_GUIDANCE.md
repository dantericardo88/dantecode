# AUTOFORGE_GUIDANCE.md
**Generated:** 2026-03-19 | **Mode:** --score-only (updated post-DTR) | **Autoforge Iteration:** 16
**Branch:** feat/dantecode-9plus-complete-matrix
**Scenario:** mid-project — DTR Phases 1–6 complete, gap-closure wave done

---

## 1. PDSE Artifact Scores

| Artifact | Source | Score | Status | Notes |
|----------|--------|-------|--------|-------|
| CONSTITUTION | `Docs/DanteCode_PRD_v1.0.md` D1 | 9.0 | ✅ PASS | Anti-stub doctrine, model agnosticism, NOMA, PDSE principles all present |
| SPEC | `Docs/DanteCode_PRD_v1.0.md` D2–D4 + Blade PRD | 8.5 | ✅ PASS | Architecture spec; DTR now implemented per Qwen gap analysis |
| CLARIFY | User-provided Qwen gap analysis (2026-03-19) | 9.0 | ✅ PASS | Surgical PRD: 12 gaps identified, Qwen code read directly, FR1–FR14 defined |
| PLAN | CAPABILITIES.md + AUTOFORGE_GUIDANCE.md (this file) | 8.5 | ✅ PASS | DTR 6-phase plan fully implemented; now serves as living record |
| TASKS | DTR Phases 1–6 (all committed) | 8.0 | ✅ PASS | All 6 phases implemented, 130 new tests, fully wired into agent-loop.ts |

**Overall PDSE Score: 8.6 / 10** (up from 7.4 — TASKS bottleneck resolved)
**Primary remaining gap:** Agent-loop refactor to fully delegate to ToolScheduler (Phase 1 additive only)

---

## 2. Current Workflow State

**Stage:** `gap-closure complete → polish / integration`
**Completed waves (all committed):**
- Reliability hardening v1.0 (checkpointer, loop-detector, circuit-breaker, git-snapshot-recovery) ✅
- 9+ Universe Waves 1–6 (WebSearch/Fetch multi-provider, SubAgent, GitHub ops, reasoning chains, self-healing, integration) ✅
- Anti-confabulation guards v1, v2, v2b (GROK_CONFAB_RE, reads-only detection, nudges ×4) ✅
- Destructive loop fix v1 + v2 (DESTRUCTIVE_GIT_RE + rm -rf guard + regex gap) ✅
- Silent tool drop fix (extractToolCalls returns parseErrors[], system prompt verification guidance) ✅
- **DTR Phase 1** — ToolCallStatus (10-state), ArtifactStore, VerificationChecks, ToolScheduler, ApprovalGateway ✅
- **DTR Phase 2** — Tool Adapters (adaptToolResult, formatEvidenceSummary) ✅
- **DTR Phase 3** — AcquireUrl + AcquireArchive tools with SHA-256 + ArtifactRecord ✅
- **DTR Phase 4** — DurableRunStore.persistArtifacts/loadArtifacts ✅
- **DTR Phase 5** — ModelCapabilityRegistry (16 builtin profiles: anthropic, grok, openai, google, groq, ollama, custom) ✅
- **DTR Phase 6** — ExecutionPolicy registry (7 classes, 16 policies, dependency gating, concurrency rules) ✅
- **DTR Wiring** — agent-loop.ts: artifact persistence, dependency gate, AcquireUrl/Archive docs + regex ✅

---

## 3. DTR Implementation Summary (6 Phases — Complete)

| Phase | Files | Tests | Status |
|-------|-------|-------|--------|
| Phase 1: Core Types + Scheduler | tool-call-types.ts, verification-checks.ts, artifact-store.ts, tool-scheduler.ts, approval-gateway.ts | 58 | ✅ Done |
| Phase 2: Tool Adapters | tool-adapters.ts | 24 | ✅ Done |
| Phase 3: Acquire Tools | acquire-url.ts, acquire-archive.ts | Covered by Phase 1 types | ✅ Done |
| Phase 4: Durable Integration | durable-run-store.ts (persistArtifacts/loadArtifacts) | Existing store tests | ✅ Done |
| Phase 5: Model Registry | model-capabilities.ts | 20 | ✅ Done |
| Phase 6: Execution Policy | execution-policy.ts | 28 | ✅ Done |
| **Wiring** | agent-loop.ts (all hooks), tools.ts, tool-schemas.ts | — | ✅ Done |

**Total new tests added in DTR wave:** 130 (58+24+20+28)

### Key wiring points in agent-loop.ts
- **Post-Bash/Write**: `globalToolScheduler.verifyBashArtifacts()` / `verifyWriteArtifact()` → DTR warning injected
- **Post-success**: `completedToolsThisTurn.add(toolCall.name)` → feeds ExecutionPolicy dependency gate
- **Pre-GitCommit/Push**: `globalExecutionPolicy.dependenciesSatisfied()` → blocks if Write/Edit not yet done
- **Pre-commit**: existing `filesModified === 0` premature commit blocker (complementary, not replaced)
- **Run end**: `durableRunStore.persistArtifacts()` → download artifacts logged to artifacts.json
- **System prompt**: AcquireUrl/AcquireArchive documented as preferred over `Bash curl`/`Bash wget`
- **Tool regex**: AcquireUrl, AcquireArchive, GitHubOps added to JSON block parser

---

## 4. Remaining Gaps (Phase 2 work — not blocking)

| Gap | Priority | Notes |
|-----|----------|-------|
| Full scheduler delegation — agent-loop directly calls executeTool(), not via ToolScheduler | Medium | Phase 1 was additive; full delegation deferred. Requires refactor of executeTool dispatch. |
| `awaiting_approval` state — ApprovalGateway disabled | Low | Gateway exists but all checks return `auto_approve` by default. Enable per-tool rules in Phase 2. |
| VSCode sidebar-provider.ts wiring | Medium | DTR Phase 1 hook wired, but completedToolsThisTurn, ExecutionPolicy gate, persistArtifacts not yet in VSCode path |
| Truncation detection in Write | Low | Size-based guard exists (30K). Qwen's pattern detects mid-content truncation markers. |

---

## 5. Recommended Next Action

**Option A (quick wins):** Wire VSCode sidebar-provider.ts with the same completedToolsThisTurn + ExecutionPolicy + persistArtifacts changes made to agent-loop.ts.

**Option B (capability):** Re-run `/autoforge --score-only` to generate fresh PDSE scores, then identify next capability gap.

**Option C (validation):** Run `tsc --noEmit` on all packages, build VSIX, install, reload window.

---

## 6. Risk Register

| Risk | P | I | Mitigation |
|------|---|---|-----------|
| completedToolsThisTurn gate blocks GitCommit when deps not declared | L | M | ExecutionPolicy only fires in `isPipelineWorkflow` context; default is `auto_approve` |
| AcquireUrl/AcquireArchive on Windows need tar/unzip | M | L | acquire-archive.ts falls back to python zipfile; tar available in Git Bash |
| persistArtifacts noise in durable run files | L | L | artifacts.json is separate sidecar, not merged into run state |

---

*Updated 2026-03-19 post-DTR Phases 1–6 completion. Previous score: 7.4. Current: 8.6.*
