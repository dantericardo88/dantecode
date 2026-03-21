## **DanteSkillbook \+ ACE Reflection Loop**

### **DanteForge-Gated Self-Improving Skillbook for DanteCode**

## **1\. Executive judgment**

This is one of the highest-ROI upgrades in the entire DanteCode roadmap.

Why:

* it directly attacks three weak areas at once: persistent learning, skill decomposition, and agent autonomy  
* it does so with a pattern that is already proven in current ACE repos  
* it compounds the value of the other machines you are already planning:  
  * Memory Engine  
  * Verification Spine  
  * DTR  
  * Council Orchestrator  
  * Research / WebFetch  
  * Git/Event Automation

ACE’s public design is already aligned with your goal: a self-improving agent loop built around a Skillbook and three roles—Agent, Reflector, SkillManager—with the skillbook persisted and reused across sessions. The current TypeScript port explicitly supports saving/loading a skillbook, gathering skill stats, and online learning modes, while the Python ACE repo frames the skillbook as an evolving system prompt that improves from execution feedback.

## **2\. Product thesis**

DanteCode needs a **DanteSkillbook** that makes every serious run teach the system something durable.

That means:

* strategies learned from prior runs are injected into future prompts  
* every meaningful task can trigger a reflection loop  
* no learning is accepted blindly  
* all accepted learning is:  
  * versioned  
  * diffable  
  * replayable  
  * auditable  
  * and DanteForge-verified before it becomes part of the Skillbook

The real product thesis is:

**DanteCode should not just remember what happened. It should remember what works, what fails, and what to do differently next time—under governance.**

## **3\. What ACE gives us, and what Dante must change**

ACE already gives you the core self-improvement loop:

* Agent generates an answer or action  
* Reflector analyzes execution and feedback  
* SkillManager curates updates into a Skillbook  
* the Skillbook is reused in future prompts  
* online learning is already a documented mode in the TypeScript port.

That is the right skeleton.

But DanteCode needs three critical upgrades beyond vanilla ACE:

### **A. Governance**

Nothing enters the Skillbook without DanteForge gates.

### **B. Git-native persistence**

The Skillbook must live in the repo-local DanteCode space and be tracked/versioned.

### **C. Runtime integration**

The loop must be woven into:

* background-agent  
* subagents  
* memory  
* verification  
* runtime-spine  
* worktrees  
* checkpoints

That is the difference between “ACE inside DanteCode” and “DanteCode becomes a governed self-improving system.”

## **4\. Scope**

## **In scope**

This machine must deliver:

* a repo-local DanteSkillbook stored under `.dantecode/skillbook/`  
* role-based Agent / Reflector / SkillManager pattern  
* OnlineACE-style reflection after meaningful tasks  
* gated Skillbook updates only after DanteForge PASS  
* Git-tracked skillbook persistence  
* prompt injection into active runs  
* background-agent execution compatibility  
* worktree-safe operation  
* checkpoint-aware skillbook state  
* MCP and slash-command surfaces  
* skillbook stats, review, and manual learn-now flows

## **Out of scope for MVP**

Do not start with:

* recursive Python REPL reflector  
* hosted kayba.ai dependency  
* full OfflineACE batch training  
* heavy visual UI for skillbook browsing  
* multi-user collaborative skillbook editing

Those can come later.

## **5\. Architecture**

This should be built as a **DanteSkillbook machine** with five organs.

## **5.1 Organ A — Skillbook Core**

This is the canonical state.

It owns:

* load/save  
* skill sections  
* update application  
* stats  
* versioning metadata  
* git integration hooks  
* pruning rules

ACE’s TS port already exposes a `Skillbook` with save/load, add skill, apply updates, and stats, which makes it the right conceptual donor for this layer.

## **5.2 Organ B — Role Engine**

This is the learning loop core.

It owns:

* DanteAgent  
* DanteReflector  
* DanteSkillManager  
* role-specific prompts  
* model-router routing for each role

ACE already uses three specialized roles with the same base model but different prompts. Dante should keep that pattern, because it is simple and clean.

## **5.3 Organ C — Reflection Loop**

This is the runtime learning engine.

It owns:

* task result ingestion  
* reflection trigger policy  
* candidate lesson extraction  
* skill update proposal generation  
* “lite mode” vs “full mode”  
* frequency controls for trivial vs meaningful tasks

