DanteCode — V+E Masterplan
0. Executive verdict

DanteCode now has a real product spine. The live feat/all-nines branch presents a portable coding agent with multi-provider routing, skill import, DanteForge verification, MCP, backgro preview VS Code surface. The repo scope is no longer speculative. ill not ready for external launch today because the repo’s own planning docs say the first GitHub push and CI are green, but the latest feat/all-nines workflow run on March 24, 2026 is failing. The visible failures include evidence-chain property tests, @dantecode/core lint/typecheck errors tied to estimateMessageTokens, and a Windows smoke/build failure in @dantecode/cli. That is the highest-priority blocker because it breaks the truth spine. ect launch posture is narrower than “replace Claude Code everywhere.” The repo’s own release model already points to the right scope: CLI = GA ship target, VS Code = preview ship target, Desktop = experimental and not launch-critical. That should remain the hard boundary until the golden flows are proven on real projects. 1. Product truth

The strongest thing about DanteCode is not raw code generation. It is the trust layer. Your current vision is clear: DanteCode is aimed at users who cannot audit code themselves, and DanteForge is supposed to close that trust gap with anti-stub enforcement, PDSE scoring, constitution checks, GStack validation, and plain-language run reports. That is a real wedge and a better wedge than trying to out-Cursor Cursor on polish alone. repo and spec support that positioning. The README describes verification, provider routing, skill import, and git-aware editing; the spec and architecture describe core packages for routing, MCP, git-engine, sandbox, skill adaptation, DanteForge, session persistence, background agents, and search/indexing. lem is not absence of features. The problem is evidence discipline. SCORING.md, PLAN.md, and TASKS.md describe locally green or externally green states, but the current public Actions evidence contradicts that. Until repo truth, CI truth, and release truth all agree, DanteCode cannot claim launch readiness with credibility. 2. Strategic launch thesis

Do not launch DanteCode as “the tool that beats Claude Code.” Launch it as:

The model-agnostic coding agent that shows its work, verifies what it changed, and lets non-technical users trust the result.

That is aligned with the current vision doc and much harder for closed tools to own cleanly. Claude Code is already available across terminal, IDE, desktop, and browser; Codex is explicitly moving toward parallel agents and worktree-based orchestration; Cursor is pushing event-driven always-on automations; OpenHands is pushing secure, scalable cloud coding agents; Continue is staking out PR checks as a repo-native enforcement layer. You should not try to win all of those fronts at once. ect initial battle is narrower:

Be the most trustworthy agent for real repo work.
Be genuinely model-agnostic.
Be portable across providers and skills.
Be good enough on your own projects that you can use it daily.
Export DanteForge outward later as a verification product. 3. External V+E scoring matrix

Your internal scoring file reports Engineering 9.3, Verification 7.6, UX 8.0, Distribution 3.6, Overall 7.6. That is useful as an internal aspiration, but it is not an external launch score because the latest live CI is red. nal V+E score for the branch right now is:

Engineering truth: 6.8/10
Strong architecture and breadth, but current public CI failure invalidates any “green” claim. cation moat:** 8.6/10
Still the strongest differentiator. The vision and spec are coherent, and the architecture keeps DanteForge central. driver usability:** 6.7/10
CLI scope is promising, but “good enough to replace Claude Code” has not yet been proven by real-project golden flows. The release docs themselves still require clean-clone quickstart proof and live provider smoke proof. perience:** 6.1/10
The VS Code extension is real and should remain preview, not GA. That is the right release ring today. bution / install / credibility:** 4.5/10
The repo still depends on live provider validation, registry secrets, and clean public CI proof. readiness overall:** 6.6/10 external

Ship threshold for your own use on real projects: 8.3/10
Public OSS launch threshold: 8.7/10

4. Non-negotiable release scope

The release scope is now frozen unless these gates are met.

GA: @dantecode/cli and stable runtime packages only.
Preview: VS Code extension.
Not launch-critical: Desktop app. ns the launch promise is:

installable from npm,
works on a clean clone,
can complete real repo tasks,
produces verification receipts and plain-language reports,
can switch providers without breaking user flow,
passes CI and live-provider smoke,
proves value on your own projects before broad marketing. 5. Workstream map
WS-0 — Truth Spine Repair

