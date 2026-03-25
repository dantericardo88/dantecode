Executive read

DanteCode still has the better foundational wedge: provider portability plus a trust engine aimed at closing the “AI said done” gap with verification receipts, anti-stub checks, PDSE, constitution checks, GStack validation, and plain-language reports for non-technical users. Qwen Code is ahead on the operator experience layer: plan mode, approval modes, restore/export/session tooling, skills packaging, subagents, hooks, usage visibility, cross-editor support, and faster productization of workflow features.

That means the remaining DanteCode gap is not “we need more intelligence.” It is: we need better runtime truthfulness, better task control, better planning/apply separation, and better operator visibility. Those are exactly the areas where Qwen Code is currently more usable day to day.

Weighted score matrix

These scores are for your use case: replacing Claude Code on real projects, not maximizing public hype.

Dimension	Weight	DanteCode	Qwen Code	Gap
Verification / trust moat	12	9.0	6.5	Dante +2.5
Task honesty / “did it really do it?”	10	6.0	8.5	Qwen +2.5
Plan mode / safe analysis	8	5.5	9.0	Qwen +3.5
Tool approvals / governance	8	6.0	9.0	Qwen +3.0
Apply / restore / undo discipline	6	7.0	8.5	Qwen +1.5
Skills system maturity	8	7.0	9.0	Qwen +2.0
Subagents / delegated work	6	6.5	9.0	Qwen +2.5
MCP / tool ecosystem management	6	7.0	8.8	Qwen +1.8
Automation / hooks	5	5.5	8.5	Qwen +3.0
Session export / analytics	5	5.0	8.8	Qwen +3.8
Token / context visibility	5	6.5	9.0	Qwen +2.5
Model portability	8	9.0	8.5	Dante +0.5
Repo understanding / search	4	7.5	7.5	tie
Background / headless workflows	4	7.5	8.5	Qwen +1.0
IDE / editor integration	5	6.5	8.5	Qwen +2.0
Install / onboarding	5	6.5	8.8	Qwen +2.3
Cross-platform polish	4	4.5	8.0	Qwen +3.5
Release credibility	6	5.0	8.5	Qwen +3.5
Docs / learnability	5	7.0	9.0	Qwen +2.0

Weighted total: DanteCode 6.7 / 10 vs Qwen Code 8.46 / 10

Where DanteCode is actually stronger

DanteCode’s README and vision are sharper than Qwen’s on the thing that matters most for your long-term moat: trustable completion. Dante explicitly frames the problem as the trust gap for non-technical users and positions DanteForge as the answer with anti-stub enforcement, PDSE scoring, constitution checks, GStack validation, and plain-language run reports. Qwen has safeguards and approvals, but its public docs are much more workflow-centered than proof-centered.

DanteCode is also clearly strong on provider portability. The public README says it supports Anthropic, Grok, OpenAI, Google, Groq, Ollama, and OpenAI-compatible endpoints, while the spec calls out provider construction, fallback routing, task overrides, background runners, indexing/search, session persistence, and CLI surfaces like /mcp, /bg, /index, /search, /party, /forge, and /magic. Qwen is also multi-provider, but Dante’s portability is more central to its product identity.

So the right conclusion is not “become Qwen.” The right conclusion is: keep Dante’s trust spine, harvest Qwen’s workflow surface.

Where Qwen Code is clearly ahead
1. Plan mode and approval model

Qwen has a much cleaner planning/apply separation. Its docs expose explicit approval modes including plan, default, auto-edit, and yolo, with plan meaning analyze only and do not modify files or execute commands. The approval-mode docs also describe Plan Mode as safe read-only analysis for exploring codebases and planning complex changes. That is a much more legible operator contract than Dante’s current public story.

This matters because a lot of “AI said it did something but didn’t” starts when planning and execution are blurred. Qwen forces a clearer mental model. Dante needs that badly.

2. Tool governance and runtime visibility

Qwen documents a formal tool loop: tool schemas are presented to the model, tool requests are validated, sensitive operations often require confirmation, and all tools are subject to sandbox restrictions. It also documents MCP conflict handling, trust-based bypass settings, and interactive management for tools and MCP servers. Dante has richer verification ambitions, but Qwen exposes the runtime control surface more clearly to the operator.

That is why Qwen feels more honest in day-to-day use: the user can see and control the execution boundary better. Dante’s vision says “honest failure reporting” and “crash-safe accountability,” but the public branch still shows a gap between docs and reality because its release docs define green CI as required while the latest feat/all-nines CI run is failing.

3. Skills and subagents

Qwen’s Skills are documented as modular folders with SKILL.md, model-invoked by description, explicitly shareable through the repo, and invocable via /skills; the docs also cover personal vs project skills and team sharing through versioned project directories. Subagents are documented as specialized assistants with separate context, controlled tools, and autonomous execution until completion or failure. That is a more mature operating model than Dante’s current public docs, even though Dante already supports importing skills from Claude Code, Continue, and OpenCode.

The key difference is that Qwen’s skills/subagents are not just capability claims. They are part of a coherent usage model. Dante has the ingredients, but not yet the same operator-tight surface.

4. Session export, insight, and usage visibility

Qwen now has /export for Markdown/JSONL/HTML session export, /insight for analyzing local session records into an HTML report, real-time token usage display, and /context for token breakdown by files and remaining context space. That is a serious usability advantage because it gives the operator visibility into what happened, what it cost, and why context is filling up.

Dante already exposes /cost and session history in its README, but it does not yet project the same level of visible runtime accounting or operator analytics in the public docs.

5. Automation hooks and workflow glue

Qwen added a Hooks system that can run custom commands at lifecycle moments such as running tests before commit, auto-formatting after code generation, or saving work summaries automatically. It also added better MCP/extension management, a VS Code companion sidebar, and GitHub workflow custom commands. This is exactly the kind of “small workflow glue” that makes a tool feel usable instead of merely ambitious.

Dante has background runners and queue/concurrency control in the spec, but it does not yet surface this with the same simple operator affordances.

6. Install, cross-platform, and release confidence

Qwen’s docs are simply more mature here. It has a structured quickstart, one-click install script, frequent weekly updates, Windows fixes, editor integrations beyond VS Code, and a public roadmap that shows many workflow features as completed. Dante’s public release docs are thoughtful, but they also explicitly require green CI, live provider smoke, publish secrets, and quickstart proof from clean clone, while the current visible run on feat/all-nines is failing.

That does not mean Dante is worse architecturally. It means Qwen is currently better operationalized.

The exact harvest list

This is the part that matters most.

Harvest 1 — Hard plan/apply split

Dante needs Qwen’s plan/default/auto-edit/yolo concept, but adapted to Dante’s trust spine.

Implement four explicit runtime states:

plan
review
apply
autoforge

And make them non-negotiable:

plan: read/search/index only, no edits, no shell mutations
review: propose exact changes, diffs, and tool intentions, still no apply
apply: edits allowed after user approval
autoforge: pre-authorized narrow workflows only, with receipts

No natural-language message may claim completion unless the task ledger shows applied and, where relevant, verified. This is the single highest-value harvest because it attacks your “said it did stuff it didn’t” problem at the root. Qwen’s explicit approval modes and Plan Mode prove that users understand this model.

Harvest 2 — Tool-call ledger and truth contract

Dante already wants honest reporting. Now enforce it with a strict task/event ledger:

planned -> approved -> started -> produced -> applied -> verified -> committed
or
planned -> approved -> started -> failed -> reported

Final report text must be generated from this ledger, not improvised by the model. If no applied event exists, the UI/report cannot say “implemented.” If edits were proposed but not written, it must say “proposed, not applied.” Dante’s vision already points in this direction; Qwen’s tool-loop and approval architecture show the operator-facing version you need.

Harvest 3 — Explicit restore/recovery model

Qwen documents /restore, /resume, /summary, and /compress as first-class session/project commands. Dante already has /undo, /history, and /compact, but it should go further and formalize:

restore previous file state
resume named session/run
summarize run outcome
compress chat into verified state snapshot

This makes the tool feel reliable after interruptions.

Harvest 4 — First-class Skills runtime

Dante already imports skills from Claude Code, Continue, and OpenCode. Keep that. But also add Qwen-style project-native skills directories, visible descriptions, explicit /skills invocation, and team-sharing conventions. Qwen’s docs show a clearer operator story here, including repo-shared skills and project-local skill directories. Dante should support both imported external skills and native Dante skills with one canonical runtime contract.

Harvest 5 — Subagents with scoped tools

Dante has /party and autoforge concepts, but it needs Qwen-style subagent controls:

separate context windows
per-agent allowed tools
per-agent skill visibility
per-agent output channel
handoff receipt back to main session