This should be OnlineACE-style first, because current ace-ts already exposes online learning patterns and the PRD correctly prioritizes that over offline training.

## **5.4 Organ D — DanteForge Gate**

This is the non-negotiable trust layer.

It owns:

* PDSE scoring  
* anti-stub  
* evidence requirements  
* pass/fail decision for each proposed update  
* review-required state for uncertain lessons

Hard rule:  
**No Skillbook update without PASS.**

## **5.5 Organ E — Runtime Integration Layer**

This is the distribution layer.

It injects the Skillbook into:

* CLI runs  
* background runs  
* subagents  
* research tasks  
* code-editing tasks  
* long-running sessions  
* council lanes where appropriate

It also ensures:

* skillbook state is checkpoint-aware  
* skillbook updates are worktree-safe  
* cross-session learning is automatic but governed

## **6\. Canonical package plan**

Create:

packages/dante-skillbook/  
 src/  
   types.ts  
   skillbook.ts  
   roles.ts  
   prompts.ts  
   reflection-loop.ts  
   integration.ts  
   retrieval.ts  
   pruning.ts  
   git-skillbook-store.ts  
   review-queue.ts  
   stats.ts  
   index.ts

Extend runtime spine with:

packages/runtime-spine/src/  
 skillbook-types.ts  
 runtime-events.ts  
 checkpoint-types.ts

### **Why this shape**

Grok’s file list is basically right, but it is slightly too thin.  
You need explicit modules for:

* retrieval/top-K injection  
* pruning  
* git-backed skillbook persistence  
* manual review queue

Otherwise those concerns get buried in oversized core files.

## **7\. Shared integration surfaces**

This machine must plug into the rest of DanteCode directly.

### **A. Runtime Spine**

Add:

* skillbook types  
* skillbook events  
* skillbook snapshot linkage in checkpoints

### **B. Background Agent**

Reflection loops should run inside the same durable async system you already use for long-running tasks.

### **C. Checkpointer**

Each session checkpoint should be able to reference:

* current skillbook version  
* newly proposed updates  
* whether updates were accepted or blocked

### **D. Git Engine**

The skillbook should be:

* stored in `.dantecode/skillbook/`  
* versioned  
* diffable  
* recoverable

### **E. Verification Spine / DanteForge**

Every proposed update must be scored/gated.

### **F. Memory Engine**

The Skillbook is not the same as memory:

* memory stores facts, history, and semantic recall  
* skillbook stores **strategies and lessons**

But they should cross-link:

* memory can help retrieve relevant prior situations  
* skillbook can preserve reusable strategies distilled from them

### **G. Model Router**

Use role-specific model routing:

* agent path  
* reflector path  
* skill manager path  
* lightweight models when possible for cost control

## **8\. Product behavior model**

A governed learning cycle should look like this:

### **Step 1 — Execute**

Agent runs a meaningful task using current injected skills.

### **Step 2 — Capture outcome**

Collect:

* result  
* feedback  
* trace/evidence  
* runtime metadata  
* failure modes if any

### **Step 3 — Reflect**

Reflector analyzes:

* what worked  
* what failed  
* what strategy seems reusable  
* what should be avoided next time

### **Step 4 — Curate**

SkillManager converts reflection into:

* add  
* refine  
* remove  
* merge  
* reject

### **Step 5 — Verify**

DanteForge decides:

* PASS → update allowed  
* FAIL → no change  
* REVIEW REQUIRED → hold for manual review

### **Step 6 — Persist**

If PASS:

* apply update  
* save skillbook  
* Git-track it  
* checkpoint linkage updated

### **Step 7 — Reuse**

Future tasks automatically inject the relevant skills.

## **9\. Retrieval and token discipline**

This is one place Grok’s packet is directionally right but too light.

If you blindly inject the whole Skillbook, you will create token bloat.

So DanteSkillbook needs a **retrieval layer**:

* retrieve top-K relevant skills for the current task  
* rank by:  
  * recency  
  * relevance  
  * trust score  
  * task type  
  * project/worktree scope  
* prune or compress low-value or stale skills  
* enforce caps per section

ACE’s public docs show a JSON skillbook and skill stats, but Dante needs stronger controlled retrieval and pruning because your system is bigger and longer-running than the minimal ACE examples.

## **10\. Scope boundaries: what belongs here vs elsewhere**