Purpose
Make the repo incapable of lying about readiness.

Current truth
TASKS.md says CI green and Phase 4 push verified; PLAN.md says GitHub proof remains external work; latest actual GitHub Actions run on feat/all-nines is failing. ed outputs**

One canonical readiness artifact generated from CI.
SCORING.md, PLAN.md, TASKS.md, and release-matrix.json must consume generated truth, not hand-written truth.
A failing CI run must automatically invalidate ship status.

Enforcement

No manual “green” language anywhere unless CI artifact says green.
npm run release:matrix must emit machine-readable status consumed by docs.
A root “ship-ready” command must fail closed.

Acceptance

Latest GitHub Actions run is green.
Generated readiness artifact matches docs exactly.
No file claims “CI green” when public CI is red.

Evidence

CI artifact with commit SHA.
Generated release matrix.
Updated docs snapshot tied to same SHA.
WS-1 — CI Unblock and Cross-Platform Integrity

Purpose
Get back to a true green baseline.

Current blockers

packages/evidence-chain property tests failing on stableJSON.
@dantecode/core lint/typecheck failure for unused estimateMessageTokens.
windows-smoke failure building @dantecode/cli. ed outputs**
Fix deterministic serialization bug in evidence-chain property tests.
Remove or wire estimateMessageTokens.
Repair Windows build/smoke path.
Re-run full matrix until green.

Acceptance

format, typecheck, lint, test, windows-smoke, anti-stub-self-check all green on GitHub Actions for feat/all-nines.
Property-test failure may reveal a real invariant bug, not just a flaky test. Treat this as product logic, not test noise.
WS-2 — Verification Spine Hardening

Purpose
Turn DanteForge from “great concept plus runtime hooks” into “provable reason to switch.”

Current strength
The vision/spec make verification central: anti-stub, PDSE, constitution, GStack, run reports, lessons, trust receipts. ust be added**

Deterministic receipt schema and retention rules.
Explicit pass/fail contract for each verifier.
Human-readable explanation for every block.
“Why this passed” and “why this failed” sections in run reports.
Reproducibility test: same inputs → same verification result except for timestamp/nonce fields.

Acceptance

For 20 repeated sample tasks, receipts are structurally valid and tamper-evident.
Users can understand the outcome without reading code.
Verification blocks bad output before commit/write completion in tested flows.

Evidence

Receipt schema docs.
Before/after examples.
Golden verification fixtures.
WS-3 — Live Provider Truth

Purpose
Prove DanteCode works with real models, not just local tests.

Current repo requirement
The release runbook explicitly requires npm run smoke:provider -- --require-provider with real credentials or manual Ollama targeting before release. ed outputs**

Provider smoke matrix for Grok, Anthropic, OpenAI, and Ollama at minimum.
Fallback-chain proof.
Failure-mode proof when provider is unavailable.

Acceptance

One successful live-provider smoke per Tier-1 supported provider you intend to market on day one.
One fallback-chain run where primary fails and secondary completes.
One Ollama local run documented end to end.

Evidence

Command transcript.
Provider result summary by commit SHA.
Cost/time metrics.
WS-4 — CLI as the real product

Purpose
Make the CLI good enough that you use it on your own repos instead of defaulting to Claude Code.

Current truth
The CLI is already the GA target in repo docs and is the main public install path. ed outputs**

Frictionless init.
Predictable /help, /status, /model, /diff, /undo, /compact, /history.
Strong interrupt/resume behavior.
Clear cost and provider visibility.
Clean failure messaging with next steps.

Acceptance
A new user can:

install,
initialize,
run a prompt on a real repo,
inspect diff,
accept or undo,
read a plain-language verification report,
all without confusion in under 10 minutes. ce**
Clean-clone stopwatch run.
Five-task usability log.
README quickstart validated exactly as written.
WS-5 — VS Code preview polish

Purpose
Keep VS Code as preview, but make it a good preview.

Current truth
VS Code is a ship target in preview; Desktop is not. ed outputs**

