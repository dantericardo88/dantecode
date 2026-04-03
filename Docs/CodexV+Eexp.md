Dante Skills & Donor Integration — V+E PRD Masterplan
0. Executive verdict

Yes — there is a real product worth building here, but it should be built as a standards-based Dante skills layer, not as a pile of random OSS imports.

DanteCode’s current public vision is already sharp: it is a coding agent for people who cannot read code, and its moat is verification, receipts, PDSE, anti-stub checks, and plain-language run reports, not generic code generation. The public repo also already defines the correct release shape: CLI is the primary GA surface, VS Code is preview, Desktop is experimental/non-ship. Any new integration should strengthen that wedge, not blur it.

The highest-value thing to include now is Agent Skills compatibility and a native Dante skills runtime. The Agent Skills spec defines a portable folder format centered on SKILL.md, optional scripts/, references/, and assets/, plus metadata like name, description, compatibility, and experimental allowed-tools. Hugging Face’s skills repo already uses that format and explicitly positions itself as interoperable with Codex, Claude Code, Gemini CLI, and Cursor. That makes this the cleanest interoperability layer Dante can add without losing its identity.

The rest should be separated by role:

Core architecture: Agent Skills support, policy mapping, verification-aware execution, native skill registry.
Extension layer: curated Dante skill packs, selected Hugging Face skill adapters, selected converted specialist agents.
Research/doctrine: agenticSeek, Agentic Design Patterns, donor notes, harvest matrices.

That separation is the difference between a strong product and a bloated repo. The recommendation to keep agenticSeek out of core is an inference based on its broad local-Manus scope and GPL-3.0 license, while agency-agents is better suited as an optional pack because it is MIT-licensed and already designed as reusable specialist agents for tools like Claude Code and others.

1. Product name

Dante Skills Runtime and Interop Layer

2. Product problem

Non-technical users can ask DanteCode to build something, but the product becomes dramatically more valuable if it can also:

discover reusable task skills,
import external skill formats,
execute them under Dante’s verification and policy engine,
preserve portability across models and tools.

That aligns directly with DanteCode’s current public vision: portable by default, verification first, honest failure reporting, and no lock-in across providers or workflows.

Today, there is already a growing ecosystem of portable agent instructions and specialist agent packs:

the Agent Skills open format,
the Hugging Face Skills repository built on that format,
specialized role packs like agency-agents,
and broader agent-pattern doctrine such as Agentic Design Patterns.

The gap is that Dante does not yet appear to expose a public, standards-based, verification-aware skills platform that can absorb these sources cleanly. That is the hole this PRD closes.

3. Product objective

Build a verification-aware skills runtime for DanteCode that:

reads and executes native Dante skills,
imports and exports Agent Skills-compatible skills,
optionally installs/uses curated external skills,
maps skill permissions into Dante policy,
preserves receipts and plain-language reports,
keeps the CLI as the primary truth surface.

This objective is consistent with the current DanteCode product thesis and with the way Hugging Face Skills and the Agent Skills spec define portable skill packaging.

4. Scope: what should be included
4.1 Core DanteCode repo — include now
A. Native Dante skills runtime

This belongs in core.

It should support:

local project skills,
user/global skills,
skill discovery,
skill activation,
skill execution under Dante policy,
skill receipts,
skill verification summaries.

This is the highest-priority inclusion because Agent Skills are defined as a portable directory format, and Dante’s own product vision explicitly values portability and verification.

B. Agent Skills compatibility layer

This belongs in core.

Dante should:

read standard SKILL.md,
parse frontmatter,
honor name, description, compatibility, metadata,
map allowed-tools into Dante’s policy engine,
execute optional scripts/ and use references/ and assets/ as context.

This is the single cleanest standards move because the format is already public and tool-agnostic, and Hugging Face is already shipping cross-tool skills built on it.

C. Verification-aware skill execution

This belongs in core.

Every skill run must be subject to:

run ledger state,
permissions/policy,
receipts,
plain-language run report,
anti-stub/verification gates where relevant.

This is not stated by the Agent Skills spec itself; it is the Dante-specific enforcement layer and the thing that keeps Dante from becoming “just another skill runner.” This is an inference from Dante’s public verification-first thesis.

D. Skill registry and resolution

This belongs in core.

Dante should resolve skills from:

.dantecode/skills/
$HOME/.dantecode/skills/
standard Agent Skills-compatible directories such as .agents/skills when enabled
imported skill packs cached into Dante-managed locations

This is a product inference based on the Agent Skills spec and Hugging Face’s explicit interoperability goal.

4.2 Dante extension repo or package — include as optional packs
A. Hugging Face skill adapters / curated bundles

Do not dump the entire Hugging Face skills repo into Dante core.

Instead:

support installation/import of selected skills,
provide curated Dante-approved packs,
preserve original metadata/license/provenance.

Hugging Face’s repo is explicitly a shared repository of AI/ML task skills and is Apache-2.0 licensed, which makes interoperability and selective reuse easier, but most of those skills are domain-specific and should not bloat Dante’s default install.

B. Converted agency-agents specialist packs

Do not put the whole agency-agents repo in core runtime.

Instead:

convert selected useful roles into Dante specialist packs,
keep them optional,
attach provenance and tags,
allow activation as subagents or skill-driven helpers.

This is the right fit because agency-agents is MIT-licensed and explicitly designed to be copied into agent directories for Claude Code and adapted to other tools, but it is broad and personality-heavy, which makes it better as an optional extension layer than as Dante’s core runtime.

Suggested first conversions:

technical writer
backend architect
frontend implementer
DevOps/CI specialist
reviewer / reality-checker

That recommendation is an inference from the agency-agents roster and Dante’s current needs.

4.3 Research / doctrine only — do not integrate directly into core
A. agenticSeek

This does not belong in DanteCode core.

It is valuable as a donor for:

local-first autonomy,
browser task execution,
multi-step planning,
agent selection ideas.

But it is explicitly positioned as a fully local Manus alternative with broad autonomous browsing/coding/planning scope, and it is GPL-3.0 licensed. That makes it a poor fit for direct code incorporation into Dante core and a much better fit as a research donor only.

B. Agentic Design Patterns

This does not belong as code.

It belongs as:

architecture doctrine,
pattern checklist,
PRD validation matrix,
missing-pattern audit.

The book is positioned as a practical guide to agentic systems with chapters on Prompt Chaining, Routing, Parallelization, Reflection, Planning, Multi-Agent Collaboration, Memory Management, MCP, Human-in-the-Loop, Exception Handling and Recovery, and Guardrails/Safety. That makes it very useful as a design-review framework.

5. Non-goals

This PRD does not include:

vendoring whole donor repos into Dante core,
copying GPL code from agenticSeek,
making Dante a generic desktop/voice/web agent platform,
building a public marketplace before the runtime is stable,
expanding Desktop as part of this work,
replacing DanteForge with third-party agent logic.

Those exclusions follow from Dante’s current product vision and release scope, plus the licensing/scope profile of the donor repos.

6. Users

Primary users:

founders,
operators,
non-technical builders,
technical users who want governed, portable, reusable workflows.

That is directly aligned with DanteCode’s public vision, which says the product is built for people who cannot read code and need trustworthy AI output.

Secondary users:

power users building reusable Dante skills,
your own internal workflows,
future community contributors of optional skill packs.

This is an inference from the standards-based skills approach and existing agent ecosystems.

7. Product requirements
7.1 Functional requirements
FR-1 — Native skill discovery

Dante must discover skills from project-local and user-global directories.

Minimum required directories:

.dantecode/skills/
$HOME/.dantecode/skills/

Optional compatible directories:

.agents/skills
other explicitly configured import paths
FR-2 — Agent Skills parser

Dante must parse:

SKILL.md frontmatter,
required name,
required description,
optional license,
optional compatibility,
optional metadata,
optional allowed-tools,
optional scripts/, references/, assets/.

These requirements come directly from the Agent Skills specification.

FR-3 — Dante policy mapping

allowed-tools and compatibility metadata must map into Dante policy rules and execution permissions.

This is a Dante-specific enforcement layer, inferred from the Agent Skills spec plus the need to preserve Dante’s trust and control model.

FR-4 — Skill execution ledger

Every skill run must produce:

run ID,
mode,
files touched,
commands run,
verification outcome,
failure reason or success summary,
plain-language report.

This flows directly from Dante’s public product thesis.

FR-5 — Skill import/export

Dante must:

import standard Agent Skills,
export Dante-native skills in an Agent Skills-compatible form where possible,
preserve provenance and licensing metadata.
FR-6 — Skill activation UX

