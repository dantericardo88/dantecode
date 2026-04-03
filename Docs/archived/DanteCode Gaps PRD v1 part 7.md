**DanteCode Persistent Debug Memory Enhancement PRD v1.0**

**Objective:** Close the critical gap identified in the live repo analysis (no DurableRunStore, no immutable file snapshots, no queryable trail of every action/modification/erasure — exactly the debugging pain of “files erased at runtime by accident” and “what was done previously” is still unsolved).  
**Target scores:** Persistent Debug Memory **9.0+** (from my current 4.0) with massive uplift to Agent Reasoning / Autonomy, Production Maturity, Security / Safety, and Session / Memory.

**Scope:** Build a native, always-on, immutable, queryable debug trail engine that logs every tool call, model decision, file change (before/after), and erasure — stored outside the worktree so it survives crashes, deletions, and full workspace wipes. Fully MCP-compatible, DanteForge-verifiable, Git-native, and the new backbone for debugging DanteCode itself.

### **Top 4-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

Selected after direct 2026 ecosystem review (MIT/Apache-friendly, agent-debug-focused, confirmed live on GitHub).

1. **AgentFS (tursodatabase/agentfs)**  
   * Why harvest: The gold-standard agent filesystem with automatic SQLite-backed immutable logging of every file operation.  
   * Harvest targets: SQLite operation log, automatic before/after snapshots on every write/delete, queryable history, session replay patterns.  
   * GitHub: [https://github.com/tursodatabase/agentfs](https://github.com/tursodatabase/agentfs)  
   * Direct win: Solves “files erased at runtime” with zero-overhead immutable history.  
2. **Lár (snath-ai/lar)**  
   * Why harvest: “Glass box” engine with central AuditLogger that persists every decision and file change for self-correcting agents.  
   * Harvest targets: Immutable audit trail, file snapshotting, replay/debugger, GxP-compliant persistence.  
   * GitHub: [https://github.com/snath-ai/lar](https://github.com/snath-ai/lar)  
   * Direct win: Makes debugging DanteCode transparent and reproducible.  
3. **Arize Phoenix (arize-ai/phoenix)**  
   * Why harvest: Open-source observability platform with full session replay, trace storage, and debugging UX for agents.  
   * Harvest targets: Persistent trace storage, session-level replay, anomaly detection on file changes, exportable audit trails.  
   * GitHub: [https://github.com/arize-ai/phoenix](https://github.com/arize-ai/phoenix)  
   * Direct win: Beautiful, searchable debug history (easy to port to VS Code/CLI).  
4. **LangGraph.js (langchain-ai/langgraphjs)**  
   * Why harvest: Production checkpoint replay that survives restarts and enables time-travel debugging.  
   * Harvest targets: Persistent checkpoint serialization, replay patterns, long-term memory tied to file operations.  
   * GitHub: [https://github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs)  
   * Direct win: Perfect integration with existing checkpointer.ts.  
5. **Aider (aider-chat/aider)**  
   * Why harvest: Battle-tested Git-native auto-snapshotting that preserves history even after destructive edits.  
   * Harvest targets: Auto-commit \+ reflog patterns, human-readable diff trails.  
   * GitHub: [https://github.com/aider-chat/aider](https://github.com/aider-chat/aider)  
   * Direct win: Complements git-engine for zero-loss file history.

### **Functional Requirements (MVP \+ Phased)**

**Core MCP Tools / Slash Commands:**

* debug\_trail(query?) → searchable history of actions/files  
* debug\_snapshot(fileOrSession?) \+ debug\_restore(id)  
* debug\_replay(sessionId, step?) → time-travel execution  
* audit\_export(sessionId) → full immutable report

**Must-Have Features**

* Immutable SQLite-backed trail of **every** action, tool call, model response, and file change (before/after hash \+ snapshot)  
* Automatic file snapshots on any modification/deletion (stored outside the worktree)  
* Searchable by file, action, error, or natural language  
* Git worktree \+ sandbox integration (snapshots survive erasures)  
* DanteForge PDSE scoring on trail entries  
* VS Code sidebar \+ CLI dashboard for instant “what happened” view  
* Cross-session persistence (survives full restarts and workspace wipes)

**Advanced (Phase 2+)**

* Visual replay timeline with diff viewer  
* Anomaly detection (“this deletion looks suspicious”)  
* Auto-generated debug reports for GitHub issues  
* Multi-agent shared trail

### **Non-Functional Requirements**

* Overhead: \<5ms per logged operation  
* Storage: Efficient (compressed snapshots \+ pruning after 30 days unless pinned)  
* Reliability: 100% durable (SQLite \+ git-engine snapshots)  
* Privacy: Local-first, encrypted optional  
* Search latency: \<200ms for complex queries

### **Implementation Recommendations (DanteCode-Specific)**

* New module: packages/debug-trail (core enhancement to memory-engine \+ session-store)  
* Core new files: audit-logger.ts, file-snapshotter.ts, trail-query-engine.ts, replay-orchestrator.ts  
* Heavy reuse: git-engine (worktree snapshots), sandbox (isolated logging), checkpointer.ts \+ memory-engine (storage), danteforge (scoring), event-orchestrator, ide/terminal integration (UI)  
* Base on AgentFS SQLite \+ Lár AuditLogger \+ LangGraph checkpoints  
* Always-on by default (toggleable)

### **Phased Roadmap**

**Phase 1 (1 week):** AgentFS-style SQLite logging \+ basic file snapshots \+ trail query (instant debugging superpower)  
**Phase 2 (1–2 weeks):** Lár-style replay \+ Phoenix-style UI \+ git-engine integration  
**Phase 3 (1–2 weeks):** LangGraph checkpoint replay \+ anomaly detection \+ DanteForge scoring

**Phase 4 (1 week):** Polish, VS Code sidebar, export, full production hardening

### **Success Metrics & Verification**

* Zero lost debugging context during DanteCode development  
* Ability to instantly answer “what changed this file last week?”  
* Debug time for runtime erasures reduced by 80%+  
* DanteForge-verified audit completeness \>99%  
* Becomes the \#1 feature used when debugging DanteCode itself

### **Risks & Mitigations**

* Storage growth → Smart pruning \+ compression (AgentFS patterns)  
* Performance → Async logging with in-memory buffer  
* Complexity → Start with AgentFS \+ Lár lightweight SQLite core

This PRD is ready to copy-paste directly into DanteCode’s planner/orchestrator/wave mode. It gives concrete GitHub targets and perfect integration with every previous enhancement (memory-engine, git-engine, danteforge, sandbox, event-orchestrator, ide integration).

Once shipped, Persistent Debug Memory becomes DanteCode’s unbreakable debugging backbone — you will never lose another file change or context again.

This is the **initial high-level PRD** you asked for. Let me know if you want the full V+E Execution Packet version next (exact file-by-file Codex-ready plan) or starter TS stubs for audit-logger.ts\!

**Persistent Debug Memory is not “observability.” It is DanteCode’s forensic truth layer.**

That means it should sit across the whole stack:

* DTR / tool runtime  
* Memory Engine  
* Verification Spine  
* Git/Event Automation  
* Council Orchestrator  
* Subagent Orchestrator  
* WebFetch / Research  
* Sandbox / worktrees  
* DanteForge scoring and audit

Your PRD is directionally strong. The biggest refinement is architectural: this should be built as a **write-ahead, immutable, queryable evidence spine** that lives **outside the worktree** and survives:

* crashes,  
* accidental deletions,  
* bad agent edits,  
* workspace wipes,  
* and future debugging sessions.

Also, one important correction on the OSS list:

* **AgentFS** is an excellent fit because it stores agent files/state/history in SQLite and explicitly emphasizes queryability, auditability, and snapshotting. It is MIT licensed.  
* **Lár** is also an excellent fit because it is built around a “glass box” audit trail and a central `AuditLogger`. It is Apache 2.0.  
* **LangGraph** is a strong fit for checkpoint/replay/time-travel patterns because its persistence model saves checkpoints, supports replay/time travel, and fault-tolerant resume.  
* **Aider** is a good Git-native complement because it assumes Git as part of the workflow and auto-commits by default unless disabled.  
* **Phoenix** is useful as a design reference for trace storage, replay, and debugging UX, but it is **not** MIT/Apache-friendly in the strict sense; the repo is licensed under Elastic License 2.0. I would treat it as inspiration, not a donor dependency.

# **V+E Masterplan**

## **DanteCode Persistent Debug Memory Enhancement**

### **Immutable, Queryable, Always-On Forensic Debug Spine**

## **1\. Executive judgment**

This should be built as a **first-class forensic memory machine** with one job:

**make it impossible to lose the history of what DanteCode did.**

Your PRD correctly identifies the unsolved pain:

* no durable run store,  
* no immutable file snapshots outside the workspace,  
* no searchable trail of actions/tool calls/modifications/deletions,  
* and therefore no reliable answer to:  
  * “what erased this file?”  
  * “what did the agent do earlier?”  
  * “what changed between the working run and the broken run?”

That is not a minor DX gap. It is a **core production-maturity, safety, and debugging gap**.

## **2\. Product thesis**

DanteCode needs a **native Persistent Debug Memory Engine** that continuously records:

* every tool call  
* every model decision  
* every file write  
* every file delete  
* every before/after snapshot  
* every checkpoint transition  
* every verification result  
* every promotion or rollback decision

and stores that evidence **outside the worktree** in a durable, queryable, immutable store.

The real thesis is:

**If DanteCode changes something, there must always be a durable forensic answer for what changed, when, why, and from where.**

## **3\. Purpose and problem statement**

Today, other systems help with parts of this:

* AgentFS proves that SQLite-backed, queryable, snapshot-friendly agent state is practical.  
* Lár proves that “glass box” agent logs and forensic replay are a real developer advantage.  
* LangGraph proves that persistent checkpoints and time-travel/replay can be normal runtime behavior, not a special debug mode.

But DanteCode does not yet have a native equivalent that is:

* always on  
* local-first  
* file-aware  
* queryable  
* replayable  
* Git-aware  
* and DanteForge-verifiable

That creates four major gaps:

### **A. Forensics gap**

You cannot reliably reconstruct a destructive sequence after the fact.

### **B. Durability gap**

If the worktree is damaged or wiped, the debug truth can disappear with it.

### **C. Query gap**

You cannot ask natural questions like:

* “show every deletion in this session”  
* “what touched this file last week”  
* “which tool call preceded this corruption”

### **D. Replay gap**

You cannot time-travel through a run and inspect the exact decision/file state transitions.

## **4\. Scope**

## **In scope**

This machine must deliver your core surfaces:

* `debugTrail(query?)`  
* `debugSnapshot(fileOrSession?)`  
* `debugRestore(id)`  
* `debugReplay(sessionId, step?)`  
* `auditExport(sessionId)`

It also must deliver:

* immutable SQLite-backed trail  
* automatic file snapshots on every write/delete  
* before/after hashes  
* searchable trail by file/action/error/natural language  
* storage outside the worktree  
* Git/worktree integration  
* DanteForge PDSE/trust scoring on trail entries  
* cross-session persistence  
* CLI dashboard and VS Code sidebar surface  
* exportable forensic report

## **Advanced scope**

Later phases should add:

* visual replay timeline  
* anomaly detection for suspicious changes  
* GitHub issue-ready debug report generation  
* multi-agent shared trail

## **Out of scope for MVP**

Do not start with:

* heavy visual timeline UI  
* anomaly ML heuristics as a dependency  
* multi-user/shared trail ACL complexity  
* cloud observability as a requirement

## **5\. Architecture**

This should be built as a **Persistent Debug Memory Spine** with six organs.

## **5.1 Organ A — Audit Logger**

This is the write path.

It records:

* tool calls  
* model decisions  
* runtime transitions  
* file ops  
* verification states  
* errors  
* deletes/restores

This is where AgentFS and Lár are the strongest inspirations:

* AgentFS for structured SQLite persistence of agent actions/state/history.  
* Lár for centralized forensic audit logging and glass-box replay value.

## **5.2 Organ B — File Snapshotter**

This is the evidence layer.

It captures:

* before snapshot  
* after snapshot  
* content hash  
* file metadata  
* delete tombstone  
* restore lineage

Hard rule:  
**all snapshots live outside the worktree.**

## **5.3 Organ C — Trail Query Engine**

This is the retrieval layer.

It must support:

* exact file/action/error queries  
* natural-language lookup  
* session-scoped and cross-session lookup  
* event lineage  
* diff-aware lookup  
* queryable history with low-latency response

## **5.4 Organ D — Replay Orchestrator**

This is the time-travel layer.

It must support:

* replay by session  
* replay by step  
* replay by file  
* resume from checkpoints  
* reconstruct decision chains  
* reconstruct file states

LangGraph’s persistence/time-travel model is the right design reference here.

## **5.5 Organ E — Snapshot/Git Reconciler**

This is the bridge between forensic trail and Git truth.

It should:

* map trail events to branches/worktrees  
* enrich trail records with Git context  
* optionally create safe Git-native fallback restore points  
* surface human-readable diffs

Aider is a good pattern reference here because it treats Git as part of the core agent workflow rather than an afterthought.

## **5.6 Organ F — Verification \+ Trust Layer**

This is what makes the trail reliable.

It must:

* score trail completeness  
* mark questionable/missing provenance  
* route important trail entries through DanteForge PDSE/trust scoring  
* support audit export  
* support “verified forensic completeness” reporting

## **6\. Canonical package plan**

The right V+E move is a new package:

packages/debug-trail/  
 src/  
   types.ts  
   audit-logger.ts  
   file-snapshotter.ts  
   trail-query-engine.ts  
   replay-orchestrator.ts  
   sqlite-store.ts  
   hash-engine.ts  
   diff-engine.ts  
   restore-engine.ts  
   anomaly-detector.ts  
   export-engine.ts  
   state/  
     trail-index.ts  
     session-map.ts  
     tombstones.ts  
   policies/  
     retention-policy.ts  
     compression-policy.ts  
     privacy-policy.ts  
   integrations/  
     git-bridge.ts  
     sandbox-bridge.ts  
     checkpointer-bridge.ts  
     danteforge-bridge.ts  
     vscode-bridge.ts  
     cli-bridge.ts  
   index.ts

This expands your proposed core files the right way:

* `audit-logger.ts`  
* `file-snapshotter.ts`  
* `trail-query-engine.ts`  
* `replay-orchestrator.ts`

without collapsing everything into four oversized files.

## **7\. Organ-to-OSS harvest map**

## **AgentFS**

Best donor for:

* SQLite-first storage model  
* queryable structured history  
* snapshot-friendly persistence  
* immutable operation logging  
* history outside the mutable workspace

## **Lár**

Best donor for:

* glass-box audit philosophy  
* central audit logger design  
* replay/debug workflow  
* step-by-step forensic visibility

## **LangGraph**

Best donor for:

* checkpoint serialization  
* replay/time travel  
* resume from exact prior state  
* durable state progression

## **Aider**

Best donor for:

* Git-native safety net behavior  
* human-readable commit/diff trail mindset  
* “never trust mutable workspace alone” philosophy

## **Phoenix**

Use only as inspiration for:

* searchability  
* replay UX  
* trace visualization/export  
  But not as a direct donor dependency because of ELv2 licensing.

## **8\. Shared integration surfaces**

This machine must integrate deeply with the rest of DanteCode.

### **A. DTR / Tool Runtime**

Every tool execution should emit trail entries.

### **B. Checkpointer**

Checkpoints and trail events should cross-link so replay can align decisions with runtime state.

### **C. Memory Engine**

Persistent Debug Memory is not the same as semantic memory, but they should cross-reference:

* semantic memory stores knowledge  
* debug trail stores truth of execution

### **D. Verification Spine**

Trail entries can be scored, completeness-checked, and used in “why did this fail?” flows.

### **E. Git/Event Automation**

Hook events, workflow runs, automated writes, and rollbacks all need trail records.

### **F. Council / Subagents**

Each lane/subagent needs scoped trail lineage, with parent-child traceability.

### **G. Sandbox / Worktrees**

Trail storage must live outside the mutable worktree but preserve linkage to it.

## **9\. Public API surface**

Formalize the commands you already proposed.

export interface DebugTrailResult {  
 query?: string;  
 results: Array\<Record\<string, unknown\>\>;  
 latencyMs: number;  
}

export interface DebugSnapshotResult {  
 snapshotId: string;  
 target: string;  
 created: boolean;  
}

export interface DebugRestoreResult {  
 snapshotId: string;  
 restored: boolean;  
 targetPath?: string;  
}

export interface DebugReplayResult {  
 sessionId: string;  
 step?: number;  
 replayed: boolean;  
 trail: Array\<Record\<string, unknown\>\>;  
}

export interface AuditExportResult {  
 sessionId: string;  
 path: string;  
 completenessScore?: number;  
}

Core exported surfaces:

* `debugTrail(query?)`  
* `debugSnapshot(fileOrSession?)`  
* `debugRestore(id)`  
* `debugReplay(sessionId, step?)`  
* `auditExport(sessionId)`

## **10\. Execution model**

A debug-trail write should follow a deterministic path.

### **Step 1 — Observe**

Capture:

* tool start/finish  
* model output/decision  
* file write/delete/move  
* verification state  
* error state  
* checkpoint transition

### **Step 2 — Snapshot**

If file mutation/delete involved:

* capture before snapshot  
* apply operation  
* capture after snapshot or tombstone  
* compute hashes

### **Step 3 — Persist**

Write immutable record to SQLite-backed store outside worktree.

### **Step 4 — Link**

Attach:

* session id  
* run id  
* parent/child lane  
* worktree  
* branch  
* checkpoint id  
* verification state

### **Step 5 — Query / replay**

Allow trail reconstruction by:

* session  
* file  
* action  
* error  
* natural language  
* step index

### **Step 6 — Compress / retain**

Apply:

* compression  
* pruning rules  
* pinned preservation for critical sessions  
* retention defaults like 30 days unless pinned

### **Step 7 — Verify / export**

Allow DanteForge-scored export of trail completeness.

## **11\. Phased roadmap**

## **Phase 1 — SQLite trail \+ snapshots**

Deliver:

* SQLite-backed audit logger  
* file snapshotter  
* trail query MVP  
* storage outside worktree

Goal:

* immediate debugging superpower  
* answer “what changed this file?”

## **Phase 2 — Replay \+ Git bridge \+ UX**

Deliver:

* replay orchestrator  
* Git/worktree linkage  
* CLI dashboard  
* VS Code sidebar  
* export basics

Goal:

* answer “what happened in this run?”

## **Phase 3 — Checkpoint alignment \+ trust \+ anomaly**

Deliver:

* checkpoint-aware replay  
* DanteForge scoring  
* suspicious-deletion heuristics  
* better completeness scoring

Goal:

* answer “why did this happen and can I trust the record?”

## **Phase 4 — Hardening \+ polish**

Deliver:

* retention/compression tuning  
* benchmark harness  
* production hardening  
* issue/export polish  
* multi-agent shared trail

Goal:

* make this one of DanteCode’s defining operational strengths

## **12\. Non-functional requirements / SLOs**

Your PRD’s NFRs are good and should become hard gates.

### **Hard SLOs**

* `<5ms` average overhead per logged operation in normal path  
* `100%` durable persistence target for committed trail events  
* `<200ms` complex query latency target  
* local-first default  
* optional encryption  
* compressed snapshot retention  
* trail survives workspace wipe

### **Additional V+E gates**

* no destructive file operation without before-state capture  
* no trail record without session/run provenance  
* no restore without audit record  
* no pruning without policy record

## **13\. Verification and benchmark model**

Success should be measured exactly the way your PRD implies.

### **A. Lost-context benchmark**

Target:

* zero lost debugging context during DanteCode development

### **B. Queryability benchmark**

Target:

* instantly answer “what changed this file last week?”

### **C. Debug speed benchmark**

Target:

* runtime erasure/debugging time reduced by 80%+

### **D. Completeness benchmark**

Target:

* DanteForge-verified audit completeness \>99%

### **E. Adoption benchmark**

Target:

* becomes the default tool used when debugging DanteCode itself

## **14\. Test charter**

## **Unit tests**

* hash generation  
* snapshot creation  
* tombstone creation  
* SQLite persistence  
* query parsing  
* replay step reconstruction  
* retention/compression policies  
* provenance linking

## **Integration tests**

* tool call trail capture  
* file write before/after snapshots  
* file delete then restore  
* session replay  
* checkpoint-linked replay  
* worktree-scoped trail  
* workspace wipe survival  
* audit export

## **Golden flows**

### **GF-01**

A file is modified and the system stores:

* before snapshot  
* after snapshot  
* hashes  
* action record  
* session linkage

### **GF-02**

A file is deleted accidentally and can be traced and restored from outside the worktree.

### **GF-03**

A session can be replayed step-by-step with decisions and file changes visible.

### **GF-04**

A natural-language query like “what erased auth.ts yesterday?” returns the relevant trail.

### **GF-05**

A workspace is wiped or corrupted, but the debug trail still survives and answers what happened.

### **GF-06**

A multi-agent/council run preserves parent-child lane debug lineage.

### **GF-07**

An audit export produces a complete, immutable, scored forensic report.

## **15\. Risks and corrections**

### **Risk 1 — storage growth**

Correction:

* compression policy  
* pruning policy  
* pin important sessions  
* store diff-friendly snapshots where safe

### **Risk 2 — write-path slowdown**

Correction:

* async buffered logger with durable flush guarantees  
* snapshot pipeline optimized for common paths  
* heavy export/replay separate from hot path

### **Risk 3 — complexity**

Correction:

* AgentFS-style SQLite core first  
* Lár-style audit philosophy second  
* replay/checkpoint alignment after that

### **Risk 4 — false trust**

Correction:

* score completeness  
* surface missing provenance  
* use DanteForge verification on trail exports and critical records

## **16\. Runbook**

### **Step 1**

Build `packages/debug-trail` and core contracts first.

### **Step 2**

Implement audit logger \+ snapshotter \+ SQLite store.

### **Step 3**

Implement trail query engine.

### **Step 4**

Implement replay \+ restore \+ Git linkage.

### **Step 5**

Integrate with checkpointer, DTR, verification, and council/subagents.

### **Step 6**

Add CLI/VS Code surfaces, anomaly hints, and hardening.

## **17\. Done definition**

This machine is complete only when all are true:

1. DanteCode has an always-on immutable debug trail.  
2. File writes and deletes always produce durable before/after history outside the worktree.  
3. Trail is queryable by file/action/error/natural language.  
4. Sessions can be replayed and restored.  
5. Debug truth survives crashes, deletions, and workspace wipes.  
6. Trail integrates with checkpoints, Git/worktrees, DTR, verification, and council/subagents.  
7. Audit exports are complete and DanteForge-verifiable.  
8. Persistent Debug Memory becomes a genuine forensic backbone, not just logging.

## **18\. Final judgment**

This is one of the strongest PRDs in the set because it addresses a real pain you keep hitting.

The most important V+E correction is:

**Build Persistent Debug Memory as DanteCode’s forensic truth layer, not as observability tooling.**

That is how it becomes the unbreakable backbone you described.

The strongest next move is to turn this directly into a **Codex-ready V+E Execution Packet**.

Please create the Codex-ready V+E Execution Packet

I’m pulling the uploaded debug-memory PRD and checking the current external references it names so the execution packet is anchored to the real 2026 tool surfaces before I lock the implementation order.

Thought for 35s

Below is the **Codex-ready V+E Execution Packet** for the **Persistent Debug Memory Enhancement** PRD.

The core build decision is:

**Build this as DanteCode’s forensic truth layer, not as “better logs.”**

That matches the current external patterns your PRD was pointing toward:

* **AgentFS** emphasizes SQLite-backed auditability, queryable history, and snapshot/reproducibility of agent state.  
* **Lár** explicitly positions itself as a “glass box” agent engine for auditable, debuggable execution.  
* **LangGraph** explicitly supports checkpoint persistence, replay, fault-tolerance, and time travel from prior checkpoints.  
* **Aider** treats Git as part of the normal coding loop and supports auto-commit behavior, which makes it a good Git-native safety/reference pattern.  
* **Phoenix** is useful as a UX inspiration for searchable traces and replay, but it is licensed under Elastic License 2.0 rather than MIT/Apache, so it should be treated as a design reference, not a donor dependency.

# **Codex-ready V+E Execution Packet**

## **PDM-01 — DanteCode Persistent Debug Memory Engine**

## **0\. Executive call**

Build this as an **always-on, immutable, queryable forensic debug spine** with six organs:

1. **Audit Logger**  
2. **File Snapshotter**  
3. **Trail Query Engine**  
4. **Replay Orchestrator**  
5. **Snapshot/Git Reconciler**  
6. **Verification \+ Trust Layer**

This machine should become the forensic backbone for:

* DTR / tool runtime  
* Memory Engine  
* Verification Spine  
* Git/Event Automation  
* Council Orchestrator  
* Subagent Orchestrator  
* Research / WebFetch  
* sandbox/worktree execution  
* DanteForge audit/export/scoring

---

# **1\. Objective**

Implement the PRD’s intended uplift by shipping:

* `debugTrail(query?)`  
* `debugSnapshot(fileOrSession?)`  
* `debugRestore(id)`  
* `debugReplay(sessionId, step?)`  
* `auditExport(sessionId)`

with:

* immutable SQLite-backed trail storage  
* automatic before/after file snapshots on modification and deletion  
* storage outside the worktree  
* searchable trail by file/action/error/natural language  
* cross-session persistence  
* Git/worktree linkage  
* checkpoint/replay alignment  
* DanteForge PDSE/trust scoring on trail entries and exports  
* CLI dashboard \+ VS Code sidebar surfacing  
* optional anomaly hints in later phases

## **1.1 Non-goals for MVP**

Do not start with:

* full visual replay timeline UI  
* anomaly ML heuristics as a dependency  
* cloud observability platforms  
* complex multi-user/shared-trail ACL systems  
* heavy hosted trace infrastructure

---

# **2\. Repo boundary and ownership**

## **2.1 New package**

Create:

packages/debug-trail/  
 src/  
   types.ts  
   audit-logger.ts  
   file-snapshotter.ts  
   trail-query-engine.ts  
   replay-orchestrator.ts  
   sqlite-store.ts  
   hash-engine.ts  
   diff-engine.ts  
   restore-engine.ts  
   anomaly-detector.ts  
   export-engine.ts  
   state/  
     trail-index.ts  
     session-map.ts  
     tombstones.ts  
   policies/  
     retention-policy.ts  
     compression-policy.ts  
     privacy-policy.ts  
   integrations/  
     git-bridge.ts  
     sandbox-bridge.ts  
     checkpointer-bridge.ts  
     danteforge-bridge.ts  
     vscode-bridge.ts  
     cli-bridge.ts  
   index.ts

## **2.2 Existing files/systems to integrate with**

* DTR / tool runtime execution surfaces  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* Memory Engine  
* Verification Engine  
* `git-engine`  
* Event Automation / event-orchestrator  
* council/subagent orchestration  
* sandbox/worktree boundaries  
* VS Code extension surfaces  
* CLI command registry  
* DanteForge verification/export surfaces

## **2.3 Hard rule**

`packages/debug-trail` is the source of truth.

Do not distribute debug-trail state across random logs, console output, and ad hoc “history” helpers.

---

# **3\. Canonical architecture**

## **3.1 Audit Logger**

Owns:

* every tool call  
* every model decision summary  
* every runtime transition  
* every verification event  
* every file mutation operation  
* every delete/restore event  
* every error/retry/timeout

Hot-path rule:

* append-only  
* immutable event records  
* durable flush guarantees  
* no “best effort” forensic writes for critical operations

## **3.2 File Snapshotter**

Owns:

* before snapshot capture  
* after snapshot capture  
* tombstones for deletions  
* content hashing  
* metadata capture  
* external storage path outside worktree

Hard rule:

* destructive file actions must capture a durable before-state unless explicitly impossible, and impossibility itself must be logged.

## **3.3 Trail Query Engine**

Owns:

* exact match queries  
* structured filter queries  
* natural-language lookup  
* session-scoped and cross-session lookup  
* file lineage lookup  
* error-to-action correlation  
* event-to-checkpoint correlation

## **3.4 Replay Orchestrator**

Owns:

* replay by session  
* replay by step  
* replay by file  
* checkpoint-aligned replay  
* reconstructed decision chains  
* replay-safe inspection without mutating current workspace

LangGraph’s persistence/time-travel model is the right design reference for replay and stepwise recovery.

## **3.5 Snapshot/Git Reconciler**

Owns:

* worktree/branch linkage  
* Git-aware trail enrichment  
* diff generation  
* restore lineage  
* optional Git-native safety reconciliation

Aider is the right reference pattern for treating Git as a first-class safety/control layer around autonomous file changes.

## **3.6 Verification \+ Trust Layer**

Owns:

* trail completeness scoring  
* missing-provenance detection  
* DanteForge/PDSE bridge  
* forensic export scoring  
* review-required vs trusted forensic state  
* override/audit policy for restore/export flows

---

# **4\. Public API contracts**

Create `packages/debug-trail/src/types.ts` with at least:

export interface DebugTrailResult {  
 query?: string;  
 results: Array\<Record\<string, unknown\>\>;  
 latencyMs: number;  
}

export interface DebugSnapshotResult {  
 snapshotId: string;  
 target: string;  
 created: boolean;  
}

export interface DebugRestoreResult {  
 snapshotId: string;  
 restored: boolean;  
 targetPath?: string;  
}

export interface DebugReplayResult {  
 sessionId: string;  
 step?: number;  
 replayed: boolean;  
 trail: Array\<Record\<string, unknown\>\>;  
}

export interface AuditExportResult {  
 sessionId: string;  
 path: string;  
 completenessScore?: number;  
}

Required exported functions:

* `debugTrail(query?)`  
* `debugSnapshot(fileOrSession?)`  
* `debugRestore(id)`  
* `debugReplay(sessionId, step?)`  
* `auditExport(sessionId)`

Also define canonical internal records:

* `TrailEvent`  
* `FileSnapshotRecord`  
* `DeleteTombstone`  
* `ReplayCursor`  
* `TrailCompletenessScore`  
* `TrailRetentionDecision`

---

# **5\. State and storage model**

## **5.1 Storage**

Primary backing store:

* SQLite, append-oriented  
* lives outside the worktree  
* durable local-first default

This choice aligns directly with AgentFS’s SQLite-backed auditability and reproducibility model.

## **5.2 Snapshot storage**

Snapshots live:

* outside worktree  
* with stable ids  
* linked to session/run/worktree/branch  
* optionally compressed  
* optionally deduped by content hash

## **5.3 Provenance requirements**

Every critical trail record must include:

* session id  
* run id  
* timestamp  
* actor/tool name  
* worktree/branch if applicable  
* before/after hash where applicable  
* checkpoint linkage if applicable  
* verification/trust metadata if applicable

## **5.4 Privacy and retention**

Policies must support:

* local-first  
* optional encryption  
* retention window  
* pinned sessions  
* compression after threshold  
* safe pruning with audit record

---

# **6\. Execution model**

Every forensic write follows a deterministic pipeline:

1. **observe**  
2. **snapshot**  
3. **persist**  
4. **link**  
5. **query/replay**  
6. **compress/retain**  
7. **verify/export**

### **Observe sources**

* tool invocation  
* model decision  
* file write/delete/move  
* verification event  
* error/timeout  
* checkpoint transition  
* council/subagent lane event  
* workflow/event automation event

### **Snapshot rules**

* file write: before \+ after  
* file delete: before \+ tombstone  
* file move: before \+ after \+ lineage mapping  
* non-file event: no content snapshot, but durable event entry

### **Persist rules**

* append immutable event  
* write snapshot references  
* do not trust mutable workspace as source of truth

---

# **7\. Generation plan**

## **PDM-G1 — Contracts spine**

Files:

* `packages/debug-trail/src/types.ts`  
* `packages/debug-trail/src/index.ts`  
* tests

Acceptance:

* core forensic types compile  
* API surface stable  
* no runtime behavior yet

---

## **PDM-G2 — SQLite store**

Files:

* `packages/debug-trail/src/sqlite-store.ts`  
* tests

Acceptance:

* SQLite persistence works  
* append-only event writes supported  
* read/query path exists  
* store lives outside worktree

AgentFS is the right design reference for SQLite-backed queryable persistence.

---

## **PDM-G3 — Hash engine \+ trail index**

Files:

* `packages/debug-trail/src/hash-engine.ts`  
* `packages/debug-trail/src/state/trail-index.ts`  
* tests

Acceptance:

* stable file/content hashes  
* indexable references by file/session/action  
* duplicate snapshot detection possible

---

## **PDM-G4 — Audit logger**

Files:

* `packages/debug-trail/src/audit-logger.ts`  
* `packages/debug-trail/src/state/session-map.ts`  
* tests

Acceptance:

* tool/model/runtime events can be recorded  
* session/run lineage maintained  
* append-only semantics enforced  
* hot path suitable for always-on logging

Lár is the key design reference for central audit logging and glass-box debugging.

---

## **PDM-G5 — File snapshotter**

Files:

* `packages/debug-trail/src/file-snapshotter.ts`  
* `packages/debug-trail/src/state/tombstones.ts`  
* tests

Acceptance:

* before/after snapshots captured  
* delete tombstones created  
* snapshots stored outside worktree  
* missing-before-state case recorded explicitly if unavoidable

---

## **PDM-G6 — Diff engine**

Files:

* `packages/debug-trail/src/diff-engine.ts`  
* tests

Acceptance:

* human-readable before/after diffs generated  
* file-level and text-level comparison supported  
* diff metadata attachable to trail results and exports

---

## **PDM-G7 — Restore engine**

Files:

* `packages/debug-trail/src/restore-engine.ts`  
* tests

Acceptance:

* restore by snapshot id works  
* restore is auditable  
* restore target path explicit  
* unsafe overwrite paths guarded

---

## **PDM-G8 — Trail query engine**

Files:

* `packages/debug-trail/src/trail-query-engine.ts`  
* tests

Acceptance:

* search by file  
* search by action  
* search by error  
* search by session  
* natural-language query path with structured fallback  
* complex queries under target latency on representative fixture set

---

## **PDM-G9 — Replay orchestrator**

Files:

* `packages/debug-trail/src/replay-orchestrator.ts`  
* tests

Acceptance:

* replay by session and step works  
* replay reconstructs event order and snapshot lineage  
* replay is read-only by default  
* checkpoint hooks pluggable

LangGraph persistence/time-travel is the right replay design reference.

---

## **PDM-G10 — Policy layer**

Files:

* `packages/debug-trail/src/policies/retention-policy.ts`  
* `packages/debug-trail/src/policies/compression-policy.ts`  
* `packages/debug-trail/src/policies/privacy-policy.ts`  
* tests

Acceptance:

* retention policy deterministic  
* compression/pruning safe and auditable  
* privacy scope rules enforceable  
* pinned sessions preserved

---

## **PDM-G11 — Export engine**

Files:

* `packages/debug-trail/src/export-engine.ts`  
* tests

Acceptance:

* session export works  
* immutable report format stable  
* completeness metadata included  
* export path auditable

---

## **PDM-G12 — Git bridge**

Files:

* `packages/debug-trail/src/integrations/git-bridge.ts`  
* tests

Acceptance:

* worktree/branch context attaches to trail events  
* Git metadata enriches trail records  
* restore/replay can reference repo state correctly

Aider is the reference pattern for keeping Git-native context tightly connected to autonomous file changes.

---

## **PDM-G13 — Checkpointer bridge**

Files:

* `packages/debug-trail/src/integrations/checkpointer-bridge.ts`  
* tests

Acceptance:

* checkpoints cross-link to trail events  
* replay can align trail with runtime checkpoints  
* interrupted runs remain reconstructable

LangGraph’s checkpoint persistence is the design reference for step-aligned replay and durable run reconstruction.

---

## **PDM-G14 — Sandbox bridge**

Files:

* `packages/debug-trail/src/integrations/sandbox-bridge.ts`  
* tests

Acceptance:

* sandboxed file ops still emit trail entries  
* storage remains outside mutable sandbox workspace  
* sandbox/session linkage preserved

---

## **PDM-G15 — DanteForge bridge**

Files:

* `packages/debug-trail/src/integrations/danteforge-bridge.ts`  
* tests

Acceptance:

* trail completeness scoring works  
* important records can carry PDSE/trust state  
* export can be DanteForge-verifiable  
* no duplicate trust semantics across systems

---

## **PDM-G16 — CLI and VS Code bridges**

Files:

* `packages/debug-trail/src/integrations/cli-bridge.ts`  
* `packages/debug-trail/src/integrations/vscode-bridge.ts`  
* tests

Acceptance:

* CLI can answer “what happened” queries immediately  
* VS Code sidebar panel can surface session/file trail  
* same trail semantics across surfaces  
* no UI-only dependency for core functionality

Phoenix is useful as inspiration for searchable trace UX and replay-style debugging, but it should remain inspiration only because of license constraints.

---

## **PDM-G17 — DTR / runtime weld**

Files:

* integrate with tool runtime / execution surfaces  
* tests

Acceptance:

* every meaningful tool execution emits trail entries  
* destructive tool operations capture snapshots  
* runtime ids and trail ids cross-link

---

## **PDM-G18 — Council / subagent weld**

Files:

* integrate with council/subagent surfaces  
* tests

Acceptance:

* parent-child lane lineage preserved  
* per-lane scoped trail queries work  
* multi-agent session replay works without ambiguity

---

## **PDM-G19 — Anomaly detector**

Files:

* `packages/debug-trail/src/anomaly-detector.ts`  
* tests

Acceptance:

* basic heuristic anomaly flags supported  
* suspicious deletion / burst rewrite / unusual erase patterns detectable  
* anomaly hints do not block core MVP  
* anomaly records are advisory and auditable

---

## **PDM-G20 — Benchmark harness**

Files:

* benchmark fixtures/reports  
* tests

Acceptance:

* logging overhead benchmark  
* query latency benchmark  
* workspace wipe survival benchmark  
* replay benchmark  
* restore benchmark  
* multi-agent lineage benchmark

---

# **8\. Golden flows**

## **GF-01 — File modification forensic record**

Input:

* modify a file

Pass:

* before snapshot captured  
* after snapshot captured  
* hashes stored  
* event linked to session/run/tool/worktree

## **GF-02 — Accidental deletion recovery**

Input:

* delete a file

Pass:

* delete tombstone recorded  
* pre-delete snapshot recoverable  
* restore succeeds from outside worktree  
* delete event queryable

## **GF-03 — Session replay**

Input:

* replay a session

Pass:

* events replay in order  
* file change lineage visible  
* checkpoint linkage visible  
* replay is read-only unless explicit restore invoked

## **GF-04 — Natural-language forensic query**

Input:

* “what erased auth.ts yesterday?”

Pass:

* relevant trail entries returned  
* linked delete/write/snapshot history shown  
* response latency within target band on representative fixture set

## **GF-05 — Workspace wipe survival**

Input:

* wipe/corrupt workspace

Pass:

* trail survives  
* snapshots survive  
* replay and restore still work  
* provenance intact

## **GF-06 — Multi-agent lineage**

Input:

* council/subagent run with multiple lanes

Pass:

* parent-child lane lineage preserved  
* per-lane actions and file changes distinguishable  
* replay can trace each lane separately and together

## **GF-07 — Audit export**

Input:

* export a session

Pass:

* immutable report emitted  
* completeness/trust metadata included  
* export can be verified/scored

---

# **9\. Hard gates**

## **Build gates**

* `debug-trail` builds cleanly  
* no circular dependency with Memory Engine, checkpointer, git-engine, or DanteForge bridge

## **Type gates**

* strict TS compile passes  
* provenance/session/run/worktree contracts stable

## **Test gates**

* unit tests for every new module  
* integration tests for all golden flows  
* benchmark harness runnable

## **Forensic safety gates**

* no destructive file op without best-effort before-state capture and explicit logging of outcome  
* no trail record without session/run provenance  
* no restore without audit record  
* no pruning/compression without policy record  
* no core forensic truth stored only inside the mutable worktree

---

# **10\. Success criteria**

This packet is complete only when all are true:

1. DanteCode has an always-on immutable debug trail.  
2. File writes and deletes always produce durable history outside the worktree.  
3. Trail is queryable by file/action/error/natural language.  
4. Sessions can be replayed stepwise.  
5. Deleted files can be traced and restored.  
6. Debug truth survives crashes, deletions, and workspace wipes.  
7. Trail integrates with checkpoints, Git/worktrees, runtime events, and council/subagents.  
8. Audit exports are complete and trust-scored.  
9. Persistent Debug Memory becomes the default debugging path for DanteCode itself.

---

# **11\. Risks and corrections**

## **Risk 1 — storage growth**

Correction:

* retention policy  
* compression policy  
* pinned-session preservation  
* hash/dedup support  
* export/archive path

## **Risk 2 — hot-path latency**

Correction:

* async buffered logger with durable flush guarantees  
* cheap hashes on hot path, heavier export/replay later  
* separate hot path from analytical queries

## **Risk 3 — false trust**

Correction:

* completeness scoring  
* provenance requirements  
* explicit missing-data markers  
* DanteForge trust bridge

## **Risk 4 — complexity explosion**

Correction:

* SQLite core first  
* snapshotter second  
* query engine third  
* replay/restore after trail truth is solid  
* anomaly/UI last

## **Risk 5 — debug trail becomes “just another log”**

Correction:

* enforce immutable schema  
* tie every critical operation to provenance and snapshots  
* make replay/restore/query first-class, not afterthoughts

---

# **12\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing PDM-01: DanteCode Persistent Debug Memory Engine.

Goal:  
Build an always-on, immutable, queryable forensic debug spine for DanteCode that records:  
\- every tool call  
\- every model decision summary  
\- every file write/delete  
\- before/after snapshots and tombstones  
\- checkpoint linkage  
\- verification state  
\- session/worktree/branch provenance

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- packages/debug-trail is the source of truth  
\- All core trail storage must live outside the worktree  
\- No destructive file operation without best-effort before-state capture and explicit logging  
\- No restore without audit record  
\- No trail record without session/run provenance  
\- No core forensic truth stored only in mutable workspace state

Create:  
packages/debug-trail/  
 src/  
   types.ts  
   audit-logger.ts  
   file-snapshotter.ts  
   trail-query-engine.ts  
   replay-orchestrator.ts  
   sqlite-store.ts  
   hash-engine.ts  
   diff-engine.ts  
   restore-engine.ts  
   anomaly-detector.ts  
   export-engine.ts  
   state/  
     trail-index.ts  
     session-map.ts  
     tombstones.ts  
   policies/  
     retention-policy.ts  
     compression-policy.ts  
     privacy-policy.ts  
   integrations/  
     git-bridge.ts  
     sandbox-bridge.ts  
     checkpointer-bridge.ts  
     danteforge-bridge.ts  
     vscode-bridge.ts  
     cli-bridge.ts  
   index.ts

Generation order:

G1:  
\- types.ts  
\- index.ts  
\- tests

G2:  
\- sqlite-store.ts  
\- tests

G3:  
\- hash-engine.ts  
\- state/trail-index.ts  
\- tests

G4:  
\- audit-logger.ts  
\- state/session-map.ts  
\- tests

G5:  
\- file-snapshotter.ts  
\- state/tombstones.ts  
\- tests

G6:  
\- diff-engine.ts  
\- tests

G7:  
\- restore-engine.ts  
\- tests

G8:  
\- trail-query-engine.ts  
\- tests

G9:  
\- replay-orchestrator.ts  
\- tests

G10:  
\- policies/retention-policy.ts  
\- policies/compression-policy.ts  
\- policies/privacy-policy.ts  
\- tests

G11:  
\- export-engine.ts  
\- tests

G12:  
\- integrations/git-bridge.ts  
\- tests

G13:  
\- integrations/checkpointer-bridge.ts  
\- tests

G14:  
\- integrations/sandbox-bridge.ts  
\- tests

G15:  
\- integrations/danteforge-bridge.ts  
\- tests

G16:  
\- integrations/cli-bridge.ts  
\- integrations/vscode-bridge.ts  
\- tests

G17:  
Integrate with DTR / runtime tool execution  
\- tests

G18:  
Integrate with council / subagent surfaces  
\- tests

G19:  
\- anomaly-detector.ts  
\- tests

G20:  
\- benchmark harness / fixtures / reports  
\- tests

Required public APIs:  
\- debugTrail(query?)  
\- debugSnapshot(fileOrSession?)  
\- debugRestore(id)  
\- debugReplay(sessionId, step?)  
\- auditExport(sessionId)

Golden flows:  
\- file modification forensic record  
\- accidental deletion recovery  
\- session replay  
\- natural-language forensic query  
\- workspace wipe survival  
\- multi-agent lineage  
\- audit export

At the end of each generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until all golden flows pass.  
---

# **13\. Final judgment**

This machine is worth prioritizing because it closes a real operational wound: losing the truth of what DanteCode actually did.

The correct build order is:

**SQLite core → audit logger → snapshotter → query engine → replay/restore → bridges → anomaly/UI → benchmarks**

That gets you real forensic power early, before the optional polish layers.