This is how you stop orchestration from becoming mush. Qwen’s subagent docs are clear that subagents have separate context and controlled tools; Dante should adopt that exact principle but add verification receipts on each handoff.

Harvest 6 — Hooks system

This is one of the highest-ROI harvests. Qwen’s Hooks system lets users automatically run tests before commit, format after generation, or save summaries at lifecycle boundaries. Dante should add hook points at:

before apply
after apply
before commit
after commit
on failure
on session end
on receipt emission

This will make Dante feel dramatically more usable without changing the core intelligence at all.

Harvest 7 — Usage visibility: /context, /export, /insight

Dante needs the operator-facing visibility layer Qwen now has:

live token/context bar
/context showing what files are consuming space
/export for Markdown/JSONL/HTML session export
/insight to analyze historical runs and spot patterns

This should be connected to DanteForge so exported sessions include receipts, verification results, provider/model used, files touched, and outcome summary. Qwen already proves users want this.

Harvest 8 — Proactive ambiguity handling

Qwen recently added “AI proactive questions: when in doubt, ask you.” Dante needs this badly. In your environment, false confidence is more damaging than asking one clarifying question or explicitly marking a missing precondition. This should be tied to plan mode and to a low-confidence threshold in reports.

Harvest 9 — Better MCP management

Dante already has /mcp. Harvest Qwen’s management ergonomics:

list connected servers
toggle enable/disable without restart
show connection state
show discovered tools
resolve naming conflicts visibly
explain sandbox compatibility failures

Qwen’s MCP docs are much stronger here.

Harvest 10 — Better VS Code preview behavior

Qwen’s VS Code beta already exposes real-time changes, auto-accept mode, attached files/images, conversation history, and multiple simultaneous sessions. Dante’s current public release model correctly keeps VS Code in preview. That is fine. But the preview should still harvest:

multiple sessions
visible task state
clear apply vs propose mode
conversation history
explicit receipt viewer
file attach/context affordances

Dante should not copy Qwen’s “auto-accept edits mode” blindly unless it is guarded by stronger receipts.

Harvest 11 — Onboarding and clean install

Qwen has a more polished install story, including one-click install and tighter quickstart docs. Dante needs a cleaner private daily-driver onboarding path:

one command install
first provider setup wizard
first repo init wizard
first task walkthrough
first receipt walkthrough
first restore/undo walkthrough

That matters because a strong product can still feel weak if the first 5 minutes are rough.

What Dante should not blindly copy

Do not let Dante drift into becoming a general “AI does everything in your terminal” product. Qwen’s docs and showcase extend into broader cowork workflows and general desktop automation, which is useful for adoption but can dilute Dante’s sharper identity. Dante should stay centered on governed coding work with receipts.

Do not replace DanteForge with lighter approvals. Qwen’s approval modes are good, but they are not a substitute for your trust engine. They are complementary. The right move is:

Qwen-style operator controls on the front,
DanteForge-style proof on the back.
The real remaining gaps

The biggest remaining gaps are:

Task honesty gap — Dante still needs a hard state machine so the UI/report can never claim applied work that was only planned or proposed. Qwen’s approval and tool model shows how to make that visible to the user.
Planning gap — Dante needs a real plan mode, not just a conceptual one. Qwen’s plan approval mode and rejected-plan visibility are stronger than Dante’s current public surface.
Operator visibility gap — Dante needs /context, richer /cost, /export, /insight, and better session/run introspection. Qwen is ahead here.
Workflow glue gap — Hooks, better restore/resume, and better MCP management. Qwen has those; Dante needs them for usability.
Operational credibility gap — Dante’s public release rules are sensible, but the current feat/all-nines CI run is red, which undercuts trust in the launch story. Qwen currently looks more operationally mature from the outside.
Bottom line

DanteCode should not chase Qwen on everything. It should harvest the parts of Qwen that directly improve usability and honesty:

explicit plan/apply modes,
approval levels,
scoped subagents,
first-class native skills,
hooks,
restore/resume/export/insight,
live context/token visibility,
better MCP management,
smoother onboarding,
stronger VS Code preview ergonomics.

If you do that while preserving DanteForge, provider portability, and the non-technical trust narrative, Dante stops being “ambitious but rough” and starts becoming the tool you can actually use on your projects every day.

I can turn this into a harvest packet next: exact features to borrow from Qwen, grouped into P0/P1/P2 implementation order with acceptance tests for DanteCode.

please continue with harvest packet

I’m converting the gap analysis into a harvest packet now: exact capabilities to steal from Qwen Code, what to keep uniquely Dante, and the order that gets you to usable fastest.

Thought for 1m 54s
DanteCode vs Qwen Code — Harvest Packet
Executive verdict

The fastest way to make DanteCode genuinely usable is not to copy Qwen Code wholesale. It is to keep Dante’s existing moat — verification, portability, and plain-language trust for non-technical users — and harvest Qwen’s stronger runtime control layer: plan/apply separation, approvals, task tracking, scoped subagents, hooks, session export, context visibility, and MCP ergonomics. Dante’s own vision and spec already center the product on trust receipts, anti-stub checks, PDSE, model portability, and a CLI-first OSS v1, while the current public CI on feat/all-nines is still failing, which means truth-hardening and operator control matter more than adding more surface area right now.

My estimate is that if you implement the Tier 0 harvests below cleanly, DanteCode’s practical usability score jumps from roughly 6.7/10 to about 8.1/10 for your use case, even before broader polish. That is because the biggest remaining gap is not raw capability; it is honest execution visibility. Qwen’s current public roadmap and docs are much stronger than Dante’s on PlanMode, TodoWrite, SubAgent, session/export, hooks, headless automation, editor support, and operator-facing workflow controls.

Tier 0 — Must harvest now

These are the features that directly attack the “said it did stuff it didn’t” problem.

H-00 — Truthful task-state machine

Why harvest it:
Dante’s vision explicitly says the trust gap is the core problem, and that honest failure reporting plus machine-verified evidence is the moat. But the current public repo still has a mismatch between ambition and externally visible proof, including a failing feat/all-nines CI run. Qwen’s approval modes, real-time progress, and task tooling create a much tighter contract between what the tool thinks, what it did, and what the user is allowed to believe.

What to build in Dante:
A non-optional execution ledger with these states:

drafted -> planned -> approved -> started -> proposed -> applied -> verified -> committed
or
drafted -> planned -> approved -> started -> failed -> reported

Final user-facing language must be generated from that ledger, not free-written by the model.

Hard rule:
Dante may never say:

“implemented”
“done”
“fixed”
“completed”

unless the ledger contains applied, and for guarded actions preferably verified.

Acceptance:

no report can claim success if file writes never occurred
no report can claim completion if verification failed
“proposed but not applied” is a first-class outcome
reports still emit on failure, matching Dante’s stated vision

Expected score lift:
Task honesty +2.5, verification trust +1.0, daily-driver confidence +1.5

H-01 — Hard Plan / Review / Apply / Autoforge mode split

Why harvest it:
Qwen exposes explicit approval modes including plan, default, auto-edit, and yolo, with plan documented as analysis-only and no execution. It also recently added visibility for rejected plans so users can compare proposals instead of losing them. Dante’s current public commands and spec imply rich behavior, but the plan/apply contract is not yet equally legible to the operator.

What to build in Dante:
Replace vague autonomy with four explicit runtime modes:

plan — read/search/index only; no edits, no shell mutations
review — generate concrete diffs, todo list, and intended tool calls; still no apply
apply — execute approved edits only
autoforge — bounded, policy-scoped autonomous loop with receipts

Critical behavior:
Every UI surface must show the current mode at all times.

Acceptance:

plan cannot write files or run mutating shell commands
rejected plans remain visible and comparable
switching from plan to apply requires explicit user intent
/party, /magic, and /forge must declare which mode they are using before work starts

Expected score lift:
Plan mode +3.0, governance +2.0, non-technical trust +1.0

H-02 — Session todo board with live progress

Why harvest it:
Qwen’s todo_write tool is one of the cleanest usability wins in the whole stack. It automatically creates and updates a structured task list for complex work, stores it per session, and shows progress in real time. That directly reduces the “black box” feeling.

What to build in Dante:
A RunPlan artifact with items:

content
status
activeForm
owner (main or subagent name)
verificationRequired
evidenceRefs

Stored in .dantecode/runs/<run-id>/todo.json

Behavior:

auto-created for tasks with 3+ distinct steps
visible in CLI and VS Code preview
updated as work proceeds
linked into final report

Acceptance:

every multi-step task produces a visible todo list
progress updates as steps move pending -> in_progress -> completed
completed item without matching ledger evidence is invalid
report includes which todo items were actually finished

Expected score lift:
Operator visibility +2.0, task honesty +1.0, usability +1.0

H-03 — Scoped subagents with visible handoffs

Why harvest it:
Qwen’s SubAgents and Task tool are more mature than Dante’s current public orchestration story. Qwen documents separate context per subagent, controlled tools, specialized prompts, real-time progress, and parallel execution. Dante already advertises /party and multi-agent capabilities, but it needs stricter structure if you want orchestration without hallucinated progress.

What to build in Dante:
A first-class subagent runtime where each subagent has:

its own context
allowed tools
allowed files / path scope
model override
receipt stream
handoff result contract

Mandatory subagent types for v1 harvest:

planner
implementer
tester
reviewer
docs

Acceptance:

subagents cannot access tools outside their policy
each subagent emits a final structured result, not just free text
parent run shows live child progress
multiple child agents can run in parallel
every handoff is receipted and included in final summary

Expected score lift:
Subagents +2.5, orchestration trust +1.5

H-04 — Hooks at the right lifecycle moments

Why harvest it:
Qwen’s Hooks system is one of the highest-ROI features in the entire product. It lets users run custom commands before commit, auto-format after generation, inject project context, and auto-save work summaries at the end of a run. That is exactly the kind of workflow glue that makes a tool usable daily.

What to build in Dante:
Support hook points at:

beforePlan
beforeApply
afterApply
beforeCommit
afterCommit
onFailure
onReport
onRunEnd

Starter defaults:

run tests before commit
run formatter after apply
save receipt summary at run end
inject project-specific memory at session start

Acceptance:

hooks are configurable per project
hook failures are visible and receipted
hooks cannot silently mutate protected files unless policy allows
hook output is visible in reports, not hidden

Expected score lift:
Workflow glue +3.0, task honesty +0.5, daily usability +1.5

H-05 — /restore, /resume, /export, /insight, /context

Why harvest it:
Qwen is simply ahead here. Its commands docs expose /resume, /restore, /summary, /compress, /stats, /skills, /approval-mode; recent releases added /export, /insight, real-time token usage, and /context. These are not cosmetic. They create operator confidence.

What to build in Dante:
Add or formalize:

/resume — resume prior run/session
/restore — restore file state before tool execution
/export — export run/session as Markdown, JSONL, HTML
/insight — analyze local run history and generate an HTML usage/report card
/context — show token/context breakdown by file and remaining headroom

Dante already advertises /history, /undo, /compact, and /cost; this harvest turns those from useful commands into a coherent runtime observability layer.

Acceptance:

/restore works by run ID and previewable diff
/export includes receipts, provider/model, files touched, and final outcome
/insight surfaces repeat failure patterns and most-used skills/providers
/context shows which files are crowding the context window
all commands work in CLI first, then VS Code preview

Expected score lift:
Session visibility +3.5, context visibility +2.5, operator trust +1.5

Tier 1 — High-value harvest after Tier 0
H-06 — Native Dante Skills runtime, not just imported skills

Qwen’s Skills are stronger because they are not merely import targets; they are a native operating model. Skills live in personal and project directories, are model-invoked by description, can be explicitly run via /skills, and can be shared via git. Extensions can also ship commands, skills, and subagents with precedence/conflict rules. Dante already imports Claude/Continue/OpenCode skills; now it needs a canonical Dante-native skill contract on top.

Build in Dante:

~/.dantecode/skills/
.dantecode/skills/
skill registry with descriptions, provenance, verification expectations
/skills list/run
skill scoring and usage history
extension-packaged skills and agents later

Acceptance:

project skills are shareable in git
imported skills normalize into one Dante schema
the model can auto-select a skill, but the user can also force one
skill execution is receipted and reportable
H-07 — Better MCP management and conflict resolution

Qwen’s MCP docs are significantly more operationally mature. It documents transport types, discovery, schema validation, conflict resolution, troubleshooting, sandbox compatibility, and CLI management for add/list/remove flows. Dante already exposes /mcp and a dedicated MCP package in the spec, but it needs a stronger operator layer around it.

Build in Dante:

dantecode mcp add/list/remove/toggle
discovered tools view
schema validation status
conflict naming rules
sandbox compatibility warning
child-process cleanup / connection health

Acceptance:

users can see connected servers and discovered tools
bad schema or sandbox incompatibility surfaces clearly
MCP connection failures are classified and receipted
tool name collisions resolve deterministically
H-08 — Headless + JSON mode as a first-class automation contract

Qwen’s headless mode is well documented: stdin or prompt input, structured text or JSON output, file redirection, consistent exit codes, and resume-scoped automation. That is exactly what Dante needs if it is going to become the brain inside larger workflows.

Build in Dante:

dantecode --prompt
dantecode --json
dantecode --resume
stable exit codes
machine-readable receipts for CI/automation

Acceptance:

automation mode produces deterministic JSON schema
non-zero exit codes map to meaningful failure classes
headless runs still emit receipts and run reports
resumable automation works at project scope
H-09 — Onboarding and config hierarchy

Qwen’s config docs are much more mature than Dante’s current onboarding story. It documents layered configuration precedence, project/user/system settings, migration, and project-local .qwen assets. Dante’s current README and spec are simpler, but still fairly manual: install, set provider key, init, then run. That is fine for builders, not ideal for broader usability.

Build in Dante:

setup wizard on first launch
provider test during init
generated .dantecode/STATE.yaml plus optional user defaults
migration path for future config changes
explicit precedence docs

Acceptance:

first successful run in under 5 minutes on clean machine
provider setup validated during onboarding
docs match actual setup flow exactly
settings precedence is documented and inspectable
Tier 2 — Nice-to-have harvests after usability is fixed
H-10 — VS Code preview ergonomics

Qwen keeps widening editor support and recently added a VS Code companion sidebar plus JetBrains and Zed support. Dante’s own release model correctly keeps VS Code in preview and Desktop out of the launch-critical path. So the right move is not “chase every editor now.” It is to improve the preview with better session visibility, receipt viewing, and mode display.

H-11 — GitHub Action / automation templates

Qwen documents a GitHub Action path and project-specific QWEN.md guidance, and its automation docs emphasize issue/PR linkage, small focused PRs, passing checks, and updated docs. Dante should eventually harvest the repo-automation discipline, but only after the CLI truth model is fixed.

H-12 — Extension ecosystem

Qwen’s extension system can package commands, skills, and subagents with conflict resolution. That is attractive, but it is not the fastest route to replacing Claude Code for your own use. Harvest the contract shape, not the ecosystem push, until Dante’s core flow is solid.

What not to harvest blindly

Do not let Dante drift away from its wedge. Qwen’s roadmap explicitly says its objective is to catch up to Claude Code’s product functionality and refine user experience. That is a valid strategy for Qwen; it is not the full Dante strategy. Dante’s stated product thesis is different: it is for users who cannot audit code and need machine-verified trust, not just a smoother command-line coding agent.

So do not water down:

DanteForge receipts
anti-stub enforcement
plain-language run reports
provider portability
honest failure reporting

Instead, put Qwen’s operator layer in front of Dante’s trust engine. That is the winning combination.

Recommended implementation order
P0 — Fix the lying problem first

Build:

truthful task-state machine
plan/review/apply/autoforge split
session todo board
subagent handoff receipts

This is the shortest path to “Dante stops pretending and starts proving.” It also aligns directly with your public product thesis.

P1 — Add workflow glue

Build:

hooks
/restore
/resume
/export
/insight
/context

This is where Dante starts to feel daily-drivable instead of merely powerful.

P2 — Strengthen the ecosystem layer

Build:

native Dante skills runtime
stronger MCP manager
headless JSON/exit-code contract
onboarding/config hierarchy

This is where Dante becomes easier to integrate into your workflows and easier to keep over time.

P3 — Preview/editor polish

Only after P0–P2:

VS Code preview improvements
GitHub Action templates
extension system hardening

That keeps the launch sequence aligned with Dante’s own spec and release matrix: CLI first, VS Code preview, Desktop later.

Final priority stack

If you only harvest five things from Qwen Code, make them these:

Plan/apply separation
truthful execution ledger
todo/progress board
hooks
restore/export/insight/context visibility

Those five are the highest-leverage path from “promising” to “usable.” Qwen is stronger there today, and Dante’s own product thesis makes those exact improvements unusually valuable because Dante is supposed to be the tool that closes the trust gap, not just another coder in a terminal.

I can turn this into a Codex-ready Qwen Harvest Execution Packet next, with exact file/module targets, feature names, acceptance tests, and phase-by-phase implementation prompts.

