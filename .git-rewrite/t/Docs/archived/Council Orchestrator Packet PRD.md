**Council Orchestrator Packet**

Author: Chatgpt

Date: 2026-03-20

This is not a separate idea from SkillBridge or the deterministic tool runtime. It is the next layer above them.

The clean stack is:

1. **DTR in DanteCode**: make tool execution deterministic, block on downloads/artifacts, resume safely.  
2. **SkillBridge in DanteForge \+ DanteCode**: make the same DanteForge skills and protocols usable across Claude/Codex/Qwen/others.  
3. **Council Orchestrator in DanteCode**: route work across multiple agent environments, detect overlap, merge outputs, and survive usage caps.

After inspecting the uploaded repos, the fit is real:

* **DanteForge** already has the right portable pieces: `src/cli/commands/party.ts`, `src/core/assistant-installer.ts`, `src/core/skills-import.ts`, `src/core/skill-registry.ts`, `src/core/verifier.ts`, `src/core/pdse.ts`, plus worktree helpers in `src/utils/worktree.ts`.  
* **DanteCode** already has the right control-plane pieces: `packages/git-engine/src/worktree.ts`, `packages/core/src/multi-agent.ts`, `packages/core/src/git-hook-handler.ts`, `packages/core/src/event-engine.ts`, `packages/core/src/event-triggers.ts`, `packages/core/src/skill-wave-orchestrator.ts`, and the existing skill import/registry surfaces in `packages/skill-adapter`.

My blunt view: **the idea is strong, but “automatically prompt the other tools” is only safe if you treat the other tools as adapters, not as GUI tabs.** GUI-driving VS Code tabs should be optional. The real product is a **Git/worktree/handoff/merge conductor**. That is the reliable part. The IDE automation layer is a convenience layer on top.

# **V+E Masterplan**

## **DanteCode Council Orchestrator**

### **Usage-Aware Multi-Agent Git Conductor for Codex, Claude Code, Antigravity/Gemini, DanteCode, and future Qwen participation**

## **1\. Vision**

DanteCode becomes the **control tower** for a live council of coding agents working on the same repo in parallel.

Each agent can:

* receive a scoped task packet,  
* work in its own isolated worktree,  
* use DanteForge skills/protocols inside its native environment,  
* return a patch, explanation, and evidence bundle.

DanteCode then:

* watches all worktrees,  
* detects overlap and duplication,  
* freezes conflicting lanes,  
* scores and reconciles divergent edits,  
* synthesizes a canonical merged result,  
* verifies it,  
* and commits or opens a PR.

The key extra requirement from your screenshot is **usage-aware failover**:

* if Claude Code hits a cap,  
* or Codex rate-limits,  
* or Antigravity becomes unavailable,  
* DanteCode reassigns unfinished or partially finished work using a structured handoff packet instead of losing progress.

That is the real moat.

## **2\. What this is, and what it is not**

This **is**:

* a multi-agent coordination plane,  
* a worktree/branch isolation system,  
* a usage-aware router,  
* a merge brain,  
* a Git event automation layer,  
* a DanteForge-powered protocol that can run across multiple agent environments.

This is **not**:

* a day-one “remote control every proprietary IDE tab by GUI automation” product,  
* a promise that every vendor tool can be driven the same way,  
* a blind auto-merge engine.

Day one should optimize for:

* reliability,  
* reproducibility,  
* Git truth,  
* adapter-based control,  
* explicit evidence.

## **3\. Why it fits the SkillBridge work above**

It fits perfectly, but as a later layer.

### **SkillBridge’s job**

SkillBridge makes DanteForge skills portable into other ecosystems so the council can share the same working methods and reference packs.

### **Council Orchestrator’s job**

Council Orchestrator makes those agents cooperate safely when they work in parallel on the same repo.

So the relationship is:

* **SkillBridge standardizes capability**  
* **Council Orchestrator standardizes collaboration**  
* **DTR standardizes execution correctness inside DanteCode**

That is the correct architecture.

## **4\. Repo boundary**

## **DanteForge owns**

Portable, environment-agnostic primitives:

* assistant bootstrap/install into Codex/Claude/Antigravity/OpenCode/Cursor-like homes  
* handoff packet schema  
* review/synthesize/verify/PDSE logic  
* merge scoring  
* lessons and constitution enforcement  
* portable skill packs  
* optional standalone “party/orchestrate” helpers

This matches the uploaded DanteForge repo, which already includes assistant installation, skill import/registry, party mode, verifier, PDSE, and worktree helpers.

## **DanteCode owns**

The control plane:

* council session state  
* usage ledger and cap tracking  
* agent adapters  
* worktree manager for live council runs  
* overlap detector  
* merge brain  
* Git event hooks / webhook / scheduler triggers  
* project-local runtime UI/CLI  
* final merge/commit/push workflow

This matches the uploaded DanteCode repo, which already includes git engine worktrees, multi-agent planning, Git hook handling, event routing, and local skill/runtime layers.

## **5\. Core product thesis**

The feature should be framed as:

### **DanteCode Council Orchestrator**

A usage-aware, NOMA-enforcing conductor that coordinates multiple AI coding environments on one repo through isolated worktrees, structured handoffs, overlap detection, and verified synthesis.

### **DanteForge Council Protocol**

A portable protocol and verification kit that lets each agent environment use the same task packet, skill packs, review standards, and merge evidence.

That keeps the split clean:

* Forge \= protocol/toolchain  
* Code \= conductor/runtime

## **6\. Non-negotiable design principles**

1. **Git is source of truth**  
   * no orchestration truth that only lives in chat windows  
2. **Worktree isolation first**  
   * each agent gets its own branch/worktree by default  
3. **NOMA is mandatory**  
   * default is non-overlapping file mandates  
   * overlap only allowed when explicitly requested or detected as unavoidable  
4. **Fail closed on ambiguity**  
   * if ownership of a file is ambiguous, freeze and require synthesis  
   * if adapter status is unknown, mark unavailable  
   * if merge confidence is low, require review  
5. **Usage-aware routing**  
   * routing decisions must consider hard caps, soft caps, latency, cost, and current health  
6. **Protocol over GUI**  
   * control agents via CLI/API/file adapters first  
   * GUI automation only as optional last-mile support  
7. **No silent overwrite**  
   * if two agents edit the same file, both versions are preserved until synthesis completes

## **7\. Product architecture**

## **7.1 Main machines/organs**

### **A. Council Router**

The brain that decides:

* who gets the task,  
* which files belong to which lane,  
* who is over cap,  
* when to fail over,  
* when to run parallel,  
* when to serialize.

### **B. Usage Ledger**

Tracks each engine:

* `ready`  
* `soft-capped`  
* `hard-capped`  
* `cooling-down`  
* `offline`  
* `manual-only`

It also tracks:

* cost class  
* expected quality by task type  
* current backlog  
* last-success timestamp  
* average completion latency

### **C. Agent Adapter Layer**

Every external tool gets an adapter.

Adapter classes:

* **Native CLI adapter** — best path  
* **API/MCP adapter** — second-best  
* **File inbox/outbox adapter** — robust fallback  
* **GUI adapter** — optional, fragile, last resort

Every adapter must implement:

* `probeAvailability()`  
* `estimateCapacity()`  
* `submitTask(packet)`  
* `pollStatus(sessionId)`  
* `collectArtifacts(sessionId)`  
* `collectPatch(sessionId)`  
* `detectRateLimit()`  
* `abortTask(sessionId)`  
* `handoff(packet)`

### **D. Worktree Manager**

Creates and manages per-agent worktrees and branches.

The uploaded repos already have a head start here:

* DanteForge has `src/utils/worktree.ts`  
* DanteCode has `packages/git-engine/src/worktree.ts`

The orchestrator should build on those, not replace them.

### **E. Overlap Detector**

Continuously watches:

* claimed file mandates,  
* actual changed files,  
* rebases,  
* branch drift,  
* duplicate edits,  
* same-function changes in different files,  
* possible hidden collisions like shared types/contracts.

### **F. Merge Brain**

The most important organ.

Pipeline:

1. collect candidate versions,  
2. compare changed files and intent,  
3. apply syntax-aware merge when safe,  
4. apply semantic synthesis when syntax-only is not enough,  
5. verify with tests/gates,  
6. produce canonical merged patch,  
7. record explanation and evidence.

### **G. Handoff Packet Engine**

This solves usage caps.

If an agent stops mid-task, the packet must preserve:

* goal  
* current branch/worktree  
* touched files  
* assumptions  
* open questions  
* completed checks  
* pending tests  
* relevant diffs  
* why it stopped  
* recommended next agent

### **H. Git Event Automation**

Use Git hooks, webhooks, cron, or manual commands to trigger:

* conflict scans  
* lane resync  
* merge attempts  
* PR generation  
* failed-test repair  
* post-review repair

DanteCode already has event and Git hook primitives for this in `event-engine.ts`, `event-triggers.ts`, and `git-hook-handler.ts`.

## **7.2 Council state model**

Every council run should have a durable state object:

type CouncilRunState \= {  
 runId: string;  
 repoRoot: string;  
 objective: string;  
 status: "planning" | "running" | "blocked" | "merging" | "verifying" | "completed" | "failed";  
 agents: AgentSessionState\[\];  
 mandates: FileMandate\[\];  
 overlaps: OverlapRecord\[\];  
 handoffs: HandoffPacket\[\];  
 finalSynthesis?: FinalSynthesisRecord;  
 auditLogPath: string;  
};

## **8\. New commands**

## **DanteCode command surface**

dantecode council start "\<objective\>" \--agents codex,claude,antigravity,dante \--worktrees  
dantecode council status  
dantecode council lanes  
dantecode council reassign \--from claude \--to codex \--reason hard-cap  
dantecode council merge \--auto  
dantecode council freeze \<file\>  
dantecode council thaw \<file\>  
dantecode council resume \<run-id\>  
dantecode council push

## **DanteForge command surface**

Use DanteForge for shared portable operations:

danteforge party \--worktree \--isolation  
danteforge review \--left \<pathA\> \--right \<pathB\>  
danteforge synthesize \--inputs \<bundleA,bundleB\>  
danteforge verify  
danteforge lessons

No need to invent a separate empire. Extend the surfaces that already exist.

## **9\. NOMA model**

NOMA should be formalized here as an actual scheduler rule, not just a philosophy.

### **NOMA lane assignment**

Each task packet should declare:

* owned files  
* allowed read-only files  
* forbidden files  
* contract dependencies  
* escalation conditions

### **Overlap levels**

* **Level 0**: no overlap  
* **Level 1**: shared contract files only  
* **Level 2**: same module, different functions  
* **Level 3**: same file, non-overlapping hunks  
* **Level 4**: same hunk or same API surface

Level 3 and 4 automatically trigger merge-brain supervision.

## **10\. Usage-aware failover**

This is the part your screenshot makes especially valuable.

### **Goal**

When a tool runs out of usage, the work does not die.

### **Mechanism**

Each adapter reports:

* remaining session confidence  
* cap suspicion  
* hard failure reason  
* recent throughput

The router then:

* pauses the lane,  
* snapshots its worktree,  
* generates a handoff packet,  
* picks a replacement engine,  
* resumes from the packet.

### **Routing policy**

Use a weighted policy:

* coding/patching  
* reviewing  
* testing  
* synthesis  
* debugging  
* long-context reading

Each engine gets a profile per task type:

* quality score  
* cost score  
* latency  
* cap risk  
* current availability

Then the router chooses the best active engine, not the best theoretical engine.

This lets you use:

* capped subscriptions first when available,  
* pay-per-usage only when needed,  
* local runtime paths when cheapest,  
* and DanteCode as the persistent coordinator.

## **11\. Merge Brain design**

This is where most systems fail.

The correct merge pipeline is:

### **Stage 1 — Structural diff**

Compare:

* touched files  
* touched hunks  
* changed symbols  
* imports/exports/contracts

### **Stage 2 — Intent scoring**

For each candidate patch, extract:

* what changed  
* why  
* risk class  
* tests added/removed  
* contract changes  
* incomplete work indicators

### **Stage 3 — Safe merge attempt**

Use a syntax-aware merge driver first when possible. Mergiraf is a strong reference here because it is explicitly a syntax-aware merge driver for multiple languages and can be used as a fallback or review tool in Git flows.

### **Stage 4 — Semantic synthesis**

If structure-only merge is insufficient:

* run DanteForge review on both variants,  
* synthesize a canonical result,  
* preserve all intended functionality,  
* emit rationale.

### **Stage 5 — Verification**

Run:

* lint  
* typecheck  
* tests  
* anti-stub  
* constitution  
* PDSE  
* target-specific smoke checks

### **Stage 6 — Decision**

* auto-merge if confidence high  
* request human review if confidence medium  
* fail closed if confidence low

## **12\. OSS to learn from**

These are the strongest verified references for the idea.

### **Gas Town**

Gas Town is explicitly a multi-agent workspace manager for Claude Code with persistent git-backed work tracking. That makes it useful for durable state, hook-backed history, and “do not lose context when agents restart.”

### **Agent Orchestrator**

Composio’s Agent Orchestrator is very close to your screenshot goal: parallel coding agents, each in its own git worktree and branch, with CI/review loops handled autonomously. This is the best reference for per-agent worktree orchestration and dashboard-style supervision.

### **Parallel Code**

Parallel Code is almost a direct proof-of-concept for your exact UX: Claude Code, Codex, and Gemini side by side, each in its own git worktree. It is a strong model for the “AI arena / compare outputs” side of your vision.

### **Continue**

Continue’s repo-defined AI checks are useful because they treat policy and review logic as version-controlled markdown checks that run as status checks. That maps well to council merge gates and automated review packets.

### **OpenHands**

