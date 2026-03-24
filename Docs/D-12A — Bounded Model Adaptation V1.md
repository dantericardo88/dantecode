D-12A — Bounded Model Adaptation V1
V+E Masterplan
0. Executive verdict

Approved as a separate PRD.

Do not bury this inside the broader vision-lock PRD. The model-quirk loop is important enough to deserve its own bounded execution packet. Your pasted Grok text already points to the right shape: observe → detect quirks → store draft override → test → promote only on proven improvement, with caps and human veto gates.

This V+E packet turns that into an implementation plan that Claude Code can execute without drifting into unsafe “self-rewriting AI” theater.

1. Purpose

Build DanteCode’s first safe, reversible, model-adaptation loop so the system can learn provider/model quirks without forcing the user to know or care about them.

Product truth

DanteCode should absorb model quirks so the user never has to think about:

Grok needing one structure
Claude preferring another
tool-call formatting differences
markdown / KaTeX quirks
early stopping
skipped synthesis
PRD-order violations
Core principle

V1 adapts prompts, templates, and tool-formatting behavior only.
V1 does not rewrite code, policies, engines, or product logic.

2. Why this is separate from D-12

D-12 is about:

vision lock
Postal Service automation
completion verifier
progressive disclosure

D-12A is different. It is a learning system with:

telemetry
quirk classification
candidate override generation
experiment budget
promotion logic
rollback
audit artifacts

That must be isolated or it will become under-specified and dangerous.

3. North-star outcome

After D-12A ships, a non-technical user should be able to run the same DanteCode command on different models and get roughly the same quality of outcome, because DanteCode has learned how to translate intent into the best structure for each model.

The user should never need to say:

“Use Grok wording for this”
“Claude likes this PRD format”
“This model breaks tool calls unless I wrap it differently”

DanteCode should handle that.

4. Scope
In scope
Observe model exchanges
Detect recurring quirk signatures
Store versioned candidate overrides
Run bounded experiments
Measure effect on PDSE, completion status, and task success
Promote or reject overrides
Roll back bad overrides
Emit readable adaptation reports
Out of scope
No autonomous code rewriting
No self-modifying repo logic
No global prompt mutation without promotion gates
No hidden permanent override changes
No unlimited experimentation
No adaptation based on vague “felt better” signals
5. Repo-correct file plan

Use repo-correct paths. Do not invent new packages.

Create
packages/core/src/model-adaptation.ts
packages/core/src/model-adaptation-store.ts
packages/core/src/model-adaptation.test.ts
packages/core/src/model-adaptation-store.test.ts
packages/core/src/model-adaptation-types.ts
Enhance
packages/core/src/completion-verifier.ts
packages/cli/src/session-report.ts
packages/cli/src/agent-loop.ts
Hook only. Keep thin.
packages/cli/src/slash-commands.ts
Only if needed for report surfacing or explicit admin/debug access.
Reports / artifacts
.dantecode/model-adaptation/overrides/<provider>/<model>/<quirk>.json
.dantecode/model-adaptation/experiments/<timestamp>-<provider>-<model>-<quirk>.json
.dantecode/reports/<timestamp>-adaptation.md
6. Deliverables
D-12A.1 — Quirk observation layer

Capture structured observations from each model exchange.

Each observation must include:

provider
model
command/workflow type
prompt template version
tool schema version
output shape
verification result
completion verifier result
failure mode tags
timestamp

This is raw evidence only. No learning yet.

D-12A.2 — Quirk taxonomy

Implement a typed quirk classifier.

Initial V1 quirk classes:

tool_call_format_error
schema_argument_mismatch
markdown_wrapper_issue
katex_format_requirement
stops_before_completion
skips_synthesis
ignores_prd_section_order
overly_verbose_preface
regeneration_trigger_pattern
provider_specific_dispatch_shape

Quirks must be evidence-based. No fuzzy personality profiling.