CLI commands should include:

/skills
/skill <name>
/skill-info <name>
/skill-install <source>
/skill-disable <name>

These commands are a product recommendation, not a currently documented Dante feature.

FR-7 — Specialist packs

Dante must support optional role packs derived from sources like agency-agents, but they must be:

optional,
tagged,
provenance-stamped,
non-core.
FR-8 — Curated bundle install

Dante should support curated external bundles, especially:

Hugging Face skill bundles,
internal private skill bundles,
converted specialist bundles.

That recommendation is supported by Hugging Face’s interoperable skills repository and agency-agents’ tool-adaptation model.

7.2 Non-functional requirements
NFR-1 — Verification first

No skill may bypass Dante verification and receipts.

NFR-2 — Crash-safe reporting

Skill runs must still emit a failure report on crash or interruption.

NFR-3 — Provenance

Every imported or converted skill must retain:

source,
original name,
version if available,
license,
local conversion date.
NFR-4 — Clean-room separation

Research donors and code donors must be separated.

This matters especially for GPL-licensed donors like agenticSeek.

NFR-5 — CLI first

All core skills flows must work in the CLI before VS Code preview gets feature parity.

That follows Dante’s release matrix.

8. Repo structure
8.1 Core repo additions

Suggested structure:

packages/skills-runtime/
packages/skills-registry/
packages/skills-policy/
packages/skills-import/
packages/skills-export/

Suggested config/data folders:

.dantecode/skills/
.dantecode/skill-packs/
.dantecode/skills.lock
.dantecode/skills-cache/
8.2 Separate extension repo

Suggested separate repo or package family:

dante-skills-packs
dante-skills-contrib
dante-agents-packs

This repo would hold:

curated HF adapters,
converted agency-agents packs,
company-specific private packs.
8.3 Research repo or folder

Suggested separate location:

docs/research/skills/
docs/research/donors/
docs/research/agent-patterns/

That is where agenticSeek notes and Agentic Design Patterns mapping should live.

9. Architecture
9.1 Skill lifecycle
Discover skill
Parse metadata
Validate schema
Resolve permissions
Resolve runtime dependencies
Execute in current mode
Capture events + receipts
Run verification
Emit plain-language report
Store skill outcome in run history
9.2 Core contracts
Skill manifest contract

Source: Agent Skills-compatible frontmatter.

Dante execution contract

Adds:

run mode,
trust state,
ledger state,
verification outcome,
evidence refs.
Skill provenance contract

Must include:

sourceType (native, hf, agency-converted, imported, private)
sourceRef
license
conversionNotes
9.3 Policy model

Suggested policy levels:

allow
ask
deny

Suggested scope:

per skill,
per tool,
per command pattern,
per path,
per runtime mode.

This is a recommendation based on OpenCode/Kilo/Qwen-style donor patterns, not a currently documented Dante behavior.

10. Verification + Enforcement

This is the V+E heart of the plan.

V-1 — Schema verification

Every imported skill must validate against Dante’s accepted skill schema.

V-2 — Provenance verification

Every non-native skill must carry source + license metadata.

V-3 — Runtime enforcement

allowed-tools, compatibility, and Dante policy must be enforced before execution.

V-4 — Receipt enforcement

Every skill invocation must produce a receipt.

V-5 — Plain-language reporting

Every skill outcome must be understandable without code inspection.

V-6 — Failure honesty

A failed or partial skill run must say that explicitly.

This is fully aligned with Dante’s public principles of verification first, honest failure reporting, and plain-language surface.

11. What belongs in v1

V1 should include only:

native Dante skills runtime
Agent Skills import/parse/execute support
policy mapping for skills
receipts and reports for skill runs
project-local and global skill directories
curated install of selected skill packs
provenance + license tracking

V1 should not include:

a public marketplace,
automatic ingestion of all donor repos,
voice/web desktop agent expansion,
community pack browsing UI,
heavy team/org control planes.

That keeps the scope consistent with Dante’s current release posture and the product wedge.

12. What belongs in v2

V2 can include:

skill pack repo and installer
converted agency-agents specialist packs
richer skill analytics
share/export of skill runs
skill recommendations
subagent-specialist routing
GitHub-triggered skill workflows
13. What belongs in research only

