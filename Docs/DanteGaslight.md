## **DanteGaslight — Persistent Self-Critique & Iterative Refinement Loop**

### **DanteForge-Gated Adversarial Refinement on top of DanteSkillbook**

## **1\. Executive judgment**

This is one of the highest-leverage follow-ons to **DanteSkillbook**.

Why it matters:

* **DanteSkillbook** teaches the system from completed work.  
* **DanteGaslight** improves the work **before** it is finalized, then feeds the verified lesson into the Skillbook.  
* Together, they create a closed loop:  
  * attempt  
  * critique  
  * refine  
  * verify  
  * learn

That pattern is well-supported conceptually by current public work:

* ACE gives you the persistent Skillbook \+ role-specialization foundation.  
* Self-Refine shows that iterative self-feedback can materially improve output quality without extra training; the paper reports roughly 20% absolute average improvement across its evaluated tasks.  
* Reflexion shows the value of keeping verbal feedback in memory across trials rather than treating each attempt as stateless.

So the strategic call is:

**Build this.**  
But build it as a **governed refinement engine**, not as an unbounded “keep attacking yourself forever” loop.

## **2\. Core correction to the PRD**

The PRD is directionally right, but I would change the product thesis from:

* “infinite iteration loop”

to:

* **bounded adversarial refinement loop with explicit stop conditions**

That matters because the external patterns you are implicitly borrowing from are not “infinite” systems:

* Self-Refine is iterative but bounded by feedback/refinement cycles.  
* Reflexion is a retry-and-reflect framework with verbal memory, not a limitless loop.  
* ACE is structured around curated learning into a Skillbook, not unconstrained recursion.

So the correct Dante version is:

**Refine until one of four things happens:**

1. DanteForge PASS  
2. confidence threshold reached  
3. budget exhausted  
4. user/system stop signal

That is safer, cheaper, and easier to trust.

## **3\. Product thesis**

DanteCode needs a **persistent self-critique engine** that can:

* detect challenge signals from the user or runtime  
* run one or more refinement passes  
* escalate to deeper critique/research when needed  
* verify every iteration  
* stop safely  
* and only then distill the final verified lesson into DanteSkillbook

The real thesis is:

**DanteCode should not only learn from the past; it should challenge weak outputs in the present until they are either good enough or proven not worth more budget.**

## **4\. Relationship to the other machines**

This machine is not standalone. It sits on top of the rest of the system.

### **Depends directly on**

* **DanteSkillbook**  
* **Verification Spine / DanteForge gate**  
* **Runtime spine**  
* **background-agent**  
* **model-router**  
* **checkpointer**  
* optionally **Research / WebFetch** when critique needs evidence

### **Strengthens directly**

* reasoning quality  
* autonomy  
* persistent debug memory  
* verification confidence  
* repeated-task improvement

So the stack becomes:

* **DTR**: correct execution  
* **Skillbook**: persistent strategy memory  
* **Gaslight**: adversarial refinement before finalization  
* **Verification**: trust gate  
* **Memory**: broader context and facts

That is coherent.

## **5\. Scope**

## **In scope**

This machine must deliver:

* manual critique triggers from user phrases  
* optional auto-trigger after weak outputs  
* bounded iterative refinement  
* a fourth role dedicated to adversarial critique  
* DanteForge gate on **every** iteration  
* persistent iteration history  
* final verified lesson write-back into DanteSkillbook  
* Git-tracked iteration/session artifacts where appropriate  
* MCP/slash surfaces:  
  * `/gaslight on`  
  * `/gaslight off`  
  * `/gaslight stats`  
  * `/gaslight review`

## **Out of scope for MVP**

Do not start with:

* infinite or open-ended loops  
* recursive REPL/tool recursion inside critique by default  
* offline/batch reflective training  
* heavy visual timeline UI  
* autonomous triggers on every trivial response  
* fully automated research escalation for every critique pass

## **6\. Canonical architecture**

This should be built as a **DanteGaslight machine** with six organs.

## **6.1 Organ A — Trigger Detector**

This is the entry layer.

It should detect:

* explicit user challenge phrases  
* weak-output heuristic triggers  
* low-confidence/failed-verification outputs  
* optional configurable random audit rate for important tasks