D-12A.3 — Versioned draft overrides

When a recurring quirk is detected, generate a draft override.

A draft override may change only:

prompt framing
instruction ordering
tool-call formatting hints
synthesis requirement text
report-generation phrasing
PRD consumption instructions

Each draft override must be stored as a versioned artifact.

Example path:

.dantecode/model-adaptation/overrides/grok/grok-3/katex_format_requirement.v1.draft.json

D-12A.4 — Bounded experiment harness

Each draft override must be tested before promotion.

Each experiment must run on:

one synthetic mini-task
one replayed real exchange
one held-out control task

Metrics:

PDSE delta
completion verifier result
task success rate
regression count
crash count
tool-call validity rate

No more than 5 experiments per quirk per day. Your Grok note explicitly called for caps like this, and I agree.

D-12A.5 — Promotion gate

Promote only if all pass:

PDSE improves by at least 5%
completion verifier does not regress
held-out control task does not regress
smoke checks pass
no new critical failure class appears

Additional safety rule:

the first 3 promotions per quirk family require explicit human veto/approval before becoming default, matching the safety gate your pasted Grok text recommended.
D-12A.6 — Rollback system

Every promotion must have a rollback artifact.

Rollback triggers:

PDSE regression
completion-verifier regression
control task regression
repeated runtime failures
user-forced disable
experiment corruption / missing evidence

Rollback must restore the last known-good override.

D-12A.7 — Adaptation report

Every adaptation cycle must emit a readable report.

Required sections:

## Quirk detected
## Evidence
## Candidate override
## Experiments run
## Promotion decision
## Rollback status
## What changed in plain English

This report should be readable by you and by another AI in a different workspace without extra translation.

7. Data contracts
QuirkObservation
type QuirkObservation = {
  id: string;
  provider: string;
  model: string;
  workflow: "magic" | "party" | "forge" | "repl" | "other";
  commandName?: string;
  promptTemplateVersion: string;
  toolSchemaVersion?: string;
  failureTags: string[];
  outputCharacteristics: string[];
  pdseScore?: number;
  completionStatus?: "complete" | "partial" | "failed";
  evidenceRefs: string[];
  createdAt: string;
};
CandidateOverride
type CandidateOverride = {
  id: string;
  provider: string;
  model: string;
  quirkKey: string;
  status: "draft" | "testing" | "promoted" | "rejected" | "rolled_back";
  scope: {
    workflow?: string;
    commandName?: string;
  };
  patch: {
    promptPreamble?: string;
    orderingHints?: string[];
    toolFormattingHints?: string[];
    synthesisRequirements?: string[];
  };
  basedOnObservationIds: string[];
  version: number;
  createdAt: string;
  promotedAt?: string;
  rejectedAt?: string;
  rollbackOfVersion?: number;
};
ExperimentResult
type ExperimentResult = {
  id: string;
  overrideId: string;
  provider: string;
  model: string;
  quirkKey: string;
  baseline: {
    pdseScore?: number;
    completionStatus?: string;
    successRate?: number;
  };
  candidate: {
    pdseScore?: number;
    completionStatus?: string;
    successRate?: number;
  };
  controlRegression: boolean;
  smokePassed: boolean;
  decision: "promote" | "reject" | "needs_human_review";
  createdAt: string;
};
8. Promotion algorithm

Strict order only:

Observe exchange
Detect recurring quirk
Classify quirk
Create draft override
Run bounded experiments
Compare baseline vs candidate
Gate on PDSE + completion verifier + control set
Require human veto for first 3 promotions per quirk family
Promote or reject
Emit report
Monitor for rollback triggers

No shortcuts.

9. Initial quirk signatures for V1

Start with these 10 only:

Grok emits output that needs stricter KaTeX/markdown shaping
Provider skips required “what was built / what needs attention” synthesis
Model stops after tool-call without narrative completion
Tool argument keys drift from schema names
PRD sections consumed out of order
Model gives long preamble before acting
Model regenerates poorly after certain failure types
Report sections omitted unless explicitly required
MCP dispatch formatting varies by provider
Plain-English summary quality collapses unless ordered last