Research-only tracks:

agenticSeek donor analysis,
pattern audit against Agentic Design Patterns,
licensing and interoperability studies,
future browser/web task agents.

This is because agenticSeek is broad and GPL-3.0, and the book is doctrine, not code.

14. Phase plan
Phase 0 — Foundation

Build:

Dante native skill schema
Agent Skills parser
discovery from project/global directories
validation and provenance storage
Phase 1 — Execution

Build:

skill run ledger integration
policy mapping
receipts
plain-language skill reports
Phase 2 — Interop

Build:

Agent Skills import/export
Hugging Face skill installer
curated pack manifest
Phase 3 — Extension packs

Build:

converted agency-agents packs
private company packs
skill tagging and search
Phase 4 — Advanced routing

Build:

specialist selection
subagent-skill mapping
future skill recommendations
15. Acceptance criteria

This PRD is complete when:

Dante can discover and run native skills.
Dante can import an Agent Skills-compliant skill.
Dante respects metadata and permissions at runtime.
Every skill run emits receipts and a plain-language report.
A selected Hugging Face skill can be installed and executed through Dante.
At least one converted agency-agents specialist pack works as an optional extension.
No GPL donor code is directly incorporated.
CLI flow works before VS Code preview flow.
Docs, behavior, and receipts agree.

The CLI-first requirement is directly supported by the release matrix.

16. Risks

Main risks:

R-1 — Scope bloat

If you import too many donor repos directly, Dante becomes a junk drawer.

R-2 — License contamination

Direct incorporation of GPL donor code would create unnecessary risk; agenticSeek is the clearest example.

R-3 — Losing Dante’s identity

If skills become just prompt packs without verification, Dante loses its moat.

R-4 — Over-indexing on personality agents

agency-agents is useful, but too much personality-first packaging could dilute coding-product clarity. That is an inference based on the repo’s positioning.

17. Final recommendation

The best masterplan is:

Build Agent Skills support into Dante core, build optional pack layers outside core, keep research donors out of runtime, and make every skill run pass through Dante’s verification and reporting engine.

That gives you:

standards compatibility,
portability,
future ecosystem growth,
optional specialist packs,
and zero compromise on Dante’s actual wedge.

If you want, I’ll turn this into a Codex-ready V+E execution packet with exact module/file targets and generation order.

Please create the Codex Ready V+E Execution Packet too

I’m turning the masterplan into an execution packet now with a hard build order, acceptance gates, and donor-specific harvest rules tied back to the current DanteCode repo and the Agent Skills/HF Skills standards layer.

Thought for 1m 10s
Dante Skills Integration — Codex-Ready V+E Execution Packet
0. Build objective

Build a verification-aware skills runtime for DanteCode that keeps Dante’s core identity intact: a coding agent that writes, edits, and verifies code across providers, with git-aware edits, provider routing, skill imports, and a verification layer meant to close the trust gap for people who cannot audit code themselves. The current repo also already fixes the release posture you should preserve while doing this work: CLI is the primary GA surface, VS Code is preview, Desktop is experimental/non-ship.

This packet is built around the open Agent Skills standard and Codex/Hugging Face interoperability, not around copying donor repos wholesale. Codex’s official docs define a skill as a directory with SKILL.md plus optional scripts/, references/, assets/, and optional agents/openai.yaml, with discovery in .agents/skills locations; Hugging Face’s Skills repo explicitly follows the standardized Agent Skills format and is designed to work across Codex, Claude Code, Gemini CLI, and Cursor.

1. Scope freeze

Keep the work inside this box:

Native Dante skills runtime
Agent Skills import/export compatibility
Verification-aware skill execution
Skill policy mapping
Project/global skill discovery
Curated optional skill-pack installation
Provenance and license tracking

Do not spend cycles here yet:

Desktop work
Public marketplace UI
Team/org analytics
Full donor-repo vendoring
Direct GPL code incorporation
Generic browser/desktop assistant expansion

That split is justified by Dante’s current release scope, by the Agent Skills portability model, by Hugging Face’s cross-agent skill ecosystem, and by the fact that agency-agents is MIT-licensed while agenticSeek is GPL-3.0 and positioned as a broad local Manus-style assistant rather than a focused verification-first coding substrate.

2. Product contract

Dante must remain:

verification first
model portable
skill portable
plain-language on the surface
CLI-first in reality