ok, that is now qwen down, what about the rest of the OSS universe that we can learn from to help close the different dimensions that we are scoring on. Aider, OpenCode, OpenHands, Kilocode. There is likely a great deal of content functionality and polish we can learn from all of them. Please dive deeper

I’m pulling the current public docs and repos for Aider, OpenCode, OpenHands, and KiloCode first, then I’ll map what each one contributes to Dante’s missing dimensions versus what is noise.

I’ve got the pattern now: each tool is strong in a different layer. Aider wins terminal discipline, OpenCode wins session/control ergonomics, OpenHands wins runtime architecture, and Kilo wins productization around modes, checkpoints, reviews, and team workflows.

Thought for 3m 24s

Yes. Once Qwen is accounted for, the rest of the OSS field fills in the missing layers around Dante in a very clean way:

Aider is the best donor for terminal discipline, git-native safety, and test/lint closure.
OpenCode is the best donor for session ergonomics, permissions, share/export, agent UX, and GitHub tasking.
OpenHands is the best donor for runtime architecture, sandbox abstraction, typed events, and deterministic replay.
Kilo is the best donor for productization: modes, rules, checkpoints, worktrees, session sharing/forking, code review automation, and team-level controls. Kilo’s own repo says its CLI is a fork of OpenCode, which is why those two overlap heavily.

Dante’s current public docs already define a strong wedge — verification receipts, anti-stub, PDSE, provider portability, CLI-first GA, VS Code preview — but they do not yet show the same degree of operator control and workflow polish that these OSS tools document publicly. That means the remaining opportunity is not “invent new magic.” It is “harvest the right layers from the right donor.”

Full competitive analysis matrix

These scores are my judgment for your actual goal: making DanteCode trustworthy and usable enough to replace Claude Code on your real repos.

Dimension	Dante	Aider	OpenCode	OpenHands	Kilo	Best donor
Verification / receipt moat	9.0	6.5	6.5	7.5	7.0	Dante
Task honesty / execution truth	6.0	7.5	8.5	8.0	8.5	OpenCode / Kilo
Plan vs apply separation	5.5	8.0	8.5	7.5	8.5	OpenCode / Kilo / Aider
Git-native safety / undo	7.0	9.5	8.5	7.0	9.0	Aider / Kilo
Lint / test feedback loop	6.5	9.0	7.0	7.0	7.5	Aider
Progress / todo visibility	5.5	6.0	7.5	7.5	8.0	Kilo / OpenCode
Permissions / policy control	6.0	6.0	8.5	8.0	8.5	OpenCode / Kilo
Subagents / orchestration	6.5	5.5	8.0	8.5	8.5	OpenHands / Kilo
Session resume / export / share	5.5	5.0	8.5	7.5	9.0	Kilo / OpenCode
Runtime sandbox / replay	4.5	4.0	6.5	9.5	7.5	OpenHands
Automation / CI / GitHub	5.5	6.0	8.5	8.5	9.0	Kilo / OpenCode / OpenHands
Context scoping / repo understanding	7.5	8.5	7.5	8.0	8.5	Aider / Kilo
Custom modes / skills / workflows	7.0	6.5	8.0	7.5	9.0	Kilo
Cross-surface polish / onboarding	6.0	8.0	8.5	6.5	9.0	Kilo / OpenCode
Team governance / visibility	4.5	3.5	6.5	8.0	9.0	Kilo / OpenHands
Weighted read
Dante now: 6.8
Aider influence target: +0.5 to +0.8
OpenCode influence target: +0.8 to +1.2
OpenHands influence target: +0.6 to +1.0
Kilo influence target: +0.9 to +1.3

If you harvest the right pieces, Dante can plausibly move into the 8.3–8.7 range without changing its core identity.

What each tool teaches Dante
1. Aider teaches discipline

Aider is still one of the best examples of a terminal-first coding agent that stays close to git reality. Its docs emphasize /undo, git-integrated history/branch workflows, ask mode for non-edit discussion, architect mode with a planner/editor split, auto lint/test after edits, repo maps for large codebases, file watching/AI comments in editors, and layered config via .aider.conf.yml and .env. It also pushes very hard on file scoping, telling users to add only the files that matter and to use ignore files or subtree scoping for large repos.

What to harvest from Aider

hard git-native undo/review discipline
architect/editor split as a reliability pattern
auto lint/test after edits
repo-map and scoped-context discipline
brutally simple terminal workflow and install story

What not to copy

Aider’s one-repo-at-a-time constraint is too limiting for Dante’s longer-term orchestration vision.
2. OpenCode teaches operator ergonomics

OpenCode is the cleanest donor for “how should the agent feel to use?” Its docs show a terminal/desktop/IDE product, /init creating an AGENTS.md, primary agents and subagents, a plan agent for non-mutating analysis, granular per-tool and per-agent permissions, snapshot-based undo via an internal git repository, manual/auto sharing, export/import of sessions, Markdown-defined custom commands, GitHub automation triggered by /opencode or /oc in comments, MCP management, and visible local logs for debugging.

This is a very important lesson for Dante: OpenCode is not stronger than Dante on verification philosophy, but it is stronger on usable control surfaces. It gives the operator a clear sense of what agent is active, what permissions exist, what can be undone, how to resume/share/export, and how GitHub automation plugs in.

What to harvest from OpenCode

project bootstrap via AGENTS.md
plan agent / non-mutating analysis path
granular permissions DSL
snapshot-backed restore
export/import/share/fork-like session flows
Markdown command/workflow system
GitHub issue/PR agent runner
logs and local troubleshooting surface

What not to copy

OpenCode’s snapshot mechanism can become heavy on large repos; its own docs warn about slower indexing and higher disk usage. Dante should keep the restore behavior, but engineer the backing store carefully.
3. OpenHands teaches architecture

OpenHands is the strongest donor for backend/runtime architecture, not day-one UX. Its SDK and paper describe an event-sourced state model, deterministic replay, immutable agent configuration, a typed tool system with MCP integration, and workspace abstractions that let the same agent run locally or in ephemeral workspaces via an agent server. The current docs also frame sandboxes explicitly, with Docker as the recommended local option, and the public API includes REST/WebSocket surfaces for events, conversations, sandbox, user, webhooks, and config. The Daytona material reinforces the same strength: parallel agents, managed shell sessions, execution feedback, and remote infrastructure.

This matters because Dante’s biggest long-term technical gap is not “more prompts.” It is the absence of a fully hardened runtime truth substrate. OpenHands has already done a lot of thinking about event streams, sandboxes, typed tools, and replay. Dante should borrow that layer under DanteForge.

What to harvest from OpenHands

typed event bus for every action/observation
deterministic replay model
immutable run configuration
workspace abstraction: local vs Docker vs remote
agent server boundary with REST/WS
strong sandbox vocabulary and shell-session feedback loop

What not to copy

OpenHands is heavier operationally. If Dante copies the full deployment story too early, it will slow the path to private daily-driver usability. Keep the architecture lessons, not the full platform weight.
4. Kilo teaches productization

Kilo is where OpenCode’s raw agent ideas get turned into a more complete product surface. Its docs describe built-in and custom modes, sticky models per mode, custom rules, instructions, subagents, skills, workflows, AGENTS.md protection, checkpoints via a shadow git repository, worktree isolation for parallel sessions, session sharing/forking/export/resume, codebase indexing, cloud agents with isolated containers and auto-branch/push behavior, GitHub/GitLab AI code reviews, team governance, and usage visibility. It also documents shell integration in unusual detail, including exit-code awareness and platform-specific reliability settings.

Kilo’s lesson is that polish is a system, not a single feature. Modes, checkpoints, session sharing, review automation, cloud agents, and org controls all reinforce the feeling that the tool knows what state it is in. Dante needs a narrower version of that discipline.

What to harvest from Kilo

mode system with sticky models
protected AGENTS.md
checkpoints + worktrees
session share/fork/export/resume
code review automation
team governance / usage visibility
shell integration with exit-code awareness
workflows and skills as first-class project artifacts

What not to copy

cloud-agent and team/org layers are powerful, but not first priority until Dante’s CLI truth model is solved.
The missing-dimension map

Here is the sharper “what closes what” matrix:

Missing Dante dimension	Best donor	Exact thing to harvest
“AI said it did it” dishonesty	OpenCode + Kilo + Aider	visible action approvals, snapshots/checkpoints, explicit non-edit modes, git-backed undo
Weak plan/apply separation	Aider + OpenCode + Kilo	ask/architect, plan agent, Architect/Ask/Debug/Code modes
Poor progress visibility	OpenCode + Kilo	agent/session metadata, share/export/resume/timeline/fork surfaces
Weak runtime architecture	OpenHands	event-sourced action/observation bus, deterministic replay, immutable run config
Weak permissions model	OpenCode + Kilo	per-tool and per-agent permissions, rules, protected config files
Weak orchestration structure	OpenHands + Kilo + OpenCode	typed subtask handoffs, isolated subagent sessions, worktree/task split
Weak repair loop	Aider	automatic lint/test on edits, fast retry discipline
Weak restore/recovery	OpenCode + Kilo	snapshots, checkpoints, /restore, /undo, timeline/fork
Weak GitHub automation	OpenCode + Kilo + OpenHands	comment-triggered agent runs, PR reviews, webhook/server model
Weak team/ops visibility	Kilo	usage dashboards, org settings, session sharing, AI review controls
Weak multi-surface polish	Kilo + OpenCode	CLI + IDE + desktop patterns, session portability, onboarding
Weak sandboxing	OpenHands	Docker/remote/process sandbox abstraction and agent server boundary
What Dante should build next from this OSS universe
P0 — Truth and control layer

This is the fastest route to usability.

Build these first:

execution ledger
hard plan/review/apply/autoforge modes
git-backed restore/checkpoints
live task board
subagent handoff receipts
auto lint/test retry loop

That stack is basically Dante’s verification wedge plus Aider/OpenCode/Kilo controls on top of it. Aider gives you the git/test discipline, OpenCode gives you permissions and session ergonomics, and Kilo gives you checkpoints and mode polish. Dante’s own vision already says the user must trust the receipt, not the model’s claim.

P1 — Runtime substrate

Once truthful UX exists, harden the backend.

Build these next:

typed action/observation event bus
immutable run config
deterministic replay for runs
workspace abstraction
sandbox provider boundary
REST/WS run server

This is the OpenHands harvest. Dante should not try to become OpenHands overnight, but it should absolutely steal the architectural bones that make actions replayable and inspectable.

P2 — Workflow and ecosystem polish

After P0 and P1, harvest the workflows that make people stick.

Build:

native Dante skills + workflows
Markdown command packs
GitHub task runner
session share/fork/export/insight
code review automation
usage and model visibility
protected AGENTS.md / project instructions

This combines OpenCode’s command/share/GitHub model with Kilo’s workflows, sessions, reviews, and org discipline.

The real “best of OSS” stack for Dante

If I collapse the whole field into one harvest stack for Dante, it looks like this:

From Aider: /ask, /architect, repo-map discipline, auto lint/test, /undo, scoped-file mindset.
From OpenCode: plan agent, per-agent permissions, snapshots, AGENTS.md bootstrap, command packs, share/export/import, GitHub comment agent.
From OpenHands: event sourcing, deterministic replay, typed tools, workspace abstraction, sandbox provider, agent server.
From Kilo: modes, sticky models, protected AGENTS.md, custom rules/instructions/subagents, checkpoints, worktrees, sessions/fork/export, code reviews, team governance.
Bottom line

The rest of the OSS universe confirms the same thing Qwen already hinted at: Dante does not need more ambition. It needs more truthful control surfaces and a stronger runtime substrate.

The clean synthesis is:

Dante keeps: verification moat, PDSE, anti-stub, provider portability, plain-language reporting.
Aider adds: terminal rigor and repair loops.
OpenCode adds: session ergonomics and permissioned agent UX.
OpenHands adds: event-sourced, replayable, sandboxed architecture.
Kilo adds: production-grade modes, checkpoints, workflows, reviews, and team polish.

That is the path to turning Dante from “strong vision with rough edges” into “the tool you actually open first.”

I can turn this into an OSS Universe Harvest Packet next: one merged implementation roadmap with exact features borrowed from Aider, OpenCode, OpenHands, Kilo, and Qwen, ordered by highest ROI.

Please turn this inot the OSS Universe Harvest Packet

I’m consolidating Qwen, Aider, OpenCode, OpenHands, and Kilo into one ranked harvest roadmap so the packet is ordered by highest ROI, not by source project.

Thought for 38s
OSS Universe Harvest Packet
0. Purpose

This packet merges the best harvestable ideas from Qwen Code, Aider, OpenCode, OpenHands, and Kilo into one Dante-focused roadmap. The goal is not parity theater. The goal is to close the exact dimensions where Dante is still weak: execution truth, mode discipline, recovery, permissions, runtime architecture, workflow glue, and daily-driver polish, while preserving Dante’s core moat of verification, receipts, provider portability, and plain-language trust. Dante’s current public vision and release materials already define that moat and also define a narrower launch scope: CLI first, VS Code preview, Desktop non-critical.

1. Core thesis

Each donor is best at a different layer. Aider is strongest on git-native discipline, scoped context, and lint/test closure. OpenCode is strongest on permissions, session ergonomics, /init + AGENTS.md, GitHub automation, and operator-facing controls. OpenHands is strongest on the runtime substrate: typed events, immutable configuration, typed tools, workspace abstraction, REST/WebSocket execution, and sandboxable local-vs-remote deployment. Kilo is strongest on productization: modes, checkpoints, worktrees, session sharing/forking/export, local reviews, autonomous mode, and thin-client-over-CLI architecture. Kilo’s own repo states that Kilo CLI is a fork of OpenCode, which explains the overlap between those two donors.

2. Donor map by missing Dante dimension
Missing Dante dimension	Primary donor	Secondary donor	What to harvest
Tool says it did work it did not do	OpenCode	Kilo, Qwen	explicit permissions, plan/build split, session/task truth surfaces
Weak plan/apply separation	Qwen	Aider, Kilo, OpenCode	plan mode, architect/ask/debug/code-style modes
Weak undo/recovery/checkpoints	Kilo	OpenCode, Aider	checkpoints, worktrees, /undo, /fork, /timeline, snapshots
Weak repair loop after edits	Aider	Kilo	auto lint/test, fast retry discipline
Weak runtime substrate	OpenHands	Kilo	typed events, replay, immutable config, workspace abstraction, agent server
Weak GitHub automation	OpenCode	Kilo, OpenHands	repo-installed GitHub agent, comment/webhook driven runs
Weak operator visibility	Qwen	Kilo, OpenCode	/context, /export, /insight, session management, stats
Weak permissions/policy layer	OpenCode	Kilo	per-tool and per-path permission rules
Weak orchestration structure	OpenHands	Qwen, Kilo	typed subagent/task handoffs with isolated scope
Weak onboarding/polish	Kilo	OpenCode, Aider	CLI install, /connect, config hierarchy, share/export/import

This ranking follows each tool’s current public docs: Aider exposes /ask, /architect, /undo, repo-map and lint/test workflows; OpenCode exposes /init, AGENTS.md, plan/build, permission rules, config directories, GitHub agent install, and MCP commands; OpenHands documents typed events/tools/workspaces and an agent server; Kilo documents Architect/Ask/Debug/Orchestrator/custom modes, checkpoints, worktrees, /share, /fork, /timeline, /export, local review, kilo run, kilo serve, and permission rules.

3. Harvest priorities
Tier 0 — Immediate harvests

These are the highest-ROI changes because they directly attack the trust gap.

H0.1 — Execution truth ledger

Donors: Qwen, OpenCode, Kilo
Why: Qwen’s approval modes, OpenCode’s plan/build split and permissions, and Kilo’s explicit interactive/autonomous behavior all give the operator a clearer contract about what was only analyzed, what was proposed, and what was actually executed. Dante needs a hard run-state ledger so the assistant cannot improvise claims of completion.

Build in Dante:
drafted -> planned -> approved -> started -> proposed -> applied -> verified -> committed
or
drafted -> planned -> approved -> started -> failed -> reported

Acceptance:
No user-facing message may say “implemented,” “done,” or “fixed” unless applied exists; no guarded success may be claimed unless verified exists; “proposed, not applied” must be first-class.

H0.2 — Hard mode system

Donors: Qwen, Aider, Kilo, OpenCode
Why: Qwen exposes plan vs execution approval levels; Aider exposes ask, architect, and code-oriented chat modes; OpenCode exposes built-in plan and build; Kilo exposes Architect, Ask, Debug, Orchestrator, and custom modes. Dante needs one visible, explicit mode system across CLI and VS Code.

Build in Dante:
plan, review, apply, autoforge, plus optional specialist overlays like debug and architect.

Acceptance:
plan can never mutate files or shell state; current mode is always visible; changing mode is an explicit operator action; /party, /forge, and /magic must declare mode before work begins.

H0.3 — Todo/progress board

