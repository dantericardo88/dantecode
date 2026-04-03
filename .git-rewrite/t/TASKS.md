# TASKS.md - Nova Program Execution Checklist

**Date:** `2026-03-27`  
**Baseline commit:** `6b9b62cd1bc4`

## Legend

- `[x]` complete
- `[ ]` pending
- `[!]` blocked on external systems, credentials, or real-world evidence

## Program Merge Foundation

- [x] Complete the recombination PRD and make it the constitutional product document
- [x] Retain release-recovery work as a parallel evidence lane instead of a separate roadmap
- [x] Lock the program rule that CLI and VS Code parity is required for every major phase
- [x] Lock the program rule that DanteForge remains the only truth authority
- [x] Forbid extraction before Phase A closure and same-commit truth gates are green

## Baseline Recovery Work Already Complete

- [x] Make `release-matrix.json` the canonical release catalog
- [x] Convert release, smoke, publish, and score scripts to catalog-driven behavior
- [x] Refactor readiness/scoring to require same-commit evidence
- [x] Promote `@dantecode/web-extractor` to the supported GA path
- [x] Implement a real `CrawleeProvider` and repair package exports/docs/tests
- [x] Make smoke and packaging flows self-sufficient from a clean clone
- [x] Reduce default `/help` to a curated tier-1 command surface
- [x] Add GitLab CI and CircleCI examples and extend validation to Node 24
- [x] Add scoring evidence manifests under `artifacts/scoring/`
- [x] Fix internal worktree handling so generated worktrees do not dirty the main repo
- [x] Regenerate readiness and score artifacts for the baseline commit

## Wave 1 - Task-Boundary Obedience + Hard Mode System

- [x] Canonicalize the user-facing mode model to `plan`, `review`, `apply`, `autoforge`, and `yolo`
- [x] Make `plan` mode write-impossible by architecture
- [x] Make `review` mode non-mutating by architecture
- [ ] Tighten the approval/profile contract across CLI, policy, and VS Code surfaces
- [ ] Add explicit boundary-drift detection between user ask, planned scope, and actual mutations
- [x] Add run/report output that explains when boundary drift was prevented or detected
- [ ] Add tests for zero-write guarantees, approval/profile regressions, drift detection, and CLI/VS Code parity

## Wave 2 - Durable Truth Substrate + Worktree Recovery

- [ ] Consolidate run lifecycle state around the durable-run path
- [ ] Normalize event emission, checkpointing, replay, resume, and fork onto the same durable-truth model
- [ ] Tie reports, receipts, and readiness artifacts to the same run/commit/worktree lineage
- [ ] Add user-visible recovery state to CLI and VS Code surfaces
- [ ] Add tests for interrupted-run resume, checkpoint restore, replay fidelity, and worktree cleanup/merge behavior

## Wave 3 - Skills Runtime v2 + Repo Awareness v2

- [ ] Add explicit `skill_loaded` and `skill_used` attribution with provenance and trust metadata
- [ ] Apply policy checks equally to skills, subagents, tools, and path/command execution
- [ ] Add report/receipt coverage for skill load/use and composition
- [ ] Expose deterministic repo map as the immediate codebase contract
- [ ] Expose semantic index/search as the background augmentation contract
- [ ] Surface index readiness and context pressure in CLI and VS Code
- [ ] Add tests for skill attribution, policy enforcement, repo map generation, semantic search quality, and context condensing

## Wave 4 - Repair Loop + Contract/Hygiene Sync

- [ ] Add an Aider-style post-apply lint/test repair loop
- [ ] Enforce diff/undo discipline around apply and recovery paths
- [ ] Fail closed when root docs or generated readiness/scoring artifacts drift from code
- [ ] Merge the remaining release-recovery deliverables into the recombination roadmap and remove duplicate planning language
- [ ] Add tests for repair-loop success/failure, undo safety, readiness freshness, scoring freshness, and doc-vs-code drift
- [ ] Re-run GF-01 through GF-06 on real repos before claiming recombination success

## Parallel Evidence Lane - External Release and Score Proof

- [!] Get the release candidate SHA green on GitHub Actions
- [!] Produce same-commit `windowsSmoke`, `publishDryRun`, and `liveProvider` receipts
- [!] Configure `NPM_TOKEN`
- [ ] Configure `VSCE_PAT` only if preview VS Code publishing is part of the release claim
- [!] Record stopwatch docs trials in `artifacts/scoring/docs-time-to-value.json`
- [!] Add receipt-backed benchmark evidence for verification score dimensions
- [!] Record real external-user sessions in `artifacts/scoring/external-users.json`
- [!] Record real third-party skills in `artifacts/scoring/skill-ecosystem.json`

## Phase B - DanteForge Extraction

- [ ] Start extraction only after all Phase A waves are complete and same-commit truth gates are green
- [ ] Move truth-centric interfaces to the narrowed DanteForge boundary: `verify`, `seal`, `timeline`, `replay`, `policy-check`, `skill-verify`, `skill-forge`, `lesson-store`
- [ ] Keep user-facing mode/session/search/skill/provider/report UX in DanteCode
- [ ] Add extraction tests that prove no second verification path remains in DanteCode

## Phase C - Post-Extraction Productization

- [ ] Finish packaging around the narrowed DanteForge interface
- [ ] Validate product surfaces and readiness claims against the extracted boundary
- [ ] Keep commercialization work from reintroducing duplicated truth logic

## Release Claim Guardrails

- [x] Do not claim `public-ready` until same-commit external gates and credentials are actually proven
- [x] Do not claim 9+ across all scoring dimensions until real evidence exists for the currently zero-scored dimensions
- [x] Do not begin extraction while any Phase A wave remains incomplete