## **Belongs in DanteSkillbook**

* strategies  
* heuristics  
* avoid/do rules  
* decomposition habits  
* repeated best practices  
* successful repair patterns  
* project-specific lessons

## **Does not belong here**

* raw debug trace  
* full semantic memory archive  
* every session transcript  
* raw tool execution history  
* Git/event trail  
* unverified guesses

That separation is critical:

* **Persistent Debug Memory** stores forensic truth  
* **Memory Engine** stores knowledge/context  
* **DanteSkillbook** stores distilled strategy

## **11\. Phased roadmap**

## **Phase 1 — Core Skillbook and governed persistence**

Deliver:

* skillbook schema  
* load/save  
* git-backed storage  
* stats  
* runtime-spine extensions

Goal:

* persistent, versioned governed skillbook exists

## **Phase 2 — Roles and Online Reflection**

Deliver:

* prompts  
* Agent / Reflector / SkillManager roles  
* reflection loop  
* task result ingestion  
* lightweight online learning

Goal:

* single-task end-to-end governed learning

## **Phase 3 — Runtime integration**

Deliver:

* background-agent integration  
* checkpoint integration  
* multi-agent / subagent integration  
* prompt injection  
* MCP/slash commands

Goal:

* learning is no longer manual or isolated

## **Phase 4 — Governance, pruning, and benchmarking**

Deliver:

* DanteForge hard gate  
* retrieval/top-K skill injection  
* pruning  
* review queue  
* benchmark harness  
* cross-session learning proof

Goal:

* self-improvement becomes safe, measurable, and cost-controlled

## **12\. Non-functional requirements / SLOs**

These should become hard gates.

### **Hard SLOs**

* reflection overhead under 8 seconds in standard mode  
* all skillbook changes Git-tracked  
* no skill update applied without explicit verification outcome  
* skill retrieval fast enough for prompt injection without noticeable friction  
* section growth bounded by pruning policy  
* worktree-safe and checkpoint-safe behavior

### **Additional V+E gates**

* no circular dependency around runtime-spine  
* no skillbook mutation outside the governed update path  
* no raw unverified lesson stored as canonical skill  
* no task that learns without provenance/evidence trail

## **13\. Verification and benchmark model**

This machine only matters if it makes the agent measurably better over repeated work.

So the benchmark harness must prove:

### **A. Persistence benchmark**

Run task, learn, restart, run again:

* learned strategies still injected  
* behavior changes appropriately

### **B. Guardrail benchmark**

Bad reflection insight should fail DanteForge gate and not pollute the skillbook.

### **C. Cross-session learning benchmark**

Strategy learned in session 1 improves session 2\.

### **D. Subagent synergy benchmark**

Subagents can contribute good lessons upward without corrupting parent behavior.

### **E. Repeated-task autonomy benchmark**

Across repeated coding tasks, show:

* fewer repeated mistakes  
* faster completion  
* better decomposition  
* lower corrective churn

ACE’s own public materials claim measurable performance gains and lower token use in some benchmarked scenarios; you should treat that as inspiration and then prove it inside DanteCode with your own harness.

## **14\. Test charter**

## **Unit tests**

* skillbook schema validation  
* save/load  
* apply update  
* stats  
* retrieval ranking  
* pruning  
* review queue behavior  
* prompt assembly  
* reflection update mapping

## **Integration tests**

* successful governed update  
* failed governed update  
* restart persistence  
* git commit on skillbook update  
* subagent-originated learning  
* checkpoint-linked skillbook state  
* prompt injection with relevant skills only

## **Golden flows**

### **GF-01 — Basic persistence**

Run task → skillbook updates → restart → same strategies injected.

### **GF-02 — Reflection and gated update**

Bad insight → DanteForge FAIL → no mutation.  
Good insight → PASS → skillbook updates.

### **GF-03 — Cross-session learning**

Session 1 learns a concrete safe strategy.  
Session 2 automatically uses it.

### **GF-04 — Subagent synergy**

Child task produces a reusable lesson.  
Parent reflection loop preserves it safely.

### **GF-05 — Repeated-task uplift**

Across repeated coding tasks over multiple sessions, the system gets measurably faster/cleaner with fewer repeated failures.

## **15\. Risks and corrections**

### **Risk 1 — token bloat**

Correction:

* top-K retrieval  
* section caps  
* prune old/low-value skills  
* compress/refine duplicate skills

### **Risk 2 — bad lessons getting in**

Correction:

* mandatory DanteForge PASS  
* review queue for uncertain updates  
* provenance/evidence required for accepted updates

### **Risk 3 — reflection cost**

Correction:

* lite mode  
* configurable frequency  
* stronger reflection only on meaningful tasks  
* role-based model routing

### **Risk 4 — conceptual overlap with memory**

Correction:

* keep memory and skillbook separate  
* facts/history in memory  
* distilled strategies in skillbook

## **16\. Runbook**

### **Step 1**

Build runtime-spine skillbook contracts and the core skillbook package first.

### **Step 2**

Implement load/save/git-backed persistence and stats.

### **Step 3**

Implement prompts, roles, and online reflection loop.

### **Step 4**

Add DanteForge gate and block all ungated updates.

### **Step 5**

Weld into background-agent, checkpoints, and runtime injection.

### **Step 6**

Add retrieval, pruning, review queue, and benchmark harness.

## **17\. Done definition**

This machine is complete only when all are true:

1. DanteSkillbook persists across sessions and is Git-tracked.  
2. Meaningful tasks can trigger governed reflection automatically.  
3. No skillbook update can occur without DanteForge PASS.  
4. Only relevant skills are injected into future prompts.  
5. Cross-session learning measurably changes future behavior.  
6. Subagents can contribute verified learning safely.  
7. Benchmarks show autonomy/decomposition/repeat-task improvement.  
8. DanteSkillbook becomes a governed self-improvement spine, not an uncontrolled prompt cache.

## **18\. Final judgment**

This is a very strong PRD conceptually.

My biggest V+E correction is:

**Do not import ACE as a framework. Import its learning loop into DanteCode’s governed runtime.**

That is how you get the upside of ACE without losing control of safety, provenance, and Git-native reproducibility.

The strongest next move is to turn this into a **Codex-ready V+E Execution Packet** with:

* exact package/file order  
* generation sequence  
* golden flows  
* hard gates  
* and DanteForge gate wiring.

Please create the Codex-ready V+E Execution Packet

I’m checking the current ACE repositories and docs first so the execution packet is anchored to the real March 2026 surface area, then I’ll lock it into the same Codex-ready V+E format as the other packets.

Thought for 34s

Below is the **Codex-ready V+E Execution Packet** for **RO-02 — DanteSkillbook \+ ACE Reflection Loop (DanteForge-Gated)**.

The core build decision is:

**Do not import ACE as a framework. Import its learning loop into DanteCode’s governed runtime.**

That matches the current ACE public surface: the ACE repos describe a **Skillbook** that evolves with execution feedback, explicitly use a three-role loop of **Agent / Reflector / SkillManager**, position the Skillbook as an evolving system prompt, and show coding-agent integrations including Claude Code and browser-use. The public examples also show the same core loop: task execution feeds reflection, which feeds Skillbook updates, which are injected back into later runs.

# **Codex-ready V+E Execution Packet**

## **RO-02 — DanteSkillbook \+ ACE Reflection Loop (DanteForge-Gated)**

## **0\. Executive call**

Build this as a **governed self-improvement spine** with five organs:

1. **Skillbook Core**  
2. **Role Engine**  
3. **Reflection Loop**  
4. **DanteForge Gate**  
5. **Runtime Integration Layer**

This machine should become the learning backbone for:

* CLI runs  
* background-agent runs  
* subagents  
* research tasks  
* code-editing tasks  
* long-running sessions  
* council lanes where appropriate

The public ACE repos already justify the skeleton: a persistent Skillbook, three specialized roles, online learning, and reuse of learned strategies across future tasks.

---

# **1\. Objective**

Implement the PRD’s intended uplift by shipping:

* repo-local DanteSkillbook persistence under `.dantecode/skillbook/`  
* Git-tracked skillbook state  
* Agent / Reflector / SkillManager role pattern  
* OnlineACE-style reflection after meaningful tasks  
* mandatory DanteForge PASS before any skill update  
* automatic skill injection into future runs  
* background-agent and worktree-safe execution  
* checkpoint-aware skillbook state  
* MCP and slash-command support  
* skillbook stats, review, and manual learn-now flows

## **1.1 Non-goals for MVP**