Important correction: do not hard-code only meme phrases like “is this really your best.”  
Use a structured trigger system with:

* regex  
* semantic match  
* verification-score trigger  
* explicit user toggle

## **6.2 Organ B — Gaslighter Role**

This is the adversarial critique role.

It should not just say “do better.”  
It should produce structured critique:

* where the answer is weak  
* what is unproven  
* what is shallow  
* what likely failed verification  
* what missing evidence or reasoning would improve it

This role is the main addition beyond ACE’s published three-role setup. ACE already gives Agent / Reflector / SkillManager; DanteGaslight adds a sharper pre-learning critique role on top of that pattern.

## **6.3 Organ C — Iteration Engine**

This is the loop controller.

Pipeline:

1. initial output exists  
2. trigger fires  
3. gaslighter critiques  
4. optional evidence/research pass  
5. rewrite pass  
6. DanteForge verification  
7. repeat or stop

Hard caps live here:

* max iterations  
* max tokens  
* max elapsed time  
* max external tool escalation count

This is the heart of the machine.

## **6.4 Organ D — DanteForge Gate**

This is the non-negotiable trust layer.

Every iteration must be checked for:

* PDSE / quality  
* anti-stub  
* evidence sufficiency  
* consistency  
* safety / policy where relevant

Hard rule:

**No iteration is promoted as final, and no lesson is learned, without PASS.**

## **6.5 Organ E — Skillbook Writer**

This is the persistence layer.

Only the **final verified lesson** is eligible for skillbook insertion.

Not:

* every critique  
* every draft  
* every failed attempt

This is one place the PRD needed sharpening.  
Persisting raw critique history and persisting distilled strategy are different concerns.

### **Persist separately**

* **iteration history** → debug/replay/audit  
* **final lesson** → DanteSkillbook

## **6.6 Organ F — Budget & Safety Controller**

This is the control layer.

It must enforce:

* opt-in / opt-out behavior  
* “stop gaslighting” immediate abort  
* token/time/iteration hard caps  
* trigger thresholds  
* no autonomous loop on trivial outputs unless configured

This is what keeps the engine useful instead of annoying.

## **7\. Canonical package plan**

Create:

packages/dante-gaslight/  
 src/  
   types.ts  
   triggers.ts  
   gaslighter-role.ts  
   iteration-engine.ts  
   integration.ts  
   budget-controller.ts  
   iteration-history.ts  
   stop-conditions.ts  
   stats.ts  
   index.ts

Extend runtime spine with:

packages/runtime-spine/src/  
 gaslight-types.ts  
 runtime-events.ts  
 checkpoint-types.ts

### **Why this shape**

Grok’s proposed file list is close, but too thin for production use.  
You need explicit modules for:

* budget control  
* iteration history  
* stop conditions  
* stats

Otherwise they get buried inside `iteration-engine.ts` and become fragile.

## **8\. Shared integration surfaces**

## **Runtime spine**

Add:

* gaslight iteration types  
* critique trigger types  
* iteration stats  
* gaslight events  
* checkpoint linkage

## **DanteSkillbook**

Final verified lessons write here.

## **DanteForge**

Every iteration passes through the gate.

## **Agent loop**

Trigger detection should happen here for user-facing/manual challenges and output review.

## **Background agent**

Longer refinement loops should run safely without freezing the main interaction path when configured.

## **Checkpointer**

Every iteration history and pending refinement state should be resumable.

## **Model-router**

Role-specific routing:

* normal answer model  
* critique model  
* rewrite model  
* verification helper if needed

## **Optional Research / WebFetch**

Only escalate when critique explicitly identifies missing evidence.

## **9\. Product behavior model**

A governed Gaslight cycle should look like this:

### **Step 1 — Detect**

A challenge arrives:

* user phrase  
* weak-output threshold  
* explicit command  
* verification fail/near-fail

### **Step 2 — Critique**

Gaslighter identifies:

* weak reasoning  
* unsupported claims  
* shallow analysis  
* better structure needed  
* missing evidence/tools

### **Step 3 — Refine**

Agent rewrites based on critique.

### **Step 4 — Verify**

DanteForge scores the rewrite.

### **Step 5 — Decide**