Stable chat + diff acceptance.
Checkpoint UX that matches the trust story.
Better status surfacing for PDSE and verification.
Fewer dead or placeholder interactions.
File-level approval controls.

Acceptance

Preview extension can complete the same golden flows as CLI except where intentionally scoped out.
No obvious stub/placeholder commands in public preview flows.
All extension state persists correctly across restart.

Evidence

Preview smoke checklist.
Screens with diff review and report view.
Restart persistence test.
WS-6 — Golden Flows

Purpose
Replace feature bragging with proof.

These flows are the true V+E gates.

GF-01: Clean install → first successful code task
Install from npm, init config, connect provider, run a simple repo task, receive report. Must pass on clean machine. Real bugfix on your own repo**
Open an actual issue in one of your projects, reproduce, patch, verify, review diff, commit. This is the first “can Ricky actually use this?” gate.

GF-03: PRD/spec → code + verification report
Run /party or equivalent multi-agent pipeline from docs/spec and require explicit report output for what completed and what did not. This aligns with your non-technical-user wedge. Provider failover**
Primary provider fails, secondary provider finishes, report states what happened.

GF-05: Skill import + execution
Import Claude/Continue/OpenCode-style skill, run it, verify output. Skill import is one of the repo’s differentiators and must be demonstrated, not merely listed. Background task completion**
Enqueue work, persist state, review results later, maintain report integrity.

Launch rule
No public launch until GF-01 through GF-05 are green. No “9s across the board” language until GF-06 is also stable.

WS-7 — OSS harvest plan

Yes, there is still more to learn from OSS and commercial leaders. The right move is not broad imitation. It is targeted harvesting.

From Aider
Steal terminal sharpness, git-native flow, command discoverability, lint/test auto-fix culture, and broad provider pragmatism. Aider’s docs still position it as terminal-first, git-native pair programming with broad provider support and in-chat command depth. wen Code**
Steal SubAgents, Skills ergonomics, Plan Mode mentality, and the “terminal-first, IDE-friendly” bridge. Qwen Code is explicitly pushing Subagents with separate context, controlled tools, and autonomous execution, plus a feature-rich workflow around Skills and Plan Mode. ontinue**
Steal source-controlled AI checks and PR-native governance. Continue is now clearly centered on repo-defined checks that run as GitHub status checks and can suggest diffs directly in PR flow. That is highly compatible with DanteForge. penHands**
Steal secure sandbox/runtime discipline, API/SDK orchestration, and delegated task entrypoints from GitHub, GitLab, Slack, and API. OpenHands is explicitly positioning around secure sandboxing, model-agnosticism, scale, and delegation from external systems. ursor**
Steal automations and always-on event-driven agents. Cursor is now explicitly running scheduled or event-triggered agents via Slack, GitHub, Linear, PagerDuty, webhooks, and cloud sandboxes with memory. This is category-defining and should influence your event gateway roadmap. odex**
Steal multi-agent orchestration, worktree-native isolation, and agent thread review. OpenAI is explicitly framing Codex around multiple agents in parallel, separate threads by project, and isolated worktree-based collaboration. laude Code**
Steal multi-surface continuity and smoother onboarding. Claude Code now presents itself across terminal, IDE, desktop, and browser with a simpler installation story than most open tools. t rule**
Do not expand surface area unless it reinforces the wedge:

trust,
portability,
governed autonomy,
non-technical usability.
WS-8 — Event gateway and automation

Purpose
Close one of the biggest current competitive gaps without trying to become Cursor overnight.

Why this matters
Cursor is already pushing always-on automations tied to events and schedules, and OpenHands is already integrating with external systems and scalable delegation paths. DanteCode needs a minimum viable automation story to avoid being trapped as “just a local REPL.” m viable build**

GitHub issue/comment trigger.
Webhook listener.
Background run queue.
Verification receipt attached back to artifact/PR.
Human approval required before write/merge beyond scoped safe ops.

Acceptance

GitHub issue can trigger a background run.
Run produces receipt and human-readable summary.
Result returns as comment or artifact.
No silent autonomous write to protected branches.
WS-9 — Memory and self-improver