These are enough to prove the loop works without turning the system into a science project.

10. Acceptance criteria

All must pass.

Core behavior
At least 3 replayed known quirks are detected correctly.
Each detected quirk creates a versioned draft override.
Each draft override can be tested without affecting global defaults.
Promotion happens only when all gates pass.
Rejection happens automatically on failed gates.
Rollback restores last known-good version.
Safety
No override is promoted silently.
No code files are rewritten by the adaptation loop.
No more than 5 experiments per quirk per day.
Human veto is required for the first 3 promotions per quirk family.
Reporting
Adaptation reports are written automatically.
Reports contain plain-English explanation of what changed.
Reports contain evidence of baseline vs candidate evaluation.
Quality
full test suite passes
typecheck passes
lint passes
build passes
external smoke test passes
11. Test charter
Unit tests
quirk classification
draft override generation
promotion gate logic
rollback logic
experiment cap enforcement
veto gate enforcement
Integration tests
observe → classify → draft
draft → test → reject
draft → test → promote
promoted override used on next session
rollback after regression
Replay tests

Use 3 known replay fixtures from real or simulated exchanges:

formatting quirk
early-stop quirk
schema mismatch quirk
Smoke tests
clean install
run command with adaptation enabled
adaptation artifact emitted
no global behavior corruption
12. Runbook
For normal operation
system observes passively
no user action required
draft overrides created quietly
promotions surfaced in report
For manual review
inspect .dantecode/model-adaptation/overrides/...
inspect .dantecode/model-adaptation/experiments/...
inspect .dantecode/reports/...-adaptation.md
For emergency disable

Provide one kill switch:

DANTE_DISABLE_MODEL_ADAPTATION=1

And one mode switch:

DANTE_MODEL_ADAPTATION_MODE=observe-only|staged|active

Default for V1 should be:

staged

Not active.

13. Risks
Biggest risk

Prompt drift disguised as learning.

Secondary risks
overfitting to tiny task sets
noisy quirk classification
too many quirk classes too early
hidden regressions on control tasks
adaptation system becoming more complex than the product benefit
Mitigation
narrow quirk taxonomy
capped experiments
held-out control task
human veto early
hard rollback
prompt-only adaptation in V1
14. Implementation order
Phase 1

Create types, store, observation logging.

Phase 2

Implement quirk classifier and draft override creation.

Phase 3

Implement experiment harness and promotion logic.

Phase 4

Add rollback and report generation.

Phase 5

Add tests, replay fixtures, smoke coverage.

Phase 6

Run one small DirtyDLite subset with adaptation in staged mode.

15. KiloCode rules
one logical change per commit
no new packages
no file over 800 LOC
keep hooks thin in agent-loop.ts
favor boring, testable machinery
no silent global mutation
16. Copy-paste handoff prompt for Claude Code

Implement D-12A — Bounded Model Adaptation V1 exactly as specified below.

Critical constraints:

This is a separate PRD from D-12.
V1 is prompt/template/tool-format adaptation only.
No autonomous code rewriting.
No new packages.
Use repo-correct paths under packages/core/src/ and existing CLI/report hooks.
Keep agent-loop.ts thin.
All overrides must be versioned, reversible, and gated.
Default adaptation mode must be staged, not active.
First 3 promotions per quirk family require human veto.
Max 5 experiments per quirk per day.
No file over 800 LOC.
One logical commit per step.

Primary deliverables:

quirk observation layer
quirk taxonomy + classifier
versioned draft overrides
bounded experiment harness
promotion gate
rollback system
adaptation report
full tests + smoke coverage

Required evidence at the end:

list of touched files
sample observation artifact
sample draft override artifact
sample experiment result
sample adaptation report
test results
smoke results