* PASS → stop  
* FAIL but salvageable \+ budget remains → iterate  
* FAIL \+ budget exhausted → stop and return best bounded result with audit  
* STOP signal → abort immediately

### **Step 6 — Learn**

If final output passes and the insight is strategy-worthy:

* write distilled lesson to DanteSkillbook

## **10\. Trigger model**

This is where I would improve the PRD significantly.

The trigger system should have four channels:

### **A. Explicit user trigger**

Examples:

* “is this really your best?”  
* “go deeper”  
* “again but better”  
* “truth mode”  
* `/gaslight on`

### **B. Verification trigger**

If verification score is below threshold, refinement can auto-start.

### **C. Policy trigger**

Only for configured task classes:

* long research answers  
* code generation  
* plans  
* patch synthesis  
* high-stakes outputs

### **D. Random audit trigger**

Small configurable percentage for important outputs, useful for quality drift detection.

This is much better than phrase-only activation.

## **11\. Iteration history vs skillbook**

This distinction matters.

### **Iteration history**

Store:

* all drafts  
* all critiques  
* all verification results  
* stop reason  
* budgets used

This belongs in:

* runtime history  
* persistent debug memory  
* replay/audit

### **Skillbook**

Store only:

* distilled  
* reusable  
* governed  
* verified strategies

This belongs in:

* DanteSkillbook

This split is critical for keeping the skillbook clean.

## **12\. Phased roadmap**

## **Phase 1 — Contracts and trigger system**

Deliver:

* runtime-spine gaslight types/events  
* trigger detector  
* config model

Goal:

* engine can detect when refinement should begin

## **Phase 2 — Core critique and iteration loop**

Deliver:

* Gaslighter role  
* iteration engine  
* hard stop conditions  
* iteration history

Goal:

* bounded iterative refinement works end-to-end

## **Phase 3 — DanteForge gate and runtime weld**

Deliver:

* mandatory gate per iteration  
* integration with agent loop  
* background-agent/checkpoint support

Goal:

* refinement is safe and durable

## **Phase 4 — Skillbook learning and benchmarking**

Deliver:

* final lesson distillation  
* skillbook write-back  
* retrieval-aware use in later tasks  
* benchmark harness

Goal:

* measurable repeated-task uplift

## **13\. Non-functional requirements / SLOs**

These should be hard gates.

### **Hard SLOs**

* max iterations configurable, default bounded  
* max token budget configurable  
* max wall-clock time configurable  
* every iteration has explicit verification outcome  
* every gaslight session has durable iteration history  
* stop signal honored immediately  
* off-by-default or threshold-gated by policy

### **Additional V+E gates**

* no lesson written without PASS  
* no iteration chain continues without remaining budget  
* no hidden auto-trigger on trivial tasks unless configured  
* no “improvement” accepted without provenance

## **14\. Verification and benchmark model**

This machine only matters if it improves repeated work in a measurable way.

### **A. Manual challenge benchmark**

User challenges answer once.  
Measure quality delta between first draft and final accepted output.

### **B. Weak-output auto-trigger benchmark**

Weak draft triggers auto-refinement.  
Measure whether final output passes when original would not.

### **C. Cross-session strategy benchmark**

Refinement teaches one durable strategy.  
Later session uses it automatically.

### **D. Repeated-task benchmark**

Across repeated coding/research tasks:

* fewer repeated mistakes  
* better reasoning depth  
* better final scores  
* better autonomy

Self-Refine and Reflexion are the right conceptual baselines for this benchmarking logic: iterative feedback/refinement and verbal-memory-aided retries are the exact families of techniques this engine belongs to.

## **15\. Test charter**

## **Unit tests**

* trigger detection  
* budget controller  
* stop conditions  
* iteration history recording  
* critique-to-rewrite mapping  
* final lesson distillation  
* config policy behavior

## **Integration tests**

* manual trigger flow  
* auto-trigger from weak output  
* immediate stop override  
* checkpointed resumed refinement  
* DanteForge blocked iteration  
* DanteSkillbook final write

## **Golden flows**

### **GF-01 — Manual trigger**

User challenges output.  
System runs 3–5 bounded iterations.  
Final output is visibly stronger.

### **GF-02 — Auto-trigger on weak output**