Purpose
Make DanteCode improve from use without becoming unsafe or hallucination-amplifying.

Current repo basis
The spec already mentions session persistence, lessons DB, and background/session infrastructure. ed outputs**

Separate “lessons from failure” from “patterns from success.”
Promotion gate: no memory promotion without verification pass.
Negative lesson suppression if contradicted repeatedly.
Project-local memory with explicit scope.
Import/export and inspectability.

Acceptance

Same class of issue fixed faster on second encounter.
No unsafe lesson is silently promoted.
Users can inspect and delete learned items.
6. Competitive position after this plan

If you execute this plan, DanteCode does not need to beat Claude Code, Codex, Cursor, Aider, Qwen Code, Continue, and OpenHands on every front.

It needs to become:

more trustworthy than Claude Code and Cursor,
more portable than Claude Code,
more verification-native than Aider and Qwen Code,
more non-technical-user legible than OpenHands,
more runtime-governed than Continue,
and good enough on your own repos that you stop needing Claude Code as the default. a winnable position.
7. Launch gates

DanteCode is ready for private daily use when all of the following are true:

latest Actions run on feat/all-nines is green,
release:doctor shows no blockers,
release:check is green,
live provider smoke is green,
README quickstart works from clean clone,
GF-01 through GF-04 are green on one of your real repos. e is ready for public OSS v1 launch when all of the following are true:
private daily-use gates are already green,
NPM_TOKEN and VSCE_PAT are configured,
publish dry-run succeeds,
GF-05 skill import proof is green,
CLI is stable enough to be the headline product,
VS Code is clearly labeled preview everywhere,
Desktop is not sold as part of launch. 8. No-ship list

Do not launch if any of these remain true:

CI red on public branch.
Repo docs disagree on readiness.
Provider smoke still unproven.
README quickstart unverified from clean clone.
Verification receipts are not deterministic or understandable.
Golden flows not completed on your own real repos.
Desktop implied as customer-ready.
“All-nines” language used before cross-platform and live-provider proofs exist. 9. Final recommendation

You are no longer in invention mode. You are in reality-hardening mode.

The sequence is:

repair truth spine,
green CI,
prove live providers,
prove golden flows on your own repos,
sharpen CLI daily-driver quality,
keep VS Code preview,
postpone Desktop ambition,
harvest selectively from Aider, Qwen Code, Continue, OpenHands, Cursor, Codex, and Claude Code without losing the trust wedge. the shortest path to the outcome you actually care about: using DanteCode on your own projects so Claude Code becomes optional instead of necessary.

I can turn this into a Codex-ready V+E execution packet next, with exact workstreams, acceptance tests, artifact names, and gate order.

Please turn it into the execution packet

I’m locking this into a build-order packet now: exact phases, gates, artifacts, and acceptance criteria, tied back to the live branch state instead of aspirational docs.

Thought for 1m 14s
DanteCode — Codex-ready V+E Execution Packet
0. Mission

Take feat/all-nines from “strong architecture with inconsistent truth” to private daily-driver ready, then to public OSS v1 ready, without expanding scope. The live docs already define the right release posture: CLI is the GA ship surface, VS Code is preview, Desktop is experimental/non-ship. The repo also already defines the trust wedge clearly: verification first, portability second, generation third.

1. Frozen facts

These are the facts this packet is allowed to assume:

DanteCode is positioned as a coding agent that writes, edits, verifies code across providers, supports provider switching/fallbacks, and imports skills from Claude Code, Continue, and OpenCode.
The product thesis is aimed at non-technical users who need verification receipts, PDSE, anti-stub, constitution checks, GStack, and plain-language reports to trust output.
The current release model says CLI = GA, VS Code = preview, Desktop = experimental; Tier-1 providers include Grok, Anthropic, OpenAI, Google, and Ollama.
The release runbook requires release:doctor, release:check, a live provider smoke, a green first GitHub Actions run, configured publish secrets, and a README quickstart that works from a clean clone.
The current public CI evidence contradicts the green-ship story: the latest visible run on feat/all-nines shows an evidence-chain property-test failure, @dantecode/core lint/typecheck issues around estimateMessageTokens, and Windows smoke failure with Git exit 128.
2. Execution objective