That is not optional. Dante’s public vision says the unsolved problem is the trust gap, the moat is verification rather than generation, and the target user is someone who cannot read code. Skills must reinforce that, not turn Dante into a generic prompt warehouse.

3. Core repo structure to build

Create or extend these packages:

packages/skills-runtime/
packages/skills-registry/
packages/skills-policy/
packages/skills-import/
packages/skills-export/

Create or use these runtime folders:

.dantecode/skills/
.dantecode/skill-packs/
.dantecode/skills.lock
.dantecode/skills-cache/

Supported discovery roots in v1:

project-local .dantecode/skills/
user-global ~/.dantecode/skills/
optional compatible import roots such as .agents/skills

Codex already scans .agents/skills from repository, user, admin, and system scopes, and Agent Skills are explicitly designed as portable folders containing SKILL.md and optional supporting directories. That makes .agents/skills compatibility a high-value interop target even if Dante keeps .dantecode/skills/ as its own native home.

4. Runtime contract

Every skill run must emit:

run ID
skill name
source type
source ref
license
mode
workspace type
tools used
files touched
commands run
verification outcome
plain-language summary
failure reason if incomplete
receipt/evidence refs

This is Dante-specific enforcement layered on top of the open skill format. The open spec gives you the portable package shape; Dante must add the trust surface. The reason is straight from Dante’s own public thesis: users must trust the receipt, anti-stub scan, PDSE score, and run report rather than the model’s claim.

5. Phase plan
Phase S0 — Foundations
S0-01 — Dante skill schema

Build a native Dante schema that can fully represent:

native skills
imported Agent Skills
converted optional packs
provenance/license data
Dante policy mapping

Create:

packages/skills-runtime/src/dante-skill.ts
packages/skills-runtime/src/skill-provenance.ts
packages/skills-runtime/src/skill-source-type.ts

Acceptance:

supports native, agent-skills, hf, agency-converted, private-pack
preserves source + license metadata
can represent optional allowed-tools, compatibility, and generic metadata

The underlying fields are anchored in the Agent Skills spec, which defines optional compatibility, metadata, and experimental allowed-tools.

S0-02 — Agent Skills parser

Create:

packages/skills-import/src/parse-skill-md.ts
packages/skills-import/src/parse-frontmatter.ts
packages/skills-import/src/validate-agent-skill.ts

Acceptance:

parses required name and description
parses optional compatibility, metadata, allowed-tools
discovers optional scripts/, references/, assets/
rejects malformed skills with clear errors

Codex’s official docs and the Agent Skills spec align on this package shape: SKILL.md is required, and scripts/, references/, assets/ are optional.

S0-03 — Discovery and registry

Create:

packages/skills-registry/src/discover-skills.ts
packages/skills-registry/src/skill-registry.ts
packages/skills-registry/src/resolve-skill-precedence.ts

Acceptance:

scans .dantecode/skills/
scans ~/.dantecode/skills/
optionally scans .agents/skills
resolves duplicate names deterministically
tracks origin scope in registry state

Codex does not merge same-name skills automatically, and it scans multiple repository/user/admin/system locations. Dante should preserve origin/scope instead of pretending collisions do not exist.

Phase S1 — Policy and execution
S1-01 — Skill-to-policy mapper

Create:

packages/skills-policy/src/map-allowed-tools.ts
packages/skills-policy/src/map-compatibility.ts
packages/skills-policy/src/skill-policy-check.ts

Acceptance:

allowed-tools maps into Dante policy
unsupported requested tools fail safely
compatibility can trigger preflight warnings
experimental allowed-tools is treated cautiously

The spec explicitly says allowed-tools is experimental and support varies by implementation, so Dante should treat it as advisory input to policy, not blind execution authority.

S1-02 — Skill run executor

Create:

packages/skills-runtime/src/run-skill.ts
packages/skills-runtime/src/skill-run-context.ts
packages/skills-runtime/src/skill-run-result.ts

Acceptance:

executes skills in current Dante mode
records tools/files/commands used
returns structured result even on failure
supports instruction-only skills and skills with scripts

Codex’s docs explicitly recommend instruction-only as the default and scripts only when deterministic behavior or tooling is needed. Dante should preserve that default.

S1-03 — Verification-aware skill receipts

Create:

packages/skills-runtime/src/skill-receipt.ts
packages/skills-runtime/src/skill-report.ts
packages/skills-runtime/src/skill-ledger-link.ts

Acceptance:

every skill run emits a receipt
every skill run emits a plain-language report
report says “proposed” vs “applied” vs “verified” correctly
failure is explicit, not softened

This is the Dante moat layer, derived from the repo’s public trust thesis, not from the open skill spec itself.

Phase S2 — CLI truth surface
S2-01 — Skill commands

Create:

packages/cli/src/commands/skills.ts
packages/cli/src/commands/skill-info.ts
packages/cli/src/commands/skill-install.ts
packages/cli/src/commands/skill-disable.ts

Recommended commands:

/skills
/skill <name>
/skill-info <name>
/skill-install <source>
/skill-disable <name>

Acceptance:

list available skills with source and scope
inspect skill metadata
enable/disable without deleting
install selected skill into managed location

Codex itself exposes /skills, explicit invocation, and $skill-installer; matching that mental model makes Dante easier to operate and easier to cross-train between tools.

S2-02 — Skill install sources

Implement support for:

local path
git repo path
curated HF pack manifest
Dante private bundle manifest

Do not implement full public marketplace UI yet.

Acceptance:

install selected HF skill by manifest entry
install local/private pack
preserve provenance in lock/cache files

Hugging Face’s repo is explicitly a shared repository of interoperable skills, with install paths for Claude Code and Codex and fallback AGENTS.md support.

Phase S3 — Import/export interoperability
S3-01 — Agent Skills export

Create:

packages/skills-export/src/export-agent-skill.ts
packages/skills-export/src/render-skill-md.ts

Acceptance:

export Dante-native skill to Agent Skills-compatible folder where possible
preserve metadata and provenance
emit warnings when Dante-only policy/verification fields cannot be represented natively
S3-02 — Codex-compatible layout support

Create:

packages/skills-export/src/export-to-agents-skills.ts

Acceptance:

can emit to .agents/skills/<skill-name>/
exported skill is discoverable by Codex-compatible layout rules
skill remains usable by Dante after round-trip import/export

This directly targets Codex’s documented repository and user discovery locations.

Phase S4 — Curated pack layer
S4-01 — Hugging Face curated integration

Create:

packages/skills-import/src/hf-manifest.ts
packages/skills-import/src/install-hf-skill.ts

Acceptance:

installs selected HF skill or curated pack
records source repo, original name, and license
refuses silent bulk import of the whole HF repo

HF Skills are Apache-2.0 and explicitly interoperable across major coding agents, but the catalog is broad and AI/ML-specific; selective install is the right v1 behavior.

S4-02 — Optional specialist packs

Create a separate extension repo or package family, not core, for converted specialist agents.

Suggested targets:

dante-skills-packs
dante-agent-packs

First conversions:

reviewer / reality-checker
technical writer
backend architect
frontend implementer
CI / release specialist

agency-agents is MIT-licensed and explicitly designed as reusable specialized agents for Claude Code and other tools, so it is a strong donor for optional packs, not for core runtime code.

Phase S5 — Research-only lane

Keep these out of core implementation:

direct agenticSeek code integration
broad local-Manus/browser agent scope
book content as runtime dependency

Use them only for:

donor notes
architecture checklists
future task-planning/browser lanes

agenticSeek is GPL-3.0 and positioned as a fully local Manus alternative that autonomously browses the web, writes code, plans tasks, and allocates the best agent automatically; that makes it a research donor, not a safe core import for this packet. Agentic Design Patterns is useful doctrine, but not code.

6. Acceptance gates

Call this packet complete only when all of these are true:

Dante discovers native skills from project and user scopes.
Dante imports an Agent Skills-compliant skill successfully.
Dante maps skill metadata into policy safely.
Dante emits receipts and plain-language reports for every skill run.
Dante exports a compatible skill layout usable in .agents/skills.
Dante installs at least one selected HF skill through the managed installer path.
Dante preserves provenance and license metadata for every imported skill.
At least one optional specialist pack works from the separate extension layer.
CLI flow works end to end before VS Code preview parity is attempted.
Existing Dante release gates still hold: release:doctor, release:check, real provider smoke, green CI on first push, publish secrets, and clean-clone README quickstart.
7. Failure codes