Weak answer triggers refinement automatically.  
Only accepted if final verified result passes.

### **GF-03 — Cross-session learning**

One successful critique cycle creates a reusable lesson.  
Later session uses it automatically.

### **GF-04 — Safety override**

User says stop.  
Loop halts immediately.

### **GF-05 — Combined proof**

Long research/coding task gets challenged once, runs multiple iterations, ends with stronger verified output, and distills one durable lesson that improves later repeated work.

## **16\. Risks and corrections**

### **Risk 1 — token cost explosion**

Correction:

* hard caps  
* lite mode  
* meaningful-task policy  
* verification-threshold trigger instead of universal trigger

### **Risk 2 — user annoyance**

Correction:

* off by default or explicitly gated  
* visible progress  
* immediate stop command  
* per-task-class policy

### **Risk 3 — over-critiquing already-good outputs**

Correction:

* DanteForge confidence threshold  
* only auto-trigger below threshold  
* allow “good enough” stop state

### **Risk 4 — polluted skillbook**

Correction:

* only final verified lesson is learned  
* no raw iteration critique enters skillbook

## **17\. Runbook**

### **Step 1**

Build gaslight runtime types, trigger detection, and config model.

### **Step 2**

Build Gaslighter role and bounded iteration engine.

### **Step 3**

Add mandatory DanteForge verification per iteration.

### **Step 4**

Weld into agent loop, checkpoints, and background execution.

### **Step 5**

Add skillbook write-back and benchmark harness.

## **18\. Done definition**

This machine is complete only when all are true:

1. DanteGaslight can detect manual and policy-based triggers.  
2. It runs bounded iterative refinement safely.  
3. Every iteration is DanteForge-gated.  
4. Stop conditions and overrides are reliable.  
5. Final verified lessons can be written into DanteSkillbook.  
6. Iteration history is durable and replayable.  
7. Benchmarks show measurable quality uplift on challenged repeated tasks.  
8. DanteGaslight becomes a governed refinement engine, not a costly gimmick.

## **19\. Final judgment**

This is a very strong PRD conceptually.

My biggest V+E correction is:

**Build DanteGaslight as bounded adversarial refinement on top of Skillbook \+ Verification, not as literal infinite self-critique.**

That is how you get the upside of Self-Refine/Reflexion-style improvement without turning DanteCode into an expensive loop machine.

The strongest next move is to turn this into a **Codex-ready V+E Execution Packet** with:

* exact file order  
* runtime-spine changes  
* golden flows  
* hard gates  
* and DanteForge gate wiring.

Please build the Codex-ready V+E Execution Packet

I’m grounding the packet to the current ACE/self-refinement references first so the build order reflects the real public patterns rather than just the pitch language.

Thought for 22s

Yes. This should be a **full V+E Masterplan for a governed self-critique engine**, but I would change the framing in one important way:

**Build it as bounded adversarial refinement, not literal “infinite gaslighting.”**

That keeps the upside of the idea while avoiding the two biggest failure modes: runaway token burn and annoying over-critique. The external patterns behind this are real and strong: ACE gives you the Skillbook plus the three-role loop, Self-Refine shows iterative self-feedback can materially improve outputs at inference time, and Reflexion shows the value of carrying verbal feedback forward across attempts.

# **V+E Masterplan**

## **DanteGaslight**

### **Persistent Self-Critique & Iterative Refinement Loop, DanteForge-Gated**

## **1\. Executive judgment**

This is one of the strongest compounding features in the whole DanteCode roadmap because it sits exactly where quality is won or lost: **between first draft and final answer**.

DanteSkillbook improves the next run.  
DanteGaslight improves **this** run, then distills the verified lesson into the Skillbook for later reuse.

That gives you a closed loop:

1. produce output  
2. challenge output  
3. refine output  
4. verify output  
5. learn from output

ACE’s current public design already gives the right learning spine: a persistent Skillbook and a three-role pattern of Agent, Reflector, and SkillManager using the same base model with role-specific prompts. Self-Refine and Reflexion supply the broader research justification for iterative self-feedback and verbal memory across retries.

## **2\. Product thesis**

DanteCode needs a **persistent self-critique engine** that can:

* detect when an answer should be challenged,  
* run one or more refinement passes,  
* escalate to evidence gathering when critique reveals missing support,  
* stop safely when the answer is good enough or the budget is spent,  
* and only then write a distilled, verified lesson into DanteSkillbook.

The core thesis is:

DanteCode should not only learn from past failures. It should challenge weak outputs in the present until they are either good enough or not worth more budget.

## **3\. Core correction to the PRD**

The PRD is strong conceptually, but “infinite iteration” is the wrong implementation target.

The correct implementation target is:

### **Bounded adversarial refinement**

Stop when one of these becomes true:

* DanteForge returns PASS  
* confidence threshold is reached  
* token budget is exhausted  
* wall-clock budget is exhausted  
* max iterations reached  
* user says stop  
* policy says the task is not worth deeper refinement

This is closer to Self-Refine and Reflexion than to an uncontrolled loop. Self-Refine explicitly alternates feedback and refine steps to improve outputs, while Reflexion uses verbal reflection and memory to improve future attempts.

## **4\. Relationship to the other machines**

This machine is not standalone. It sits on top of the rest of the system.

### **Depends directly on**

* DanteSkillbook  
* Verification Spine / DanteForge gate  
* Runtime spine  
* background-agent  
* model-router  
* checkpointer  
* optional Research / WebFetch when critique identifies missing evidence

### **Strengthens directly**

* reasoning depth  
* autonomy  
* verification quality  
* persistent debug memory  
* repeated-task performance

So the stack becomes:

* DTR ensures execution correctness  
* Skillbook stores durable strategy  
* DanteGaslight improves current output before finalization  
* Verification Spine decides trust  
* Memory Engine keeps broader context and history

That is coherent and compounding.

## **5\. Scope**

## **In scope**

This machine must deliver:

* manual critique triggers from user phrases  
* optional auto-trigger on weak outputs  
* a dedicated critique role  
* bounded iterative refinement  
* mandatory DanteForge verification on every iteration  
* durable iteration history  
* final verified lesson write-back into DanteSkillbook  
* Git-tracked history where appropriate  
* runtime-spine events and checkpoints  
* MCP/slash commands:  
  * `/gaslight on`  
  * `/gaslight off`  
  * `/gaslight stats`  
  * `/gaslight review`

## **Out of scope for MVP**

Do not start with:

* unbounded loops  
* recursive tool nesting by default  
* offline/batch reflection training  
* heavy replay UI  
* auto-trigger on every trivial answer  
* mandatory research escalation for every critique pass

## **6\. Product behavior model**

A governed Gaslight cycle should look like this:

### **Step 1 — Detect**

A trigger arrives from:

* explicit user challenge,  
* low verification score,  
* configured task class,  
* optional light audit sampling.

### **Step 2 — Critique**

The Gaslighter role identifies:

* shallow reasoning  
* unsupported claims  
* missing structure  
* missing evidence  
* missing tool usage  
* obvious failure patterns

### **Step 3 — Refine**

The Agent rewrites using the critique.

### **Step 4 — Verify**

DanteForge evaluates the rewritten answer.

### **Step 5 — Decide**

* PASS: stop  
* FAIL but recoverable and budget remains: iterate  
* FAIL and budget exhausted: stop with best bounded result \+ audit  
* STOP signal: abort immediately

### **Step 6 — Learn**

Only if the final result passes and the extracted lesson is strategy-worthy:

* distill the lesson  
* write it to DanteSkillbook  
* Git-track it  
* checkpoint-link it

## **7\. Trigger model**

This is one place the concept needs structure.

The trigger system should have four channels.

### **A. Explicit user trigger**

Examples:

* “is this really your best?”  
* “go deeper”  
* “again but better”  
* “truth mode”  
* `/gaslight on`

### **B. Verification trigger**

If verification or confidence score is below threshold, refinement can auto-start.

### **C. Policy trigger**

Enable by task type:

* long-form research  
* plans  
* code generation  
* patch synthesis  
* high-stakes outputs

### **D. Random audit trigger**

Small configurable percentage for quality drift detection.

This is better than phrase-only activation and safer than always-on refinement.

## **8\. Canonical architecture**

This should be built as a **DanteGaslight machine** with six organs.

## **8.1 Trigger Detector**

Owns:

* regex triggers  
* semantic trigger detection  
* verification-threshold triggers  
* task-class policy triggers  
* opt-in / opt-out state

## **8.2 Gaslighter Role**

Owns:

* adversarial critique prompt  
* weakness extraction  
* “tear down and rebuild” instructions  
* structured critique output, not just generic “be better”

ACE already supplies the three-role pattern. DanteGaslight adds a fourth specialized critique role on top of that skeleton.

## **8.3 Iteration Engine**

Owns:

* execution of the refinement loop  
* stop conditions  
* token/time/iteration budgets  
* research escalation hooks  
* iteration history  
* lite mode vs standard mode

## **8.4 DanteForge Gate**

Owns:

* PDSE  
* anti-stub  
* evidence checks  
* consistency checks  
* PASS / FAIL / REVIEW-REQUIRED on each iteration

Hard rule:  
**No iteration becomes final, and no lesson is learned, without PASS.**

## **8.5 Skillbook Writer**

Owns:

* distillation of the final verified lesson  
* Skillbook update request  
* Git-tracked write  
* checkpoint linkage

Important separation:

* iteration history is not the Skillbook  
* only the final verified lesson is eligible for learning

## **8.6 Budget & Safety Controller**

Owns:

* iteration cap  
* token cap  
* time cap  
* stop override  
* opt-in / off-by-default policy  
* “good enough” threshold  
* no-loop guarantees

## **9\. Canonical package plan**

Create:

packages/dante-gaslight/  
 src/  
   types.ts  
   triggers.ts  
   gaslighter-role.ts  
   iteration-engine.ts  
   integration.ts  
   budget-controller.ts  
   iteration-history.ts  
   stop-conditions.ts  
   stats.ts  
   index.ts

Extend runtime spine with:

packages/runtime-spine/src/  
 gaslight-types.ts  
 runtime-events.ts  
 checkpoint-types.ts

This shape is stronger than the thin file plan in the PRD because it gives explicit homes to:

* budgets  
* stop conditions  
* iteration history  
* stats

instead of burying them in one oversized loop file.

## **10\. Shared integration surfaces**

### **Runtime spine**

Add:

* gaslight iteration records  
* critique trigger records  
* gaslight config  
* iteration stats  
* checkpoint linkage

### **DanteSkillbook**

The final verified lesson writes here.

### **DanteForge**

Every iteration is gated here.

### **Agent loop**

Trigger detection and post-output activation should start here.

### **Background agent**

Longer critique loops should run safely without freezing the main interaction path when configured.

### **Checkpointer**

Every iteration should be resumable.

### **Model-router**

Use role-specific routing for:

* normal answer  
* critique  
* rewrite  
* optional evidence check

### **Research / WebFetch**

Only escalate when critique explicitly says the answer lacks evidence.

## **11\. Iteration history vs Skillbook**

This distinction is critical.

### **Iteration history stores**

* all drafts  
* all critiques  
* all gate results  
* stop reasons  
* budget consumption  
* evidence escalation decisions

This belongs in:

* runtime history  
* persistent debug memory  
* replay/audit

### **Skillbook stores**

* only distilled, reusable, verified strategy

This belongs in:

* DanteSkillbook

That keeps the Skillbook clean and high-trust.

## **12\. Phased roadmap**

## **Phase 1 — Contracts and trigger system**

Deliver:

* gaslight types/events/checkpoint extensions  
* trigger detector  
* config model

Goal:

* engine can decide when refinement should begin

## **Phase 2 — Core critique and bounded loop**

Deliver:

* Gaslighter role  
* iteration engine  
* stop conditions  
* iteration history

Goal:

* bounded iterative refinement works end-to-end

## **Phase 3 — DanteForge gate and runtime weld**

Deliver:

* mandatory gate per iteration  
* agent-loop integration  
* background-agent support  
* checkpoint support

Goal:

* refinement is safe and durable

## **Phase 4 — Skillbook learning and benchmarking**

Deliver:

* final lesson distillation  
* skillbook write-back  
* retrieval-aware reuse in future tasks  
* benchmark harness

Goal:

* measurable repeated-task uplift

## **13\. Non-functional requirements / SLOs**

### **Hard SLOs**