This packet is not trying to “make DanteCode beat Claude Code.” It is trying to make DanteCode good enough that you can use it on your own repos reliably, with proof, and then expose that narrower truth publicly. Competing tools already have strong workflow edges: Aider is very strong in terminal-first git-native flow, Qwen Code is pushing Subagents/Skills/Plan Mode, Continue is pushing source-controlled AI checks in PR flow, OpenHands is positioning as a secure model-agnostic coding-agent platform, Codex is pushing multi-agent worktrees, Cursor has event-driven automations, and Claude Code already spans terminal/IDE/desktop/web. DanteCode should answer with trust + portability + governed autonomy, not with surface-area sprawl.

3. Hard scope lock

Do not widen scope until all gates below are green.

Ship now

@dantecode/cli
stable runtime packages needed by CLI
verification/reporting spine
live provider support for marketed Tier-1 providers
real-repo daily-driver flows

Ship as preview

VS Code extension only after CLI is stable

Explicitly non-blocking

Desktop polish
big automation layer
full enterprise control plane
public claims about “all nines” across every surface

This scope is directly aligned with the repo’s release matrix and spec.

4. Delivery standard

Every phase below must satisfy these packet rules:

No hand-edited readiness claims.
No “green” language unless generated from CI or measured artifacts.
No new public-facing feature unless it improves one of four launch moats:
verification,
portability,
governed execution,
non-technical legibility.
No phase closes without artifacts, acceptance, and fail codes.
No Desktop work unless it directly unblocks CLI or shared runtime.
No more than 1–4 files per atomic implementation prompt when using Codex/Claude-style execution, to stay aligned with your existing build discipline.
Phase P0 — Truth Spine Repair
Goal

Make the repo incapable of overstating readiness.

Why first

Your docs and current public CI do not agree. SCORING.md, ARCHITECTURE.md, SPEC.md, RELEASE.md, and TASKS.md describe a stronger state than the latest visible branch run proves. Until that is fixed, every later claim is weak.

Required outputs

Create or normalize these artifacts:

artifacts/readiness/current-readiness.json
artifacts/readiness/current-readiness.md
scripts/release/generate-readiness.ts
scripts/release/assert-readiness.ts

Update these docs to consume generated truth, not prose truth:

SCORING.md
RELEASE.md
PLAN.md
TASKS.md
ARCHITECTURE.md
Required behavior
npm run release:matrix remains machine-readable source of truth if that is already the contract.
npm run release:doctor must read actual generated readiness state.
Any red CI job must cause readiness status to be blocked.
Docs must render status from generated artifacts or include a stamped snapshot tied to commit SHA.
Acceptance
One command regenerates readiness artifacts from current repo state.
Docs cannot say “CI green” if the latest run is red.
Release status can only be one of:
blocked
local-green-external-pending
private-ready
public-ready
Fail codes
TRUTH-001 docs claim green but generated artifact says blocked
TRUTH-002 readiness artifact missing commit SHA
TRUTH-003 release scripts and docs disagree
TRUTH-004 manual status text remains in tracked docs
Phase P1 — CI Recovery
Goal

Return feat/all-nines to a real green baseline.

