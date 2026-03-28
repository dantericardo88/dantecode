# Dante Recombination Masterplan - V+E Product Requirements Document

| Field | Value |
| --- | --- |
| Status | Execution-ready |
| Date | 2026-03-27 |
| Command context | `/inferno` |
| Scope | DanteCode + DanteForge recombination strategy |
| Primary audience | DanteCode maintainers, DanteForge maintainers, execution agents |
| Source freeze | 2026-03-27 official docs + current repo planning docs |
| Success condition | Dante reaches trustworthy 9+ execution quality without weakening its verification moat |

## Purpose

This document turns the earlier memo-style execution packet into a complete PRD.

The core thesis does not change:

- Dante already has the strongest trust thesis in the set.
- Dante does not yet have the strongest execution pipeline, operator surface, or long-horizon control model.
- The right move is recombination, not feature sprawl.

The goal is to rebuild Dante's execution pipeline stage-by-stage using the best proven patterns from donor systems while preserving Dante's unique moat:

- verification
- receipts
- evidence chain
- PDSE
- anti-stub enforcement
- plain-language trust reporting
- provider portability

This PRD resolves the missing pieces the original memo lacked:

- explicit user/problem framing
- goals and non-goals
- donor evidence rationale
- detailed functional and non-functional requirements
- UX requirements
- architecture boundary
- phased roadmap and package impact
- metrics
- risks and mitigations
- final program-level acceptance criteria

## 0. Executive Verdict

Dante should not try to win by being the most magical terminal agent.

Dante should win by being the most trustworthy execution system with the best operator experience for serious work.

Strategic rule:

- Keep Dante's trust layer.
- Harvest Qwen's control model.
- Harvest Kilo's polish.
- Harvest OpenCode's permission and session discipline.
- Harvest OpenHands' evented runtime substrate.
- Harvest Aider's terminal discipline.
- Harvest Agent Skills as the portability spine.

Do not ship a donor collage.
Ship a coherent Dante system with a single constitutional center of truth.

## 1. Problem Statement

### 1.1 What Dante already does well

Dante already differentiates on the dimension that matters most for real software work:

- It treats verification as a first-class product surface.
- It can explain outcomes in plain language.
- It aims for evidence, not vibe-based completion.
- It is structurally aligned with auditability and provider portability.

That is the right moat.

### 1.2 What is still broken

Today, Dante's biggest risks are not idea quality. They are execution quality and execution truth:

1. It can drift beyond the user's requested boundary.
2. Its mode system is not yet strict enough.
3. Long tasks can still collapse into one context and one actor.
4. Run truth is not yet anchored to one canonical runtime substrate.
5. Recovery, replay, and resume are not yet bulletproof enough to trust under stress.
6. Skills are not yet explicit, visible, composable, and auditable enough.
7. Repo awareness is not yet strong enough for very large codebases.
8. Same-commit readiness truth is still vulnerable to drift.
9. Docs can still outrun code.
10. Ship hygiene is not yet fully constitutional.

### 1.3 Product problem to solve

Build the best place to do real software work by combining:

- DanteCode as the flagship operator surface
- DanteForge as the truth engine
- donor patterns for control, sessioning, indexing, replay, and recovery

without duplicating truth logic or weakening Dante's verification posture.

## 2. Users and Jobs To Be Done

### 2.1 Primary user - Non-technical operator

This user cannot reliably inspect diffs, evaluate code quality, or judge whether an AI overclaimed.

They need Dante to:

- stay inside the requested scope
- explain what changed in plain language
- clearly separate plan from execution
- verify outcomes automatically
- tell the truth when work is partial or failed

### 2.2 Secondary user - Technical maintainer

This user can inspect code, but wants leverage and control.

They need Dante to:

- decompose long work safely
- delegate bounded subtasks
- recover or replay sessions
- search large repos effectively
- keep receipts tied to the actual commit

### 2.3 Tertiary user - Team lead or platform owner

This user cares about governance, repeatability, and team-safe extensibility.

They need Dante to:

- enforce policy and permissions
- expose durable audit trails
- support local/project/org skill systems
- keep truth logic centralized
- support future hosted or commercial layers without re-architecting the core

## 3. Product Thesis

### 3.1 Positioning

DanteCode should be the best environment in which to work.

DanteForge should be the best environment in which to verify truth.

DanteCode may render the truth beautifully.
DanteForge must own the truth.