OpenHands’ current SDK/docs emphasize agents that can run locally or in ephemeral workspaces and scale to many agents. That is relevant for adapter design, sandboxed execution, and hierarchical orchestration.

### **Mergiraf**

Mergiraf should be studied for syntax-aware merge before LLM synthesis. It is not the whole answer, but it is the right first-pass merge primitive.

### **Merge Resolver**

Merge Resolver is smaller and less mature, but it is useful as a pattern for conflict-block extraction, AI-assisted resolution, and auto-stage/auto-commit flow.

## **13\. What belongs in DanteForge vs DanteCode for this feature**

## **DanteForge additions**

I would add a portable protocol and review family, not the whole conductor.

Suggested new area:

src/core/council-protocol/  
 handoff-packet.ts  
 intent-diff.ts  
 synthesis-review.ts  
 merge-audit.ts

And extend:

* `src/core/verifier.ts`  
* `src/core/pdse.ts`  
* `src/cli/commands/party.ts`  
* `src/core/assistant-installer.ts`

### **Why**

DanteForge should remain the shared protocol and verification brain that any assistant environment can use.

## **DanteCode additions**

This is where the main feature should live.

Suggested new area:

packages/core/src/council/  
 council-router.ts  
 usage-ledger.ts  
 council-state-store.ts  
 worktree-observer.ts  
 overlap-detector.ts  
 merge-brain.ts  
 agent-adapters/  
   base.ts  
   codex.ts  
   claude-code.ts  
   antigravity.ts  
   dantecode.ts  
packages/cli/src/commands/council.ts  
packages/git-engine/src/merge.ts

And extend:

* `packages/core/src/multi-agent.ts`  
* `packages/core/src/git-hook-handler.ts`  
* `packages/core/src/event-engine.ts`  
* `packages/core/src/event-triggers.ts`  
* `packages/git-engine/src/worktree.ts`

### **Why**

DanteCode is the conductor. This is where live routing, monitoring, overlap detection, and merge orchestration belong.

## **14\. Phased roadmap**

## **Phase 0 — Protocol and state**

Define:

* council run state  
* handoff packet schema  
* overlap model  
* usage ledger state machine  
* adapter interface

No IDE automation yet.

## **Phase 1 — Worktree council MVP**

Implement:

* per-agent worktrees  
* manual task assignment  
* patch collection  
* overlap detection  
* manual merge-brain invocation

This gets you a real working system early.

## **Phase 2 — Usage-aware failover**

Implement:

* adapter health probes  
* cap/offline detection  
* handoff packet generation  
* reroute to another engine

This is the feature your screenshot needs most.

## **Phase 3 — Merge Brain auto mode**

Implement:

* syntax-aware merge  
* semantic review/synthesis  
* confidence scoring  
* auto-merge thresholds  
* review-required paths

## **Phase 4 — Event automation**

Implement:

* Git hook triggers  
* webhook triggers  
* scheduled repair/retry  
* PR generation  
* post-review repair loops

## **Phase 5 — Optional GUI automation**

Only after the control plane is stable:

* launch/attach to supported IDEs  
* inject packets via CLI/task/prompt bridges  
* optional desktop automation where no formal integration exists

This should be clearly labeled experimental.

## **15\. Tests and gates**

### **Required golden flows**

#### **GF-01**

Two agents edit different files in parallel.  
Result: both merge cleanly, no overlap freeze, one commit.

#### **GF-02**

Two agents edit the same file but different hunks.  
Result: overlap detected, syntax merge attempted, verified, committed.

#### **GF-03**

Two agents edit the same hunk with different intent.  
Result: freeze, collect both versions, semantic synthesis, verification, review if needed.

#### **GF-04**

Claude hits a cap mid-task.  
Result: state snapshot \+ handoff packet \+ reroute to Codex or DanteCode without losing work.

#### **GF-05**

Agent crashes or IDE closes unexpectedly.  
Result: worktree remains intact, run resumes from durable state.

#### **GF-06**

Same task assigned accidentally to two lanes.  
Result: duplicate work detected, second lane downgraded or repurposed, no silent double-merge.

### **Hard gates**

* no merge without preserved originals  
* no auto-push on low-confidence synthesis  
* no lane continues after ambiguous ownership  
* no handoff packet may omit touched files or pending tests  
* no GUI adapter may be required for core functionality

## **16\. Brutally honest risks**

### **Risk 1 — GUI automation fantasy**

Trying to control every IDE tab directly will make the system flaky.

**Fix:** make GUI control optional. The real product is adapter \+ Git \+ worktree \+ packet orchestration.

### **Risk 2 — false merge confidence**

An LLM merge can look coherent and still drop functionality.

**Fix:** force structural diff \+ verification \+ test gates \+ original preservation.

### **Risk 3 — usage-cap detection ambiguity**

Some tools fail noisily, others just degrade or stop responding.

**Fix:** treat uncertainty as degraded health, not success. Use timeouts, heartbeat loss, and no-output windows as signals.

### **Risk 4 — overlap beyond file paths**

Two agents can collide semantically without touching the same file.

**Fix:** add symbol/API dependency detection, not just file-level locks.

### **Risk 5 — too much too soon**

If you build SkillBridge, DTR, and Council Orchestrator at once, you will create too much moving surface area.

**Fix:** sequence the work:

* DTR spine  
* SkillBridge MVP  
* Council Protocol \+ Worktree Council MVP  
* usage-aware failover  
* merge brain  
* optional GUI layer

## **17\. Final judgment**

This is one of the most powerful ideas in your stack, but only if you build the right thing.

The wrong thing is:

* “DanteCode controls other IDE tabs magically.”

The right thing is:

* “DanteCode is a durable, usage-aware council conductor built on worktrees, packets, verification, and synthesis.”

That absolutely fits with what we were working on above.

In fact, I would define the combined roadmap like this:

* **SkillBridge** makes every council member speak a shared DanteForge language.  
* **DTR** makes DanteCode execute and verify work correctly.  
* **Council Orchestrator** makes the whole council collaborate without stepping on itself.

That is coherent.

The strongest next step is to turn this into a **Codex-ready V+E Execution Packet** with exact file paths for both repos and a phased implementation order.

Please create the codex ready V+E execution packet  
Thought for 1m 53s

Below is the **Codex-ready V+E Execution Packet** for the **Council Orchestrator / Usage-Aware Multi-Agent Git Conductor**.

This is the correct follow-on to the work above.

It fits the prior stack cleanly:

* **DTR** gives DanteCode deterministic execution and blocking semantics.  
* **SkillBridge** gives the council a shared DanteForge language across environments.  
* **Council Orchestrator** gives the council safe parallel collaboration, usage-aware failover, and verified synthesis.

From the uploaded repos, the split is clear:

* **DanteForge** already has the portable protocol pieces: `src/cli/commands/party.ts`, `src/core/assistant-installer.ts`, `src/core/skills-import.ts`, `src/core/skill-registry.ts`, `src/core/verifier.ts`, `src/core/pdse.ts`, and `src/utils/worktree.ts`.  
* **DanteCode** already has the control-plane pieces: `packages/git-engine/src/worktree.ts`, `packages/core/src/multi-agent.ts`, `packages/core/src/git-hook-handler.ts`, `packages/core/src/event-engine.ts`, `packages/core/src/event-triggers.ts`, `packages/core/src/skill-wave-orchestrator.ts`, and `packages/cli/src/commands/skills.ts`.

The strongest external patterns for this are also real and current: Agent Orchestrator explicitly manages parallel coding agents with a git worktree per agent; Parallel Code does the same for Claude Code, Codex CLI, and Gemini CLI; Gas Town focuses on persistent git-backed multi-agent coordination for Claude Code. These are the right reference families for the worktree-first control plane.

---

# **Codex-ready V+E Execution Packet**

## **CO-01 — DanteCode Council Orchestrator \+ DanteForge Council Protocol**

## **0\. Executive verdict**

Build this.

But build **the reliable version**, not the fantasy version.

### **The reliable version**

DanteCode coordinates agents through:

* worktrees,  
* branches,  
* task packets,  
* adapter probes,  
* patch collection,  
* overlap detection,  
* merge synthesis,  
* verification,  
* and usage-aware failover.

### **The fantasy version**

DanteCode magically drives every open IDE tab directly as the primary control mechanism.

Do **not** build the fantasy version first.

The control plane must be:

* Git-first  
* worktree-first  
* adapter-first  
* durable-state-first

GUI automation can be added later as an optional adapter class.

---

# **1\. Product definition**

## **1.1 Product name**

**DanteCode Council Orchestrator**

## **1.2 One-line definition**

A usage-aware, NOMA-enforcing multi-agent conductor that coordinates Codex, Claude Code, Antigravity/Gemini, DanteCode, and later Qwen-capable lanes through isolated worktrees, structured handoffs, overlap detection, and verified synthesis.

## **1.3 Council protocol companion**

**DanteForge Council Protocol**

This is the portable protocol/tooling layer that gives every council member:

* the same handoff packet schema,  
* the same review/synthesis rules,  
* the same verification expectations,  
* the same assistant install/bootstrap behavior.

That split is correct:

* **DanteForge \= protocol \+ verification kit**  
* **DanteCode \= live conductor/runtime**

---

# **2\. Problem statement**

Right now, the user can already run multiple agent environments side by side on the same repo.

The problem is that this creates:

* duplicate work,  
* overlapping file edits,  
* manual merge hell,  
* inconsistent reviews,  
* and hard-stop loss of momentum when one environment hits usage caps.

The orchestrator must solve:

1. **parallel delegation**  
2. **NOMA lane ownership**  
3. **overlap detection**  
4. **intelligent merge/synthesis**  
5. **usage-aware rerouting**  
6. **verified final integration**  
7. **one clean Git outcome**

---

# **3\. Goals**

## **3.1 Functional goals**

* launch and manage parallel agent lanes against one repo  
* isolate each lane into its own worktree/branch  
* assign file mandates with NOMA by default  
* detect file and semantic overlap early  
* collect patches and evidence from each lane  
* synthesize competing edits into a canonical merge  
* reroute unfinished work when an agent hits usage caps or becomes unavailable  
* commit or PR only after verification gates pass

## **3.2 Product goals**

* make the screenshot workflow real, repeatable, and safe  
* reduce manual merging and duplicate work  
* make DanteCode the control tower for subscription-capped and API-priced agents  
* let users exploit cheap/capped usage first, then fail over into paid/API lanes only when needed

## **3.3 Non-goals for MVP**

* fully autonomous desktop GUI control of every IDE tab  
* blind auto-push on all merges  
* direct dependence on any one vendor’s hidden UI behavior  
* full cloud fleet orchestration on day one

---

# **4\. Non-negotiable principles**

1. **Git is source of truth**  
2. **Worktrees are default**  
3. **NOMA is enforced by code, not vibe**  
4. **No silent overwrite**  
5. **Usage cap detection must fail closed**  
6. **Merge confidence must be explicit**  
7. **Original candidate outputs are always preserved**  
8. **GUI automation is optional, not foundational**  
9. **No council lane may continue on ambiguous ownership**  
10. **No final push without verification**

---

# **5\. Repo boundary**

## **5.1 DanteForge owns**

Portable protocol and verification primitives.

### **Extend existing DanteForge surfaces**

* `src/cli/commands/party.ts`  
* `src/core/assistant-installer.ts`  
* `src/core/verifier.ts`  
* `src/core/pdse.ts`  
* `src/utils/worktree.ts`

### **Add new DanteForge protocol area**

src/core/council-protocol/  
 types.ts  
 handoff-packet.ts  
 intent-diff.ts  
 synthesis-review.ts  
 merge-audit.ts

### **DanteForge responsibilities**

* assistant bootstrap/install into supported homes  
* handoff packet schema \+ serializer  
* review/synthesize protocol  
* merge audit output  
* intent-diff scoring  
* PDSE/constitution/anti-stub reuse  
* optional portable party-mode helpers

---

## **5.2 DanteCode owns**

The actual orchestrator runtime.

### **Extend existing DanteCode surfaces**

* `packages/git-engine/src/worktree.ts`  
* `packages/core/src/multi-agent.ts`  
* `packages/core/src/git-hook-handler.ts`  
* `packages/core/src/event-engine.ts`  
* `packages/core/src/event-triggers.ts`  
* `packages/core/src/skill-wave-orchestrator.ts`  
* `packages/cli/src/commands/git.ts`  
* `packages/cli/src/command-registry.ts`

### **Add new DanteCode control-plane area**

packages/core/src/council/  
 council-types.ts  
 council-router.ts  
 usage-ledger.ts  
 council-state-store.ts  
 worktree-observer.ts  
 overlap-detector.ts  
 merge-brain.ts  
 merge-confidence.ts  
 handoff-engine.ts  
 council-events.ts  
 agent-adapters/  
   base.ts  
   dantecode.ts  
   codex.ts  
   claude-code.ts  
   antigravity.ts  
packages/cli/src/commands/council.ts  
packages/git-engine/src/merge.ts  
packages/git-engine/src/conflict-scan.ts

### **DanteCode responsibilities**

* lane creation  
* live state  
* routing  
* capacity/cap tracking  
* overlap detection  
* merge orchestration  
* handoff and reassignment  
* final verification/push flow

---

# **6\. Architecture**

## **6.1 Core machines**

### **A. Council Router**

Decides:

* which agents are available  
* which task goes to which lane  
* which files each lane owns  
* whether work runs in parallel or serial  
* when to reroute due to caps/failures

### **B. Usage Ledger**

Tracks for each agent:

* `ready`  
* `degraded`  
* `soft-capped`  
* `hard-capped`  
* `offline`  
* `manual-only`

Also tracks:

* average latency  
* success rate  
* recent failures  
* cost class  
* task-type strength

### **C. Agent Adapter Layer**