* max iterations configurable and bounded  
* max token budget configurable  
* max elapsed time configurable  
* every iteration has an explicit verification outcome  
* every gaslight session has durable iteration history  
* stop signal honored immediately  
* off by default or threshold-gated by policy

### **Additional V+E gates**

* no lesson write without PASS  
* no iteration continues without budget  
* no hidden auto-trigger on trivial tasks unless configured  
* no accepted refinement without provenance

## **14\. Verification and benchmark model**

This machine matters only if it measurably improves repeated work.

### **A. Manual challenge benchmark**

One user challenge produces a visibly stronger final answer.

### **B. Weak-output auto-trigger benchmark**

Weak draft auto-triggers refinement and ends with a passable answer where the original would fail.

### **C. Cross-session strategy benchmark**

One critique cycle creates a reusable lesson that changes later behavior.

### **D. Repeated-task benchmark**

Across repeated coding/research tasks:

* fewer repeated mistakes  
* deeper reasoning  
* stronger final scores  
* lower corrective churn

Self-Refine’s reported average performance lift across its evaluated tasks is a strong conceptual justification for this benchmark style, though DanteCode should prove the gains on its own tasks and gates.

## **15\. Test charter**

## **Unit tests**

* trigger detection  
* budget controller  
* stop conditions  
* iteration history recording  
* critique-to-rewrite mapping  
* lesson distillation  
* config policy behavior

## **Integration tests**

* manual trigger flow  
* auto-trigger from weak output  
* immediate stop override  
* checkpointed resumed refinement  
* DanteForge blocked iteration  
* DanteSkillbook final write

## **Golden flows**

### **GF-01 — Manual trigger**

User challenges output.  
System runs 3–5 bounded iterations.  
Final output is visibly stronger.

### **GF-02 — Auto-trigger on weak output**

Weak answer triggers refinement automatically.  
Only accepted if final verified result passes.

### **GF-03 — Cross-session learning**

One successful critique cycle creates a reusable lesson.  
Later session uses it automatically.

### **GF-04 — Safety override**

User says stop.  
Loop halts immediately.

### **GF-05 — Combined proof**

Long research/coding task gets challenged once, runs multiple iterations, ends with a stronger verified output, and distills one durable lesson that improves later repeated work.

## **16\. Risks and corrections**

### **Risk 1 — token cost explosion**

Correction:

* hard caps  
* lite mode  
* meaningful-task policy  
* verification-threshold trigger instead of universal trigger

### **Risk 2 — user annoyance**

Correction:

* off by default or explicitly gated  
* visible progress  
* immediate stop command  
* per-task-class policy

### **Risk 3 — over-critiquing already-good outputs**

Correction:

* DanteForge confidence threshold  
* only auto-trigger below threshold  
* allow “good enough” stop state

### **Risk 4 — polluted Skillbook**

Correction:

* only final verified lesson is learned  
* no raw critique enters the Skillbook  
* REVIEW-REQUIRED queue for ambiguous lessons

## **17\. Runbook**

### **Step 1**

Build runtime-spine gaslight types, triggers, and config.

### **Step 2**

Build Gaslighter role and bounded iteration engine.

### **Step 3**

Add mandatory DanteForge verification on every iteration.

### **Step 4**

Weld into agent loop, checkpoints, and background execution.

### **Step 5**

Add Skillbook write-back and benchmark harness.

## **18\. Done definition**

This machine is complete only when all are true:

1. DanteGaslight can detect manual and policy-based triggers.  
2. It runs bounded iterative refinement safely.  
3. Every iteration is DanteForge-gated.  
4. Stop conditions and overrides are reliable.  
5. Final verified lessons can be written into DanteSkillbook.  
6. Iteration history is durable and replayable.  
7. Benchmarks show measurable quality uplift on challenged repeated tasks.  
8. DanteGaslight becomes a governed refinement engine, not a costly gimmick.

## **19\. Final judgment**

This is a strong PRD conceptually.

My biggest V+E correction is:

**Build DanteGaslight as bounded adversarial refinement on top of Skillbook \+ Verification, not as literal infinite self-critique.**

That is how you get the upside of ACE \+ Self-Refine \+ Reflexion style improvement without turning DanteCode into an expensive loop machine.