### 3.2 Product promise

When a user asks Dante to do work:

- the boundary is explicit
- the active mode is visible
- permissions are enforceable
- large work is decomposed intentionally
- every material action is recoverable
- every result is reported honestly
- every claim can be tied back to receipts, events, and verification

### 3.3 What "100% complete" means for this PRD

This PRD is considered complete when it contains:

- resolved product decisions instead of placeholders
- in-scope and out-of-scope boundaries
- detailed requirements
- delivery sequencing
- measurable exit criteria
- package-level ownership guidance
- donor rationale supported by primary-source research

This document intentionally leaves implementation details flexible where they do not affect constitutional product behavior.

## 4. Goals and Non-Goals

### 4.1 Goals

1. Enforce hard separation between `plan`, `review`, `apply`, and `autoforge`.
2. Make task-boundary obedience measurable and reliable.
3. Make long-task execution decomposed, resumable, and auditable.
4. Move all run truth onto a durable event- and receipt-based substrate.
5. Make worktree-backed recovery feel safe enough for daily-driver use.
6. Make skills explicit, local-first, composable, policy-bound, and provable.
7. Make repo awareness first-class on large codebases.
8. Eliminate same-commit readiness drift.
9. Prevent docs from outrunning code.
10. Prepare a clean DanteCode/DanteForge extraction boundary without duplicating trust logic.

### 4.2 Non-goals

1. Copying any donor product wholesale.
2. Shipping a hosted platform before the local/runtime truth boundary is stable.
3. Adding decorative features that do not improve truth, control, or operator leverage.
4. Letting speed claims outrank verification quality.
5. Building a registry-first skill ecosystem before local inventory is solid.
6. Keeping duplicate verification logic in both DanteCode and DanteForge long term.

## 5. Current Gaps To Close

These are the product gaps this PRD is explicitly designed to close:

1. Task-boundary obedience
2. Hard mode separation
3. Long-task decomposition
4. Durable execution truth
5. Worktree-backed recovery
6. Skill activation discipline
7. Repo awareness
8. Same-commit readiness truth
9. Doc/reality drift
10. Ship hygiene

If these ten gaps are not closed, Dante may still be impressive, but it will not be trustworthy enough to become the default environment for serious work.

## 6. Donor Research and Harvest Decisions

Harvest decisions below are based on official docs reviewed on 2026-03-27 and listed in Appendix A.

| Donor | Validated strengths | Harvest | Do not copy |
| --- | --- | --- | --- |
| Qwen Code | Approval modes, explicit subagents, task delegation, skills, plan-mode tooling | Approval ladder, read-only planning, explicit decomposition, tool-scoped subagents, visible skill usage | Any weakening of Dante verification or hidden product assumptions |
| Kilo Code | Custom modes, sticky models, file-scoped restrictions, Agent Manager, worktree parallelism, checkpoints, semantic code indexing, context condensing | Polished mode system, session/agent manager, worktree isolation, indexing + context pressure UX | Treating permissions as a security boundary by themselves, or relying on opaque automation |
| OpenCode | Build/Plan primary agents, subagents, permission engine, config layering, session ergonomics | Plan/build split, permission enforcement, config discipline, agent/session mental model | Complexity that muddies the operator model |
| OpenHands | Append-only event system, event log, persistence/resume, workspace abstraction, local/remote execution symmetry, sandbox runtime | Durable runtime substrate, replay foundation, event-centric state model | Premature operational heaviness |
| Aider | Ask/code/architect split, repo map, git/diff/undo discipline, automatic lint/test repair loop | Repo map, repair loop, diff/undo culture, terminal rigor | Narrow single-loop UX as Dante's final product |
| Agent Skills + Claude Code ecosystem | Open skill specification, progressive disclosure, skill directories, allowed-tools metadata, subagents, plugin marketplace controls | Verified local inventory, import/export compatibility, explicit skill composition, policy-bound plugin/skill loading | Registry dependence, hidden skill execution, uncontrolled marketplace trust |

### 6.1 Qwen - What Dante should take

Qwen's strongest contribution is control architecture:

- approval modes that change what the agent may do
- explicit task delegation through subagents
- separate context and tool access per subagent
- visible skills and slash-command distinction

Dante should copy the discipline, not the branding.

### 6.2 Kilo - What Dante should take

Kilo's strongest contribution is operator polish:

- custom modes with sticky models
- file/path restrictions
- worktree-backed parallel execution
- resumable agent/session management
- semantic code indexing plus context condensing

Dante should take the product feel, but keep DanteForge as the truth authority.

### 6.3 OpenCode - What Dante should take

OpenCode's strongest contribution is a clean mental model:

- Build versus Plan
- primary agents versus subagents
- explicit permissions with `allow`, `ask`, `deny`
- config layering and agent-specific overrides

Dante should adopt this clarity, then harden it with verification.

### 6.4 OpenHands - What Dante should take

OpenHands contributes the strongest runtime substrate patterns:

- append-only event log
- conversation-level state orchestration
- workspace abstraction
- local versus remote execution symmetry
- persistence and resume services that observe the event stream

Dante should use these ideas to anchor run truth and replay.

### 6.5 Aider - What Dante should take

Aider contributes discipline at the point of execution:

- deliberate ask/code split
- architect/editor separation
- repo map for immediate codebase awareness
- automatic lint/test repair loop
- git-integrated diff/undo culture

Dante should adapt these into its post-apply execution loop.

### 6.6 Agent Skills and Claude Code - What Dante should take

The skills ecosystem contributes the right portability model:

- skill as a directory with `SKILL.md`
- progressive disclosure of metadata, instructions, and resources
- optional preapproved tools metadata
- project-level and user-level skills
- policy and marketplace layering for plugins and extensions

Dante should become the strictest verifier of imported skills, not merely another consumer.

## 7. Product Boundary After Recombination

### 7.1 DanteCode should own

- CLI and IDE UX
- visible mode system
- plan/review/apply/autoforge interaction model
- session management and session visibility
- repo awareness UX
- skill discovery and composition UX
- provider/model selection UX
- timeline and report rendering
- being the best place to actually work

### 7.2 DanteForge should own

- verification engine
- PDSE
- anti-stub and governance
- receipts and evidence chain
- sealing and cryptographic timeline
- replay and restore primitives
- skill verification, dedupe, merge, improve, runtime routing
- lessons and adversarial refinement
- external-tool adapters and commercial trust services

### 7.3 Shared interface

DanteCode must consume DanteForge through a narrow, explicit interface:

- `verify`
- `seal`
- `timeline`
- `replay`
- `policy-check`
- `skill-verify`
- `skill-forge`
- `lesson-store`

No long-term duplication of trust logic is allowed across the two repos.

## 8. Canonical Dante Execution Pipeline

### Stage 1 - Task intake

Every request produces:

- run ID
- user intent classification
- requested scope
- allowed action boundary

### Stage 2 - Task classification

The system classifies work into:

- explain
- analyze
- review
- change
- long-horizon
- background automation

This classification determines mode, decomposition, and approval behavior.

### Stage 3 - Mode selection

Required primary modes:

- `plan`
- `review`
- `apply`
- `autoforge`

Required overlays:

- `debug`
- `architect`
- `reviewer`
- `docs`

Mode properties must be:

- visible to the user
- sticky with preferred model/provider
- able to carry tool restrictions
- able to carry file/path restrictions

### Stage 4 - Scope and permission fencing

Permissions must be enforced at the level of:

- tool
- mode
- subagent
- command pattern
- path or regex
- skill

Permission outcomes:

- allow
- ask
- deny

### Stage 5 - Repo awareness and context assembly

Use a dual system:

- immediate deterministic repo map
- background semantic block index

Context inputs include:

- repo map
- codebase search
- file watch and incremental update
- context condensing
- explicit context pressure visibility

### Stage 6 - Skill discovery and selection

Runtime must use a verified local inventory with:

- import
- scan
- dedupe
- merge
- improve
- provenance and license tracking
- explicit `/skills`
- explicit `/skills run <name>`
- visible "skill loaded" and "skill used" events
- multi-skill composition

### Stage 7 - Plan creation

`plan` mode must be truly read-only.

`review` mode may produce:

- diff proposals
- task lists
- design notes
- handoff summaries

Neither mode may mutate code without an explicit transition.

### Stage 8 - Subtask decomposition

Long tasks decompose into bounded roles such as:

- planner
- implementer
- tester
- reviewer
- docs

Each subagent receives:

- separate context
- separate tool scope
- separate file/path scope
- separate receipt stream
- explicit handoff summary

### Stage 9 - Execution

Rules:

- no apply without approval path
- no success implied by tool call alone
- file writes tracked path-by-path
- diff and undo culture retained