Every agent environment gets an adapter implementing one common contract.

### **D. Worktree Manager**

Creates and manages per-agent worktrees.

This is validated by the ecosystem patterns above: Agent Orchestrator and Parallel Code both rely on per-agent git worktrees as a core coordination primitive, and Gas Town relies on git-backed persistence for multi-agent work management.

### **E. Overlap Detector**

Detects:

* same-file overlap  
* same-hunk overlap  
* shared contract overlap  
* symbol/API overlap  
* branch drift

### **F. Merge Brain**

Collects multiple outputs and synthesizes a canonical result.

First-pass merge should be structural/syntax-aware before semantic synthesis. Mergiraf is the right model to learn from here because it is built specifically as a syntax-aware merge driver, while Agent Orchestrator provides the multi-worktree orchestration pattern around it.

### **G. Handoff Engine**

When an agent caps out or becomes unavailable:

* snapshot worktree state  
* write handoff packet  
* reroute to the next best agent  
* preserve evidence and pending checks

### **H. Event Automation**

Uses Git hooks, filesystem events, and explicit commands to trigger:

* scans  
* freezes  
* merges  
* verification  
* reroutes  
* PR/commit actions

---

## **6.2 Adapter contract**

Create a common adapter interface:

export interface CouncilAgentAdapter {  
 id: string;  
 displayName: string;  
 kind: "native-cli" | "api" | "file-bridge" | "gui";  
 probeAvailability(): Promise\<AdapterAvailability\>;  
 estimateCapacity(): Promise\<AdapterCapacity\>;  
 submitTask(packet: CouncilTaskPacket): Promise\<AdapterSubmission\>;  
 pollStatus(sessionId: string): Promise\<AdapterStatus\>;  
 collectArtifacts(sessionId: string): Promise\<AdapterArtifacts\>;  
 collectPatch(sessionId: string): Promise\<AdapterPatch | null\>;  
 detectRateLimit(sessionId: string): Promise\<RateLimitSignal\>;  
 abortTask(sessionId: string): Promise\<void\>;  
}

### **Required adapter classes**

* `dantecode.ts`  
* `codex.ts`  
* `claude-code.ts`  
* `antigravity.ts`

### **Hard rule**

Day-one adapters should prefer:

1. native CLI / API  
2. file inbox/outbox bridges  
3. GUI automation only if no better path exists

---

## **6.3 Council run state**

Add a durable council run state object:

export interface CouncilRunState {  
 runId: string;  
 repoRoot: string;  
 objective: string;  
 status: "planning" | "running" | "blocked" | "merging" | "verifying" | "completed" | "failed";  
 createdAt: string;  
 updatedAt: string;  
 agents: AgentSessionState\[\];  
 mandates: FileMandate\[\];  
 overlaps: OverlapRecord\[\];  
 handoffs: HandoffPacket\[\];  
 finalSynthesis?: FinalSynthesisRecord;  
 auditLogPath: string;  
}

Add related records:

* `AgentSessionState`  
* `FileMandate`  
* `OverlapRecord`  
* `HandoffPacket`  
* `FinalSynthesisRecord`

---

# **7\. New command surface**

## **7.1 DanteCode CLI**

Add:

dantecode council start "\<objective\>" \--agents codex,claude,antigravity,dante \--worktrees  
dantecode council status  
dantecode council lanes  
dantecode council freeze \<file\>  
dantecode council thaw \<file\>  
dantecode council reassign \--from claude \--to codex \--reason hard-cap  
dantecode council merge \--auto  
dantecode council verify  
dantecode council push  
dantecode council resume \<run-id\>

## **7.2 DanteForge CLI**

Extend existing party/review/synthesize workflow instead of inventing a second product shell:

danteforge party \--worktree \--isolation  
danteforge review \--left \<pathA\> \--right \<pathB\>  
danteforge synthesize \--inputs \<bundleA,bundleB\>  
danteforge verify  
---

# **8\. NOMA execution model**

## **8.1 Default mandate rules**

Every lane gets:

* `ownedFiles`  
* `readOnlyFiles`  
* `forbiddenFiles`  
* `contractDependencies`  
* `overlapPolicy`

## **8.2 Overlap severity**

* **L0** — no overlap  
* **L1** — shared contract read dependencies  
* **L2** — same module family, different symbols  
* **L3** — same file, non-overlapping hunks  
* **L4** — same hunk / same API surface

### **Enforcement**

* L0/L1 proceed  
* L2 warns  
* L3 triggers supervised merge  
* L4 freezes both lanes pending merge-brain review

---

# **9\. Usage-aware failover**

This is one of the highest-value parts of the feature.

## **9.1 Why it matters**

Codex, Claude Code, and Gemini-style environments can all degrade or cap out in different ways. Qwen also supports multiple providers via `modelProviders`, which makes it a future participant in the same ecosystem rather than a special case.

## **9.2 Required signals**

Each adapter must emit:

* health heartbeat  
* last progress timestamp  
* recent output activity  
* known rate-limit signals  
* hard failure codes  
* cap suspicion score

## **9.3 Routing policy**

Router uses weighted selection:

* task type fit  
* current health  
* cap risk  
* latency  
* cost  
* confidence score  
* recent success

## **9.4 Handoff packet must contain**

* objective  
* lane id  
* worktree path  
* branch name  
* touched files  
* current diff summary  
* assumptions  
* completed checks  
* pending tests  
* blocker reason  
* recommended next agent

---

# **10\. Merge Brain design**

## **10.1 Merge pipeline**

1. collect candidate patches  
2. structural diff  
3. symbol/API diff  
4. syntax-aware merge attempt  
5. semantic review \+ synthesis if needed  
6. verification  
7. confidence scoring  
8. auto-merge, review-required, or block

## **10.2 Confidence buckets**

* `high` — auto-merge allowed  
* `medium` — synthesize then require review  
* `low` — preserve candidates and block

## **10.3 Required outputs**

* merged patch  
* rationale  
* preserved originals  
* merge audit bundle  
* confidence score  
* test results

---

# **11\. File plan**

## **11.1 DanteForge new files**

### **`src/core/council-protocol/types.ts`**

Exports:

* `CouncilTaskPacket`  
* `HandoffPacket`  
* `IntentDiff`  
* `SynthesisReview`  
* `MergeAuditRecord`

### **`src/core/council-protocol/handoff-packet.ts`**

Responsibilities:

* create  
* serialize  
* validate  
* redact secrets from packet payloads

### **`src/core/council-protocol/intent-diff.ts`**

Responsibilities:

* compare two candidate outputs  
* summarize intent differences  
* score preservation risk

### **`src/core/council-protocol/synthesis-review.ts`**

Responsibilities:

* review two or more candidate outputs  
* generate canonical synthesis instructions  
* emit merge rationale

### **`src/core/council-protocol/merge-audit.ts`**

Responsibilities:

* produce audit artifact  
* record sources, decisions, confidence, verification outcome

---

## **11.2 DanteForge modified files**

