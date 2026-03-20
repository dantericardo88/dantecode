**DanteCode Verification / QA Enhancement PRD v1.0**

**Objective:** Close the critical gaps identified in the live repo analysis (DanteForge pipeline \+ anti-stub tests \+ gates are a strong foundation, but lack systematic multi-stage verification, metric-driven scoring, critic/debate loops, output validation rails, structured evaluation harnesses, and deep integration with reasoning chains / subagent spawning).  
**Target scores:** Verification / QA **9.0+** (from my current 7.5) with strong uplift to Model Reasoning Chains, Agent Reasoning / Autonomy, and Production Maturity.

**Scope:** Supercharge DanteForge into a production-grade, observable, multi-agent verification engine with rails, metrics, and self-correction — fully MCP-compatible, Git-native, and DanteForge-verifiable by design.

### **Top 4-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

Selected after direct 2026 ecosystem review (MIT/Apache-friendly, agent-focused verification patterns).

1. **LangGraph.js (langchain-ai/langgraphjs)**  
   * Why harvest: Gold standard for stateful verification graphs with built-in reflection and critic nodes.  
   * Harvest targets: Verifier nodes, multi-step critique loops, conditional verification edges, persistent checkpointed evaluation traces.  
   * GitHub: [https://github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs)  
   * Direct win: Turns basic gates into observable, graph-powered verification workflows.  
2. **DeepEval (confident-ai/deepeval)**  
   * Why harvest: Modern pytest-style LLM/agent evaluation framework used by production agents for metric-driven QA.  
   * Harvest targets: Test-case generation, metric suites (faithfulness, correctness, hallucination), evaluation harness patterns, assertion-based gates.  
   * GitHub: [https://github.com/confident-ai/deepeval](https://github.com/confident-ai/deepeval)  
   * Direct win: Instant structured testing \+ scoring that maps perfectly to PDSE.  
3. **DSPy (dspy-ai/dspy — port architecture)**  
   * Why harvest: Revolutionary signature \+ optimizer approach that systematically improves verification quality.  
   * Harvest targets: Evaluator signatures, bootstrapping metrics, self-optimizing verification pipelines, few-shot critic patterns.  
   * GitHub: [https://github.com/dspy-ai/dspy](https://github.com/dspy-ai/dspy)  
   * Direct win: Makes DanteForge self-improving over time.  
4. **CrewAI (crewAIInc/crewAI — port critic patterns)**  
   * Why harvest: Battle-tested multi-agent debate and critic validation loops.  
   * Harvest targets: Dedicated critic agents, validation/debate flows, hierarchical QA checkpoints, consensus mechanisms.  
   * GitHub: [https://github.com/crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)  
   * Direct win: Multi-agent verification that integrates natively with our subagent spawning.  
5. **OpenHands (All-Hands-AI/OpenHands)**  
   * Why harvest: Practical, long-horizon QA and self-verification loops built for real coding agents.  
   * Harvest targets: Iterative verification cycles, sandboxed evaluation harness, reflection \+ correction triggers, stability metrics.  
   * GitHub: [https://github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)  
   * Direct win: Closes the “anti-stub” and production QA gap with proven patterns.

### **Functional Requirements (MVP \+ Phased)**

**Core MCP Tools / Slash Commands:**

* verify\_output(task, output, criteria?) → PDSE score \+ critique trace  
* run\_qa\_suite(planId, outputs) → full metric report  
* critic\_debate(subagents, output) → consensus verification  
* add\_verification\_rail(rule) → runtime guard

**Must-Have Features**

* Multi-stage verification pipeline (syntactic → semantic → factual → safety)  
* PDSE scoring engine with configurable metrics (faithfulness, correctness, hallucination, completeness)  
* Critic / debate agents (tie into subagent spawning)  
* Output validation rails (Guardrails-inspired) \+ hard/soft gates  
* Structured test harness (DeepEval-style) for plans, skills, and outputs  
* Full traceability and observability (tied to checkpointer \+ reasoning traces)  
* DanteForge self-optimization loop (DSPy-inspired)

**Advanced (Phase 2+)**

* Automatic test-case generation  
* Cross-session benchmark tracking  
* Vision \+ multimodal verification  
* Automated PR-level QA for git-engine outputs

### **Non-Functional Requirements**

* Latency: \<800ms typical verification pass  
* Reliability: 100% gate enforcement, zero unverified outputs in production mode  
* Observability: Complete traces \+ confidence scores in CLI/VS Code  
* Model-agnostic: Works across all providers via model-router  
* Safety: Git worktree isolation \+ recovery-engine integration

### **Implementation Recommendations (DanteCode-Specific)**

* New module: packages/verification-engine (or major enhancement to existing DanteForge)  
* Core new files: pdse-scorer.ts, critic-debater.ts, verification-graph.ts, qa-harness.ts, rails-enforcer.ts  
* Heavy reuse: danteforge core, checkpointer.ts, recovery-engine.ts, model-router.ts, reasoning-graph.ts (from previous PRD), subagent spawning, git-engine  
* MCP \+ slash-command \+ streaming support out of the box

### **Phased Roadmap**

**Phase 1 (1 week):** LangGraph.js verifier nodes \+ basic PDSE enhancement \+ rails (quick jump to 8.5)  
**Phase 2 (1–2 weeks):** DeepEval harness \+ DSPy-style metrics \+ critic agents  
**Phase 3 (1–2 weeks):** CrewAI/OpenHands debate loops \+ full integration with reasoning chains

**Phase 4 (1 week):** Polish, auto-optimization, benchmarks, VS Code verification dashboard preview

### **Success Metrics & Verification**

* DanteForge pass rate on all outputs \>98% in production mode  
* Internal benchmark: 30+ complex tasks with measurable hallucination reduction  
* SWE-bench / custom QA suite uplift  
* Traceability score and user confidence in verification logs  
* Production maturity: full test coverage for new verification module

### **Risks & Mitigations**

* Verification latency → Configurable strictness levels \+ caching of common checks  
* Overly strict gates → Soft-mode fallback \+ user override with audit log  
* Metric drift → DSPy-style bootstrapping \+ periodic self-optimization  
* Complexity → Start with LangGraph \+ DeepEval patterns, then layer critics

This PRD is ready to copy-paste directly into DanteCode’s planner/orchestrator/wave mode. It gives concrete, up-to-date GitHub targets and perfect integration with your existing architecture (DanteForge, checkpointer, recovery-engine, reasoning chains, subagent spawning, git-engine).

Once shipped, Verification / QA becomes DanteCode’s unbreakable backbone — metric-driven, observable, and self-improving. Let me know if you want API type signatures, a starter TS stub for pdse-scorer.ts, or the next PRD (e.g., Production Maturity, Agent Reasoning / Autonomy, or Inline Completions)\!

# **V+E Masterplan**

## **DanteCode Verification / QA Enhancement**

### **Metric-Driven, Multi-Stage, Multi-Agent Verification Spine**

## **1\. Executive judgment**

This should be built as a **first-class verification machine** with shared contracts, not as a scattering of gates across the codebase.

The PRD’s real thesis is sound:

* DanteForge and anti-stub tests are a strong base,  
* but the system still lacks systematic multi-stage verification,  
* metric-driven scoring,  
* critic/debate loops,  
* validation rails,  
* structured QA harnesses,  
* and deep integration with reasoning chains and subagent spawning.

The target outcome is also clear:

* move Verification / QA from about **7.5 to 9.0+**,  
* while lifting reasoning chains, agent autonomy, and production maturity with it.

My strongest architectural judgment is this:

### **Verification should become DanteCode’s backbone**

Not:

* one extra command,  
* one extra score,  
* or one more “review step.”

But:

* a graph-powered verification engine,  
* with observable traces,  
* configurable rails,  
* critic/debate loops,  
* and structured evaluation harnesses,  
* reusable by every other subsystem.

## **2\. Product thesis**

DanteCode needs a **production-grade verification engine** that can evaluate outputs at multiple levels:

1. **Syntactic**  
2. **Semantic**  
3. **Factual**  
4. **Safety / policy**  
5. **Completeness / production readiness**

The PRD explicitly calls for that multi-stage pipeline, plus configurable PDSE-style metrics such as faithfulness, correctness, hallucination, and completeness.

So the final product thesis is:

**Every meaningful output in DanteCode should be able to pass through a structured, observable, metric-driven verification graph before it is trusted.**

## **3\. Purpose and problem statement**

Today, DanteCode can already produce and test work, but the PRD correctly identifies the gaps:

* verification is not yet systematic,  
* scoring is not yet rich enough,  
* critic/debate patterns are underdeveloped,  
* output rails are weak,  
* evaluation harnesses are thin,  
* and verification is not deeply wired into reasoning chains or spawned subagents.

That creates four practical problems:

### **A. Trust gap**

Outputs may look good but still be under-verified.

### **B. Observability gap**

The system lacks complete critique traces, confidence surfaces, and structured verification evidence.

### **C. Self-correction gap**

The system does not yet have strong critic/debate and self-optimization loops.

### **D. Reuse gap**

Verification is not yet the shared spine used by research, subagents, Git outputs, and reasoning flows.

The PRD’s proposed commands already imply the right solution:

* `verify_output`  
* `run_qa_suite`  
* `critic_debate`  
* `add_verification_rail`

## **4\. Scope**

## **In scope**

This machine must deliver:

* multi-stage verification graph  
* PDSE scorer with configurable metrics  
* critic/debate verification loops  
* hard and soft output rails  
* structured QA harness  
* traceability and observability  
* self-optimization / bootstrapping loop  
* MCP compatibility  
* slash-command support  
* streaming verification progress  
* integration with:  
  * checkpointer  
  * recovery-engine  
  * model-router  
  * reasoning chains  
  * subagent spawning  
  * git-engine  
  * DanteForge core

That is exactly the scope the PRD describes.

## **Advanced scope**

Later phases should add:

* automatic test-case generation  
* cross-session benchmark tracking  
* multimodal verification  
* PR-level QA for Git outputs.

## **Out of scope for MVP**

Do not start with:

* full multimodal verification everywhere,  
* full PR automation everywhere,  
* or heavy self-optimization loops before the base graph and harness are stable.

The PRD’s risk section is correct: complexity must be controlled by starting with LangGraph \+ DeepEval patterns, then layering critics and optimization.

## **5\. Architecture**

The V+E answer is to build this as a **Verification Spine** with four main organs.

## **5.1 Organ A — Verification Graph Engine**

This is the heart.

It should model verification as a directed graph of nodes:

* parse / syntax check  
* structural validation  
* semantic critique  
* factuality / grounding  
* safety / policy  
* completeness  
* final confidence synthesis

The PRD explicitly highlights LangGraph.js as the gold-standard harvest target for stateful verification graphs, reflection nodes, conditional edges, and checkpointed traces.

## **5.2 Organ B — PDSE Scoring Engine**

This is the metrics layer.

It should score outputs along configurable dimensions:

* faithfulness  
* correctness  
* hallucination risk  
* completeness  
* possibly style/contract adherence where relevant

The PRD is explicit that this scoring should be configurable and central.

## **5.3 Organ C — Critic / Debate Engine**

This is the multi-agent validation layer.

It should support:

* one or more critic agents,  
* review/debate over candidate outputs,  
* consensus or adjudication,  
* and structured critique traces.

The PRD explicitly wants critic/debate agents tied into subagent spawning and inspired by CrewAI/OpenHands patterns.

## **5.4 Organ D — QA Harness \+ Rails**

This is the enforcement layer.

It should provide:

* structured test suites for plans, skills, outputs, and artifacts,  
* hard/soft gates,  
* runtime rails,  
* audit logs for overrides,  
* and reusable benchmark runs.

The PRD explicitly calls for DeepEval-style structured evaluation and Guardrails-inspired rails.

## **6\. Canonical package plan**

The PRD already suggests the right direction: a new `packages/verification-engine` or a major DanteForge enhancement. The V+E recommendation is:

Build a new package, but make it deeply integrated with DanteForge rather than burying it inside unrelated modules.

Recommended structure:

packages/verification-engine/  
 src/  
   types.ts  
   verification-graph.ts  
   pdse-scorer.ts  
   critic-debater.ts  
   qa-harness.ts  
   rails-enforcer.ts  
   metric-suite.ts  
   confidence-synthesizer.ts  
   traces/  
     trace-recorder.ts  
     trace-serializer.ts  
   critics/  
     critic-runner.ts  
     consensus.ts  
   harness/  
     test-case.ts  
     suite-runner.ts  
     benchmark-runner.ts  
   optimization/  
     bootstrapping.ts  
     verifier-tuning.ts  
   index.ts

This maps directly to the PRD’s recommended core files:

* `pdse-scorer.ts`  
* `critic-debater.ts`  
* `verification-graph.ts`  
* `qa-harness.ts`  
* `rails-enforcer.ts`

## **7\. Shared integration surfaces**

The PRD is very clear that this engine must not live in isolation. It should heavily reuse:

* DanteForge core  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* `reasoning-graph.ts`  
* subagent spawning  
* `git-engine`

So the V+E integration plan is:

### **A. Checkpointer**

Store:

* verifier node traces,  
* critic outputs,  
* benchmark results,  
* override events,  
* confidence history.

### **B. Recovery-engine**

Resume:

* long-running verification graphs,  
* debate loops,  
* benchmark suites,  
* suspended QA passes.

### **C. Model-router**

Choose:

* cheap verifier for syntactic checks,  
* stronger verifier for semantic/factual critique,  
* multi-model debate where needed.

### **D. Reasoning graph / subagents**

Verification should plug into:

* spawned critics,  
* spawned specialist validators,  
* reasoning chain checkpoints,  
* final synthesis review.

### **E. Git-engine**

Run verification on:

* generated patches,  
* PR-level diffs,  
* merge outputs,  
* council synthesis outputs.

## **8\. Public API surface**

The PRD’s four core tools are correct and should be kept.

Recommended contracts:

export interface VerifyOutputResult {  
 score: number;  
 dimensions: Record\<string, number\>;  
 confidence: number;  
 passed: boolean;  
 critiqueTrace: Array\<Record\<string, unknown\>\>;  
 railsTriggered: Array\<Record\<string, unknown\>\>;  
}

export interface QaSuiteResult {  
 suiteId: string;  
 passed: boolean;  
 metrics: Record\<string, number\>;  
 failures: Array\<Record\<string, unknown\>\>;  
 tracePath?: string;  
}

export interface CriticDebateResult {  
 consensus: "pass" | "fail" | "review-required";  
 critics: Array\<Record\<string, unknown\>\>;  
 rationale: string;  
 confidence: number;  
}

export interface VerificationRailResult {  
 ruleId: string;  
 action: "allow" | "warn" | "block";  
 reason: string;  
}

Core surface:

* `verifyOutput(task, output, criteria?)`  
* `runQaSuite(planId, outputs)`  
* `criticDebate(subagents, output)`  
* `addVerificationRail(rule)`

## **9\. Execution pipeline**

A verification run should follow a deterministic multi-stage path:

### **Step 1 — Structural / syntactic check**

Basic parse, schema, contract, syntax.

### **Step 2 — Semantic verification**

Does the output actually satisfy the task?

### **Step 3 — Factual / grounding verification**

Is it grounded in evidence or source material where applicable?

### **Step 4 — Safety / rails**

Does it violate runtime or policy rails?

### **Step 5 — Critic / debate loop**

If confidence is low, or stakes are high, run critics.

### **Step 6 — Confidence synthesis**

Combine metrics \+ critics \+ rails \+ traces into one final decision:

* pass  
* soft pass with warnings  
* review required  
* block

That directly operationalizes the PRD’s “multi-stage verification pipeline” plus critic/debate and rails.

## **10\. Organ-to-OSS harvest map**

The PRD’s OSS list is good and should remain the basis.

### **LangGraph.js**

Harvest:

* verifier nodes  
* reflection loops  
* conditional verification edges  
* checkpointed traces

### **DeepEval**

Harvest:

* pytest-style evaluation harness  
* metric suite structure  
* assertion-oriented QA workflows

### **DSPy**

Harvest:

* evaluator signatures  
* bootstrapping patterns  
* self-improving verifier tuning

### **CrewAI**

Harvest:

* critic / debate agent patterns  
* hierarchical QA checkpoints  
* consensus flows

### **OpenHands**

Harvest:

* long-horizon reflection / repair loops  
* practical coding-agent QA cycles  
* stability metrics

The V+E correction is:

* do not dependency-sprawl,  
* port patterns into Dante-native contracts.

## **11\. Phased roadmap**

The PRD’s roadmap is good. Keep it, but sharpen the deliverables.

## **Phase 1 — Graph \+ PDSE \+ rails**

Deliver:

* LangGraph-style verifier nodes  
* base PDSE enhancement  
* rails enforcement  
* trace recorder

Goal:

* fast move toward 8.5

## **Phase 2 — QA harness \+ metrics \+ critics**

Deliver:

* DeepEval-style suite runner  
* richer metric suite  
* critic agents  
* consensus flow

Goal:

* structured evaluation and stronger output confidence

## **Phase 3 — Debate loops \+ reasoning integration**

Deliver:

* CrewAI/OpenHands-style review loops  
* integration with subagent spawning  
* reasoning-chain checkpoint verification  
* Git output verification

Goal:

* verification becomes part of autonomy, not just post-checking

## **Phase 4 — Self-optimization \+ benchmarks \+ dashboard**

Deliver:

* DSPy-inspired tuning/bootstrapping  
* benchmark tracking  
* verification dashboard preview  
* cross-session trend reporting

Goal:

* self-improving and observable verification backbone

## **12\. Non-functional requirements / SLOs**

These should become hard gates, not aspirations.

The PRD specifies:

* `<800ms` typical verification pass  
* `100%` gate enforcement  
* complete traces \+ confidence scores  
* model-agnostic support  
* Git worktree isolation \+ recovery-engine integration

V+E interpretation:

### **Hard SLOs**

* typical light verification pass under 800ms  
* no production-mode output bypasses verification without explicit audited override  
* every verification run emits a trace  
* every override is logged  
* model-router compatibility required  
* worktree-safe operation required

## **13\. Verification and benchmark model**

The PRD defines strong success metrics:

* DanteForge pass rate above 98%  
* internal benchmark with 30+ complex tasks  
* hallucination reduction  
* better traceability and user confidence  
* full test coverage for the verification module

So the V+E benchmark harness should include:

### **A. Output benchmark corpus**

30+ complex tasks across:

* code generation  
* patching  
* planning  
* research-based answers  
* multi-agent syntheses

### **B. Hallucination benchmark**

Track:

* unsupported claims  
* wrong file/path references  
* fake completion claims  
* dropped functionality in merge/synthesis tasks

### **C. Traceability benchmark**

Track:

* trace completeness  
* critique usefulness  
* override audit quality  
* user-visible confidence quality

## **14\. Test charter**

## **Unit tests**

* PDSE dimension scoring  
* rails enforcement  
* graph node transitions  
* consensus logic  
* confidence synthesis  
* metric suite registration  
* trace serialization

## **Integration tests**

* `verifyOutput` on normal outputs  
* `runQaSuite` on plan/skill/output bundles  
* `criticDebate` with multiple critics  
* rails block/warn/allow flow  
* checkpoint \+ recovery on long verification runs  
* Git diff / PR-level verification

## **Golden flows**

### **GF-01**

A normal output passes multi-stage verification with score, dimensions, confidence, and trace.

### **GF-02**

A weak or hallucinated output fails factual/semantic checks and is blocked or flagged review-required.

### **GF-03**

A critic debate produces consensus and rationale.

### **GF-04**

A rail blocks a forbidden output path, and the override path is audited.

### **GF-05**

A long verification run is checkpointed, interrupted, resumed, and completed.

### **GF-06**

A generated patch or council synthesis goes through verification before being marked push-ready.

## **15\. Risks and corrections**

The PRD’s risks are right. Here is the V+E correction.

### **Risk 1 — latency**

If verification becomes too heavy, users will bypass it.

Correction:

* strictness levels  
* cached common checks  
* fast path vs deep path

### **Risk 2 — overly strict gates**

If gates are too rigid, users will start distrusting the engine.

Correction:

* soft-mode fallback  
* override with audit log  
* review-required state between pass and block

### **Risk 3 — metric drift**

Metrics can go stale or become miscalibrated.

Correction:

* DSPy-style bootstrapping  
* periodic calibration  
* benchmark regressions

### **Risk 4 — complexity explosion**

Too many critics, too many graphs, too many metrics too early.

Correction:

* start with graph \+ PDSE \+ rails  
* then harness \+ critics  
* then debate \+ optimization

## **16\. Runbook**

### **Step 1**

Build the verification graph, PDSE scorer, and rails first.

### **Step 2**

Add trace recording and observable CLI/VS Code outputs.

### **Step 3**

Add QA harness and metric suite.

### **Step 4**

Add critic/debate loops and connect them to spawned subagents.

### **Step 5**

Integrate with reasoning chains, Git outputs, and broader runtime.

### **Step 6**

Add self-optimization and benchmark tracking only after the base engine is stable.

## **17\. Done definition**

This machine is complete only when all are true:

1. DanteCode has a real multi-stage verification graph.  
2. PDSE scoring is configurable and visible.  
3. Rails can warn or block outputs.  
4. Critic/debate flows work and produce consensus traces.  
5. QA suites can be run against plans, skills, and outputs.  
6. Verification is deeply integrated with checkpointer, recovery-engine, model-router, reasoning chains, subagent spawning, and git-engine.  
7. Production-mode outputs cannot bypass verification without audited override.  
8. Benchmark corpus shows measurable improvement in hallucination reduction and traceability.  
9. Verification becomes a shared backbone, not a feature island.

## **18\. Final judgment**

This is a strong PRD. It fits your stack very well.

The most important V+E correction is this:

**Build Verification / QA as DanteCode’s shared verification spine, not as a local enhancement to DanteForge tests.**

That is how it becomes the “unbreakable backbone” the PRD is aiming for.

The strongest next move is to convert this directly into a **Codex-ready V+E Execution Packet** with:

* exact package/file order,  
* phased generations,  
* golden flows,  
* and hard gates.

Please build the V+E Masterplan Document for this next

I’m locating the next uploaded PRD and converting it into the same V+E structure as the others so it stays consistent with the broader DanteCode roadmap.

Thought for 26s

I only see these uploaded PRDs in the session:

* `DanteCode Gaps PRD v1 part 1.md`  
* `DanteCode Gaps PRD v1 part 2.md`  
* `DanteCode Gaps PRD v1 part 3.md`

I already converted **part 3** into a full V+E Masterplan in the previous reply.

There is not a newer “next” PRD file attached yet. Upload **part 4** or paste the next document, and I’ll convert it into the same V+E Masterplan format immediately.

Sorry please produce the Codex-ready V+E Execution Packet

I’m grounding the packet to the uploaded QA/verification PRD and checking the current external patterns it names so the implementation order reflects the actual 2026 tool surfaces rather than old assumptions.

Thought for 55s

Below is the **Codex-ready V+E Execution Packet** for the **DanteCode Verification / QA Enhancement PRD v1.0**.

The key architectural decision is unchanged:

**Build verification as a shared spine, not a sidecar.**

That fits both the uploaded PRD and the current external patterns it references:

* LangGraph’s JS runtime is explicitly built around graph state persistence and checkpoints, which makes it the right model for multi-stage verification traces and resumable critic loops.  
* DeepEval is designed around evaluation datasets, test cases, and metrics such as G-Eval, which maps cleanly to a structured QA harness and metric-driven scoring.  
* DSPy’s current optimizer model is explicitly metric-driven, which makes it a good pattern for later verifier bootstrapping and calibration rather than a day-one dependency.

# **Codex-ready V+E Execution Packet**

## **VQ-01 — DanteCode Verification / QA Spine**

## **0\. Executive call**

Build this as a **dedicated verification engine** with four major organs:

1. **Verification Graph**  
2. **PDSE / Metrics Scorer**  
3. **Critic / Debate Engine**  
4. **QA Harness \+ Rails**

This engine must become the trust layer used by:

* research outputs,  
* WebFetch / extraction,  
* subagent outputs,  
* council synthesis,  
* code patches,  
* and final push-ready decisions.

## **1\. Objective**

Implement the PRD’s intended uplift by shipping:

* `verifyOutput(task, output, criteria?)`  
* `runQaSuite(planId, outputs)`  
* `criticDebate(subagents, output)`  
* `addVerificationRail(rule)`

with:

* multi-stage verification  
* configurable PDSE-style scoring  
* critic/debate loops  
* hard/soft rails  
* structured trace recording  
* checkpointed resumability  
* model-router integration  
* reasoning-chain and subagent integration  
* DanteForge verification compatibility

## **1.1 Non-goals for MVP**

Do not start with:

* full multimodal verification everywhere  
* full PR automation everywhere  
* broad auto-optimization before the base graph is stable  
* massive dashboard work before the engine is usable in CLI/API form

---

# **2\. Repo boundary and ownership**

## **2.1 New package**

Create:

packages/verification-engine/  
 src/  
   types.ts  
   verification-graph.ts  
   pdse-scorer.ts  
   critic-debater.ts  
   qa-harness.ts  
   rails-enforcer.ts  
   metric-suite.ts  
   confidence-synthesizer.ts  
   traces/  
     trace-recorder.ts  
     trace-serializer.ts  
   critics/  
     critic-runner.ts  
     consensus.ts  
   harness/  
     test-case.ts  
     suite-runner.ts  
     benchmark-runner.ts  
   optimization/  
     bootstrapping.ts  
     verifier-tuning.ts  
   index.ts  
 test/

## **2.2 Existing files to integrate with**

* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* `reasoning-graph.ts` or equivalent reasoning flow file  
* subagent spawning/orchestrator surfaces  
* `git-engine`  
* DanteForge verification/core  
* MCP tool registration  
* slash-command registration  
* streaming progress surfaces

## **2.3 Hard rule**

`packages/verification-engine` is the source of truth.

Do not scatter verification logic across five unrelated files and call that “done.”

---

# **3\. Canonical architecture**

## **3.1 Verification Graph**

`verification-graph.ts` owns the multi-stage flow:

1. structural / syntax check  
2. semantic check  
3. factual / grounding check  
4. safety / policy rail evaluation  
5. optional critic/debate loop  
6. confidence synthesis  
7. final decision

LangGraph’s checkpointed graph model is the correct external pattern here, but DanteCode should implement its own runtime contracts rather than import LangGraph assumptions directly into product logic.

## **3.2 PDSE / Metric Suite**

`pdse-scorer.ts` and `metric-suite.ts` own:

* faithfulness  
* correctness  
* hallucination risk  
* completeness  
* optional task-specific metrics

DeepEval’s current framing around test cases \+ metrics \+ evaluation datasets is the right reference pattern for this layer.

## **3.3 Critic / Debate Engine**

`critic-debater.ts`, `critic-runner.ts`, and `consensus.ts` own:

* one or more critics  
* review passes  
* debate loops  
* consensus or review-required outcome  
* rationale capture

## **3.4 QA Harness \+ Rails**

`qa-harness.ts`, `rails-enforcer.ts`, `suite-runner.ts`, and `benchmark-runner.ts` own:

* reusable evaluation suites  
* hard/soft gates  
* override logging  
* benchmark execution  
* regression detection

## **3.5 Optimization lane**

`bootstrapping.ts` and `verifier-tuning.ts` are phase-later.

DSPy’s current optimizer model is metric-driven, so this lane should tune verifier behavior against explicit metrics, not vague “improve quality” prompts.

---

# **4\. Public API contracts**

Create `packages/verification-engine/src/types.ts` with at least:

export interface VerificationCriteria {  
 requireFactuality?: boolean;  
 requireCompleteness?: boolean;  
 requireSafety?: boolean;  
 strictness?: "light" | "standard" | "strict";  
 metrics?: string\[\];  
}

export interface VerifyOutputResult {  
 score: number;  
 dimensions: Record\<string, number\>;  
 confidence: number;  
 passed: boolean;  
 critiqueTrace: Array\<Record\<string, unknown\>\>;  
 railsTriggered: Array\<Record\<string, unknown\>\>;  
 decision: "pass" | "soft-pass" | "review-required" | "block";  
}

export interface QaSuiteResult {  
 suiteId: string;  
 passed: boolean;  
 metrics: Record\<string, number\>;  
 failures: Array\<Record\<string, unknown\>\>;  
 tracePath?: string;  
}

export interface CriticDebateResult {  
 consensus: "pass" | "fail" | "review-required";  
 critics: Array\<Record\<string, unknown\>\>;  
 rationale: string;  
 confidence: number;  
}

export interface VerificationRailResult {  
 ruleId: string;  
 action: "allow" | "warn" | "block";  
 reason: string;  
}

Required exported functions:

* `verifyOutput(task, output, criteria?)`  
* `runQaSuite(planId, outputs)`  
* `criticDebate(subagents, output)`  
* `addVerificationRail(rule)`

---

# **5\. Trace and checkpoint model**

## **5.1 Trace recorder**

Every verification run must emit:

* node transitions  
* metric scores  
* critic outputs  
* rail triggers  
* final decision  
* override events if any

## **5.2 Checkpoint integration**

`checkpointer.ts` must persist:

* graph node progress  
* critic loop state  
* benchmark suite progress  
* partial traces  
* final decision payloads

## **5.3 Recovery integration**

`recovery-engine.ts` must be able to resume:

* interrupted graph passes  
* long benchmark suites  
* critic/debate rounds  
* suspended verification runs after timeout or restart

LangGraph’s checkpoint model is the right external reference for resumable graph execution.

---

# **6\. Generation plan**

## **VQ-G1 — Contracts spine**

Files:

* `packages/verification-engine/src/types.ts`  
* `packages/verification-engine/src/index.ts`  
* tests

Acceptance:

* core result and criteria types compile  
* exported API surface stable  
* no verification logic yet

---

## **VQ-G2 — Trace recorder**

Files:

* `packages/verification-engine/src/traces/trace-recorder.ts`  
* `packages/verification-engine/src/traces/trace-serializer.ts`  
* tests

Acceptance:

* trace events can be recorded and serialized  
* trace includes stage, timestamp, decision fragment, and metadata  
* no hidden in-memory-only trace path

---

## **VQ-G3 — Rails engine**

Files:

* `packages/verification-engine/src/rails-enforcer.ts`  
* tests

Acceptance:

* hard and soft rails supported  
* actions \= allow / warn / block  
* override requires explicit audit payload  
* rail evaluation deterministic

---

## **VQ-G4 — PDSE scorer**

Files:

* `packages/verification-engine/src/pdse-scorer.ts`  
* `packages/verification-engine/src/metric-suite.ts`  
* tests

Acceptance:

* dimensions computed separately  
* aggregate score computed reproducibly  
* configurable metric selection works  
* missing evidence can lower confidence or trigger failure

---

## **VQ-G5 — Confidence synthesis**

Files:

* `packages/verification-engine/src/confidence-synthesizer.ts`  
* tests

Acceptance:

* combines PDSE \+ rails \+ trace state into final confidence  
* outputs pass / soft-pass / review-required / block  
* thresholds configurable

---

## **VQ-G6 — Verification graph**

Files:

* `packages/verification-engine/src/verification-graph.ts`  
* tests

Acceptance:

* multi-stage node flow exists  
* stages can short-circuit  
* deep path can invoke critics later  
* graph state resumable  
* decision is not made outside graph

---

## **VQ-G7 — Critic runner**

Files:

* `packages/verification-engine/src/critics/critic-runner.ts`  
* `packages/verification-engine/src/critics/consensus.ts`  
* tests

Acceptance:

* one or more critics can run  
* consensus result returned  
* divergent critic outputs preserved  
* low-confidence consensus produces review-required, not fake pass

---

## **VQ-G8 — Critic debate engine**

Files:

* `packages/verification-engine/src/critic-debater.ts`  
* tests

Acceptance:

* structured debate flow supported  
* rationale generated  
* integrates with graph and confidence synthesis  
* critic outputs appear in trace

---

## **VQ-G9 — QA harness core**

Files:

* `packages/verification-engine/src/harness/test-case.ts`  
* `packages/verification-engine/src/harness/suite-runner.ts`  
* `packages/verification-engine/src/qa-harness.ts`  
* tests

Acceptance:

* suites can be declared and run  
* result payload structured  
* failures mapped to metric dimensions  
* trace bundle attached

DeepEval’s current split between test cases, metrics, and evaluation workflows is the right design reference for this harness.

---

## **VQ-G10 — Benchmark runner**

Files:

* `packages/verification-engine/src/harness/benchmark-runner.ts`  
* tests

Acceptance:

* benchmark corpus can run end-to-end  
* historical result format stable  
* regression surfaces clear  
* supports 30+ complex tasks for the corpus target

---

## **VQ-G11 — Checkpoint \+ recovery weld**

Files:

* integrate with `checkpointer.ts`  
* integrate with `recovery-engine.ts`  
* tests

Acceptance:

* interrupted verification resumes  
* benchmark suite resumes  
* critic/debate resumes if interrupted  
* no trace loss on recovery

---

## **VQ-G12 — Model-router weld**

Files:

* integrate with `model-router.ts`  
* tests

Acceptance:

* stage-specific model selection works  
* light verifier vs heavy verifier routing works  
* engine remains provider-agnostic

---

## **VQ-G13 — Reasoning/subagent weld**

Files:

* integrate with reasoning-chain/reasoning-graph surfaces  
* integrate with subagent spawning/orchestrator  
* tests

Acceptance:

* spawned critics possible  
* reasoning outputs can be verified before finalization  
* subagent outputs feed into verification graph  
* no orphan critic loops

---

## **VQ-G14 — Git/output weld**

Files:

* integrate with `git-engine`  
* tests

Acceptance:

* generated patches / merge outputs / council synthesis can be verified before marked ready  
* verification results attach to Git-oriented workflows  
* review-required blocks push-ready state

---

## **VQ-G15 — MCP / slash / streaming weld**

Files:

* MCP tool registration  
* slash-command integration  
* streaming progress hooks  
* tests

Acceptance:

* `verifyOutput`  
* `runQaSuite`  
* `criticDebate`  
* `addVerificationRail`  
  are callable from exposed tool surfaces  
* progress visible for long runs

---

## **VQ-G16 — Optimization lane**

Files:

* `packages/verification-engine/src/optimization/bootstrapping.ts`  
* `packages/verification-engine/src/optimization/verifier-tuning.ts`  
* tests

Acceptance:

* metric-driven tuning path exists  
* strictly opt-in  
* never mutates verifier behavior silently  
* benchmark deltas recorded before/after

DSPy’s optimizer pattern is the right model here: optimize against explicit metrics, not vague “better reasoning.”

---

## **VQ-G17 — DanteForge verification bridge**

Files:

* DanteForge integration bridge files  
* tests

Acceptance:

* extracted verification results can be passed into DanteForge-compatible gates  
* anti-stub / structural validity / pass/fail routing unified  
* no duplicated pass/fail semantics

---

# **7\. Golden flows**

## **GF-01 — Basic verification pass**

Input:

* normal task \+ output

Pass:

* multi-stage graph runs  
* dimensions returned  
* confidence returned  
* trace recorded  
* final decision emitted

## **GF-02 — Hallucinated or weak output**

Input:

* output with unsupported claims / incomplete reasoning

Pass:

* semantic or factual stage fails  
* score drops appropriately  
* decision becomes block or review-required  
* rationale preserved

## **GF-03 — Critic debate**

Input:

* ambiguous output needing multiple reviewers

Pass:

* critics run  
* consensus produced  
* dissent preserved  
* final rationale recorded

## **GF-04 — Rail enforcement**

Input:

* output violating a configured rule

Pass:

* rail action triggers warn or block  
* override path audited if invoked  
* no silent bypass

## **GF-05 — Resumable verification**

Input:

* long-running verification interrupted mid-run

Pass:

* checkpoint persists  
* run resumes without trace corruption  
* final decision still consistent

## **GF-06 — Patch / synthesis verification**

Input:

* generated patch or council synthesis output

Pass:

* verification runs before push-ready  
* failed or low-confidence result blocks promotion  
* originals and trace remain accessible

---

# **8\. Hard gates**

## **Build gates**

* package builds cleanly  
* no circular dependency with `checkpointer.ts`, `recovery-engine.ts`, `model-router.ts`, or DanteForge bridges

## **Type gates**

* strict TS compile passes  
* public interfaces exported and stable

## **Test gates**

* unit tests for all new modules  
* golden flow integration tests  
* benchmark harness runnable

## **Output gates**

No verification result may be marked pass unless:

* dimensions computed  
* confidence computed  
* trace recorded  
* rail outcomes recorded  
* final decision explicit

## **Safety gates**

* no production-mode output bypass without audited override  
* no critic/debate result silently dropped  
* no review-required promoted to pass  
* no resumed run may lose prior trace state

---

# **9\. Success criteria**

This packet is complete only when all are true:

1. DanteCode has a real multi-stage verification graph.  
2. PDSE-style dimensions are configurable and visible.  
3. Rails can allow, warn, or block.  
4. Critic/debate loops work with structured traces.  
5. QA suites can be run against plans, skills, outputs, and later patches.  
6. Verification integrates with checkpoints, recovery, model routing, reasoning, and subagents.  
7. Push-ready states can be blocked by verification.  
8. Benchmark corpus for 30+ complex tasks runs and reports regression/improvement.  
9. Verification becomes a shared spine, not a feature island.

---

# **10\. Risks and corrections**

## **Risk 1 — latency blow-up**

Correction:

* strictness levels  
* cache common checks  
* light path vs deep path  
* critics only when needed

## **Risk 2 — overblocking**

Correction:

* support pass / soft-pass / review-required / block  
* add audited overrides  
* avoid binary-only semantics

## **Risk 3 — metric drift**

Correction:

* keep benchmark suite  
* opt-in optimization lane  
* periodic calibration against explicit metrics

## **Risk 4 — complexity explosion**

Correction:

* build graph \+ PDSE \+ rails first  
* then harness  
* then critics  
* then optimization

## **Risk 5 — verification logic spreads everywhere**

Correction:

* `packages/verification-engine` remains source of truth  
* other systems call into it, not reimplement it

---

# **11\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing VQ-01: DanteCode Verification / QA Spine.

Goal:  
Build a dedicated verification engine for DanteCode that supports:  
\- multi-stage verification graph  
\- PDSE-style configurable scoring  
\- critic/debate loops  
\- hard and soft rails  
\- QA suites and benchmark harnesses  
\- checkpointed resumability  
\- model-router integration  
\- reasoning/subagent integration  
\- DanteForge verification compatibility

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- packages/verification-engine is the source of truth  
\- No production output may silently bypass verification  
\- No pass state without dimensions \+ confidence \+ trace  
\- No review-required may be promoted to pass automatically  
\- Critic outputs must be preserved  
\- Resumable runs must not lose trace state

Create:  
packages/verification-engine/  
 src/  
   types.ts  
   verification-graph.ts  
   pdse-scorer.ts  
   critic-debater.ts  
   qa-harness.ts  
   rails-enforcer.ts  
   metric-suite.ts  
   confidence-synthesizer.ts  
   traces/  
     trace-recorder.ts  
     trace-serializer.ts  
   critics/  
     critic-runner.ts  
     consensus.ts  
   harness/  
     test-case.ts  
     suite-runner.ts  
     benchmark-runner.ts  
   optimization/  
     bootstrapping.ts  
     verifier-tuning.ts  
   index.ts

Generation order:

G1:  
\- types.ts  
\- index.ts  
\- tests

G2:  
\- traces/trace-recorder.ts  
\- traces/trace-serializer.ts  
\- tests

G3:  
\- rails-enforcer.ts  
\- tests

G4:  
\- pdse-scorer.ts  
\- metric-suite.ts  
\- tests

G5:  
\- confidence-synthesizer.ts  
\- tests

G6:  
\- verification-graph.ts  
\- tests

G7:  
\- critics/critic-runner.ts  
\- critics/consensus.ts  
\- tests

G8:  
\- critic-debater.ts  
\- tests

G9:  
\- harness/test-case.ts  
\- harness/suite-runner.ts  
\- qa-harness.ts  
\- tests

G10:  
\- harness/benchmark-runner.ts  
\- tests

G11:  
Integrate with:  
\- checkpointer.ts  
\- recovery-engine.ts  
\- tests

G12:  
Integrate with:  
\- model-router.ts  
\- tests

G13:  
Integrate with:  
\- reasoning graph / reasoning chains  
\- subagent spawning  
\- tests

G14:  
Integrate with:  
\- git-engine  
\- tests

G15:  
Integrate:  
\- MCP tools  
\- slash commands  
\- streaming progress  
\- tests

G16:  
\- optimization/bootstrapping.ts  
\- optimization/verifier-tuning.ts  
\- tests

G17:  
Integrate DanteForge verification bridge  
\- tests

Required public APIs:  
\- verifyOutput(task, output, criteria?)  
\- runQaSuite(planId, outputs)  
\- criticDebate(subagents, output)  
\- addVerificationRail(rule)

Golden flows:  
\- normal verification pass  
\- hallucinated/weak output blocked or review-required  
\- critic debate with consensus  
\- rail block/warn with audited override  
\- resumable verification run  
\- patch/synthesis verification before push-ready

At the end of every generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until all golden flows pass.  
---

# **12\. Final judgment**

This is one of the most important DanteCode machines because it changes the trust model for everything else.

The correct build order is:

**graph → PDSE → rails → traces → harness → critics → integration → optimization**

That keeps the engine useful early and prevents it from turning into an overcomplicated review sidecar.