### Stage 10 - Checkpointing and worktree safety

All non-trivial runs may create:

- checkpoint
- restore point
- worktree branch
- timeline entry
- optional fork

Long jobs must be resumable.

### Stage 11 - Verification

This remains Dante's moat:

- PDSE
- anti-stub
- evidence chain
- receipts
- adversarial refinement
- plain-language trust report

### Stage 12 - Honest reporting

Rules:

- no "done" without apply proof
- no "verified" without post-apply verification
- partial, timeout, and failure are first-class outcomes
- reports derive from events, ledger entries, and receipts only

### Stage 13 - Recovery and replay

Requirements:

- replayable run state
- restore by checkpoint or run ID
- resume from interruption
- worktree/session continuity
- same-commit truth

### Stage 14 - Lessons and memory

Dante owns:

- quirk adaptation
- lessons learned
- skill improvements
- provider/model-specific behavior tuning
- gaslight-derived corrections

## 9. Functional Requirements

### FR-1. Task intake and intent boundaries

The system must:

1. create a run object before any material work begins
2. store the requested boundary and allowed action class
3. preserve the original user ask for later report comparison
4. detect and flag boundary drift when work expands beyond the ask

### FR-2. Hard mode system

The system must:

1. expose `plan`, `review`, `apply`, and `autoforge` as visible modes
2. keep the active mode visible in the CLI and IDE at all times
3. ensure `plan` is read-only
4. ensure `review` does not mutate files
5. require an explicit transition into `apply`
6. fence `autoforge` behind policy plus verification

### FR-3. Permission engine

The system must:

1. support `allow`, `ask`, and `deny`
2. enforce permissions per tool, path, command pattern, skill, and subagent
3. support path and regex matching for file access
4. support explicit external-directory rules
5. record every approval decision in the event log and receipt stream
6. prevent hidden bypass paths

### FR-4. Repo awareness

The system must:

1. build a deterministic repo map quickly on session start
2. build or refresh a semantic index in the background
3. provide semantic `codebase_search`
4. show index readiness and context pressure to the operator
5. support large-repo context condensing without corrupting intent or history

### FR-5. Skill runtime v2

The system must:

1. maintain a verified local skill inventory
2. support import from external ecosystems and open skill standards
3. preserve provenance, license, compatibility, and trust score
4. allow explicit invocation and composition
5. record skill load/use events in receipts and reports
6. enforce the same policy layer on skills that applies to normal execution

### FR-6. Long-task decomposition

The system must:

1. decompose long-horizon work into bounded subtasks
2. support role-specialized subagents
3. isolate context, files, and tools for each subagent
4. support parallel execution where tasks do not conflict
5. return structured handoff summaries rather than raw transcript dumps

### FR-7. Execution and repair loop

The system must:

1. execute only inside approved boundaries
2. track writes path-by-path
3. run post-apply repair loops for lint, build, and tests where configured
4. support diff review and undo
5. stop claiming success when verification or repair fails

### FR-8. Durable truth substrate

The system must:

1. emit typed runtime events for material state transitions
2. persist those events durably
3. derive reports from the event log rather than assistant prose
4. tie receipts and readiness artifacts to the same commit
5. survive crash or interruption with honest partial state

### FR-9. Recovery, replay, and resume

The system must:

1. restore by run ID or checkpoint
2. replay an execution timeline deterministically enough for audit use
3. resume interrupted long jobs
4. preserve session/worktree continuity
5. distinguish replay, resume, and fork as separate operator actions

### FR-10. Honest reporting

The system must:

1. emit a report for every material run, including failures
2. label outcomes as `COMPLETE`, `PARTIAL`, `FAILED`, or `NOT ATTEMPTED`
3. explain what was built, what failed, and what needs to happen next
4. show verification evidence in plain language
5. never overclaim relative to receipts or verification state

### FR-11. Lessons and adaptive memory

The system must:

1. capture lessons only after verified success or explicit review
2. separate facts, strategies, and transient run history
3. support provider/model-specific tuning records
4. keep the memory system auditable and reversible

### FR-12. DanteForge extraction boundary

The system must:

1. keep truth logic inside DanteForge or behind DanteForge-owned interfaces
2. prevent DanteCode-only copies of verification logic from accreting over time
3. make extraction possible without breaking DanteCode UX

## 10. Non-Functional Requirements