### **`src/cli/commands/party.ts`**

Add:

* `--orchestrate`  
* `--handoff`  
* `--review-conflict`  
* `--worktree-observer`

### **`src/core/assistant-installer.ts`**

Extend install surfaces so council protocol assets can be installed into supported assistant homes.

### **`src/core/verifier.ts`**

Add council-specific verification entrypoints.

### **`src/core/pdse.ts`**

Add optional merge-preservation dimension or council-specific synthesis penalty flags.

### **`src/utils/worktree.ts`**

Do not replace; extend for protocol-compatible worktree metadata.

---

## **11.3 DanteCode new files**

### **`packages/core/src/council/council-types.ts`**

Core state types for run, lane, overlap, confidence, handoff, routing.

### **`packages/core/src/council/usage-ledger.ts`**

Tracks adapter health/caps/cost/latency.

### **`packages/core/src/council/council-state-store.ts`**

Durable state persistence for council runs.

### **`packages/core/src/council/council-router.ts`**

Task routing, reassignment, prioritization.

### **`packages/core/src/council/worktree-observer.ts`**

Watch branches/worktrees, detect drift and changes.

### **`packages/core/src/council/overlap-detector.ts`**

Detect overlapping ownership and semantic collisions.

### **`packages/core/src/council/merge-confidence.ts`**

Score candidate merges.

### **`packages/core/src/council/merge-brain.ts`**

Core synthesis and merge decision engine.

### **`packages/core/src/council/handoff-engine.ts`**

Create and consume handoff packets.

### **`packages/core/src/council/council-events.ts`**

Event constants and event payload contracts.

### **`packages/core/src/council/agent-adapters/base.ts`**

Adapter interface and shared helpers.

### **`packages/core/src/council/agent-adapters/dantecode.ts`**

Native self-lane adapter.

### **`packages/core/src/council/agent-adapters/codex.ts`**

Codex adapter.

### **`packages/core/src/council/agent-adapters/claude-code.ts`**

Claude Code adapter.

### **`packages/core/src/council/agent-adapters/antigravity.ts`**

Antigravity/Gemini adapter.

### **`packages/git-engine/src/merge.ts`**

Git merge helpers and candidate preservation paths.

### **`packages/git-engine/src/conflict-scan.ts`**

Scan conflicted files/hunks/symbols.

### **`packages/cli/src/commands/council.ts`**

User-facing council command router.

---

## **11.4 DanteCode modified files**

### **`packages/core/src/multi-agent.ts`**

Refactor or extend to integrate with council router instead of staying lane-abstract only.

### **`packages/core/src/git-hook-handler.ts`**

Emit structured council-aware Git events.

### **`packages/core/src/event-engine.ts`**

Add council event types.

### **`packages/core/src/event-triggers.ts`**

Allow council tasks from manual/API/Git triggers.

### **`packages/core/src/skill-wave-orchestrator.ts`**

Support handoff-aware execution packets for skill-driven work where applicable.

### **`packages/git-engine/src/worktree.ts`**

Extend with per-lane metadata and safer merge-back semantics.

### **`packages/cli/src/command-registry.ts`**

Register `council` command.

### **`packages/cli/src/commands/git.ts`**

Surface council-aware git status and conflicts where useful.

---

# **12\. Event model**

Add event types:

type CouncilEventType \=  
 | "council:start"  
 | "council:lane-assigned"  
 | "council:lane-progress"  
 | "council:overlap-detected"  
 | "council:lane-frozen"  
 | "council:handoff-created"  
 | "council:handoff-consumed"  
 | "council:merge-started"  
 | "council:merge-completed"  
 | "council:merge-blocked"  
 | "council:verify-passed"  
 | "council:verify-failed"  
 | "council:push-ready";

Persist these in the same audit/evidence style you already use elsewhere.

---

# **13\. Phased implementation order**

## **Phase 0 — contracts and state only**

Do not touch GUI automation.

### **CO-G1**

Add DanteForge council protocol contracts.  
Files:

* `src/core/council-protocol/types.ts`  
* `src/core/council-protocol/handoff-packet.ts`  
* tests

### **CO-G2**

Add DanteCode council types and state store.  
Files:

* `packages/core/src/council/council-types.ts`  
* `packages/core/src/council/council-state-store.ts`  
* tests

Acceptance:

* run state can be created, saved, loaded  
* handoff packets validate  
* no orchestration yet

---

## **Phase 1 — worktree council MVP**

### **CO-G3**

Add usage ledger and adapter base.  
Files:

* `packages/core/src/council/usage-ledger.ts`  
* `packages/core/src/council/agent-adapters/base.ts`  
* tests

### **CO-G4**

Add native DanteCode adapter and worktree observer.  
Files:

* `packages/core/src/council/agent-adapters/dantecode.ts`  
* `packages/core/src/council/worktree-observer.ts`  
* tests

### **CO-G5**

Add overlap detector and conflict scan helpers.  
Files:

* `packages/core/src/council/overlap-detector.ts`  
* `packages/git-engine/src/conflict-scan.ts`  
* tests

### **CO-G6**

Add council router MVP.  
Files:

* `packages/core/src/council/council-router.ts`  
* `packages/core/src/multi-agent.ts`  
* tests

Acceptance:

* can start a run  
* can assign lanes  
* can create worktrees  
* can detect basic file overlap  
* no auto-merge yet

---

## **Phase 2 — adapter participation and usage failover**

### **CO-G7**

Add Codex adapter.  
Files:

* `packages/core/src/council/agent-adapters/codex.ts`  
* tests

### **CO-G8**

Add Claude Code adapter.  
Files:

* `packages/core/src/council/agent-adapters/claude-code.ts`  
* tests

### **CO-G9**

Add Antigravity adapter.  
Files:

* `packages/core/src/council/agent-adapters/antigravity.ts`  
* tests

### **CO-G10**

Add handoff engine and reassignment flow.  
Files:

* `packages/core/src/council/handoff-engine.ts`  
* `src/core/council-protocol/intent-diff.ts`  
* tests

Acceptance:

* lane can be reassigned  
* hard-cap or offline state produces handoff packet  
* replacement lane resumes from packet

---

## **Phase 3 — merge brain**

### **CO-G11**

Add merge confidence and merge helpers.  
Files:

* `packages/core/src/council/merge-confidence.ts`  
* `packages/git-engine/src/merge.ts`  
* tests

### **CO-G12**

Add merge brain.  
Files:

* `packages/core/src/council/merge-brain.ts`  
* `src/core/council-protocol/synthesis-review.ts`  
* `src/core/council-protocol/merge-audit.ts`  
* tests

Acceptance:

* collects two candidate patches  
* preserves originals  
* emits synthesized result  
* outputs confidence bucket  
* no push yet

---

## **Phase 4 — CLI and event weld**

### **CO-G13**

Add council events and Git hook/event integration.  
Files:

* `packages/core/src/council/council-events.ts`  
* `packages/core/src/git-hook-handler.ts`  
* `packages/core/src/event-engine.ts`  
* `packages/core/src/event-triggers.ts`  
* tests

