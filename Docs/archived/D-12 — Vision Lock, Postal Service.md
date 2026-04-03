D-12 — Vision Lock, Postal Service Automation, and Model Adaptation
V+E Masterplan
Executive verdict

Approved with corrections.

This is the right next PRD, but only as a lock-and-instrument pass. It should do five things:

Replace the old developer-centered vision with the true 95% north star.
Automate the Postal Service workflow inside the product.
Add model-adaptation as a versioned learning system, not an autonomous self-rewriter.
Upgrade run reports from “activity logs” to “trust artifacts.”
Hard-lock progressive disclosure so DanteCode stays usable for non-technical builders.

This PRD must be implemented against the repo that actually exists today, not imagined package paths.

1) Purpose

DanteCode’s north star is not “best AI coding tool for developers.”

DanteCode’s north star is:

Enable non-technical people to build trustworthy software by directing AI, without needing to understand code, terminals, or model quirks.

Code generation is the commodity.
Verification, coordination, and translation are the product.

2) Product thesis to lock

Other tools assume the user can judge the output.

DanteCode assumes the user often cannot judge the output, so it must provide:

plain-English verification
plain-English run accounting
model-agnostic execution
cross-workspace coordination artifacts
progressive disclosure
learning from model quirks without making the user manage them
3) Scope
In scope
Replace or expand the existing root VISION.md with the 95% positioning.
Create an operational Postal Service document inside Docs/.
Expand existing run-report behavior into a required artifact for /magic, /party, /forge, and normal REPL mutation sessions.
Add model-adaptation V1 in the existing architecture.
Lock the default help/on-ramp experience to the simplified surface.
Add tests and smoke coverage.
Out of scope
No new giant package just to sound important.
No fully autonomous prompt self-modification in production.
No new advanced command sprawl.
No new model-specific UX surfaces exposed to the user.
No “AI rewrites itself forever” architecture theater.
4) Repo-correct file plan
Must update
VISION.md
Docs/POSTAL-SERVICE-WORKFLOW.md
packages/cli/src/session-report.ts
packages/cli/src/slash-commands.ts
packages/cli/src/command-registry.ts
packages/cli/src/agent-loop.ts
Only for hook wiring. Do not let this become a god file again.
Must create
packages/core/src/model-adaptation.ts
packages/core/src/model-adaptation.test.ts
packages/core/src/model-adaptation-store.ts
packages/core/src/model-adaptation-store.test.ts
packages/core/src/completion-verifier.ts
packages/core/src/completion-verifier.test.ts
Must enhance
the existing core run-report module that already backs RunReportAccumulator, serializeRunReportToMarkdown, and writeRunReport
Do not create a second report system. packages/cli/src/session-report.ts already consumes those exports.
5) Deliverables
D-12.1 — Vision lock

Replace the current portability-first vision with a north-star document that explicitly states:

the user is often non-technical
DanteCode exists to close the trust gap
verification is the product moat
model portability matters because the user should never be trapped by provider lock-in
the product is designed to help the 95%, not merely accelerate the 5%
D-12.2 — Postal Service automation

Automate the process already being done manually between workspaces.

After every /magic, /party, /forge, and any REPL session that modifies files, DanteCode must write a report to:

.dantecode/reports/<timestamp>-<command>.md

Each report must include:

command name
project path
provider + model
start/end timestamps
files created
files modified
files deleted
tests run
verification outcomes
cost estimate
per-PRD status: complete, partial, or failed
plain-English “What was built”
plain-English “What needs attention”
reproduction command
crash-safe partial report if execution ends early
D-12.3 — Completion verifier

Add a completion verifier that evaluates outcomes against intent, not just file quality.

For each PRD or workflow step, it must determine:

were expected files created
were expected files modified
did required functions/classes/routes exist
did tests exist
did tests pass
is the work complete, partial, or failed

This is not allowed to hallucinate.
When confidence is low, it must say so.

D-12.4 — Model adaptation V1

Implement a model-quirk adaptation loop with bounded authority.

Flow:

Observe exchanges.
Detect recurring quirks.
Classify quirk type.
Generate a candidate override.
Store override as versioned draft.
Apply draft only in-session or in test mode.
Promote only if tests and smoke checks pass.

Examples of quirk classes:

tool-call JSON formatting issues
KaTeX / markdown formatting preference
tendency to summarize before finishing
tendency to ignore workflow stages
tendency to omit file edits after planning
tendency to stop after tool execution without synthesis
provider-specific verbosity or tone problems

This must support model/provider keys like:

provider
model id
workflow type
command type
quirk signature
override version
evidence count
D-12.5 — Progressive disclosure hard lock

Default /help must remain capped at the simplified surface.

Rules:

default help shows no more than 13 commands
advanced commands remain hidden unless:
user asks for /help --all, or
user has 3 successful sessions, or
explicit advanced mode is enabled
contextual suggestions may appear, but only when directly relevant

No regression allowed here.

6) Acceptance criteria

All must pass.

Vision
VISION.md explicitly states the 95% non-technical mission.
It clearly says verification is the moat and code generation is commodity.
Postal Service
Docs/POSTAL-SERVICE-WORKFLOW.md exists.
/magic, /party, /forge, and mutation REPL sessions all write reports automatically.
Reports are written even on early failure via crash-safe finalization.
Run report quality

Every generated report must contain these headings exactly:

## What was built
## What needs attention
## Completion status
## Verification summary
## Files changed
## Reproduction
Completion verifier
For a successful PRD run, report marks complete.
For missing artifacts, report marks partial or failed.
No PRD may be marked complete if expected outputs are absent.
Model adaptation
V1 detects quirks from real exchanges and stores versioned candidate overrides.
Candidate overrides are testable and hot-loadable for the current session.
Promotion to persistent default requires test pass plus smoke pass.
No silent production override promotion.
Progressive disclosure
default /help shows ≤13 commands
/help --all still exposes full surface
advanced unlock works only after 3 successful sessions or explicit user action
Quality gates
full test suite passes
typecheck passes
lint passes
build passes
external smoke test passes
at least one deterministic integration test covers:
/party
report output
completion verifier
model adaptation observation + candidate override creation
7) Execution order
Phase A — Vision and workflow docs
Rewrite VISION.md
Add Docs/POSTAL-SERVICE-WORKFLOW.md
Phase B — Trust artifact upgrade
Enhance existing run-report system
Add completion verifier
Wire into command handlers and session lifecycle
Phase C — Model adaptation V1
Add observation store
Add quirk detector
Add candidate override generation
Add safe promotion gate
Phase D — UX lock
Harden progressive disclosure logic
Add unlock tracking for 3 successful sessions
Phase E — Validation
Run full test suite
Run smoke suite
Run one controlled PRD folder test
Update scoring only after evidence exists
8) Required test charter
Unit
quirk detection for known provider/model signatures
candidate override generation
completion verifier classification
report serialization sections
Integration
/magic writes report on success
/party writes report on partial failure
crash still writes partial report
advanced help remains hidden before 3 successful sessions
advanced help unlocks after threshold
Smoke
clean install
init
one real command
report file emitted
report readable by another AI without extra translation
DirtyDLite pilot

After merge, run DanteCode against a small DirtyDLite PRD subset first, not all 25 at once.
That pilot becomes the first real Score B evidence.

9) Scoring impact

This PRD should move:

Score B by making verification artifacts honest and portable
Score C by making the user experience more legible
Score D indirectly by making the tool demoable and explainable

It should not be used to inflate Score A with more architecture theater.

10) Hard rules for Claude Code
Do not invent new packages unless current package boundaries truly block progress.
Do not re-bloat agent-loop.ts.
No new file over 800 LOC.
One logical change per commit.
Do not duplicate report systems.
Do not ship autonomous prompt mutation without promotion gates.
Favor boring, testable machinery over cleverness.
Copy-paste handoff prompt for Claude Code

Implement D-12 — Vision Lock, Postal Service Automation, and Model Adaptation exactly as specified below.

Critical constraints:

Use the repo as it exists now.
Do not create packages/evolve-brain or packages/agent-loop.
Update the real root VISION.md.
Add Docs/POSTAL-SERVICE-WORKFLOW.md.
Keep packages/cli/src/agent-loop.ts thin; only wire hooks there.
Extend the existing core run-report implementation already used by packages/cli/src/session-report.ts.
Add model adaptation under packages/core/src/.
V1 model adaptation is observe → classify → draft override → test → promote.
No silent production self-rewriting.
Default /help must remain ≤13 commands.
All new files must stay under 800 LOC.
One logical commit per step.
Full tests, typecheck, lint, build, and external smoke must pass.

Primary deliverables:

Vision lock in VISION.md
Automated Postal Service workflow
Completion verifier
Model adaptation V1 with staged overrides
Progressive disclosure hard lock

Required evidence at the end:

list of touched files
test results
smoke results
one sample generated run report
one sample model adaptation artifact
updated scoring deltas only where directly evidenced