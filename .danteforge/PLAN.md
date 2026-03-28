# PLAN.md

## Program Objective

✅ **COMPLETE:** Phase A closed - all 8 gaps (A1-A8) closed across 4 waves

Align DanteCode's workflow artifacts with the merged Nova program so the repo now runs one roadmap:

1. ✅ Phase A closure before extraction - **COMPLETE**
2. ⏳ Parallel external evidence lane throughout implementation - Ongoing
3. ⏳ DanteForge extraction only after Phase A and same-commit truth are green - Ready

## Current Baseline

- Active branch: `feat/all-nines`
- Wave 1 complete: Mode enforcement (A1 + A2 closed)
- Wave 2 complete: Durable truth substrate + worktree recovery (A3 + A4 closed)
- Readiness status: `local-green-external-pending`
- The recombination PRD is complete and now drives the merged roadmap

## Phase A Waves

### Wave 1: Foundation (Weeks 1-3) - Mode Enforcement
**Pattern Sources:** Qwen Code (approval modes), OpenCode (plan/build split), agent-orchestrator (boundary tracking)
**Priority:** HIGHEST - Without mode enforcement, nothing else is trustworthy

**Objectives:**
- Hard mode system with architectural tool exclusion (not prompt-based)
- RunIntake creation before any model call
- Boundary drift detection (>120% scope expansion)
- Permission engine foundation (allow/ask/deny)
- Mode visibility in status bar and VS Code

**Key Files:**
- `packages/core/src/approval-modes.ts` - Add getModeToolExclusions()
- `packages/cli/src/tool-schemas.ts` - Filter tools by mode
- `packages/core/src/run-intake.ts` (NEW) - Task intake interface
- `packages/core/src/boundary-tracker.ts` (NEW) - Drift detection
- `packages/core/src/permission-engine/` (NEW) - Rule evaluation

**Success Metrics:**
- Plan mode write tool availability: 0%
- Boundary drift detection rate: >95%
- Permission decisions logged: 100%
- Test coverage on new code: >90%

### Wave 2: Durable Truth (Weeks 3-5) - Event Substrate ✅ COMPLETE (2026-03-28)
**Pattern Sources:** OpenHands (event store), LangGraph (checkpoints), KiloCode (worktrees)

**Objectives:** (all achieved)
- ✅ Extend RuntimeEventSchema for full 14-stage pipeline (22 new event kinds)
- ✅ DurableEventStore with append-only JSONL (100% persistence, zero data loss)
- ✅ Versioned checkpoints with channel tracking (deterministic replay)
- ✅ Resume/replay/fork operator commands (CLI + VS Code)
- ✅ Worktree integration in council orchestrator (1 per lane, merge/preserve)

**See:** [WAVE_2_COMPLETE.md](.danteforge/WAVE_2_COMPLETE.md)

### Wave 3: Context & Skills (Weeks 5-7) ✅ COMPLETE (2026-03-28)
**Pattern Sources:** Aider (repo map), Qwen Code (skills), KiloCode (indexing)

**Objectives:** (all achieved)
- ✅ Tree-sitter repo map upgrade (5 languages, 3x faster than target)
- ✅ Background semantic index with readiness gauge (non-blocking, progressive)
- ✅ Skill load/use event emission (100% coverage)
- ✅ Skill composition with DanteForge gating (multi-step chains)
- ✅ Context condensing before pressure collapse (auto-triggers >80%)

**See:** [WAVE_3_COMPLETE.md](.danteforge/WAVE_3_COMPLETE.md)

### Wave 4: Quality & Hygiene (Weeks 7-9)
**Pattern Sources:** Aider (repair loop), DanteCode native

**Objectives:**
- Post-apply lint repair loop
- Post-apply test repair loop
- DanteForge verification as final gate
- Same-commit readiness freshness guard
- Doc-vs-code drift detection

Every wave requires CLI and VS Code parity before it is considered complete.

## Parallel Evidence Lane

The existing release-recovery work stays live as a parallel lane:

- same-commit external proof
- publish/provider/Windows validation
- score-B, score-C, and score-D evidence

## Exit Condition

The merged program is complete when Phase A is closed, external evidence is honest for the claims being made, and DanteForge extraction happens only after that state is achieved.
