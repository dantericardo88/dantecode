**DanteCode Session / Memory Enhancement PRD v1.0**

**Objective:** Close the critical gaps identified in the live repo analysis (session-store.ts \+ checkpointer.ts provide only basic summaries and per-session state; no long-term/cross-session persistence, no semantic/vector/graph recall, no automatic compression/pruning, no entity/user memory layers, and limited integration with reasoning chains, autonomy engine, subagents, and DanteForge).  
**Target scores:** Session / Memory **9.0+** (from my current 6.5) with strong uplift to Agent Reasoning / Autonomy, Model Reasoning Chains, Skill Decomposition, and Production Maturity.

**Scope:** Build a native, multi-layer, semantic, persistent memory engine that is model-agnostic, checkpoint-native, DanteForge-verifiable, and works across CLI restarts, background sessions, and VS Code.

### **Top 4-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

Selected after direct 2026 ecosystem review (MIT/Apache-friendly, agent-first memory systems).

1. **Mem0 (mem0ai/mem0)**  
   * Why harvest: The 2026 gold-standard long-term memory layer for AI agents (vector \+ graph \+ user memory with automatic management).  
   * Harvest targets: Multi-level memory hierarchy, automatic entity extraction & summarization, semantic search \+ recall, pruning/compression strategies, cross-session persistence.  
   * GitHub: [https://github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)  
   * Direct win: Turns basic summaries into intelligent, lifelong agent memory.  
2. **LangGraph.js (langchain-ai/langgraphjs \+ LangMem extensions)**  
   * Why harvest: Production-grade checkpointed state management with built-in long-term memory threads.  
   * Harvest targets: Persistent checkpointing across restarts, graph-based memory nodes, semantic summarization, thread-level isolation \+ sharing.  
   * GitHub: [https://github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs)  
   * Direct win: Seamless upgrade to our existing checkpointer.ts.  
3. **Zep (getzep/zep)**  
   * Why harvest: Battle-tested memory server with embeddings, auto-summarization, and session/document stores used in top agents.  
   * Harvest targets: Vector \+ document memory layers, semantic search APIs, automatic compression, observability hooks.  
   * GitHub: [https://github.com/getzep/zep](https://github.com/getzep/zep)  
   * Direct win: High-performance semantic recall layer.  
4. **OpenHands (All-Hands-AI/OpenHands)**  
   * Why harvest: Practical long-horizon session memory tailored for coding agents with recovery focus.  
   * Harvest targets: Context window optimization, persistent workspace memory, recovery-friendly state serialization.  
   * GitHub: [https://github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)  
   * Direct win: Ties memory directly into autonomy and sandbox patterns.  
5. **Continue (continuedev/continue)**  
   * Why harvest: Production context/memory providers used in real VS Code \+ terminal workflows.  
   * Harvest targets: Repo-aware memory indexing, session context providers, lightweight embedding recall.  
   * GitHub: [https://github.com/continuedev/continue](https://github.com/continuedev/continue)  
   * Direct win: Perfect IDE/terminal integration layer.

### **Functional Requirements (MVP \+ Phased)**

**Core MCP Tools / Slash Commands:**

* memory\_store(key, value, scope?) \+ memory\_recall(query, limit?, scope?)  
* memory\_summarize(sessionId) \+ memory\_prune(threshold?)  
* cross\_session\_recall(userGoal?) → semantic long-term retrieval  
* memory\_visualize() → trace \+ entity map

**Must-Have Features**

* Multi-layer memory (short-term in-memory \+ long-term vector/graph \+ user-level)  
* Semantic search & recall via embeddings (tie into model-router)  
* Automatic entity extraction, summarization, and compression  
* Cross-session persistence (file \+ optional self-hosted Zep/Mem0)  
* Smart pruning & forgetting policies (age \+ relevance \+ DanteForge score)  
* Full integration with checkpointer.ts, reasoning-graph, autonomy loops, and subagent state  
* DanteForge PDSE scoring on recalled memories \+ verification gates  
* Git worktree snapshots for memory state

**Advanced (Phase 2+)**

* Graph memory for relationship tracking  
* User/profile memory across projects  
* Multi-agent shared memory with access controls  
* VS Code sidebar memory explorer

### **Non-Functional Requirements**

* Latency: \<150ms typical recall, \<400ms complex semantic query  
* Scalability: Support 100k+ memory items with pruning  
* Reliability: 100% persistence & recovery via checkpointer \+ git-engine  
* Model-agnostic: Any provider via model-router.ts  
* Privacy-first: Local-first (embeddings optional on-device), encrypted storage

### **Implementation Recommendations (DanteCode-Specific)**

* New module: packages/memory-engine (or major enhancement to core/session-store.ts \+ checkpointer.ts)  
* Core new files: memory-orchestrator.ts, vector-store.ts, semantic-recall.ts, pruning-engine.ts, entity-extractor.ts  
* Heavy reuse: checkpointer.ts (base persistence), model-router.ts (embeddings/summarization), danteforge (PDSE \+ gates), reasoning-graph.ts, autonomy-engine, git-engine (snapshots), sandbox (isolated memory ops)  
* Make Mem0/Zep optional (lightweight in-memory \+ local vector default)  
* MCP \+ slash-command \+ VS Code sidebar support out of the box

### **Phased Roadmap**

**Phase 1 (1 week):** LangGraph.js checkpoint upgrades \+ basic Mem0-style hierarchy \+ summarization (quick jump to 8.0–8.5)  
**Phase 2 (1–2 weeks):** Zep vector layer \+ semantic recall \+ OpenHands long-horizon patterns  
**Phase 3 (1–2 weeks):** Continue/IDE integration \+ pruning \+ DanteForge deep scoring

**Phase 4 (1 week):** Polish, cross-session benchmarks, memory visualizer, production hardening

### **Success Metrics & Verification**

* Recall accuracy \>90% on complex multi-session queries (human \+ DanteForge eval)  
* Context window efficiency: 40%+ token reduction via smart compression  
* Long-horizon autonomy uplift: 2–8 hour sessions with perfect context retention  
* DanteForge pass rate on memory operations \>97%  
* Production maturity: full test coverage \+ cross-session SWE-bench improvement

### **Risks & Mitigations**

* Memory bloat → Built-in pruning \+ relevance scoring (Mem0 patterns)  
* Embedding cost → Optional local models \+ caching (reuse model-router)  
* Complexity → Start lightweight with LangGraph \+ Mem0 architecture, then layer Zep  
* Privacy → Strict local-first defaults \+ user-configurable cloud options

This PRD is ready to copy-paste directly into DanteCode’s planner/orchestrator/wave mode. It gives concrete GitHub targets and perfect integration with **every** previous enhancement (checkpointer, reasoning chains, autonomy engine, DanteForge, git-engine, sandbox, IDE integration, etc.).

Once shipped, Session / Memory becomes DanteCode’s “infinite context” superpower — intelligent, persistent, and truly production-grade.

This completes the full set of capability PRDs based on the original gaps\! Let me know if you want API type signatures, a starter TS stub for memory-orchestrator.ts, a combined implementation roadmap for all PRDs, or anything else.

# **V+E Masterplan**

## **DanteCode Session / Memory Enhancement**

### **Persistent, Semantic, Multi-Layer Memory Spine**

## **1\. Executive judgment**

This should be built as a **first-class memory machine** with its own contracts, storage layers, and retrieval logic.

The PRD correctly identifies the current gap:

* `session-store.ts` and `checkpointer.ts` only provide basic summaries and per-session state  
* there is no strong long-term or cross-session persistence  
* no semantic/vector/graph recall  
* no automatic compression/pruning  
* no user/entity memory layer  
* and only weak integration with reasoning chains, autonomy, subagents, and DanteForge.

The target is also clear:

* move Session / Memory from roughly **6.5 to 9.0+**  
* and lift reasoning, autonomy, skill decomposition, and production maturity with it.

My strongest architectural judgment is this:

### **Memory should become DanteCode’s cross-session cognition spine**

Not:

* a few helper methods,  
* a better summary file,  
* or a single vector store.

But:

* a multi-layer memory hierarchy,  
* with semantic recall,  
* entity/user memory,  
* checkpoint-native persistence,  
* pruning/compression,  
* verification gates,  
* and durable integration with every major runtime machine.

## **2\. Product thesis**

DanteCode needs a **native, multi-layer, semantic, persistent memory engine** that can:

* store short-term working context  
* persist long-term memory across restarts  
* recall semantically relevant memories  
* extract entities and relationships  
* summarize and compress context automatically  
* prune low-value memory safely  
* support user/profile memory and later multi-agent shared memory  
* integrate with checkpoints, reasoning graphs, autonomy loops, subagents, Git snapshots, and DanteForge verification.

The core thesis is:

**Session state is not enough. DanteCode needs verified, semantic, persistent memory that survives time, restarts, and complex work.**

## **3\. Purpose and problem statement**

Today, DanteCode can remember the current session moderately well, but the PRD correctly identifies four deeper problems:

### **A. Persistence gap**

Memory does not yet survive strongly across CLI restarts, background sessions, and longer-running work.

### **B. Semantic gap**

There is no rich vector/graph/entity recall, so past knowledge is harder to retrieve intelligently.

### **C. Compression gap**

There is no strong automatic summarization, pruning, or forgetting policy.

### **D. Integration gap**

Memory is not yet deeply welded into reasoning chains, autonomy loops, subagent state, verification, and Git snapshots.

This masterplan exists to solve those four gaps together.

## **4\. Scope**

## **In scope**

This machine must deliver the PRD’s core surfaces:

* `memoryStore(key, value, scope?)`  
* `memoryRecall(query, limit?, scope?)`  
* `memorySummarize(sessionId)`  
* `memoryPrune(threshold?)`  
* `crossSessionRecall(userGoal?)`  
* `memoryVisualize()`

It also must deliver:

* multi-layer memory  
* semantic recall via embeddings  
* entity extraction and summarization  
* cross-session persistence  
* smart pruning and forgetting policies  
* integration with `checkpointer.ts`, reasoning graph, autonomy loops, subagent state, DanteForge gates, model-router, git-engine, and sandboxed operations.

## **Advanced scope**

Later phases can add:

* graph memory for relationship tracking  
* user/profile memory across projects  
* multi-agent shared memory with access controls  
* VS Code sidebar memory explorer.

## **Out of scope for MVP**

Do not start with:

* full graph-memory-heavy UI  
* complex shared-memory ACL systems  
* cross-project social/profile memory features everywhere  
* or cloud-hosted external memory as a hard dependency

The PRD already points to the correct safer path: local-first default, optional Mem0/Zep integration, and checkpoint-native persistence.

## **5\. Architecture**

The right V+E answer is to build this as a **Memory Spine** with five organs.

## **5.1 Organ A — Memory Orchestrator**

This is the control brain.

It decides:

* what gets stored  
* at what layer  
* how it is summarized  
* whether embeddings/entities should be extracted  
* what should be pruned or compressed  
* and what retrieval strategy to use for recall

## **5.2 Organ B — Multi-Layer Storage Engine**

This is the memory hierarchy.

It should support at least:

### **Layer 1 — Short-term working memory**

Fast, in-memory, session-local, low-latency.

### **Layer 2 — Checkpoint/session memory**

Persistent, resumable, tied to `checkpointer.ts` and recovery.

### **Layer 3 — Long-term semantic memory**

Vector-backed or local semantic index for cross-session recall.

### **Layer 4 — Entity / user memory**

Profiles, named entities, relationships, repeated patterns, preferences.

### **Layer 5 — Git / workspace snapshot memory**

Repo-aware memory anchored to worktrees, branches, and project state.

That hierarchy is the real product. It is what the PRD means by “multi-layer memory.”

## **5.3 Organ C — Semantic Recall Engine**

This is the retrieval layer.

It must support:

* query-based semantic recall  
* scoped recall  
* cross-session recall  
* ranking and relevance  
* memory fusion across layers  
* optional provider-backed embeddings through `model-router.ts`

## **5.4 Organ D — Summarization / Compression / Pruning Engine**

This is the token-efficiency layer.

It must:

* summarize sessions  
* compress verbose state into durable memory  
* prune stale/low-value items  
* apply forgetting policies by age, relevance, and verification quality  
* preserve high-value verified memory longer

The PRD explicitly calls for automatic summarization, compression, pruning, and relevance-based forgetting.

## **5.5 Organ E — Verification \+ Governance Layer**

This is what makes memory trustworthy.

It must:

* run DanteForge PDSE/gates on recalled memories where relevant  
* score memory quality  
* protect against polluted or low-value recall  
* keep audit trails of important writes/prunes  
* support privacy-first local defaults and configurable storage policies

## **6\. Canonical package plan**

The PRD points toward a new `packages/memory-engine` or a major enhancement to `session-store.ts` and `checkpointer.ts`. The V+E recommendation is:

Build a new package, then integrate it deeply into session/checkpoint/reasoning flows.

Recommended structure:

packages/memory-engine/  
 src/  
   types.ts  
   memory-orchestrator.ts  
   short-term-store.ts  
   session-memory.ts  
   vector-store.ts  
   semantic-recall.ts  
   entity-extractor.ts  
   summarizer.ts  
   pruning-engine.ts  
   compression-engine.ts  
   graph-memory.ts  
   memory-visualizer.ts  
   storage/  
     local-store.ts  
     encrypted-store.ts  
     snapshot-store.ts  
   adapters/  
     mem0-adapter.ts  
     zep-adapter.ts  
     continue-adapter.ts  
   policies/  
     retention-policy.ts  
     privacy-policy.ts  
     scoring-policy.ts  
   index.ts

This structure directly operationalizes the PRD’s recommended core files:

* `memory-orchestrator.ts`  
* `vector-store.ts`  
* `semantic-recall.ts`  
* `pruning-engine.ts`  
* `entity-extractor.ts`

## **7\. Organ-to-OSS harvest map**

The PRD’s prioritized OSS list is strong. Keep it, but harvest patterns rather than letting dependencies define the architecture.

### **Mem0**

Harvest:

* memory hierarchy  
* entity extraction  
* automatic summarization  
* semantic recall  
* pruning/compression concepts  
* cross-session persistence patterns

### **LangGraph.js \+ LangMem style patterns**

Harvest:

* checkpoint-native memory  
* thread-level isolation and sharing  
* graph-based memory nodes  
* resumable memory workflows

### **Zep**

Harvest:

* vector/document memory ideas  
* semantic search APIs  
* summarization/compression patterns  
* observability hooks

### **OpenHands**

Harvest:

* long-horizon session memory for coding agents  
* recovery-friendly workspace memory  
* context-window optimization for persistent work

### **Continue**

Harvest:

* repo-aware context providers  
* IDE/terminal-friendly memory surfaces  
* lightweight retrieval into coding workflows

## **8\. Shared integration surfaces**

The PRD is very explicit that memory must not live alone. It should reuse:

* `checkpointer.ts`  
* `model-router.ts`  
* DanteForge PDSE/gates  
* `reasoning-graph.ts`  
* autonomy engine  
* git-engine  
* sandbox  
* VS Code/CLI integration.

So the V+E integration plan is:

### **A. Checkpointer**

Memory persistence and recovery backbone.

### **B. Model-router**

Embedding generation, summarization, semantic recall ranking, optional local embedding model routing.

### **C. Reasoning graph**

Memory retrieval and write-back during planning/reasoning loops.

### **D. Autonomy engine**

Long-horizon tasks persist and recall progress intelligently.

### **E. Subagent orchestrator**

Children can inherit scoped memory, write specialized memory, and return verified memories upward.

### **F. Git-engine**

Memory snapshots tied to repo/worktree state.

### **G. Sandbox**

Sensitive or isolated memory operations remain contained.

### **H. Verification spine**

Memory writes, recall quality, and pruning decisions can be scored and gated.

## **9\. Public API surface**

Keep the PRD’s core commands, but formalize the contracts.

export interface MemoryStoreResult {  
 key: string;  
 scope: "session" | "project" | "user" | "global";  
 stored: boolean;  
 layer: "short-term" | "checkpoint" | "semantic" | "entity";  
}

export interface MemoryRecallResult {  
 query: string;  
 scope?: string;  
 results: Array\<Record\<string, unknown\>\>;  
 latencyMs: number;  
}

export interface MemorySummarizeResult {  
 sessionId: string;  
 summary: string;  
 compressed: boolean;  
 tokensSaved?: number;  
}

export interface MemoryPruneResult {  
 prunedCount: number;  
 retainedCount: number;  
 policy: string;  
}

export interface MemoryVisualizeResult {  
 nodes: Array\<Record\<string, unknown\>\>;  
 edges: Array\<Record\<string, unknown\>\>;  
}

Core surface:

* `memoryStore(key, value, scope?)`  
* `memoryRecall(query, limit?, scope?)`  
* `memorySummarize(sessionId)`  
* `memoryPrune(threshold?)`  
* `crossSessionRecall(userGoal?)`  
* `memoryVisualize()`

## **10\. Execution model**

A memory interaction should follow a deterministic pipeline.

### **Step 1 — Ingest**

Receive:

* event  
* session output  
* user fact  
* reasoning artifact  
* subagent result  
* repo snapshot  
* explicit memory command

### **Step 2 — Classify**

Decide:

* short-term only  
* session/checkpoint  
* semantic  
* entity/user  
* snapshot/workspace  
* discard

### **Step 3 — Enrich**

Optionally:

* summarize  
* extract entities  
* embed  
* score relevance  
* attach source/provenance  
* link to task/session/worktree

### **Step 4 — Persist**

Write to correct layer(s) with privacy and retention policy.

### **Step 5 — Recall**

Retrieve by:

* exact key  
* semantic similarity  
* entity relationship  
* session lineage  
* cross-session goal relevance

### **Step 6 — Compress / prune**

Apply:

* age  
* relevance  
* DanteForge score / trust score  
* user-configured retention policy

### **Step 7 — Verify**

Important recalled memories should be:

* traceable  
* scored  
* optionally gated before use in critical flows

## **11\. Phased roadmap**

The PRD’s roadmap is strong. Keep it, but sharpen the machine boundaries.

## **Phase 1 — Core persistence \+ hierarchy**

Deliver:

* checkpoint upgrades  
* basic memory hierarchy  
* summarization  
* session \+ short-term \+ checkpoint memory

Goal:

* fast jump to 8.0–8.5

## **Phase 2 — Semantic recall**

Deliver:

* vector layer  
* semantic retrieval  
* OpenHands-style long-horizon session patterns  
* cross-session recall

Goal:

* memory becomes genuinely useful across restarts and long sessions

## **Phase 3 — Pruning \+ integration**

Deliver:

* pruning/compression  
* deeper DanteForge scoring  
* Continue-style repo/IDE integration  
* stronger reasoning/subagent integration

Goal:

* memory becomes efficient and operationally central

## **Phase 4 — Graph and visualization polish**

Deliver:

* graph memory  
* visualizer  
* cross-session benchmarks  
* production hardening

Goal:

* make memory explainable, observable, and ready for larger autonomy loops

## **12\. Non-functional requirements / SLOs**

The PRD gives strong targets. They should become hard gates.

### **Hard SLOs**

* typical recall under 150ms  
* complex semantic query under 400ms  
* support 100k+ memory items with pruning  
* 100% persistence/recovery via checkpoint \+ Git snapshot path  
* model-agnostic operation  
* privacy-first local defaults  
* encrypted storage options

### **Additional V+E gates**

* no critical memory write without provenance metadata  
* no prune operation without policy record  
* no semantic recall without scoring/ranking metadata  
* no cross-session recall without clear scope handling

## **13\. Verification and benchmark model**

The PRD’s success metrics are strong and should become the benchmark charter.

### **A. Recall accuracy benchmark**

Measure:

* 90% recall accuracy on complex multi-session queries

### **B. Context efficiency benchmark**

Measure:

* 40%+ token reduction from summarization/compression

### **C. Long-horizon autonomy benchmark**

Measure:

* 2–8 hour sessions with stable context retention

### **D. DanteForge benchmark**

Measure:

* 97% pass rate on memory operations / recalled memory quality gates

### **E. Production maturity benchmark**

Measure:

* full test coverage of memory engine  
* cross-session SWE-bench uplift or analogous repo-task improvement

## **14\. Test charter**

## **Unit tests**

* memory classification  
* semantic ranking  
* entity extraction  
* summarization  
* pruning decisions  
* retention policies  
* encryption/storage behavior  
* scope isolation

## **Integration tests**

* session restart persistence  
* cross-session recall  
* checkpoint recovery  
* subagent memory inheritance  
* repo/worktree memory snapshot linkage  
* reasoning-chain memory write/read  
* VS Code / CLI provider integration

## **Golden flows**

### **GF-01**

A session writes useful memory and that memory is available after restart.

### **GF-02**

A semantic recall query returns relevant cross-session items with ranking and scope handling.

### **GF-03**

A long session is summarized/compressed and token load drops materially without losing critical facts.

### **GF-04**

A pruning run removes low-value items but preserves high-value, frequently recalled, or verified memory.

### **GF-05**

A spawned subagent writes scoped memory and the parent can recall the useful subset without leaking forbidden context.

### **GF-06**

A repo/worktree snapshot memory ties recalled knowledge to the right project state.

### **GF-07**

A memory visualization returns entity/relationship or scope map without corrupting storage.

## **15\. Risks and corrections**

The PRD’s risks are correct. Here is the V+E correction.

### **Risk 1 — memory bloat**

Correction:

* pruning and compression must be first-class, not later cleanup  
* retention policies and trust scoring required from early phases

### **Risk 2 — embedding cost**

Correction:

* local-first embeddings by default where possible  
* cache embeddings  
* route through `model-router.ts`  
* keep semantic layer optional/fallback-friendly

### **Risk 3 — complexity**

Correction:

* start with hierarchy \+ persistence \+ summarization  
* then add vector recall  
* then graph/user/multi-agent layers

### **Risk 4 — privacy**

Correction:

* local-first defaults  
* encrypted storage option  
* clear scope rules  
* optional cloud adapters only by explicit opt-in

## **16\. Runbook**

### **Step 1**

Build the new memory package and contracts first.

### **Step 2**

Upgrade checkpoint/session memory and summarization.

### **Step 3**

Add semantic recall and vector layer.

### **Step 4**

Add pruning, scoring, and verification gating.

### **Step 5**

Integrate with reasoning, autonomy, subagents, and git snapshots.

### **Step 6**

Add graph memory, visualization, and polish.

## **17\. Done definition**

This machine is complete only when all are true:

1. DanteCode has real multi-layer memory.  
2. Memory persists across restarts and sessions.  
3. Semantic cross-session recall works with useful accuracy.  
4. Summarization and pruning materially reduce context load.  
5. Memory is integrated with checkpoints, reasoning, autonomy, subagents, git snapshots, and DanteForge verification.  
6. Privacy-first local defaults hold.  
7. Benchmark corpus proves recall accuracy and context efficiency.  
8. Session / Memory becomes a genuine DanteCode superpower rather than a better summary file.

## **18\. Final judgment**

This is a strong PRD.

The most important V+E correction is:

**Build Memory as DanteCode’s persistent cognition spine, not as a storage upgrade.**

That is how it becomes the “infinite context” advantage the PRD is reaching for.

The strongest next move is to turn this directly into a **Codex-ready V+E Execution Packet**.

Please create the Codex-ready V+E Execution Packet.

I’m grounding the execution packet to the uploaded memory PRD and checking the current external memory-tool patterns it references so the build order reflects the actual 2026 surfaces rather than stale assumptions.

Thought for 56s

Below is the **Codex-ready V+E Execution Packet** for **DanteCode Session / Memory Enhancement**.

The core build decision is:

**Build memory as a dedicated cognition spine, not as a bigger `session-store.ts`.**

That matches the uploaded PRD and the current external patterns it was pointing at:

* **Mem0** presents itself as a universal memory layer for AI agents.  
* **LangGraph** explicitly supports checkpoint persistence, thread-scoped short-term memory, and durable execution, which is the right pattern for checkpoint-native memory.  
* **Zep** positions itself as a context/memory system with low-latency retrieval and hybrid memory APIs, which makes it a strong optional adapter pattern for semantic recall.  
* **Continue** exposes context providers as plugins, which is useful as the IDE/context-surface model for memory retrieval.  
* **OpenHands** is now built around a software-agent SDK and benchmark infrastructure, which makes it a useful reference for long-horizon, durable agent state rather than just short chat memory.

# **Codex-ready V+E Execution Packet**

## **ME-01 — DanteCode Memory Engine**

## **0\. Executive call**

Build this as a **multi-layer memory engine** with five organs:

1. **Memory Orchestrator**  
2. **Layered Storage Engine**  
3. **Semantic Recall Engine**  
4. **Summarization / Compression / Pruning Engine**  
5. **Verification \+ Governance Layer**

This machine should become the memory backbone for:

* reasoning chains  
* subagents  
* autonomy loops  
* research/WebFetch outputs  
* Git/worktree snapshots  
* user/profile memory  
* long-running sessions and restarts

---

# **1\. Objective**

Implement the PRD’s intended uplift by shipping:

* `memoryStore(key, value, scope?)`  
* `memoryRecall(query, limit?, scope?)`  
* `memorySummarize(sessionId)`  
* `memoryPrune(threshold?)`  
* `crossSessionRecall(userGoal?)`  
* `memoryVisualize()`

with:

* short-term \+ checkpoint \+ semantic \+ entity/user memory layers  
* local-first persistence  
* semantic retrieval  
* summarization/compression  
* pruning/forgetting policies  
* checkpoint-native recovery  
* model-router integration  
* DanteForge verification compatibility  
* git/worktree snapshot memory  
* optional Mem0/Zep/Continue-style adapters, but never as hard requirements

## **1.1 Non-goals for MVP**

Do not start with:

* full graph-memory UI  
* complex multi-agent shared-memory ACL systems  
* cloud-only memory as a dependency  
* broad profile/social memory across every project  
* forcing external memory services for baseline functionality

---

# **2\. Repo boundary and ownership**

## **2.1 New package**

Create:

packages/memory-engine/  
 src/  
   types.ts  
   memory-orchestrator.ts  
   short-term-store.ts  
   session-memory.ts  
   vector-store.ts  
   semantic-recall.ts  
   entity-extractor.ts  
   summarizer.ts  
   pruning-engine.ts  
   compression-engine.ts  
   graph-memory.ts  
   memory-visualizer.ts  
   storage/  
     local-store.ts  
     encrypted-store.ts  
     snapshot-store.ts  
   adapters/  
     mem0-adapter.ts  
     zep-adapter.ts  
     continue-adapter.ts  
   policies/  
     retention-policy.ts  
     privacy-policy.ts  
     scoring-policy.ts  
   index.ts

## **2.2 Existing files to integrate with**

* `session-store.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* reasoning-chain / reasoning-graph surfaces  
* autonomy engine  
* subagent orchestrator  
* `git-engine`  
* DanteForge verification bridge  
* MCP tool registration  
* slash-command registration  
* optional VS Code context surfaces

## **2.3 Hard rule**

`packages/memory-engine` is the source of truth.

Do not smear memory logic across session state, checkpoints, and random retrieval helpers.

---

# **3\. Canonical architecture**

## **3.1 Memory Orchestrator**

Owns:

* ingest classification  
* layer routing  
* summarization decisions  
* embedding/entity enrichment decisions  
* recall strategy selection  
* prune/compress policy application

## **3.2 Layered Storage Engine**

Support at least these layers:

### **Layer 1 — short-term working memory**

* in-memory  
* low latency  
* session-local

### **Layer 2 — checkpoint/session memory**

* persistent  
* resumable  
* tied to `checkpointer.ts`

### **Layer 3 — long-term semantic memory**

* vector or semantic index  
* cross-session recall  
* optional local embeddings via `model-router.ts`

### **Layer 4 — entity / user memory**

* named entities  
* repeated preferences  
* relationship anchors  
* user/project scoped facts

### **Layer 5 — Git / workspace snapshot memory**

* branch/worktree-aware memory  
* repo-linked facts and summaries  
* snapshot lineage

This layered approach is the right adaptation of the external memory tools: Mem0’s hierarchy, LangGraph’s checkpointed memory threads, Zep’s retrieval layer, and Continue’s context-provider model.

## **3.3 Semantic Recall Engine**

Owns:

* semantic query matching  
* ranking  
* scope filtering  
* cross-session recall  
* memory fusion across layers  
* retrieval metadata

## **3.4 Summarization / Compression / Pruning Engine**

Owns:

* session summarization  
* compression of verbose history  
* pruning based on age/relevance/trust  
* forgetting policies  
* token-efficiency tracking

## **3.5 Verification \+ Governance Layer**

Owns:

* provenance requirements  
* trust scoring  
* DanteForge compatibility  
* prune/write audit records  
* privacy and scope enforcement  
* memory quality rails

---

# **4\. Public API contracts**

Create `packages/memory-engine/src/types.ts` with at least:

export interface MemoryStoreResult {  
 key: string;  
 scope: "session" | "project" | "user" | "global";  
 stored: boolean;  
 layer: "short-term" | "checkpoint" | "semantic" | "entity";  
}

export interface MemoryRecallResult {  
 query: string;  
 scope?: string;  
 results: Array\<Record\<string, unknown\>\>;  
 latencyMs: number;  
}

export interface MemorySummarizeResult {  
 sessionId: string;  
 summary: string;  
 compressed: boolean;  
 tokensSaved?: number;  
}

export interface MemoryPruneResult {  
 prunedCount: number;  
 retainedCount: number;  
 policy: string;  
}

export interface MemoryVisualizeResult {  
 nodes: Array\<Record\<string, unknown\>\>;  
 edges: Array\<Record\<string, unknown\>\>;  
}

Required exported functions:

* `memoryStore(key, value, scope?)`  
* `memoryRecall(query, limit?, scope?)`  
* `memorySummarize(sessionId)`  
* `memoryPrune(threshold?)`  
* `crossSessionRecall(userGoal?)`  
* `memoryVisualize()`

---

# **5\. Storage and policy model**

## **5.1 Storage backends**

Implement:

* local default store  
* encrypted local store  
* snapshot-aware store  
* optional external adapters

## **5.2 Privacy model**

Default:

* local-first  
* project/session scoping explicit  
* no cross-session/user recall without scope policy  
* encrypted storage optional but first-class

## **5.3 Retention model**

Every persisted item must carry:

* layer  
* scope  
* createdAt / updatedAt  
* provenance  
* relevance score  
* trust/verification score  
* prune eligibility

## **5.4 Adapter model**

Adapters remain optional:

* `mem0-adapter.ts`  
* `zep-adapter.ts`  
* `continue-adapter.ts`

Use them as pattern adapters, not as the default required runtime. Mem0, Zep, and Continue are useful design anchors, but the baseline DanteCode memory path must remain local-first and self-contained.

---

# **6\. Execution model**

Every memory interaction must follow a deterministic pipeline:

1. **ingest**  
2. **classify**  
3. **enrich**  
4. **persist**  
5. **recall**  
6. **compress / prune**  
7. **verify**

### **Ingest sources**

* explicit user memory commands  
* reasoning outputs  
* subagent outputs  
* research/WebFetch artifacts  
* session summaries  
* Git/worktree snapshots  
* background/autonomy progress markers

### **Classification outcomes**

* short-term only  
* checkpoint/session  
* semantic  
* entity/user  
* workspace snapshot  
* discard

### **Enrichment steps**

* summarize  
* embed  
* extract entities  
* attach provenance  
* attach trust score  
* attach repo/session/worktree lineage

---

# **7\. Generation plan**

## **ME-G1 — Contracts spine**

Files:

* `packages/memory-engine/src/types.ts`  
* `packages/memory-engine/src/index.ts`  
* tests

Acceptance:

* core API/result types compile  
* scope/layer contracts stable  
* no runtime behavior yet

---

## **ME-G2 — Local storage foundations**

Files:

* `packages/memory-engine/src/storage/local-store.ts`  
* `packages/memory-engine/src/storage/encrypted-store.ts`  
* `packages/memory-engine/src/storage/snapshot-store.ts`  
* tests

Acceptance:

* local persistence works  
* encrypted path works  
* snapshot-backed records supported  
* storage contracts stable

---

## **ME-G3 — Short-term \+ session memory**

Files:

* `packages/memory-engine/src/short-term-store.ts`  
* `packages/memory-engine/src/session-memory.ts`  
* tests

Acceptance:

* short-term in-memory store works  
* session-level persistent store works  
* restart-safe session reload possible  
* no cross-session leakage by default

---

## **ME-G4 — Memory orchestrator**

Files:

* `packages/memory-engine/src/memory-orchestrator.ts`  
* tests

Acceptance:

* ingest/classify/persist routing works  
* layer selection deterministic  
* provenance metadata attached  
* no direct writes bypass orchestrator

---

## **ME-G5 — Summarizer \+ compression**

Files:

* `packages/memory-engine/src/summarizer.ts`  
* `packages/memory-engine/src/compression-engine.ts`  
* tests

Acceptance:

* session summarization works  
* compression path works  
* tokens-saved metric exposed  
* summarized output can be re-stored into memory

---

## **ME-G6 — Retention and privacy policies**

Files:

* `packages/memory-engine/src/policies/retention-policy.ts`  
* `packages/memory-engine/src/policies/privacy-policy.ts`  
* `packages/memory-engine/src/policies/scoring-policy.ts`  
* tests

Acceptance:

* retention rules deterministic  
* privacy/scope enforcement works  
* scoring policy can influence prune priority  
* no prune without policy attribution

---

## **ME-G7 — Vector store**

Files:

* `packages/memory-engine/src/vector-store.ts`  
* tests

Acceptance:

* semantic storage/retrieval interface exists  
* local-first implementation works  
* adapter path pluggable  
* no mandatory remote dependency

---

## **ME-G8 — Semantic recall**

Files:

* `packages/memory-engine/src/semantic-recall.ts`  
* tests

Acceptance:

* semantic queries return ranked results  
* scope filters enforced  
* retrieval metadata includes score/ranking  
* cross-layer recall fusion supported

LangGraph’s checkpointed thread memory and Zep’s retrieval-oriented memory model both support this architecture choice well.

---

## **ME-G9 — Entity extraction**

Files:

* `packages/memory-engine/src/entity-extractor.ts`  
* tests

Acceptance:

* entities can be extracted from memory items  
* relationships and tags can be attached  
* entity records can be recalled separately  
* bad/empty extraction handled safely

Mem0’s “memory layer” positioning makes entity-centric enrichment a reasonable optional pattern here, but DanteCode should still own its own contracts.

---

## **ME-G10 — Pruning engine**

Files:

* `packages/memory-engine/src/pruning-engine.ts`  
* tests

Acceptance:

* prune decisions use age \+ relevance \+ trust/policy  
* important/verified items are retained longer  
* prune runs are auditable  
* dry-run mode supported

---

## **ME-G11 — Graph memory \+ visualizer**

Files:

* `packages/memory-engine/src/graph-memory.ts`  
* `packages/memory-engine/src/memory-visualizer.ts`  
* tests

Acceptance:

* relationship graph can be materialized  
* visualization payloads stable  
* graph layer optional  
* no corruption of primary stores if graph build fails

Zep’s graph-adjacent context direction and LangGraph’s graph-oriented runtime both support this as a later-phase enhancement, not an MVP dependency.

---

## **ME-G12 — Checkpointer \+ recovery weld**

Files:

* integrate with `checkpointer.ts`  
* integrate with `recovery-engine.ts`  
* tests

Acceptance:

* memory survives restart/interruption  
* session/checkpoint memory restores correctly  
* prune/summarize runs resumable  
* no trace loss during recovery

LangGraph’s persistence and durable execution are the strongest design references here.

---

## **ME-G13 — Model-router weld**

Files:

* integrate with `model-router.ts`  
* tests

Acceptance:

* embedding model routing works  
* summarization routing works  
* semantic ranking can use model-router where needed  
* engine remains provider-agnostic

---

## **ME-G14 — Reasoning / autonomy / subagent weld**

Files:

* integrate with reasoning-chain or reasoning-graph surfaces  
* integrate with autonomy engine  
* integrate with subagent orchestrator  
* tests

Acceptance:

* reasoning flows can write/retrieve memory  
* autonomy loops can persist long-horizon state  
* subagents get scoped memory inheritance  
* parent/child memory boundaries enforced

OpenHands is a useful reference here because it emphasizes long-running agent execution and benchmarked agent workflows rather than just chat memory.

---

## **ME-G15 — Git/worktree snapshot weld**

Files:

* integrate with `git-engine`  
* tests

Acceptance:

* repo/worktree snapshots can anchor memory records  
* recall can be filtered by repo/worktree state  
* memory tied to wrong branch/worktree is not silently surfaced as canonical

---

## **ME-G16 — Verification \+ governance weld**

Files:

* DanteForge verification bridge files  
* tests

Acceptance:

* important memory items can carry trust scores  
* recalled memory can be gated/scored before critical use  
* prune/write audit log exists  
* no critical memory write without provenance

---

## **ME-G17 — MCP / slash / IDE surface**

Files:

* MCP tool registration  
* slash-command integration  
* optional VS Code surface hooks  
* tests

Acceptance:

* all public memory tools callable  
* memory recall visible in CLI/API surfaces  
* memory visualizer payload accessible  
* no IDE-only dependency for core functionality

Continue’s context-provider model is the right high-level pattern for the IDE surface layer here.

---

## **ME-G18 — Adapter lane**

Files:

* `packages/memory-engine/src/adapters/mem0-adapter.ts`  
* `packages/memory-engine/src/adapters/zep-adapter.ts`  
* `packages/memory-engine/src/adapters/continue-adapter.ts`  
* tests

Acceptance:

* adapters are optional  
* baseline DanteCode memory works without them  
* adapter contracts do not leak into core storage/retrieval contracts

---

## **ME-G19 — Benchmark harness**

Files:

* benchmark fixtures/reports  
* tests

Acceptance:

* recall accuracy benchmark exists  
* summarization/compression benchmark exists  
* long-horizon persistence benchmark exists  
* regression reporting stable

---

# **8\. Golden flows**

## **GF-01 — Persistent restart memory**

Input:

* store useful session memory, restart DanteCode

Pass:

* memory survives  
* session/checkpoint layer restores correctly  
* provenance preserved

## **GF-02 — Semantic cross-session recall**

Input:

* recall query against older relevant sessions

Pass:

* ranked relevant results returned  
* scope enforced  
* latency within target band  
* ranking metadata exposed

## **GF-03 — Summarize and compress**

Input:

* long noisy session

Pass:

* session summarized  
* compressed memory stored  
* token load materially reduced  
* critical facts retained

## **GF-04 — Safe pruning**

Input:

* large mixed memory set

Pass:

* stale/low-value memories pruned  
* high-value and verified memories preserved  
* prune run audited

## **GF-05 — Scoped subagent memory**

Input:

* child agent writes memory during task

Pass:

* parent can recall allowed subset  
* restricted memory does not leak across scope  
* checkpoint lineage preserved

## **GF-06 — Repo/worktree memory**

Input:

* project-specific repo state changes

Pass:

* memory anchors to correct repo/worktree  
* recall can target the right branch/context  
* no silent cross-branch confusion

## **GF-07 — Visualization**

Input:

* memory visualize request

Pass:

* stable node/edge payload returned  
* graph optional  
* visualization does not mutate memory

---

# **9\. Hard gates**

## **Build gates**

* `memory-engine` builds cleanly  
* no circular dependency with `session-store.ts`, `checkpointer.ts`, `model-router.ts`, or verification bridge

## **Type gates**

* strict TS compile passes  
* scope/layer contracts stable  
* adapter contracts separate from core contracts

## **Test gates**

* unit tests for each new module  
* integration tests for all golden flows  
* benchmark harness runnable

## **Safety gates**

* no prune without policy record  
* no critical memory write without provenance  
* no cross-session recall without scope handling  
* no semantic recall result without ranking metadata  
* no adapter required for baseline memory functionality

---

# **10\. Success criteria**

This packet is complete only when all are true:

1. DanteCode has real multi-layer memory.  
2. Memory persists across restarts and sessions.  
3. Semantic cross-session recall works with useful ranking.  
4. Summarization and compression materially reduce context load.  
5. Pruning is policy-driven and auditable.  
6. Memory integrates with checkpoints, reasoning, autonomy, subagents, Git snapshots, and verification.  
7. Local-first privacy defaults hold.  
8. Benchmarks show meaningful recall accuracy and context-efficiency improvement.  
9. Memory becomes a core cognition layer rather than a better summary file.

---

# **11\. Risks and corrections**

## **Risk 1 — memory bloat**

Correction:

* build pruning and compression early  
* trust/relevance-aware retention  
* audit all prune runs

## **Risk 2 — embedding cost/latency**

Correction:

* local-first embeddings where possible  
* cache embedding outputs  
* route through `model-router.ts`  
* keep semantic layer optional/fail-soft

## **Risk 3 — complexity explosion**

Correction:

* hierarchy \+ persistence \+ summarization first  
* semantic/vector layer second  
* graph/adapters/UI later

## **Risk 4 — privacy leakage**

Correction:

* explicit scopes  
* encrypted local storage option  
* no uncontrolled cross-session/user recall  
* external adapters opt-in only

## **Risk 5 — memory logic spreads everywhere**

Correction:

* `packages/memory-engine` stays the source of truth  
* external systems call into it instead of rolling their own memory paths

---

# **12\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing ME-01: DanteCode Memory Engine.

Goal:  
Build a dedicated multi-layer memory engine for DanteCode that supports:  
\- short-term memory  
\- checkpoint/session memory  
\- long-term semantic memory  
\- entity/user memory  
\- git/worktree snapshot memory  
\- semantic recall  
\- summarization/compression  
\- pruning/forgetting policies  
\- checkpointed recovery  
\- model-router integration  
\- reasoning/autonomy/subagent integration  
\- DanteForge verification compatibility

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- packages/memory-engine is the source of truth  
\- No critical memory write without provenance metadata  
\- No prune without policy attribution  
\- No semantic recall without ranking metadata  
\- No cross-session recall without scope enforcement  
\- External adapters are optional, not required for baseline functionality

Create:  
packages/memory-engine/  
 src/  
   types.ts  
   memory-orchestrator.ts  
   short-term-store.ts  
   session-memory.ts  
   vector-store.ts  
   semantic-recall.ts  
   entity-extractor.ts  
   summarizer.ts  
   pruning-engine.ts  
   compression-engine.ts  
   graph-memory.ts  
   memory-visualizer.ts  
   storage/  
     local-store.ts  
     encrypted-store.ts  
     snapshot-store.ts  
   adapters/  
     mem0-adapter.ts  
     zep-adapter.ts  
     continue-adapter.ts  
   policies/  
     retention-policy.ts  
     privacy-policy.ts  
     scoring-policy.ts  
   index.ts

Generation order:

G1:  
\- types.ts  
\- index.ts  
\- tests

G2:  
\- storage/local-store.ts  
\- storage/encrypted-store.ts  
\- storage/snapshot-store.ts  
\- tests

G3:  
\- short-term-store.ts  
\- session-memory.ts  
\- tests

G4:  
\- memory-orchestrator.ts  
\- tests

G5:  
\- summarizer.ts  
\- compression-engine.ts  
\- tests

G6:  
\- policies/retention-policy.ts  
\- policies/privacy-policy.ts  
\- policies/scoring-policy.ts  
\- tests

G7:  
\- vector-store.ts  
\- tests

G8:  
\- semantic-recall.ts  
\- tests

G9:  
\- entity-extractor.ts  
\- tests

G10:  
\- pruning-engine.ts  
\- tests

G11:  
\- graph-memory.ts  
\- memory-visualizer.ts  
\- tests

G12:  
Integrate with:  
\- checkpointer.ts  
\- recovery-engine.ts  
\- tests

G13:  
Integrate with:  
\- model-router.ts  
\- tests

G14:  
Integrate with:  
\- reasoning chains / reasoning graph  
\- autonomy engine  
\- subagent orchestrator  
\- tests

G15:  
Integrate with:  
\- git-engine  
\- tests

G16:  
Integrate DanteForge verification/governance bridge  
\- tests

G17:  
Integrate:  
\- MCP tools  
\- slash commands  
\- optional IDE surface hooks  
\- tests

G18:  
\- adapters/mem0-adapter.ts  
\- adapters/zep-adapter.ts  
\- adapters/continue-adapter.ts  
\- tests

G19:  
\- benchmark harness / fixtures / reports  
\- tests

Required public APIs:  
\- memoryStore(key, value, scope?)  
\- memoryRecall(query, limit?, scope?)  
\- memorySummarize(sessionId)  
\- memoryPrune(threshold?)  
\- crossSessionRecall(userGoal?)  
\- memoryVisualize()

Golden flows:  
\- persistent restart memory  
\- semantic cross-session recall  
\- summarize and compress  
\- safe pruning  
\- scoped subagent memory  
\- repo/worktree memory  
\- visualization

At the end of each generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until all golden flows pass.  
---

# **13\. Final judgment**

This machine matters because it changes DanteCode from “session-aware” to **cognitively persistent**.

The correct build order is:

**storage → session layers → orchestrator → summarization → policies → semantic recall → pruning → integrations → adapters → benchmarks**

That gets you real memory early without collapsing under abstraction debt.