Known blockers from live evidence
@dantecode/evidence-chain property tests are failing in stableJSON
@dantecode/core lint/typecheck is failing due to estimateMessageTokens
windows-smoke is failing with Git exit code 128
some jobs are being canceled downstream because the matrix is already red
Subphase P1-A — Evidence-chain determinism
Files likely involved
packages/evidence-chain/src/**
packages/evidence-chain/src/__tests__/property-tests.test.ts
Task

Fix stableJSON semantics so property-based tests reflect actual deterministic serialization rules.

Required decision

Choose one canonical rule and document it:

duplicate object keys are invalid input and must be normalized/rejected before serialization, or
duplicate keys are allowed but last-write-wins must be deterministic and tested explicitly.

The current failing counterexamples show duplicate-key collisions with different values, so this is not just flaky infrastructure; it is an ambiguous serialization contract.

Acceptance
property tests pass
contract is written down in code comments + test names
receipts depending on stableJSON are still reproducible
Fail codes
EC-001 property tests still fail
EC-002 contract undefined for duplicate keys
EC-003 serialization change breaks prior receipt fixtures without migration note
Subphase P1-B — Core lint/typecheck
Files likely involved
packages/core/src/context-budget.test.ts
token-estimation helper source in packages/core/src/**
Task

Either wire estimateMessageTokens into the tested path or remove/rename it according to lint rules. The failure is explicit in both lint and typecheck.

Acceptance
@dantecode/core lint green
@dantecode/core typecheck green
no dead helper remains in that path
Fail codes
CORE-001 lint still fails
CORE-002 typecheck still fails
CORE-003 helper left in repo but unused
Subphase P1-C — Windows smoke
Files likely involved
.github/workflows/ci.yml
CLI smoke/install scripts
any script that assumes Unix shell or missing Git identity/history behavior
Task

Repair Windows smoke so it can clone/build/smoke CLI without Git 128 failures.

Likely causes to test
missing fetch-depth: 0 or history expectation
script assumes global Git identity
shell/path quoting incompatibility
command assumes POSIX-only behavior
clean repo state logic not compatible with Actions checkout on Windows
Acceptance
windows-smoke green on GitHub Actions
smoke test is not silently skipped
same smoke path works locally on Windows if reproducible
Fail codes
WIN-001 Git 128 remains
WIN-002 smoke passes by bypassing the failing command
WIN-003 Unix-only shell assumptions remain in release path
Exit gate for Phase P1

All of these must be green on GitHub Actions:

format
typecheck
lint
test
windows-smoke
anti-stub-self-check
Phase P2 — Verification Spine Hardening
Goal

Turn DanteForge from “strong positioning” into “provable switch reason.”

Why now

The vision is built around trust receipts, PDSE, anti-stub, constitution checks, GStack, and plain-language reports. If this layer feels vague or inconsistent, the whole wedge collapses.

Required outputs

Create:

docs/verification/receipt-schema.md
docs/verification/pdse-contract.md
docs/verification/failure-reasons.md
fixtures/verification/golden/**
artifacts/verification/samples/**
Required behavior

Every completed run that writes or proposes changes must emit:

run ID
provider/model used
files touched
verification stages run
stage pass/fail results
plain-language summary
next-step recommendation
deterministic receipt payload
Acceptance
20 repeated sample tasks produce structurally valid receipts
receipt schema is documented and versioned
“why passed” and “why failed” are visible in plain language
verification blocks unsafe writes in tested flows
same input and same repo state produce same semantic receipt outcome except timestamp/nonce metadata
Fail codes
VERIFY-001 receipt omitted on failure
VERIFY-002 pass/fail reason not human-readable
VERIFY-003 receipt not reproducible
VERIFY-004 verification can be bypassed in normal CLI flow
Phase P3 — CLI Daily-driver Readiness
Goal

Make the CLI the real product, not just the nominal ship surface.

Why this is the center

The README, spec, and release matrix already make the CLI the primary public interface and default install target.

Required flows

These commands or equivalent UX surfaces must be solid:

dantecode init
one-shot prompt execution
REPL start
/help
/status
/model
/diff
/undo
/history
/cost
skill import
background task visibility
plain-language run report display
Required outputs

Create:

docs/golden-flows/cli-clean-install.md
docs/golden-flows/cli-repo-edit.md
docs/golden-flows/cli-provider-failover.md
docs/golden-flows/cli-skill-import.md
Acceptance

A clean user can:

install,
init a repo,
connect a provider,
run a task,
inspect a diff,
undo or commit,
read a plain-language verification report,
in under 10 minutes, following only the README/quickstart. The README already presents quickstart and command expectations, so this is a fair gate.
Fail codes
CLI-001 quickstart diverges from actual behavior
CLI-002 core task flow requires undocumented flags
CLI-003 /undo or diff flow is unreliable
CLI-004 report not understandable by non-technical user
CLI-005 cost/provider state unclear during session
Phase P4 — Live Provider Proof
Goal

Prove DanteCode works with real providers, not only local tests.

Why this is mandatory

Your release runbook explicitly requires live provider validation and clean README behavior before release.

Required matrix

Minimum day-one provider proof:

Grok
Anthropic
OpenAI
Ollama

Optional before public v1:

Google
Groq
custom OpenAI-compatible

That matches the repo’s documented support and release matrix.

Required outputs

Create:

artifacts/provider-smoke/<date>/<provider>.json
artifacts/provider-smoke/<date>/summary.md
Required scenarios
successful smoke per provider
one provider failure with fallback-chain success
one explicit local Ollama success
one error-path where credentials are missing and failure message is correct
Acceptance
npm run smoke:provider -- --require-provider green with real creds
fallback chain demonstrated
Ollama local path proven
provider-smoke summary checked into artifacts or published in release evidence
Fail codes
PROV-001 no real provider smoke
PROV-002 fallback path not proven
PROV-003 marketed provider unsupported in real run
PROV-004 missing-credential path is confusing or silent
Phase P5 — Golden Flows on Your Real Repos
Goal

Answer the only question that matters: can Ricky use this instead of defaulting to Claude Code?

Required real-repo flows

Run these on one of your actual repos, not a demo repo:

GF-01 — Clean clone to first success

Install DanteCode fresh, connect provider, complete a small change, get report.

GF-02 — Real bugfix

Use DanteCode to reproduce, patch, verify, and diff-review a real issue.

GF-03 — Refactor with guardrails

Run a controlled refactor touching multiple files; verify receipts and undo path.

GF-04 — Skill import

Import a real skill from one of the supported formats and execute it end to end. The README and spec explicitly position skill import as a differentiator, so this must be proven.

GF-05 — Provider failover

Primary provider errors; fallback completes the task; run report records the switch.

GF-06 — Background completion

Queue work, leave it, resume later, inspect result and report.

Required outputs

Create:

artifacts/golden-flows/gf-01/**
artifacts/golden-flows/gf-02/**
artifacts/golden-flows/gf-03/**
artifacts/golden-flows/gf-04/**
artifacts/golden-flows/gf-05/**
artifacts/golden-flows/gf-06/**

Each folder must include:

prompt
repo SHA
provider/model
files touched
final diff summary
verification receipt
operator verdict
Acceptance

GF-01 through GF-05 must be green before private daily-driver declaration.
GF-06 must be green before public v1 declaration.

Fail codes
GF-001 demo repo used instead of real repo
GF-002 report missing from any flow
GF-003 undo/recovery not proven
GF-004 fallback path simulated, not real
GF-005 imported skill not actually exercised
Phase P6 — VS Code Preview Seal
Goal

Keep VS Code as preview, but make it a credible preview.

Why not earlier

The release model already says preview, not GA. CLI must win first.

Required outputs

Create:

docs/golden-flows/vscode-preview-smoke.md
artifacts/vscode-preview/<date>/**
Must-have preview behaviors
chat sidebar works
diff review works
PDSE/verification status visible
restart persistence works
model switching works
skill import visible if advertised
no obviously stubbed UI affordances in the public preview path
Acceptance
preview can complete the same core task classes as CLI except where intentionally documented otherwise
extension state survives restart
preview label is visible in docs and packaging
Fail codes
VSC-001 preview marketed as GA
VSC-002 core flows broken after restart
VSC-003 diff/review UX not usable
VSC-004 preview surface promises features not actually wired
Phase P7 — Selective OSS Harvest
Goal

Harvest strengths without losing DanteCode’s identity.

Priority harvest map
Harvest A — Aider

Steal:

terminal simplicity
git-native flow
minimal command friction
file-selection discipline

Aider remains a strong benchmark for “fastest route from repo to useful edit.”

Harvest B — Qwen Code

Steal:

Subagents
Skills ergonomics
Plan Mode safety split
terminal-first, IDE-friendly positioning

Qwen Code is aggressively evolving in these exact directions.

Harvest C — Continue

Steal:

source-controlled AI checks
CI/PR-native enforcement
suggested-diff-on-fail pattern

That maps extremely well to DanteForge.

Harvest D — OpenHands

Steal:

secure runtime posture
platform/API shape
delegated execution discipline

OpenHands is a direct benchmark for model-agnostic, scalable coding-agent runtime design.

Harvest E — Codex / Cursor / Claude Code

Steal:

worktree-native parallelism from Codex
event-driven background automations from Cursor
multi-surface continuity and smoother onboarding from Claude Code

These are the current polish leaders, but they are not where DanteCode should start.

Rule

No harvest enters the roadmap unless it strengthens one of:

trust,
portability,
governed autonomy,
non-technical legibility.
Phase P8 — Public OSS v1 Release Seal
Goal

Convert private readiness into credible public release.

Required preconditions
P0 through P6 green
provider smoke artifacts present
golden flows present
readiness artifact says public-ready
publish secrets configured
quickstart works from clean clone

That is directly aligned with your own release runbook.

Required outputs

Create:

artifacts/release/v1/public-readiness.json
artifacts/release/v1/public-readiness.md
artifacts/release/v1/publish-dry-run.log
artifacts/release/v1/quickstart-proof.md
Acceptance
npm run release:doctor no blockers
npm run release:check green
live provider smoke green
first GitHub Actions CI run on release candidate green
publish dry-run green
README quickstart proven from clean clone
Fail codes
REL-001 publish dry-run fails
REL-002 README quickstart drifts from reality
REL-003 external secrets not configured
REL-004 public-ready asserted without green CI
REL-005 Desktop implied as launch-critical
Gate sheet
Private daily-driver gate

Declare private-ready only when:

P0 complete
P1 complete
P2 complete
P3 complete
P4 complete
GF-01 through GF-05 green
current readiness artifact = private-ready
Public OSS v1 gate

Declare public-ready only when:

private-ready already true
P6 complete
P8 complete
GF-06 green
current readiness artifact = public-ready
Recommended execution order for Codex / Claude / Kilo-style runs

Use this exact sequence:

P0 Truth Spine
P1-A Evidence-chain
P1-B Core lint/typecheck
P1-C Windows smoke
P2 Verification contracts
P3 CLI golden flows
P4 Live provider matrix
P5 Real-repo proofs
P6 VS Code preview seal
P8 Public release seal

Do not reverse this. Fixing polish before truth and CI is wasted motion.

Codex-ready operator brief
Project: DanteCode
Branch: feat/all-nines
Mode: approvals-first, no scope expansion
Primary objective: make CLI truly private-daily-driver ready, then public OSS v1 ready
Secondary objective: keep VS Code as honest preview
Non-objective: Desktop polish, broad new feature expansion, marketing polish

Execution rules:
1. Treat current repo docs as partially aspirational until CI-backed truth artifacts exist.
2. First build the truth spine: generated readiness artifacts, fail-closed release status, doc/runtime agreement.
3. Then fix public CI blockers:
   - evidence-chain stableJSON property failures
   - core lint/typecheck failure around estimateMessageTokens
   - windows-smoke Git 128 failure
4. Do not add new user-facing features until public CI is green.
5. DanteForge/verification work must produce deterministic receipt artifacts and human-readable pass/fail reasons.
6. CLI is the main product. VS Code remains preview. Desktop is non-blocking.
7. Every phase must emit artifacts under /artifacts and fail codes on unmet acceptance.
8. No claim of green, ready, or ship unless generated readiness artifacts say so.
9. Keep changes atomic: 1–4 files per prompt when possible.
10. Prefer deleting ambiguity over adding capability.

Definition of done for private-ready:
- public CI green
- readiness artifacts generated
- live provider smoke proven
- GF-01..GF-05 proven on a real repo
- CLI quickstart works cleanly
- verification receipts are deterministic and understandable

Definition of done for public-ready:
- private-ready already true
- VS Code preview smoke proven
- publish dry-run proven
- README quickstart proven from clean clone
- release artifacts stamped with commit SHA
Final call

This packet gives you the shortest route to the outcome you actually want: using DanteCode on your own projects with enough confidence that Claude Code becomes optional instead of mandatory. The repo already has the right wedge and release shape; what it lacks is truth-hardening, green CI, live-provider proof, and real-repo receipts.