Do not start with:

* recursive Python REPL reflector  
* hosted kayba.ai dependency  
* full OfflineACE batch training  
* heavy visual Skillbook UI  
* multi-user collaborative editing

The public ACE docs do expose recursive reflection in the Python-oriented framework, but the simpler and safer first move for DanteCode is the lighter online loop your PRD calls for.

---

# **2\. Repo boundary and ownership**

## **2.1 Primary package**

Create:

packages/dante-skillbook/  
 src/  
   types.ts  
   skillbook.ts  
   roles.ts  
   prompts.ts  
   reflection-loop.ts  
   integration.ts  
   retrieval.ts  
   pruning.ts  
   git-skillbook-store.ts  
   review-queue.ts  
   stats.ts  
   index.ts

## **2.2 Runtime spine extensions**

Extend:

packages/runtime-spine/src/  
 skillbook-types.ts  
 runtime-events.ts  
 checkpoint-types.ts

## **2.3 Existing integration targets**

Integrate with:

* `background-agent.ts`  
* `multi-agent.ts`  
* `checkpointer.ts`  
* `git-engine`  
* DanteForge verification bridge  
* `model-router.ts`  
* MCP tool registry  
* slash-command registry

## **2.4 Hard rule**

`packages/dante-skillbook` is the source of truth.

Do not smear learning logic across prompts, memory helpers, and agent wrappers.

---

# **3\. Canonical architecture**

## **3.1 Skillbook Core**

Owns:

* load/save  
* skill sections  
* update application  
* stats  
* pruning hooks  
* version metadata  
* Git persistence

ACE’s public repos explicitly present the Skillbook as a persistent, evolving collection of strategies that gets injected back into future runs.

## **3.2 Role Engine**

Owns:

* DanteAgent  
* DanteReflector  
* DanteSkillManager  
* role-specific prompt assembly  
* model-router specialization

The three-role loop is not optional; it is the central ACE pattern described in the public ACE docs.

## **3.3 Reflection Loop**

Owns:

* task result ingestion  
* “meaningful task” trigger policy  
* candidate lesson extraction  
* update proposal generation  
* lite vs standard reflection frequency

Use the online-learning pattern first. The public ACE repos already show automatic learning from task execution and reuse of learned strategies, which is enough to justify OnlineACE-first implementation.

## **3.4 DanteForge Gate**

Owns:

* PDSE scoring  
* anti-stub  
* evidence requirement  
* PASS / FAIL / REVIEW-REQUIRED decision  
* review-queue linkage

**No update to Skillbook without PASS.**

## **3.5 Runtime Integration Layer**

Owns:

* skill injection into active tasks  
* background-agent flow compatibility  
* checkpoint linkage  
* worktree-safe operation  
* subagent contribution flow  
* MCP/slash exposure

---

# **4\. Public API contracts**

Create `packages/dante-skillbook/src/types.ts` with at least:

export interface Skill {  
 id: string;  
 title: string;  
 content: string;  
 section: string;  
 trustScore?: number;  
 sourceSessionId?: string;  
 sourceRunId?: string;  
 createdAt: string;  
 updatedAt: string;  
}

export interface UpdateOperation {  
 action: "add" | "refine" | "remove" | "merge" | "reject";  
 targetSkillId?: string;  
 candidateSkill?: Skill;  
 rationale: string;  
}

export interface SkillbookStats {  
 totalSkills: number;  
 sections: Record\<string, number\>;  
 lastUpdatedAt?: string;  
}

export interface ReflectionOutcome {  
 proposedUpdates: UpdateOperation\[\];  
 verified: boolean;  
 gateDecision: "pass" | "fail" | "review-required";  
}

Required exported functions:

* `DanteSkillbook.load()`  
* `DanteSkillbook.save()`  
* `DanteSkillbook.stats()`  
* `triggerReflection(taskResult)`  
* `getRelevantSkills(taskContext, limit?)`

Required exposed surfaces:

* `/skillbook status`  
* `/skillbook review`  
* `/learn-now`

---

# **5\. Storage and Git model**

## **5.1 Skillbook path**

Store the canonical skillbook under:

.dantecode/skillbook/skillbook.json

## **5.2 Git model**

Every accepted update must:

* write through the canonical Skillbook path  
* be Git-tracked  
* produce a meaningful commit message or staged change record according to repo policy  
* remain diffable and recoverable

