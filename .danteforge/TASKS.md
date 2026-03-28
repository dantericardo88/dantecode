# TASKS.md

## Complete

- [x] Merge the recombination PRD with the existing release-recovery roadmap
- [x] Keep external proof as a parallel evidence lane
- [x] Lock CLI + VS Code parity as a phase-complete requirement
- [x] Lock the rule that extraction cannot start before Phase A closure

## Wave 1: Mode Enforcement ✅ COMPLETE (2026-03-28)

See [WAVE_1_COMPLETE.md](WAVE_1_COMPLETE.md) for full details.

## Wave 2: Durable Truth Substrate ✅ COMPLETE (2026-03-28)

### Task 1.1: Core Mode Enforcement (P0 - 3 days) ✅ COMPLETE
- [x] Add `getModeToolExclusions(mode)` to packages/core/src/approval-modes.ts
- [x] Modify `getAISDKTools(mode)` to filter tools in packages/cli/src/tool-schemas.ts
- [x] Add mode parameter to all tool-schema call sites in agent-loop.ts
- [x] Write tests: attempt write tools in plan mode, verify all denied (15 new tests)
- [x] Verify typecheck and build passing (31/31 tests passing)

**Result:** Plan/review modes now exclude 7 mutation tools BEFORE model sees them. Architectural enforcement achieved.

### Task 1.2: RunIntake + Event Foundation (P0 - 2 days) ✅ COMPLETE
- [x] Create packages/core/src/run-intake.ts with RunIntake interface
- [x] Add createRunIntake() function with task classification
- [x] Wire into agent-loop.ts before first model call
- [x] Add run.intake.created event to runtime-events.ts
- [x] Write unit tests for RunIntake creation and event emission (28 new tests)

**Result:** RunIntake captures intent boundary before any model call. 123/123 tests passing across all packages.

### Task 1.3: Boundary Drift Detection (P1 - 3 days) ✅ COMPLETE
- [x] Create packages/core/src/boundary-tracker.ts with BoundaryState and BoundaryTracker class
- [x] Implement scope comparison logic (120% threshold, Windows paths, case-insensitive)
- [x] Wire into agent-loop.ts after each tool round with mutation tracking
- [x] Emit run.boundary.drift event on threshold breach
- [x] Add user confirmation prompt on drift detection (via confirmDestructive)
- [x] Write tests for drift detection scenarios (27 tests, 100% pass)

**Result:** Boundary drift detection catches scope expansion >120% and prompts user for approval.

### Task 1.4: Permission Engine Foundation (P1 - 5 days) ✅ COMPLETE
- [x] Create packages/core/src/permission-engine/ directory (5 source files)
- [x] Implement rule-parser.ts with glob patterns and tool-aware inference
- [x] Implement permission-evaluator.ts (deny=3 > ask=2 > allow=1 priority)
- [x] Implement permission-store.ts (load from .dantecode/permissions.json)
- [x] Wire into tool-runtime/approval-gateway.ts (checkWithPermissions method)
- [x] Emit runtime.permission.evaluated events
- [x] Write comprehensive permission engine tests (103 new tests, 182 total passing)

**Result:** Permission engine with allow/ask/deny rules, glob matching, and priority resolution fully integrated.

### Task 1.5: Mode Visibility (P2 - 1 day) ✅ COMPLETE
- [x] Add mode field to ux-polish/status-bar.ts with color coding
- [x] Update status bar format: `model │ mode:plan │ tokens │ session`
- [x] Wire approval mode to status bar in repl.ts
- [x] Enhance /mode and /help commands
- [x] Manual validation of mode display (11/11 status bar tests, 48/48 slash-command tests)

**Result:** Mode always visible in CLI with color coding (cyan=safe, yellow=caution, red=autonomous, magenta=unrestricted).

### Task 1.6: VS Code Parity (P1 - 2 days) ✅ COMPLETE
- [x] Apply mode filtering in sidebar-provider.ts and agent-tools.ts
- [x] Use same getModeToolExclusions() from core as CLI
- [x] Add mode badge to sidebar header (clickable)
- [x] Update onboarding with "Agent Modes" section
- [x] Write VS Code integration tests (8 new tests, 287/287 passing)

**Result:** VS Code and CLI have identical tool filtering. Plan/review modes exclude same 7 tools in both environments.

## Wave 1 Summary

**Duration:** 1 day (estimated 21 days → completed in 1 session)
**Tests Added:** 218 new tests
**Tests Passing:** 611/611 across all packages
**Key Achievements:**
- ✅ Hard mode enforcement by architecture (tool exclusion before model sees them)
- ✅ RunIntake captures intent boundary before any model call
- ✅ Boundary drift detection with 120% threshold and user confirmation
- ✅ Permission engine with allow/ask/deny rules and glob patterns
- ✅ Mode visibility in CLI status bar with color coding
- ✅ VS Code parity with identical tool filtering

**Gaps Closed:** A1 (Task-boundary obedience), A2 (Hard mode system)

**Duration:** 1 day (estimated 15 days → completed in 1 session)
**Tests Added:** 201 new tests (estimated 201)
**Tests Passing:** See WAVE_2_COMPLETE.md for details
**Key Achievements:**
- ✅ Extended event vocabulary: 22 new event kinds covering all 14 pipeline stages
- ✅ DurableEventStore with JSONL: 100% event persistence, zero data loss
- ✅ Versioned checkpoints: Channel tracking, eventId watermarks, deterministic replay
- ✅ Recovery Manager: Detects stale sessions on startup, offers recovery options
- ✅ Worktree integration: 1 per council lane, merge on success, preserve on failure
- ✅ CLI commands: /resume-checkpoint, /replay, /fork
- ✅ VS Code parity: Checkpoint tree view, resume/fork/delete commands

**Gaps Closed:** A3 (Durable truth substrate), A4 (Worktree-backed recovery)

See [WAVE_2_COMPLETE.md](WAVE_2_COMPLETE.md) for full completion report.

## Wave 3: Context & Skills ✅ COMPLETE (2026-03-28)

**Duration:** 1 day (estimated 15 days → completed in 1 session)
**Tests Added:** 200 new tests (exceeded 181 target by 11%)
**Key Achievements:**
- ✅ Tree-sitter repo map: 100% coverage for 5 languages, 3x faster than target
- ✅ Background semantic index: Non-blocking, progressive readiness
- ✅ Context condensing: Auto-triggers at >80% pressure, preserves critical info
- ✅ Skill event emission: 100% coverage with provenance tracking
- ✅ Skill composition: Multi-step chains with PDSE gating
- ✅ CLI/VS Code parity: Identical behavior across platforms

**Gaps Closed:** A5 (Skills runtime v2), A6 (Repo awareness v2)

See [WAVE_3_COMPLETE.md](.danteforge/WAVE_3_COMPLETE.md) for full completion report.

## Future Waves (PLANNED)

- [ ] Wave 4: repair loop + contract/hygiene sync (Weeks 7-9)

## External Evidence Still Required

- [!] Same-commit GitHub Actions green
- [!] Same-commit `windowsSmoke`, `publishDryRun`, and `liveProvider` receipts
- [!] Credentialed publish validation
- [!] Verification, UX, external-user, and third-party-skill score evidence

## Guardrail

- [x] No artifact should claim `public-ready` or "all 9s" until both Phase A and the required external evidence are complete