Donors: Qwen, Kilo, OpenCode
Why: Qwen’s todo/progress tools and Kilo/OpenCode’s session-centric UX make work feel inspectable instead of magical. Dante needs a run-scoped, evidence-linked task board that updates during execution and is embedded in the final report.

Build in Dante:
A .dantecode/runs/<run-id>/todo.json with task, owner, status, verification requirement, evidence refs.

Acceptance:
Multi-step tasks auto-create todos; tasks cannot be marked complete without matching ledger evidence; final report shows completed vs pending work.

H0.4 — Git-backed recovery

Donors: Kilo, OpenCode, Aider
Why: Kilo documents checkpoints and worktrees; OpenCode documents internal project initialization and session/share controls; Aider emphasizes /undo and git-native use. Dante needs reliable undo/restore/checkpoint semantics before it adds more autonomy.

Build in Dante:
/undo, /restore, /timeline, optional /fork, lightweight checkpoints, and per-run restore points.

Acceptance:
Any applied change can be restored by run ID or checkpoint; restore preview shows diff; recovery survives app restart.

H0.5 — Auto lint/test loop

Donors: Aider
Why: Aider’s docs and benchmark writeups repeatedly emphasize immediate lint/test repair as part of its interactive engineering workflow. Dante needs that loop because “write code and stop” is not enough for trustworthy completion.

Build in Dante:
Optional post-apply hooks for formatter, linter, test runner, with retry guidance.

Acceptance:
Configured lint/test commands can run automatically after edits; failures are attached to the run ledger and report; retry path is explicit.

Tier 1 — High-value harvests after truth is fixed
H1.1 — Native skills and command packs

Donors: Qwen, OpenCode, Kilo
Why: Qwen has mature skills; OpenCode documents Markdown-defined custom commands under project and global directories; Kilo layers modes, skills, and workflows on top. Dante already supports imported skills, but it needs a native Dante skill/workflow contract.

Build in Dante:
~/.dantecode/skills/, .dantecode/skills/, .dantecode/commands/, plus explicit /skills and /run-command.

Acceptance:
Project-local and global skills/commands are discoverable, shareable, receipted, and selectable by the model or the user.

H1.2 — Granular permissions and policy engine

Donors: OpenCode, Kilo
Why: OpenCode and Kilo both document per-tool permission rules with allow/ask/deny and pattern-based granularity, including path-specific edit rules and command-pattern rules. Dante needs this because verification alone is not enough; it also needs runtime policy fences.

Build in Dante:
Per-tool, per-command-pattern, per-path policy rules in project config.

Acceptance:
The operator can set “ask” for shell, “deny” for edits outside allowed paths, and override specific commands or folders.

H1.3 — Session observability

Donors: Qwen, Kilo, OpenCode
Why: Qwen has /export, /insight, and context visibility; Kilo documents /export, /share, /fork, /timeline, /sessions, kilo stats; OpenCode documents logs, local data, and configuration directories. Dante needs a coherent observability layer around sessions and runs.

Build in Dante:
/context, /export, /insight, /sessions, /resume, /share, /stats, all tied to receipts.

Acceptance:
Session export includes provider, model, files touched, receipts, and outcomes; /context shows token pressure; /insight surfaces repeated failure modes.

H1.4 — GitHub automation

Donors: OpenCode, Kilo, OpenHands
Why: OpenCode documents opencode github install/run; Kilo documents kilo github, cloud agent, bot, code review, and auto triage; OpenHands documents remote agent server and GitHub workflows in the SDK docs navigation. Dante should harvest the narrow slice that matters first: repo-comment or workflow-triggered runs with explicit receipts.

Build in Dante:
GitHub Action/bootstrap command, issue-comment trigger, PR review trigger, webhook run entrypoint.

Acceptance:
A repo can install Dante automation; a comment or workflow run can trigger a bounded task; results come back with receipts and status.

Tier 2 — Architectural harvests

These are essential for Dante’s long-term ceiling, but they come after the truth layer.

H2.1 — Typed event bus

Donor: OpenHands
Why: OpenHands’s SDK paper and docs explicitly describe an event-sourced state model, typed events, typed tools, immutable configuration, and deterministic replay. That is the cleanest architectural donor for Dante’s long-term runtime substrate.

Build in Dante:
Typed ActionRequested, ActionStarted, ActionSucceeded, ActionFailed, VerificationCompleted, RunStateChanged, ReportEmitted, SubagentHandoff events.

Acceptance:
Every meaningful action in Dante emits a typed event; UI/report state is derived from events, not chat text.

H2.2 — Deterministic replay and immutable run config

Donor: OpenHands
Why: OpenHands explicitly frames deterministic replay and immutable agent configuration as foundational SDK traits. Dante should copy that discipline so runs are reproducible and debuggable.

Build in Dante:
Immutable run config snapshot at start; event log replay tooling; reproducible run-state reconstruction.

Acceptance:
A stored run can be replayed into the same semantic state; config changes after start do not mutate prior runs.

H2.3 — Workspace abstraction and agent server boundary

Donor: OpenHands
Why: OpenHands documents LocalWorkspace, Docker/remote workspaces, and a FastAPI-based agent server with REST and WebSocket endpoints. Dante should harvest the abstraction, not all the weight, so the same agent loop can run locally or in sandboxed remote contexts later.

Build in Dante:
LocalWorkspace, SandboxWorkspace, and a minimal run server API for remote execution.

Acceptance:
Same task logic can target local or sandbox workspace; server can stream run events; workspace type is explicit in receipts.

Tier 3 — Polish harvests

These matter, but only after the fundamentals above are in place.

H3.1 — Thin-client architecture

Donor: Kilo
Why: Kilo’s docs describe the CLI engine as the foundation and clients as thin wrappers communicating via HTTP + SSE. That is a strong model for keeping Dante’s surfaces consistent.

Build in Dante:
CLI/runtime as source of truth; VS Code and future clients consume the same run server.

H3.2 — Cross-surface session sharing

Donors: Kilo, OpenCode
Why: Kilo has /share, /unshare, /fork, /timeline, import/export; OpenCode emphasizes sessions, logs, and shareable project bootstrap. This is useful once Dante’s receipts and observability are reliable.

Build in Dante:
Session share links or export bundles, fork from message/checkpoint, replayable report bundles.

H3.3 — Local review and pre-push review

Donor: Kilo
Why: Kilo documents /local-review and /local-review-uncommitted. Dante should harvest that because it pairs naturally with DanteForge.

Build in Dante:
/review-local, /review-uncommitted, with receipt-backed findings.

4. What Dante should preserve as uniquely Dante

Do not flatten Dante into “another terminal coding agent.” The parts that should remain distinctly Dante are the verification spine, anti-stub philosophy, plain-language reporting for non-technical users, and provider portability. None of the donors own that combination as clearly as Dante’s current vision does. The harvest strategy is to put the donor workflow surfaces in front of Dante’s trust engine, not to replace it.

5. Recommended build order
Phase P0 — Stop lying, start proving

Build:

execution ledger
hard modes
todo/progress board
git-backed restore
auto lint/test loop

This is the highest ROI because it fixes operator trust first, using the strongest ideas from Qwen, OpenCode, Kilo, and Aider.

Phase P1 — Add workflow glue

Build:

native skills + command packs
permissions/policy engine
session observability
GitHub automation

This phase makes Dante daily-drivable and easier to integrate into your repos.

Phase P2 — Harden the runtime substrate

Build:

typed events
immutable run config
deterministic replay
workspace abstraction
minimal agent server boundary

This phase gives Dante the OpenHands-grade backbone it currently lacks.

Phase P3 — Surface polish

Build:

thin-client consistency across CLI/VS Code
share/fork/export UX
local review UX
team/org controls later

This is where Kilo-style polish should enter, but only after Dante’s truth substrate is solid.

6. Launch gates for harvested features

A harvest is not “done” when code exists. It is done when:

the behavior is visible to the operator,
the final report is derived from the execution ledger,
receipts reflect the new behavior,
restore/undo still works,
the feature works in CLI first,
and the public docs no longer overclaim relative to CI or runtime evidence.

That standard fits Dante’s existing release posture and solves the exact credibility gap that still exists today.

7. Final merged recommendation

The best synthesis is:

Qwen for plan/apply/operator visibility,
Aider for git discipline and lint/test closure,
OpenCode for permissions, session ergonomics, AGENTS.md, and GitHub tasking,
OpenHands for events, replay, immutable config, workspaces, and agent server,
Kilo for modes, checkpoints, worktrees, session lifecycle, and polished client architecture.

That is the OSS Universe Harvest Packet: not a grab bag, but a ranked import plan that closes Dante’s weakest dimensions first while preserving the part that can actually make it win.