## **5.3 Checkpoint model**

Every relevant checkpoint should capture:

* skillbook version/reference  
* any pending proposed updates  
* whether the update was accepted, blocked, or queued for review

---

# **6\. Retrieval and token discipline**

## **6.1 Retrieval layer**

Create `retrieval.ts` to:

* rank relevant skills  
* select top-K only  
* filter by task type  
* filter by project/worktree scope  
* filter by trust score  
* prefer recent and verified skills

## **6.2 Pruning layer**

Create `pruning.ts` to:

* cap section growth  
* merge duplicates  
* demote stale or low-value skills  
* keep max section size bounded  
* preserve high-trust skills longer

ACE’s public positioning around a Skillbook as an evolving system prompt is powerful, but DanteCode needs stronger retrieval and pruning because your runtime is broader, longer-lived, and more safety-constrained than a minimal ACE wrapper.

---

# **7\. Generation plan**

## **RO-G1 — Runtime spine extensions \+ Skillbook core**

Files:

* `packages/runtime-spine/src/skillbook-types.ts`  
* `packages/runtime-spine/src/runtime-events.ts` update  
* `packages/runtime-spine/src/checkpoint-types.ts` update  
* `packages/dante-skillbook/src/types.ts`  
* `packages/dante-skillbook/src/skillbook.ts`  
* tests

Acceptance:

* skillbook types compile  
* runtime events include skillbook update lifecycle  
* checkpoints can reference skillbook state  
* skillbook load/save/stats work

---

## **RO-G2 — Git-backed skillbook storage**

Files:

* `packages/dante-skillbook/src/git-skillbook-store.ts`  
* tests

Acceptance:

* `.dantecode/skillbook/skillbook.json` persists correctly  
* skillbook writes are Git-aware  
* diffable state preserved  
* no ad hoc file writes bypass storage layer

---

## **RO-G3 — Prompts**

Files:

* `packages/dante-skillbook/src/prompts.ts`  
* tests

Acceptance:

* role-specific prompts exist for Agent / Reflector / SkillManager  
* prompts can inject top-K relevant skills  
* DanteForge gate expectations embedded where appropriate  
* no hard-coded model assumptions

The public ACE repos justify the role-specialized prompt pattern directly.

---

## **RO-G4 — Roles**

Files:

* `packages/dante-skillbook/src/roles.ts`  
* tests

Acceptance:

* DanteAgent works with injected skills  
* DanteReflector produces candidate learnings  
* DanteSkillManager proposes update operations  
* model-router integration hooks exposed

---

## **RO-G5 — Reflection loop MVP**

Files:

* `packages/dante-skillbook/src/reflection-loop.ts`  
* tests

Acceptance:

* single task result can trigger reflection  
* proposed updates returned  
* no write applied yet without gate  
* lite mode and standard mode hooks present

---

## **RO-G6 — Retrieval and pruning**

Files:

* `packages/dante-skillbook/src/retrieval.ts`  
* `packages/dante-skillbook/src/pruning.ts`  
* `packages/dante-skillbook/src/stats.ts`  
* tests

Acceptance:

* top-K skill retrieval works  
* section caps enforced  
* low-value skill pruning works  
* stats reflect live skillbook state

---

## **RO-G7 — Review queue**

Files:

* `packages/dante-skillbook/src/review-queue.ts`  
* tests

Acceptance:

* review-required updates can be queued  
* queue state persists  
* manual review path possible  
* no blocked update silently disappears

---

## **RO-G8 — Integration surface**

Files:

* `packages/dante-skillbook/src/integration.ts`  
* `packages/dante-skillbook/src/index.ts`  
* tests

Acceptance:

* high-level wrapper exists  
* task execution can request skill injection  
* reflection can be triggered from one integration surface  
* external packages do not need to wire low-level internals directly

---

## **RO-G9 — Background-agent weld**

Files:

* integrate with `background-agent.ts`  
* tests

Acceptance:

* reflection loops run inside background execution when configured  
* long tasks can learn without blocking primary UX path unnecessarily  
* checkpoint-safe asynchronous operation exists

---

## **RO-G10 — Multi-agent weld**

Files:

* integrate with `multi-agent.ts`  
* tests

Acceptance:

* agent runs can consume Skillbook context  
* parent/child task flows can trigger reflection safely  
* no uncontrolled parallel skillbook mutation race