### NFR-1. Honesty

No user-visible success claim may exceed the evidence available in the ledger, receipts, and verification results.

### NFR-2. Durability

Long-running work must survive interruption without losing the ability to resume, replay, or report partial outcomes.

### NFR-3. Safety

Sensitive files, destructive commands, external directories, and skill/plugin loading must remain policy-controlled.

### NFR-4. Performance

The system should provide:

- fast initial repo understanding
- background indexing that does not block the operator
- resume flows that feel immediate on normal projects
- large-session condensing before context collapse

### NFR-5. Platform coverage

The recombined system must continue to support the current Node/TypeScript workspace and target the platform matrix already implied by the repo's CI and release gates.

### NFR-6. Explainability

Mode, approval state, skill use, and verification outcomes must be understandable to a non-technical operator.

### NFR-7. Auditability

All important decisions must be reconstructible from event/state/receipt artifacts after the fact.

### NFR-8. Extensibility

The architecture must support later cloud or commercial layers without requiring a second truth engine.

## 11. UX Requirements

### 11.1 Core operator requirements

The operator must always be able to answer:

- What mode am I in?
- What is Dante allowed to do right now?
- What is running?
- What changed?
- What was verified?
- Can I restore or replay this?
- Which skills or subagents were used?

### 11.2 Required surfaces

CLI and IDE surfaces must expose:

- visible active mode
- approval status
- run status and timeline
- session and worktree identity
- skill loading/use indicators
- context pressure/index status
- replay/restore entry points

### 11.3 Required interaction flows

The product must feel coherent in these flows:

1. Analyze-only request with no mutation.
2. Plan-first request with explicit approval before apply.
3. Long task that decomposes into subtasks.
4. Interrupted run that resumes later.
5. Recovery to prior checkpoint or forked branch.
6. Explicit skill discovery, loading, and execution.
7. Honest failure reporting when verification does not pass.

## 12. Constitutional Rules

### 12.1 Verification rules

1. No feature counts as done if it exists only in docs.
2. No report may overclaim relative to apply and verify receipts.
3. No same-commit readiness lag.
4. No ship-critical TODO, FIXME, stub, or placeholder in active implementation files.
5. No hidden fallback that implies success when work was not actually done.
6. Every long task must be resumable or fail honestly.

### 12.2 Enforcement rules

1. `plan` must be read-only.
2. `review` must not mutate.
3. `apply` requires approval or explicit policy allowance.
4. `autoforge` must remain fenced by policy and verification.
5. Skills must obey the same tool/path/mode policy as normal execution.
6. Subagents may not escape their scope.

## 13. Anti-Stub and Anti-Fake-Complete Doctrine

Touched implementation files must not ship with:

- TODO
- FIXME
- stub
- placeholder
- "phase 2"
- fake success path
- dummy return
- partial preview behavior in a ship-critical path

If a slice cannot be completed:

- mark it `PARTIAL`
- list exact blockers
- do not claim completion

Any ship-critical path with a stub must be:

- finished
- explicitly de-scoped from v1
- or removed from ship claims

## 14. Delivery Plan and Sequencing

### Phase A - Close Dante before extraction

This is the mandatory build order.

#### A1. Task-boundary obedience

Goal:

- no automatic side quests
- no unasked fixes
- run-only means run-only
- diagnose-only means diagnose-only

Likely package focus:

- `packages/cli`
- `packages/core`
- reporting and policy tests

#### A2. Hard mode system

Goal:

- ship enforced `plan`
- ship enforced `review`
- ship enforced `apply`
- ship enforced `autoforge`

Likely package focus:

- `packages/cli`
- `packages/core`
- `packages/vscode`

#### A3. Durable truth substrate

Goal:

- canonical event bus
- durable run store
- replayable state
- apply/verify evidence integration

Likely package focus:

- `packages/core`
- `packages/evidence-chain`
- `packages/danteforge`

#### A4. Worktree-backed recovery

Goal:

- checkpoint
- restore
- timeline
- fork
- resumable parallel worktree runs

Likely package focus:

- `packages/git-engine`
- `packages/core`
- `packages/cli`

#### A5. Skills runtime v2

Goal:

- local verified inventory
- explicit skill invocation
- visible skill use
- multi-skill composition
- skill receipts plus policy

Likely package focus:

- `packages/skills-runtime`
- `packages/skill-adapter`
- `packages/cli`