### **CO-G14**

Add CLI surface.  
Files:

* `packages/cli/src/commands/council.ts`  
* `packages/cli/src/command-registry.ts`  
* tests

Acceptance:

* `dantecode council start/status/merge/reassign` works  
* events are emitted and persisted

---

## **Phase 5 — protocol/party integration**

### **CO-G15**

Extend DanteForge party/review/verifier flow.  
Files:

* `src/cli/commands/party.ts`  
* `src/core/verifier.ts`  
* `src/core/pdse.ts`  
* `src/core/assistant-installer.ts`  
* tests

Acceptance:

* DanteForge can produce review/synthesis artifacts usable by council merge flow  
* no repo-wide instability introduced

---

## **Phase 6 — optional experimental GUI layer**

Only after all above is stable.

### **CO-G16**

Add experimental GUI adapter base.  
Files:

* separate experimental namespace  
* clearly opt-in  
* off by default

Acceptance:

* no core flow depends on GUI support

---

# **14\. Golden flows**

## **GF-01 — Parallel non-overlapping edits**

Two agents edit different files in separate worktrees.

Pass:

* no overlap freeze  
* patches collected  
* merged result verified  
* single commit produced

## **GF-02 — Same file, different hunks**

Two agents edit different hunks in the same file.

Pass:

* overlap detected as supervised, not fatal  
* merge helper attempts safe merge  
* verification passes  
* originals preserved

## **GF-03 — Same hunk, conflicting intent**

Two agents edit the same hunk differently.

Pass:

* both lanes frozen  
* candidates preserved  
* merge brain synthesizes candidate  
* verification \+ review gate required unless confidence high

## **GF-04 — Usage cap failover**

Claude lane hard-caps during task.

Pass:

* lane status flips to hard-capped  
* handoff packet created  
* Codex or DanteCode lane resumes work  
* no work lost

## **GF-05 — Agent crash/offline**

Adapter stops reporting health.

Pass:

* status moves to offline/degraded  
* worktree state remains intact  
* handoff packet generated  
* run resumable

## **GF-06 — Duplicate task assignment**

Same file mandate accidentally assigned twice.

Pass:

* overlap detector catches it  
* second lane is frozen or repurposed  
* no silent double-merge

---

# **15\. Acceptance criteria**

The feature is not done until all are true:

1. `dantecode council start` creates a real run with worktrees and lane assignments  
2. NOMA file mandates are persisted  
3. overlap detection works for file-level and hunk-level collisions  
4. at least one external adapter beyond DanteCode works end-to-end  
5. usage-cap/offline handoff packets are produced and consumable  
6. merge brain preserves originals and emits confidence  
7. no final push occurs without verification  
8. CLI surface is stable and documented  
9. DanteForge review/synthesis helpers are callable by council flow  
10. GUI automation is not required for core functionality

---

# **16\. Hard gates**

## **Build gates**

* root build passes in DanteCode  
* root build passes in DanteForge

## **Type gates**

* `tsc --noEmit` passes in touched packages

## **Test gates**

* unit tests for all new modules  
* golden flows pass  
* no regression in existing worktree, multi-agent, or event tests

## **Safety gates**

* no low-confidence auto-push  
* no overwrite without candidate preservation  
* no lane continues after ambiguous ownership  
* no adapter marked healthy without a valid probe  
* no council command mutates repo state outside recorded audit flow

---

# **17\. Risks and mitigations**

## **Risk 1 — trying to automate IDE windows first**

Mitigation:

* adapter-first architecture  
* GUI layer explicitly phase-later

## **Risk 2 — merge brain looks smart but drops functionality**

Mitigation:

* preserve originals  
* require structured diff \+ verification  
* confidence buckets  
* review gate on medium/low confidence

## **Risk 3 — usage-cap detection is fuzzy**

Mitigation:

* explicit degraded state  
* no-output timeout windows  
* adapter-specific heuristics  
* fail closed

## **Risk 4 — file-level NOMA misses semantic collisions**

Mitigation:

* add symbol/API overlap detection in `conflict-scan.ts`  
* contract dependency declarations in mandates

## **Risk 5 — doing this at same time as everything else**

Mitigation:

* do not start this before DTR spine is stable  
* do not build GUI layer until council MVP is already useful

---

# **18\. Runbook**

## **First**

Implement only:

* CO-G1  
* CO-G2  
* CO-G3  
* CO-G4  
* CO-G5  
* CO-G6

That gives a worktree council MVP.

## **Second**

Implement:

* CO-G7 through CO-G10

That gives usage-aware failover.

## **Third**

Implement:

* CO-G11 through CO-G15

That gives merge synthesis and CLI/public usability.

## **Last**

CO-G16 only if the earlier phases are already battle-stable.

---

# **19\. Codex handoff prompt**

Use this prompt as the exact execution brief.

You are implementing CO-01: DanteCode Council Orchestrator \+ DanteForge Council Protocol.

Goal:  
Build a usage-aware, NOMA-enforcing multi-agent orchestrator for DanteCode that coordinates multiple coding agents through isolated git worktrees, structured handoff packets, overlap detection, merge synthesis, and verified final integration. DanteForge provides the portable protocol, review, synthesis, and verification helpers.

Hard architectural split:  
\- DanteForge owns portable council protocol, handoff packet schema, intent diff, synthesis review, merge audit, and verification helpers  
\- DanteCode owns live council control plane, usage ledger, agent adapters, worktree observation, overlap detection, merge brain, and CLI  
\- Do NOT make GUI automation the primary control path  
\- Do NOT duplicate the conductor logic inside DanteForge

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- Fail closed on ambiguous ownership, low merge confidence, and adapter health uncertainty  
\- Git is source of truth  
\- Preserve original candidate outputs before synthesis  
\- No auto-push on low-confidence merges  
\- GUI adapter layer is optional and must remain non-blocking to core functionality

Implement in this order:

DanteForge:  
1\. src/core/council-protocol/types.ts  
2\. src/core/council-protocol/handoff-packet.ts  
3\. src/core/council-protocol/intent-diff.ts  
4\. src/core/council-protocol/synthesis-review.ts  
5\. src/core/council-protocol/merge-audit.ts  
6\. extend src/cli/commands/party.ts  
7\. extend src/core/verifier.ts  
8\. extend src/core/pdse.ts  
9\. extend src/core/assistant-installer.ts