---

## **RO-G11 — Checkpointer weld**

Files:

* integrate with `checkpointer.ts`  
* tests

Acceptance:

* checkpoints capture skillbook state/version  
* interrupted runs preserve pending update state  
* replay/resume can reconstruct learning decisions

---

## **RO-G12 — Model-router weld**

Files:

* integrate with `model-router.ts`  
* tests

Acceptance:

* role-specific model routing works  
* lighter models can be used for reflection where configured  
* no provider lock-in

---

## **RO-G13 — DanteForge gate weld**

Files:

* DanteForge verification bridge files  
* tests

Acceptance:

* every proposed update gets PASS / FAIL / REVIEW-REQUIRED  
* FAIL blocks mutation  
* PASS allows applyUpdate  
* review-required routes into review queue

This is the single most important Dante-specific divergence from vanilla ACE. ACE’s public repos emphasize self-improvement; Dante must add governance before persistence.

---

## **RO-G14 — MCP and slash-command weld**

Files:

* MCP registration  
* slash-command registration  
* tests

Acceptance:

* `/skillbook status`  
* `/skillbook review`  
* `/learn-now`  
  are exposed and functional  
* responses use shared runtime contracts

---

## **RO-G15 — Benchmark harness**

Files:

* benchmark fixtures/reports  
* tests

Acceptance:

* repeated-task benchmark exists  
* cross-session learning benchmark exists  
* failed-insight rejection benchmark exists  
* subagent contribution benchmark exists  
* measurable before/after comparison captured

---

# **8\. Golden flows**

## **GF-01 — Basic persistence**

Input:

* complete meaningful task and accept a verified lesson

Pass:

* skillbook updated  
* Git-tracked  
* restart preserves the skill  
* future run injects it

## **GF-02 — Reflection and gated update**

Input:

* task outcome produces a bad lesson proposal, then a good one

Pass:

* bad lesson receives DanteForge FAIL and is not written  
* good lesson receives PASS and is written  
* review-required path queues instead of silently dropping

## **GF-03 — Cross-session learning**

Input:

* session 1 learns a concrete safe strategy

Pass:

* session 2 automatically uses that strategy  
* behavior measurably changes  
* retrieval logs explain why the skill was injected

## **GF-04 — Subagent synergy**

Input:

* parent task delegates to subagent, subagent discovers reusable lesson

Pass:

* child result can trigger reflection  
* verified lesson can be promoted upward safely  
* parent future runs benefit without leaking bad child behavior

## **GF-05 — Repeated-task uplift**

Input:

* repeated coding task across multiple sessions

Pass:

* skillbook accumulates verified strategies  
* later runs complete faster or with fewer repeated failures  
* benchmark records measurable improvement

---

# **9\. Hard gates**

## **Build gates**

* `dante-skillbook` builds cleanly  
* no circular dependency with runtime-spine, checkpointer, or DanteForge bridge

## **Type gates**

* strict TS compile passes  
* skill/update/checkpoint/event contracts stable

## **Test gates**

* unit tests for every new module  
* golden flow integration tests  
* benchmark harness runnable

## **Governance gates**

* no skillbook mutation without explicit verification outcome  
* no raw reflection output written directly as canonical skill  
* no section may grow past configured cap without pruning or merge behavior  
* no ungated update path in background or subagent flows

---

# **10\. Success criteria**

This packet is complete only when all are true:

1. DanteSkillbook persists across sessions and is Git-tracked.  
2. Meaningful tasks can trigger reflection automatically.  
3. No skill update can occur without DanteForge PASS or explicit review queue placement.  
4. Only relevant skills are injected into future prompts.  
5. Cross-session learning measurably changes behavior.  
6. Subagents can contribute verified learning safely.  
7. Benchmarks show repeated-task uplift.  
8. DanteSkillbook becomes a governed self-improvement spine, not an uncontrolled prompt cache.

---

# **11\. Risks and corrections**

## **Risk 1 — token bloat**

Correction:

* retrieval top-K only  
* section caps  
* pruning  
* merge duplicate/overlapping skills

## **Risk 2 — bad lessons slip through**

Correction:

* DanteForge gate mandatory  
* evidence/provenance required  
* review queue for uncertain lessons  
* no direct write path from reflector to canonical store