#### A6. Repo awareness v2

Goal:

- fast repo map
- semantic background index
- `codebase_search`
- context pressure and condensing

Likely package focus:

- `packages/core`
- `packages/git-engine`
- IDE/CLI surfaces

#### A7. Aider-grade repair loop

Goal:

- post-apply lint/test loop
- diff/undo discipline
- failure-guided repair

Likely package focus:

- `packages/cli`
- `packages/core`
- scripts and verification hooks

#### A8. Contract and hygiene sync

Goal:

- same-commit readiness truth
- clean root contract
- no stale `SCORING.md` or `TASKS.md` claims
- no ship-critical partial subsystem in ship scope

Likely package focus:

- `scripts/release/*`
- readiness artifacts
- root planning docs

Only after A1 through A8 are closed should DanteForge extraction begin.

### Phase B - DanteForge extraction

Move to DanteForge:

- evidence chain and sealing
- PDSE and anti-stub governance
- adversarial refinement and lessons
- skill verification and routing
- replay and cryptographic timeline
- external-tool adapters
- commercial trust services

Keep in DanteCode:

- user-facing orchestration
- sessions and run visibility
- search and context UX
- skill UX
- provider/model UX
- report rendering

### Phase C - Post-extraction productization

After the trust boundary is stable:

- bundle DanteForge cleanly into DanteCode
- add external-tool adapters and commercial distribution
- keep the trust engine proprietary if that remains the business strategy

## 15. Acceptance Gates

### 15.1 Per-slice gates

Every implementation slice must pass:

1. Code gate - type/build passes for touched scope.
2. Behavior gate - tests added or updated, including success and failure paths.
3. Truth gate - receipts/reports cannot overclaim; readiness artifacts same-commit fresh if impacted.
4. Anti-stub gate - no stub/TODO/FIXME/placeholder in touched implementation files.
5. Contract gate - root docs updated only if behavior is actually complete.

### 15.2 Program-level gates

Before Dante can claim recombination success:

1. A1 through A8 are complete and verified.
2. `plan` and `review` have zero permitted write paths by architecture, not just prompt.
3. Run reports and readiness artifacts are generated from the same commit that claims readiness.
4. Replay, resume, restore, and fork are proven on real interrupted runs.
5. Skill load/use is explicit and policy-bound.
6. Large-repo search and context management work without silent degradation.
7. Golden flows are demonstrated on real repos, not toy examples.

### 15.3 Golden flows

These must pass on real repositories:

| ID | Flow | Pass condition |
| --- | --- | --- |
| GF-01 | Clean install to first success | Under 10 minutes, init works, first task completes with honest report |
| GF-02 | Real bugfix with verification receipt | Verifier catches issue, patch applies, receipt and seal exist |
| GF-03 | Multi-file refactor with guardrails | Unsafe changes blocked, undo safe and complete |
| GF-04 | Skill import and execution | Skill imported, verified, listed, executed, and reported end-to-end |
| GF-05 | Provider failover | Fallback completes and report records the switch |
| GF-06 | Background or long-horizon completion | Work persists across sessions with integrity maintained |

## 16. Metrics and Instrumentation

| Dimension | Metric | Target |
| --- | --- | --- |
| Task-boundary obedience | Analyze/review runs with zero unintended writes | Greater than 99% |
| Mode correctness | `plan`/`review` writes | 0 |
| Resume reliability | Interrupted runs resumed successfully in validation suite | Greater than or equal to 95% |
| Report honesty | False `COMPLETE` outcomes contradicted by verification | 0 |
| Skill discipline | Explicitly attributed skill-use events for skill-assisted runs | 100% |
| Repo awareness | Benchmark queries with relevant result in top five | Greater than or equal to 85% |
| Repair loop | First-order lint/test failures auto-repaired without overclaim | Greater than or equal to 70% |
| Same-commit truth | Readiness artifacts generated from claimed commit | 100% |
| Ship hygiene | Ship-critical TODO/stub findings in active scope | 0 |
| Operator trust | User can answer mode/status/verification questions from UI alone | Yes on all validation flows |