Use these so Codex/Claude cannot hide ambiguity:

SKILL-001 malformed SKILL.md
SKILL-002 missing required name
SKILL-003 missing required description
SKILL-004 unsupported tool requested by skill
SKILL-005 compatibility preflight failed
SKILL-006 provenance/license missing
SKILL-007 receipt emission failed
SKILL-008 export lost required metadata
SKILL-009 install source not trusted/allowed
SKILL-010 skill reported success without applied or verified state
8. Suggested repo split
DanteCode core

Include:

native skills runtime
registry
parser/importer
exporter
policy mapper
skill receipts/reports
Separate extension repo/package

Include:

curated HF adapters
converted agency-agents packs
your own private company packs
Research/docs lane

Include:

agenticSeek harvest notes
Agentic Design Patterns notes
donor comparisons
licensing notes

That split keeps DanteCode focused while still letting you learn from the broader ecosystem. It also avoids mixing optional content packs and research donors into the runtime core.

9. Codex operator brief
Project: DanteCode
Track: Dante Skills Integration
Mode: approvals-first, implementation-first, docs-second

Mission:
Build a verification-aware native skills runtime for DanteCode with Agent Skills compatibility and Codex-compatible export/discovery support.

Do not:
- vendor whole donor repos into core
- import GPL code
- expand Desktop
- build public marketplace UI
- treat docs as done if behavior is not implemented

Build order:
S0-01 Dante skill schema
S0-02 Agent Skills parser
S0-03 discovery and registry
S1-01 skill-to-policy mapper
S1-02 skill run executor
S1-03 verification-aware skill receipts
S2-01 CLI skill commands
S2-02 skill install sources
S3-01 Agent Skills export
S3-02 Codex-compatible layout export
S4-01 Hugging Face curated installer
S4-02 separate optional specialist-pack layer
S5 research-only donor notes

Rules:
1. Every skill run must emit structured receipts and plain-language reports.
2. No skill may bypass Dante verification/policy.
3. Preserve source, license, version if available, and conversion notes.
4. CLI first; VS Code later.
5. If the feature exists only in docs, treat it as not done.
6. Keep changes atomic: 1–4 files per prompt where possible.
7. Update docs only when implementation changes behavior.
10. First prompt to hand Codex
Implement S0-01 and S0-02 only.

Create a native Dante skill schema plus an Agent Skills parser.

Requirements:
- Native schema must represent: name, description, sourceType, sourceRef, license, compatibility, metadata, allowedTools, scripts, references, assets
- Parse Agent Skills-compatible SKILL.md frontmatter
- Validate required name and description
- Support optional compatibility, metadata, allowed-tools
- Detect optional scripts/, references/, assets/
- Return clear typed validation errors
- Do not add execution yet
- Add tests for valid parse, missing name, missing description, malformed frontmatter, optional directories discovery
- Return touched files, tests added, and blockers
11. Second prompt to hand Codex
Implement S0-03 and S1-01 only.

Create discovery/registry plus skill-to-policy mapping.

Requirements:
- Discover skills from .dantecode/skills and ~/.dantecode/skills
- Optionally support .agents/skills as a compatible import root
- Preserve scope/origin in registry entries
- Deterministically handle duplicate names without silent merge
- Map Agent Skills allowed-tools into Dante policy inputs
- Treat allowed-tools as advisory/experimental, not unconditional execution authority
- Add tests for duplicate names, scope precedence, unsupported tools, compatibility warnings
- Return touched files, tests added, and blockers
12. Third prompt to hand Codex
Implement S1-02 and S1-03 only.

Create the skill run executor and verification-aware skill receipts.

Requirements:
- Support instruction-only skills first
- Support scripts metadata wiring even if scripts execution is stubbed behind policy checks
- Every skill run must emit runId, skillName, sourceType, filesTouched, commandsRun, verificationOutcome, plainLanguageSummary, failureReason if any
- Report must distinguish proposed vs applied vs verified
- No success wording without applied state
- No verified wording without verified state
- Add tests for successful instruction-only execution, failed policy preflight, partial run, report wording correctness
- Return touched files, tests added, artifacts produced, and blockers

This is the right packet for what you asked: it keeps Dante aligned with its current product identity, builds on the open Agent Skills ecosystem that Codex and Hugging Face already support, and keeps optional donor content outside the core until the runtime is solid.