## **Risk 3 — reflection cost**

Correction:

* lite mode  
* configurable frequency  
* lighter model-router path for reflector where appropriate  
* focus on meaningful tasks, not every trivial action

## **Risk 4 — overlap with Memory Engine**

Correction:

* Memory Engine stores facts/history/context  
* DanteSkillbook stores distilled strategies  
* keep contracts distinct and cross-link by provenance only

## **Risk 5 — race conditions across lanes**

Correction:

* single governed storage/update path  
* serialized update application  
* checkpoint-linked pending update handling

---

# **12\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing RO-02: DanteSkillbook \+ ACE Reflection Loop (DanteForge-Gated) for DanteCode.

Goal:  
Build a governed self-improvement system for DanteCode based on the ACE Skillbook pattern:  
\- Skillbook persistence  
\- Agent / Reflector / SkillManager roles  
\- online reflection after meaningful tasks  
\- skill injection into future prompts  
\- mandatory DanteForge verification before any skillbook update  
\- git-tracked skillbook state  
\- background-agent and checkpoint-safe operation

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 450 LOC where practical  
\- Add tests in every generation  
\- packages/dante-skillbook is the source of truth  
\- Use runtime-spine for all skillbook types/events/checkpoints  
\- Skillbook must live in .dantecode/skillbook/skillbook.json  
\- All accepted updates must be Git-tracked  
\- NO update to Skillbook unless DanteForge verification returns PASS  
\- REVIEW-REQUIRED updates must go to a review queue, not be dropped or auto-applied  
\- Use model-router for role-specific prompt/model routing  
\- Reflection loops must run safely inside background-agent / worktree-aware execution

Create:  
packages/dante-skillbook/  
 src/  
   types.ts  
   skillbook.ts  
   roles.ts  
   prompts.ts  
   reflection-loop.ts  
   integration.ts  
   retrieval.ts  
   pruning.ts  
   git-skillbook-store.ts  
   review-queue.ts  
   stats.ts  
   index.ts

Also extend:  
packages/runtime-spine/src/  
 skillbook-types.ts  
 runtime-events.ts  
 checkpoint-types.ts

Generation order:

G1:  
\- runtime-spine skillbook extensions  
\- dante-skillbook/src/types.ts  
\- dante-skillbook/src/skillbook.ts  
\- tests

G2:  
\- dante-skillbook/src/git-skillbook-store.ts  
\- tests

G3:  
\- dante-skillbook/src/prompts.ts  
\- tests

G4:  
\- dante-skillbook/src/roles.ts  
\- tests

G5:  
\- dante-skillbook/src/reflection-loop.ts  
\- tests

G6:  
\- dante-skillbook/src/retrieval.ts  
\- dante-skillbook/src/pruning.ts  
\- dante-skillbook/src/stats.ts  
\- tests

G7:  
\- dante-skillbook/src/review-queue.ts  
\- tests

G8:  
\- dante-skillbook/src/integration.ts  
\- dante-skillbook/src/index.ts  
\- tests

G9:  
Integrate with:  
\- background-agent.ts  
\- tests

G10:  
Integrate with:  
\- multi-agent.ts  
\- tests

G11:  
Integrate with:  
\- checkpointer.ts  
\- tests

G12:  
Integrate with:  
\- model-router.ts  
\- tests

G13:  
Integrate DanteForge verification gate  
\- tests

G14:  
Integrate:  
\- MCP tools  
\- slash commands  
\- tests

G15:  
\- benchmark harness / fixtures / reports  
\- tests

Required public APIs:  
\- DanteSkillbook.load() / save() / stats()  
\- triggerReflection(taskResult)  
\- getRelevantSkills(taskContext, limit?)  
\- /skillbook status  
\- /skillbook review  
\- /learn-now

Golden flows:  
\- basic persistence  
\- reflection and gated update  
\- cross-session learning  
\- subagent synergy  
\- repeated-task uplift

At the end of each generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until the repeated-task uplift flow passes with measurable improvement.  
---

# **13\. Final judgment**

This is one of the best compounding features in the whole DanteCode roadmap, but only if you keep the order right:

**skillbook core → governed persistence → roles → reflection → gate → runtime weld → retrieval/pruning → benchmarks**

That gets you the ACE upside without sacrificing Dante’s safety, provenance, and Git-native reproducibility.