I can turn this into a Codex-ready OSS Universe Execution Packet next, with exact feature IDs, suggested module/file targets, acceptance tests, and generation order.

please build the codex ready oss universe execution packet

I’m locking the packet to the current public docs for DanteCode, Aider, OpenCode, OpenHands, Kilo, and Qwen so the build order reflects what those tools actually expose today, not stale memory.

Thought for 2m 9s

Below is the Codex-ready OSS Universe Execution Packet. It is optimized for the current DanteCode positioning: CLI as the primary GA surface, VS Code as preview, Desktop as non-ship, with Dante’s moat remaining verification, receipts, provider portability, and plain-language trust for non-technical users. That stays aligned with Dante’s current vision, README, release matrix, and release runbook.

The packet is also grounded in what the main OSS donors actually expose today: Aider’s /ask and /architect modes plus automatic lint/test loops and repo-map usage; OpenCode’s plan agent, AGENTS.md bootstrap, permissions, export/import, and GitHub comment runner; OpenHands’ event-sourced runtime with deterministic replay, immutable config, typed tools, and local/ephemeral workspaces; Kilo’s custom modes, sticky models, checkpoints, worktrees, and code reviews; and Qwen’s approval model, tool schemas, and hooks.

OSS Universe Execution Packet
1. Mission

Make DanteCode usable enough to become the first tool you open on real repos by importing the best control surfaces from the OSS field without diluting Dante’s trust engine. The point is not to mimic any single donor. The point is to combine:

Qwen for approval modes, hooks, and operator clarity.
Aider for git-native discipline, ask/architect separation, and automatic lint/test repair.
OpenCode for plan/build separation, AGENTS.md, permissions, sessions, export/import, MCP auth, and GitHub workflow triggers.
OpenHands for the runtime substrate: typed events, deterministic replay, immutable run config, and workspace abstraction.
Kilo for productization: custom modes, sticky models, checkpoints, worktrees, headless server flow, code reviews, and session sharing/forking.
2. Freeze rules

Do not widen scope while building this packet.

Dante’s public docs already define the right release posture: the CLI is the primary GA target, VS Code is preview, and Desktop is experimental; the release runbook also says release is only complete when the local release checks, provider smoke, first GitHub CI run, publish secrets, and clean-clone README quickstart are all green.

So the freeze rules are:

No Desktop-first work.
No enterprise dashboard work.
No marketplace/ecosystem work.
No new surface feature unless it improves one of four things:
task honesty
recovery/control
runtime verifiability
daily-driver usability
CLI first, then VS Code preview.
Every feature must emit visible receipts or state transitions.
3. Phase order
Phase U0 — Stop lying, start proving

This is the highest ROI phase because Dante’s own vision says the problem is the trust gap between “AI said done” and “it actually works.”

Build in this exact order:

U0-01 execution ledger
U0-02 hard mode system
U0-03 todo/progress board
U0-04 checkpoints and restore
U0-05 lint/test hook loop
Phase U1 — Add operator control

This phase harvests the most practical OpenCode, Kilo, and Qwen ergonomics: permissions, AGENTS.md, skills/commands, observability, and GitHub entrypoints.

Build:

U1-01 policy engine
U1-02 native skills and command packs
U1-03 session observability
U1-04 GitHub runner
Phase U2 — Harden the substrate

This is the OpenHands harvest: typed events, replay, immutable config, workspace abstraction, minimal run server.

Build:

U2-01 typed event bus
U2-02 immutable run config
U2-03 deterministic replay
U2-04 workspace abstraction
U2-05 run server
Phase U3 — Parallelism and polish

This is where Kilo-style worktrees, subagents, review flows, and VS Code preview maturity enter. Kilo’s public docs explicitly surface custom modes, worktrees, checkpoints, code reviews, headless kilo serve, and session share/fork flows.

Build:

U3-01 scoped subagents
U3-02 worktree isolation
U3-03 local review
U3-04 VS Code preview truth surface
4. Feature cards
U0-01 — Execution ledger

Why this exists
Qwen’s approval model, OpenCode’s restricted plan agent, and Kilo’s explicit attempt_completion tool all show the same lesson: the runtime needs a structured notion of “planned,” “executed,” and “complete,” instead of letting the model improvise those claims in prose.

Build

packages/core/src/runtime/run-ledger.ts
packages/core/src/runtime/run-state-machine.ts
packages/core/src/runtime/run-outcome.ts

State model
drafted -> planned -> approved -> started -> proposed -> applied -> verified -> committed
or
drafted -> planned -> approved -> started -> failed -> reported

Acceptance

No report can say “done” unless applied exists.
No guarded success can say “verified” unless verified exists.
“Proposed, not applied” is first-class.
Failure still emits a report.
U0-02 — Hard mode system

Why this exists
Aider exposes /ask and /architect; OpenCode exposes a restricted plan agent; Kilo exposes Architect, Ask, Debug, Orchestrator, and custom modes; Qwen exposes approval modes. Dante needs one visible operator contract across surfaces.

Build

packages/core/src/runtime/mode-kind.ts
packages/core/src/runtime/mode-policy.ts
packages/cli/src/commands/mode.ts
packages/vscode/src/state/current-mode.ts

Required modes

plan
review
apply
autoforge
optional overlays: debug, architect

Acceptance

plan cannot mutate files or run mutating shell commands.
Mode is always visible in CLI prompt and VS Code header.
Mode change is explicit.
/party, /forge, /magic must declare mode before work begins.
U0-03 — Todo/progress board

Why this exists
Qwen and Kilo both make multi-step work more inspectable by exposing structured progress and completion boundaries instead of a single blob of assistant text.

Build

packages/core/src/runtime/run-plan.ts
packages/cli/src/views/todo-board.ts
packages/vscode/src/views/todo-board.ts

Storage
.dantecode/runs/<run-id>/todo.json

Acceptance

Auto-created for 3+ step tasks.
Every completed task must link to ledger evidence.
Final report shows completed, pending, and failed items separately.
U0-04 — Checkpoints and restore

Why this exists
Aider emphasizes /undo and git discipline; Kilo documents checkpoints, worktrees, and git-based rollback; OpenCode documents session export/import and strong project bootstrap habits. Dante needs recovery before it adds autonomy.

Build

packages/git-engine/src/checkpoints/checkpoint-store.ts
packages/git-engine/src/checkpoints/restore-run.ts
packages/cli/src/commands/restore.ts
packages/cli/src/commands/timeline.ts

Acceptance

Restore by run ID or checkpoint ID.
Diff preview before restore.
Recovery survives restart.
Checkpoint metadata is attached to run receipts.
U0-05 — Lint/test hook loop

Why this exists
Aider’s docs explicitly say it can automatically lint and test after edits, and Qwen’s Hooks system now documents lifecycle scripts like test-before-commit and auto-format-after-generation. That is a direct daily-driver usability win.

Build

packages/core/src/hooks/hook-kind.ts
packages/core/src/hooks/hook-runner.ts
packages/cli/src/commands/hooks.ts

Hook points

before-plan
before-apply
after-apply
before-commit
after-commit
on-failure
on-report
on-run-end

Acceptance

Project config can bind shell commands to hooks.
Hook failures are visible and receipted.
Lint/test output is attached to the run.
U1-01 — Policy engine

Why this exists
OpenCode’s permissions are concrete: ask, allow, deny for tools like edit, bash, and webfetch, with per-agent overrides. Kilo’s custom modes also emphasize safety by restricting files and commands, including fileRegex-scoped editing. Dante needs that runtime fence.

Build

packages/core/src/policy/policy-schema.ts
packages/core/src/policy/policy-engine.ts
packages/cli/src/commands/policy.ts

Acceptance

Per-tool policy.
Per-command-pattern policy.
Per-path or file-regex policy.
Per-mode and per-subagent overrides.
Policy decisions visible in receipts.
U1-02 — Native skills and command packs

Why this exists
Dante already imports skills from Claude Code, Continue, and OpenCode. Qwen, OpenCode, and Kilo all show that native reusable skills, commands, or modes become a real workflow layer once they are first-class, project-local, and shareable.

Build

packages/skill-adapter/src/dante-skill-schema.ts
packages/skill-adapter/src/dante-command-schema.ts
packages/cli/src/commands/skills.ts
packages/cli/src/commands/run-command.ts

Directories

~/.dantecode/skills/
.dantecode/skills/
.dantecode/commands/

Acceptance

Auto-discover project and global skills.
Normalize imported skills into one Dante schema.
Skill execution is receipted and reportable.
U1-03 — Session observability

Why this exists
OpenCode exposes session export/import and stats; Kilo exposes session sharing/forking and CLI/headless/server commands; Qwen emphasizes operator visibility through its tools and workflow docs. Dante needs /context, /export, /insight, /sessions, and /stats as one coherent layer.