## 17. Risks and Mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Donor collage syndrome | Product becomes incoherent | Use a single Dante mental model and constitutional center |
| Dual truth drift | DanteCode and DanteForge diverge | Keep truth logic behind DanteForge-owned interfaces |
| Over-automation | Agent acts beyond user intent | Enforce hard modes, policy, and boundary checks |
| Worktree complexity | Recovery becomes fragile instead of safe | Treat worktree lifecycle as product, not implementation detail |
| Indexing cost or fragility | Repo awareness becomes unreliable | Dual system: deterministic repo map first, semantic index second |
| Skill sprawl | Imported skills become untrusted attack surface | Verified local inventory, provenance, explicit policy, receipts |
| Doc outruns code | Product credibility collapses | Same-commit readiness discipline and contract gate |
| Premature extraction | UX and truth boundary both degrade | Do not extract before A1-A8 are closed |

## 18. What 9+ Actually Requires

To genuinely earn a 9+ score, Dante must demonstrate:

- no execution overclaiming on long tasks
- perfect or near-perfect plan/apply separation
- trustworthy replay and restore
- polished worktree/session management
- explicit skill inventory and composition
- strong repo awareness on large repos
- a repair loop that feels automatic but safe
- same-commit proof artifacts
- zero active ship-critical stubs
- docs that do not outrun code
- UX polished enough that users want to remain in DanteCode even when DanteForge is the engine

That is the actual bar.

## 19. Required Slice Report Format

Every execution slice should report in this order:

1. Reality check
2. Gap being closed
3. Files touched
4. Implementation summary
5. Tests added or updated
6. Artifacts, receipts, or readiness updated
7. Anti-stub scan result
8. Acceptance status
9. Remaining blockers

## 20. Final Recommendation

The correct strategy is:

1. Use donor systems to recombine the best execution pipeline now.
2. Finish DanteCode closure using that recombination.
3. Extract DanteForge only after the trust/runtime boundary is stable.
4. Bundle DanteForge back into DanteCode as the truth engine.
5. Commercialize DanteForge-adjacent trust services separately if desired.
6. Keep the trust logic proprietary if that remains core to the moat.

This path is strongest for:

- best product
- best moat
- clean packaging
- future monetization

## Appendix A - Primary Sources Reviewed On 2026-03-27

### Qwen Code

- Approval Mode: https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/
- Task tool and subagent delegation: https://qwenlm.github.io/qwen-code-docs/en/developers/tools/task/
- Skills: https://qwenlm.github.io/qwen-code-docs/zh/users/features/skills/
- Project docs index: https://qwenlm.github.io/qwen-code-docs/en/

### Kilo Code

- Custom Modes: https://kilo.ai/docs/features/custom-modes
- Checkpoints: https://kilo.ai/docs/features/checkpoints
- Codebase Indexing: https://kilo.ai/docs/features/codebase-indexing
- Orchestrator Mode: https://kilo.ai/docs/basic-usage/orchestrator-mode
- Agent Manager: https://kilo.ai/docs/advanced-usage/agent-manager
- Context Condensing: https://kilo.ai/docs/customize/context/context-condensing

### OpenCode

- Intro and Plan mode usage: https://opencode.ai/docs/
- Agents: https://opencode.ai/docs/agents/
- Permissions: https://opencode.ai/docs/permissions
- Config layering: https://opencode.ai/docs/config/

### OpenHands

- Conversation architecture: https://docs.openhands.dev/sdk/arch/conversation
- Events architecture: https://docs.openhands.dev/sdk/arch/events
- Runtime architecture: https://docs.openhands.dev/openhands/usage/architecture/runtime
- Docker sandbox: https://docs.openhands.dev/usage/runtimes/docker

### Aider

- Chat modes: https://aider.chat/docs/usage/modes.html
- Repository map: https://aider.chat/docs/repomap.html
- Git integration: https://aider.chat/docs/git.html
- Linting and testing: https://aider.chat/docs/usage/lint-test.html

### Skills ecosystem

- Agent Skills overview: https://agentskills.io/home
- Agent Skills specification: https://agentskills.io/specification
- Claude Code settings, subagents, and plugin hierarchy: https://code.claude.com/docs/en/settings

## Appendix B - Resolved Product Decisions

1. DanteForge remains the sole truth authority.
2. `plan` and `review` are enforced read-only states, not just prompt conventions.
3. Long tasks must decompose into bounded actors with scoped tools and receipts.
4. Skills are local-first, explicit, and policy-bound.
5. Semantic indexing is additive; deterministic repo mapping remains mandatory.
6. Worktree-backed recovery is a product feature, not a hidden implementation detail.
7. No DanteForge extraction happens before Phase A closure.