DanteCode:  
1\. packages/core/src/council/council-types.ts  
2\. packages/core/src/council/usage-ledger.ts  
3\. packages/core/src/council/council-state-store.ts  
4\. packages/core/src/council/agent-adapters/base.ts  
5\. packages/core/src/council/agent-adapters/dantecode.ts  
6\. packages/core/src/council/agent-adapters/codex.ts  
7\. packages/core/src/council/agent-adapters/claude-code.ts  
8\. packages/core/src/council/agent-adapters/antigravity.ts  
9\. packages/core/src/council/worktree-observer.ts  
10\. packages/core/src/council/overlap-detector.ts  
11\. packages/core/src/council/merge-confidence.ts  
12\. packages/core/src/council/merge-brain.ts  
13\. packages/core/src/council/handoff-engine.ts  
14\. packages/core/src/council/council-events.ts  
15\. packages/git-engine/src/conflict-scan.ts  
16\. packages/git-engine/src/merge.ts  
17\. extend packages/core/src/multi-agent.ts  
18\. extend packages/core/src/git-hook-handler.ts  
19\. extend packages/core/src/event-engine.ts  
20\. extend packages/core/src/event-triggers.ts  
21\. extend packages/git-engine/src/worktree.ts  
22\. add packages/cli/src/commands/council.ts  
23\. extend packages/cli/src/command-registry.ts  
24\. optionally extend packages/cli/src/commands/git.ts for council-aware conflict output

Core MVP requirements:  
\- start a council run  
\- create worktrees per lane  
\- persist mandates and run state  
\- detect overlap  
\- collect candidate patches  
\- create handoff packets on hard-cap/offline  
\- support at least one external adapter plus the DanteCode adapter  
\- synthesize merges with preserved originals  
\- verify before push

Golden flows:  
\- parallel non-overlapping edits  
\- same file different hunks  
\- same hunk conflicting intent  
\- usage-cap failover  
\- adapter crash/offline  
\- duplicate task assignment

At the end of each generation report:  
\- files changed  
\- tests added  
\- gates passed or failed  
\- remaining risks  
\- next generation

Do not claim completion until the golden flows pass and no core functionality depends on GUI automation.  
---

# **20\. Final judgment**

This is the right idea.

The correct interpretation is not:  
“DanteCode should click around all my other tabs.”

The correct interpretation is:  
“DanteCode should become the durable conductor that can coordinate the other environments, absorb their caps/failures, preserve their work, and produce one verified Git outcome.”

That is coherent with everything above, and it is strong enough to become one of the defining DanteCode features.

The right next move is **CO-G1 through CO-G6 only**. That gets you a real worktree council MVP without overcommitting to the fragile layer too early.

**Addendum to ChatGPT’s Council Orchestrator Packet**  
**Author:** Grok  
**Date:** 2026-03-20

**For:** Council member (you can hand this off immediately)

**Quick verdict on ChatGPT’s packet**

ChatGPT’s packet is **excellent** as the foundation for Phase 1 (SkillBridge compiler \+ runtime). It correctly locks the repo split, defines the canonical skillbridge.json, adds capability profiling, and respects Qwen’s filesystem-first skill model.

**This addendum adds the missing half** from Richard’s screenshot: live multi-agent Git orchestration \+ intelligent merge \+ usage-aware handoff. It also adds the new idea you just described (multiple council members editing DanteForge \+ PDSE documents in parallel with smart summarization and handoff).

Everything slots directly on top of ChatGPT’s work — no conflicts.

### **1\. The Full Vision (Screenshot \+ Parallel-Editing Layer)**

We now have a three-layer stack:

1. **SkillBridge** (ChatGPT’s packet) — portable skills across agents.  
2. **Council Orchestrator** (ChatGPT’s packet \+ this addendum) — live parallel work in worktrees with overlap detection and merge.  
3. **Council Self-Editing** (new Phase 3\) — DanteForge/PDSE documents themselves become editable by the full council. When one agent runs out of context or usage, another agent reviews, summarizes progress, lists what’s outstanding, and picks up exactly where the previous one left off.

This turns the council into **four parallel engineering teams** that never lose momentum.

### **2\. OSS We Learn From (Exact Lessons)**

* **Agent Orchestrator** (ComposioHQ/agent-orchestrator) — parallel worktrees \+ auto-conflict handling (exact screenshot pattern).  
* **Gas Town** (steveyegge/gastown) — persistent git-backed handoff for multi-agent Claude sessions.  
* **Parallel Code** (johannesjo/parallel-code) — side-by-side agents with worktrees.  
* **Merge Resolver** \+ **mergiraf** — AI \+ syntax-aware merge (feed both versions to PDSE).  
* **Continue.dev** — repo-defined AI checks for handoff/summarization.

### **3\. Minimal File Additions (Additive Only)**

**DanteForge (add these 3 files first — Phase 2 start):**

text

```
src/core/git-orchestrator/
  watcher.ts              ← monitors worktrees + file changes
  merger.ts               ← PDSE-powered intelligent merge + handoff summary
  index.ts                ← hooks into party --orchestrate
```

**DanteCode (add 1 file):**

text

```
packages/skill-adapter/src/git-merge-bridge.ts  ← calls DanteForge orchestrator
```

**Phase 3 (Council Self-Editing) — add later:**

text

```
src/core/pdse-handoff/
  reviewer.ts             ← summarizes PDSE edits
  summarizer.ts           ← generates “what was done / what’s left” packet
```

### **4\. Council Starter Build Order (Start Here Today)**

**Day 1–2 – Get the screenshot working**

1. src/core/git-orchestrator/watcher.ts (start simple: poll worktrees every 10s)  
2. src/core/git-orchestrator/merger.ts (basic PDSE compare \+ merge)  
3. Update src/cli/commands/party.ts (add \--orchestrate flag)  
4. Test: Open Codex \+ Claude Code side-by-side, edit the same file, run danteforge party \--orchestrate, verify merge \+ commit.

**Day 3 – Add usage-aware handoff**

Extend merger.ts to create a handoff packet when an agent hits a cap.

**Later (Phase 3\) – Self-editing of DanteForge/PDSE**

The council can now edit PDSE-score.json, CONSTITUTION.md, etc. in parallel. One agent summarizes, another picks up.

### **5\. Codex-Ready Handoff Prompt (Copy-Paste This to Codex)**

text

```
You are implementing Phase 2 of the Council Orchestrator (Git Orchestrator layer on top of SkillBridge).

Goal:
Build live multi-agent Git orchestration so Codex, Claude Code, Antigravity, and DanteCode can edit the same repo in parallel worktrees. Detect overlap, merge intelligently with PDSE, create handoff summaries, and commit cleanly.

Hard rules:
- Use existing worktree helpers
- Preserve originals before merge
- Fail closed on low-confidence merges
- Add tests for every file

Start with these files only:
1. src/core/git-orchestrator/watcher.ts
2. src/core/git-orchestrator/merger.ts
3. Update src/cli/commands/party.ts with --orchestrate flag

Golden flow to test:
Open two agents side-by-side, edit the same file, run danteforge party --orchestrate → auto-merge + commit.

Report files changed + tests added after each step.
```

---

**Ready to hand off.**

Copy ChatGPT’s full packet \+ this addendum and send it to the council member. They have everything they need to start building **today**.

When they finish the first three files above, let me know and I’ll give the next batch (handoff packet \+ Phase 3 self-editing of PDSE/DanteForge docs).

This is now a complete, shippable system. Let’s get the council moving. 🚀