Build

packages/core/src/analytics/session-stats.ts
packages/core/src/analytics/context-breakdown.ts
packages/cli/src/commands/export.ts
packages/cli/src/commands/insight.ts
packages/cli/src/commands/context.ts
packages/cli/src/commands/sessions.ts

Acceptance

Export includes provider, model, receipts, files touched, and final outcome.
Context command shows token pressure by file/source.
Insight command surfaces repeated failure classes and most-used skills.
U1-04 — GitHub runner

Why this exists
OpenCode documents issue/PR comment triggers via /opencode or /oc in GitHub Actions. Kilo documents automated code reviews on PRs and MRs. Dante should harvest the narrowest useful version first: bounded GitHub-triggered tasks with receipts.

Build

packages/github-runner/src/action-entry.ts
.github/actions/dantecode/action.yml
.github/workflows/dantecode.yml

Acceptance

Repo can install Dante runner.
Comment or workflow dispatch can launch bounded run.
Results return as PR comment/check artifact with receipt summary.
U2-01 — Typed event bus

Why this exists
OpenHands explicitly documents an event-sourced state model, typed tools, and deterministic replay. This is the cleanest donor for Dante’s long-term truth substrate.

Build

packages/core/src/events/event-kind.ts
packages/core/src/events/event.ts
packages/core/src/events/event-bus.ts

Initial event kinds

run.drafted
run.mode.changed
action.requested
action.started
action.succeeded
action.failed
verification.completed
report.emitted
subagent.handoff
checkpoint.created

Acceptance

UI state derives from events.
Reports derive from events + ledger.
No user-facing status is free-written without event support.
U2-02 — Immutable run config

Why this exists
OpenHands’ SDK paper explicitly calls out immutable configuration for agents. Dante needs the same discipline so runs are reproducible and debugging doesn’t mutate history.

Build

packages/core/src/runtime/run-config.ts
packages/core/src/runtime/run-config-snapshot.ts

Acceptance

Provider/model/mode/policy/workspace are snapshotted at run start.
Later config changes do not alter prior runs.
U2-03 — Deterministic replay

Why this exists
OpenHands highlights deterministic replay as a core property of its SDK. Dante should borrow that directly under DanteForge.

Build

packages/core/src/replay/replay-run.ts
packages/core/src/replay/replay-reader.ts

Acceptance

Stored run can reconstruct semantic state from events + config.
Replay output matches recorded ledger state.
U2-04 — Workspace abstraction

Why this exists
OpenHands documents both local-machine workspaces and ephemeral workspaces through an Agent Server. Dante should separate workspace choice from task logic now, even if local is the only production target at first.

Build

packages/core/src/workspace/workspace.ts
packages/core/src/workspace/local-workspace.ts
packages/core/src/workspace/sandbox-workspace.ts

Acceptance

Same agent loop can target local or sandbox workspace.
Workspace type is shown in run receipt.
U2-05 — Minimal run server

Why this exists
OpenHands exposes Python and REST APIs and a server boundary; Kilo also documents kilo serve and a thin-client pattern. Dante should create the minimum server needed so CLI and VS Code consume the same runtime truth.

Build

packages/server/src/http.ts
packages/server/src/ws.ts
packages/server/src/routes/runs.ts

Acceptance

Start run, stream events, fetch report, restore checkpoint.
CLI still works offline/local without server dependency.
U3-01 — Scoped subagents

Why this exists
Qwen’s public repo emphasizes Skills and SubAgents; OpenHands is designed for multi-agent tasks; Kilo exposes multiple task-oriented modes and worktree-based multi-session execution. Dante should make subagents real permission boundaries, not just prompt roles.

Build

packages/core/src/subagents/subagent-schema.ts
packages/core/src/subagents/subagent-runner.ts

Initial subagents

planner
implementer
tester
reviewer
docs

Acceptance

Each subagent has its own context, policy, tools, and receipt stream.
Parent run shows child progress and final handoff result.
U3-02 — Worktree isolation

Why this exists
Kilo’s docs explicitly describe isolated worktrees under .kilocode/worktrees/ and git-based parallel task execution. Dante should use the same idea for multi-run safety.

Build

packages/git-engine/src/worktrees/create-worktree.ts
packages/git-engine/src/worktrees/list-worktrees.ts
packages/git-engine/src/worktrees/cleanup-worktree.ts

Acceptance

Concurrent runs can isolate filesystem changes.
Worktree metadata is attached to receipts.
U3-03 — Local review

Why this exists
Kilo’s code-review docs show a strong pattern: structured feedback across performance, security, style, and test coverage on code changes. Dante should harvest the local equivalent and pipe it through DanteForge.

Build

packages/danteforge/src/review/local-review.ts
packages/cli/src/commands/review-local.ts
packages/cli/src/commands/review-uncommitted.ts

Acceptance

Review against staged, unstaged, or checkpoint diff.
Output is structured and receipted.
U3-04 — VS Code preview truth surface

Why this exists
Dante’s own release matrix says VS Code is preview. That means the VS Code goal is not feature sprawl; it is accurate presentation of mode, task state, receipts, restore points, and subagent activity.

Build

packages/vscode/src/views/run-header.ts
packages/vscode/src/views/receipt-panel.ts
packages/vscode/src/views/checkpoint-panel.ts

Acceptance

Current mode always visible.
Task board visible.
Receipt summary visible.
Restore/checkpoint flow works from preview UI.
5. Defer list

Do not spend early cycles on these:

Desktop polish
team analytics dashboards
full extension marketplace
multi-IDE expansion beyond current preview path
public cloud agent productization
enterprise governance surfaces

Those are all legitimate later harvests from Kilo/OpenHands, but they are not the shortest path to making Dante the first tool you open. Kilo’s docs clearly show much broader team, cloud, analytics, and review surfaces, but Dante’s own current public positioning is narrower and should stay narrower until the trust/control substrate is stable.

6. Ship gates for this packet

Call the packet successful only when all of these are true:

CLI can run in plan, review, apply, and autoforge.
Final reports are generated from ledger + events, not free text.
Restore/checkpoint works.
Hooked lint/test results are visible.
Policy engine blocks forbidden actions.
Export/context/insight work.
GitHub runner can execute bounded tasks.
Replay reconstructs prior run state.
VS Code preview surfaces truthful status.
Release runbook gates still remain satisfied: local release checks, provider smoke, first GitHub CI run, publish secrets, and clean-clone README quickstart.
7. Codex operator brief
Project: DanteCode
Branch target: current working branch
Mission: import the highest-ROI control/runtime patterns from Qwen, Aider, OpenCode, OpenHands, and Kilo without diluting Dante’s trust moat.

Non-negotiables:
1. Dante remains verification-first and report-first.
2. CLI is primary; VS Code is preview; Desktop is out of scope.
3. No feature may claim success unless backed by the execution ledger.
4. Every new user-visible status must derive from typed events and/or the run ledger.
5. Keep changes atomic: 1–4 files per implementation prompt whenever possible.
6. Prefer deleting ambiguity over adding capability.

Build order:
U0-01 execution ledger
U0-02 hard modes
U0-03 todo/progress board
U0-04 checkpoints/restore
U0-05 lint/test hooks
U1-01 policy engine
U1-02 native skills/commands
U1-03 session observability
U1-04 GitHub runner
U2-01 typed event bus
U2-02 immutable run config
U2-03 deterministic replay
U2-04 workspace abstraction
U2-05 minimal run server
U3-01 scoped subagents
U3-02 worktree isolation
U3-03 local review
U3-04 VS Code preview truth surface

Definition of done:
- no “done/fixed/implemented” claim without applied state
- no “verified” claim without verified state
- restore works
- run export works
- policy engine works
- replay works
- CLI truth surface works end to end
8. First prompt to give Codex
Implement U0-01 only.

Create a run ledger and strict run state machine for DanteCode.
Requirements:
- Canonical states: drafted, planned, approved, started, proposed, applied, verified, committed, failed, reported
- Final report text must be generated from ledger state, not model prose
- Add unit tests that prove:
  1) no success wording without applied
  2) no verified wording without verified
  3) proposed-not-applied is first-class
  4) failure still emits a reportable outcome
- Keep changes isolated to runtime/core layers only
- Do not add UI yet
- Return touched files, tests added, and any follow-on blockers

The shortest path is still the same: fix Dante’s truth surface first, then add OpenCode/Kilo/Qwen usability, then wire in OpenHands-grade runtime structure. That preserves the one thing the other tools do not own as clearly: trust the receipt, not the model’s claim.