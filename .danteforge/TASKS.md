# TASKS.md

## Phase 1
1. Implement the documented workflow - files: src/cli/, src/core/ - verify: Commands produce truthful artifacts and state transitions - effort: M
2. Add verification coverage - files: tests/ - verify: New integration tests fail on incomplete or misleading workflows - effort: M

## Dependencies
- Task 2 depends on the core workflow semantics being stable enough to test.

## Phase Grouping
- Phase 1: establish truthful artifact and execution semantics.

## Context
# PLAN.md

## Architecture Overview
- Inputs: constitution, review output, and specification artifacts.
- Outputs: executable tasks, prompt artifacts, and verification signals.
- Execution model: deterministic local planning, explicit prompt mode for implementation when no LLM is configured.

## Implementation Phases
1. Validate prerequisites and load project state.
2. Generate or refine the required artifact.
3. Store executable tasks for phase 1.
4. Verify required artifacts before moving to execution.

## Technology Decisions
- Keep the CLI ESM-first and file-based for portability.
- Preserve user-level config for secrets and project-level state for artifacts.
- Respect constitution constraints: # DanteForge Constitution

## Risk Mitigations
- Avoid false-positive success messages by requiring a real artifact write.
- Avoid false-positive execution by requiring explicit --prompt mode when no LLM is available.
- Review-generated context is available for refinement.

## Testing Strategy
- Unit tests for parsing, state transitions, and exit-code behavior.
- End-to-end CLI tests in isolated temp workspaces.
- Extension tests for shell safety and command dispatch behavior.

## Timeli

# SPEC.md

## Feature Name
Implement the Session / Memory Enhancement PRD as detailed in Docs\DanteCode Gaps PRD v1 part 5.md

## Constitution Reference
# DanteForge Constitution
- Always prioritize zero ambiguity
- Local-first & PIPEDA compliant
- Atomic commits only
- Always verify before commit
- Scale-adaptive: solo -> party mode automatically

## What & Why
Deliver Implement the Session / Memory Enhancement PRD as detailed in Docs\DanteCode Gaps PRD v1 part 5.md using a structured DanteForge workflow that can run locally or with an external LLM.

## User Stories
1. As an operator, I want Implement the Session / Memory Enhancement PRD as detailed in Docs\DanteCode Gaps PRD v1 part 5.md, so that I can move from intent to execution with clear artifacts.
2. As a reviewer, I want generated artifacts to be explicit and verifiable, so that the workflow is trustworthy.

## Non-functional Requirements
- Keep generated artifacts deterministic in local-only mode.
- Preserve compatibility with prompt-mode and LLM-backed workflows.
- Make every step fail closed when prerequisites are missing.

## Acceptance Criteria
1. SPEC.md is written to .danteforge/.
2. The task breakdown can drive for
