# PLAN.md - Nova Recombination Program + Release Recovery Merge

> Constitutional product doc: `Docs/Dante_Recombination_Masterplan_VE.md`
> Live readiness state: `artifacts/readiness/current-readiness.json`
> Live score report: `artifacts/scoring/current-score-report.json`

**Date:** `2026-03-27`  
**Baseline commit:** `6b9b62cd1bc4`  
**Program status:** `phase-a-wave-1-pending / external-evidence-parallel`

## Objective

Merge the new Dante recombination program with the existing same-commit release recovery work so the repo operates under one roadmap instead of two overlapping plans.

This program is now the source of truth for execution order:

1. Phase A closure before extraction
2. DanteForge extraction after A1-A8 are closed
3. Post-extraction productization after the boundary is stable

The prior release-recovery work is retained as a standing evidence lane inside this program, not as a separate cleanup effort.

## Locked Program Rules

- Scope is the full program, not a single implementation wave.
- Every major phase must reach CLI and VS Code parity before it is considered complete.
- External release blockers run as a parallel evidence lane, not as a front gate or end-only pass.
- DanteForge remains the only truth authority; no second verification path is allowed to emerge in DanteCode.
- Extraction is forbidden until Phase A is complete and same-commit truth gates are green.
- If a wave cannot close fully, it must be reported as `PARTIAL` and the program does not advance on trust-critical claims.

## Baseline Already Completed

These lanes remain complete and now become program foundations instead of stand-alone recovery wins:

### 1. Release source of truth

- `release-matrix.json` is the canonical release catalog for package scope, publish eligibility, and surface maturity
- release, smoke, publish, and scoring scripts read from the catalog instead of drifting hard-coded package lists
- GitHub Actions, GitLab CI, and CircleCI examples are aligned to the same release command set

### 2. Honesty restoration

- readiness generation fails closed to same-commit evidence instead of stale claims
- scoring is artifact-backed where possible and uses `artifacts/scoring/` for non-automatable evidence manifests
- root scoring/readiness docs describe measured state rather than aspirational outcomes

### 3. Supported GA surface cleanup

- `@dantecode/web-extractor` is in the supported GA path
- `CrawleeProvider` is a real provider implementation rather than an empty export target
- package metadata, exports, docs, and contract tests match the shipped behavior

### 4. Smoke and packaging resilience

- CLI, install, external, provider, and publish dry-run flows do not rely on leftover build state
- the CLI build emits the artifacts used by score measurement and smoke validation
- internal worktree creation no longer dirties the parent repository

### 5. UX and scoring scaffolding

- default `/help` shows a curated tier-1 command surface
- CI coverage includes Node 24 plus GitHub Actions, GitLab CI, and CircleCI examples
- external evidence manifests exist for install success, docs time-to-value, external users, and third-party skills

## Current Baseline Reality

- Local gates are green for the baseline release-recovery commit
- Smoke and release scripts are green locally
- Same-commit readiness truth exists locally but is still externally incomplete
- Verification quality, UX evidence, and distribution evidence are not yet honestly claimable as 9+
- The recombination PRD is now complete, but the repo plan and task artifacts must drive implementation through the merged roadmap below

## Program Structure

## Phase A - Dante Closure Before Extraction

This phase is mandatory. No extraction work begins until all four waves below are complete.

### Wave 1 - Task-boundary obedience + hard mode system

Goal:

- make `plan`, `review`, `apply`, `autoforge`, and `yolo` the canonical user-facing mode model
- ensure `plan` and `review` cannot mutate by architecture rather than prompt convention
- tighten the approval/profile contract across CLI, policy, and VS Code surfaces
- detect and report boundary drift between user ask, planned scope, and actual mutations

Completion rule:

- `plan` and `review` have zero permitted write paths
- CLI and VS Code display the same active mode and restriction state
- boundary drift is surfaced in reports and tests

### Wave 2 - Durable truth substrate + worktree-backed recovery

Goal:

- consolidate run lifecycle, event emission, checkpointing, replay, resume, fork, and worktree provenance around the durable-run path
- make reports, receipts, and readiness artifacts resolve to the same run, commit, and worktree story

Completion rule:

- interrupted runs can resume cleanly
- restore/replay/fork behavior is covered by tests
- same-commit linkage exists across durable runs, reports, and readiness artifacts
- CLI and VS Code expose the same user-visible recovery state

### Wave 3 - Skills runtime v2 + repo awareness v2

Goal:

- make skills explicit, policy-bound, provenance-aware, and reportable end-to-end
- add visible skill load/use attribution and composition receipts
- upgrade repo awareness to a dual system: deterministic repo map immediately, semantic index/search in the background
- surface index readiness and context pressure in both CLI and VS Code

Completion rule:

- skill load/use is explicit in reports and receipts
- policy applies equally to skills, tools, and subagents
- repo map and semantic search both have tested contracts
- CLI and VS Code surface the same user-visible skill/index state

### Wave 4 - Repair loop + contract/hygiene sync

Goal:

- add an Aider-style post-apply lint/test repair loop
- enforce diff/undo discipline
- close doc/readiness/scoring drift so root docs and generated artifacts cannot outrun code
- absorb all remaining release-recovery deliverables into the merged program so there is no second cleanup roadmap

Completion rule:

- repair loop success and failure paths are covered by tests
- doc-vs-code drift checks fail closed
- readiness/scoring freshness guards are enforced
- root planning and release docs reflect the merged program accurately

## Parallel Evidence Lane - External Release and Score Proof

This lane runs in parallel with Phase A and remains required before any public-ready or 9+ claim.

### External proof still required

- GitHub Actions must be green for the release candidate SHA
- `windowsSmoke` must move from `unknown` to `pass`
- `publishDryRun` must be validated in a credentialed environment
- `liveProvider` must be validated with real provider credentials
- `NPM_TOKEN` must be configured for publish validation
- `VSCE_PAT` is only required if preview VS Code publishing is part of the release claim

### Evidence still required for honest 9+

- receipt-backed verification benchmark evidence for score-B claims
- stopwatch-based docs time-to-value trials for score-C claims
- user-tested evidence for error clarity and verification trust
- real external-user sessions for score-D claims
- real third-party imported skills for score-D claims

## Phase B - DanteForge Extraction

This phase starts only after Phase A closes and same-commit truth gates are green.

Move to DanteForge:

- verification, sealing, and cryptographic timeline
- replay/timeline primitives
- skill verification, routing, and forge capabilities
- adversarial lessons and governance

Keep in DanteCode:

- mode UX
- session and run visibility
- search/index UX
- skill UX
- provider/model UX
- report rendering

## Phase C - Post-Extraction Productization

Once the boundary is stable:

- bundle DanteForge cleanly behind the narrowed interface
- finish packaging and commercialization shape around the trusted core
- keep truth logic centralized and non-duplicated

## Exit Criteria

This merged program is complete when:

1. Phase A waves 1-4 are complete with CLI and VS Code parity.
2. External release and score evidence are current enough to support any public-ready claim being made.
3. DanteForge extraction has happened only after A1-A8 closure and same-commit truth is green.
4. Root docs, readiness artifacts, and scores all agree on the same current reality.
5. Any score still below 9 is due to missing external evidence, not hidden repo debt or internal contradictions.
