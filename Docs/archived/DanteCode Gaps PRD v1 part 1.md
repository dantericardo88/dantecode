**DanteCode WebSearch Enhancement PRD v1.0**  
**Objective:** Close the critical gaps identified in the live repo analysis (generic browser-agent.ts fallback, no native DuckDuckGo implementation, no dedicated caching layer, weak smart extractor).  
**Target scores:** WebSearch 9.0+ and WebFetch/Page Analysis 9.0+ (from current 7.0 each).

**Scope:** Build a first-class, native, cached, intelligent web research module that is model-agnostic, MCP-compatible, DanteForge-verifiable, and production-ready.

### **Top 3-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

These were selected after direct repo/code review (no .md hype, no external benchmarks). Focus is on **harvestable code patterns** we can port or adapt (licenses allow: MIT/Apache).

1. **EudaLabs/ddgs (or deedy5/ddgs family) – Native DuckDuckGo Search Core**  
   * Why harvest: Pure, no-API-key DuckDuckGo client used in top agents (LangChain, CrewAI, Phidata). Full TS ports exist with excellent result parsing.  
   * Harvest targets: Query building, pagination/time/region/safe-search filters, structured result objects (title, url, snippet, date, source), retry/backoff logic.  
   * GitHub: Search “EudaLabs/ddgs” or deedy5/ddgs for the latest Node/TS implementation.  
   * Direct win: Makes “native DuckDuckGo tool” real and unlimited (with our caching).  
2. **Firecrawl (@mendableai/firecrawl \+ @mendable/firecrawl-js SDK)**  
   * Why harvest: Gold-standard for turning any URL into clean LLM-ready Markdown \+ structured JSON. Self-hostable Docker option \+ agent mode.  
   * Harvest targets: Schema-based extraction, pre-actions (click/scroll/wait), clean markdown generator, batch/async patterns, output options (markdown/JSON/screenshot).  
   * GitHub: mendableai/firecrawl.  
   * Direct win: Solves the “smart extractor” gap with one SDK call.  
3. **Crawl4AI (unclecode/crawl4ai)**  
   * Why harvest: Best-in-class caching \+ hybrid extraction (rule-based \+ LLM). Adaptive strategies and relevance filtering.  
   * Harvest targets: CacheMode system (ENABLED/BYPASS/WRITE\_ONLY), BM25 \+ cosine relevance scoring, dual extraction pipelines (CSS/XPath vs LLM), markdown cleaning (headings/tables preserved), session pooling.  
   * GitHub: unclecode/crawl4ai (study Python patterns and port the architecture — extremely clean).  
   * Direct win: Persistent \+ in-memory caching \+ noise reduction.  
4. **Stagehand (browserbase/stagehand)**  
   * Why harvest: Modern TypeScript-first browser agent framework built on Playwright. Perfect match for our existing browser-agent.ts.  
   * Harvest targets: extract() with Zod schemas, hybrid act()/observe() control, auto-caching of successful actions, self-healing, structured output.  
   * GitHub: browserbase/stagehand.  
   * Direct win: Upgrades our Playwright usage into production-grade agentic extraction.  
5. **Qwen Code CLI web\_search tool (QwenLM/qwen-code)**  
   * Why harvest: Exact same CLI/agent architecture as DanteCode. Multi-provider abstraction, concise answer \+ numbered citations, config-driven fallbacks.  
   * Harvest targets: Provider priority/fallback logic, settings.json \+ env \+ CLI flag config, citation parsing, tool disable/exclude pattern.  
   * GitHub: QwenLM/qwen-code (tool definition in core).  
   * Direct win: Professional tool integration and citation UX.

### **Functional Requirements (MVP \+ Phased)**

**Core Tools (expose via MCP and slash-commands):**

* web\_search(query, options) → structured results \+ cache hit  
* web\_fetch\_and\_extract(url, instructions?, schema?) → {markdown, structuredJson, metadata, citations}  
* Optional: smart\_research(query) → multi-hop subagent mode

**Must-Have Features**

* Native DuckDuckGo primary (via ddgs) \+ fallbacks  
* Hybrid caching (in-memory LRU per session \+ persistent via existing session-store/checkpointer.ts — key \= normalized query/URL \+ hash)  
* Smart extractor pipeline: Playwright/Stagehand → Firecrawl-style cleaning → Crawl4AI-style relevance filter → optional lightweight model refine  
* Structured output (Zod schemas or natural-language instructions)  
* Relevance ranking \+ deduplication  
* Streaming where possible \+ clear citations/sources  
* DanteForge hooks (fact-check extracted claims, PDSE scoring)

**Advanced (Phase 2+)**

* Parallel multi-query \+ subagent spawning  
* Pre-actions (click/scroll sequences)  
* Query rewriting via model-router  
* Stealth (user-agent rotation, proxies, rate-limit backoff)

### **Non-Functional Requirements**

* Latency: \<1.5s cached search, \<6s full search+extract  
* Cache hit target: \>60% in realistic multi-turn sessions  
* Privacy-first (DuckDuckGo default, no tracking)  
* Resilient (retries, circuit breaker, loop-detector integration)  
* Model-agnostic & sandboxed (worktree \+ Docker)  
* Configurable via CLI flags, settings.json, and runtime params

### **Implementation Recommendations (DanteCode-Specific)**

* New module: packages/web-research (or extend core/browser-agent.ts \+ mcp)  
* Reuse: model-router.ts for any light LLM calls, git-engine for any local persistence, danteforge for verification gates  
* Caching layer: Simple key-value on top of existing checkpointer.ts  
* Make Firecrawl optional (cloud free tier or self-hosted)  
* Full MCP compatibility \+ slash-command support

### **Phased Roadmap**

**Phase 1 (1–2 weeks):** Native ddgs search \+ basic cache \+ simple fetch (MVP that already hits 8.5)  
**Phase 2 (2 weeks):** Firecrawl/Stagehand extractor \+ Crawl4AI-style cleaning & relevance (smart extractor live)  
**Phase 3 (1–2 weeks):** Full caching strategies, multi-provider (Qwen-style), parallel/subagent support

**Phase 4 (1 week):** DanteForge integration, benchmarks, testing on research-heavy tasks, polish

### **Success Metrics & Verification**

* Internal benchmark: 20+ research/synthesis tasks (compare before/after)  
* Agent autonomy improvement on web-dependent workflows  
* Cache hit rate \+ output cleanliness (human \+ DanteForge eval)  
* SWE-bench or custom web-research suite uplift  
* Production maturity: \>80% test coverage for new module

### **Risks & Mitigations**

* Rate limits → heavy caching \+ backoff (already in ddgs patterns)  
* Extraction quality on JS-heavy sites → Stagehand/Firecrawl hybrid \+ fallback  
* Maintenance → Build self-healing patterns from Stagehand/Crawl4AI

This PRD is ready to copy-paste directly into DanteCode’s planner/orchestrator. It gives concrete GitHub references, exact harvest targets, and a clear path to close the gaps with minimal new dependencies.

Once implemented, we should see WebSearch and WebFetch jump to 9.0+ and overall score move meaningfully higher. Let me know if you want API signature examples, file-by-file breakdown, or a sample implementation stub\!

**DanteCode Agent Spawning / SubAgents Enhancement PRD v1.0**  
**Objective:** Close the critical gaps identified in the live repo analysis (multi-agent.ts \+ background-agent.ts provide basic nesting and background support, but lack dynamic spawning control, hierarchical orchestration, robust handoff protocols, per-subagent isolation/persistence, and proven long-run autonomy).  
**Target scores:** Agent Spawning / SubAgents 9.5+ and Agent Reasoning / Autonomy 8.5+ (from my current 8.0 / 7.0).

**Scope:** Build production-grade dynamic spawning, nesting, and orchestration that is model-agnostic, MCP-compatible, DanteForge-verifiable, Git-native (worktree isolation), and integrates with existing checkpointer/recovery-engine.

### **Top 4-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

Selected after direct review of 2026 ecosystems (LangChain.js extensions, native TS frameworks, lightweight handoff patterns). Licenses (MIT/Apache) allow clean harvesting. Focus is on **code patterns** we can port directly into our monorepo.

1. **LangGraph.js (langchain-ai/langgraphjs \+ LangChain.js subgraph support)**  
   * Why harvest: Gold-standard stateful graphs with **subgraphs** for true hierarchical nesting and isolated yet connected sub-agents.  
   * Harvest targets: Dynamic subgraph registration, state mapping (parent ↔ child), per-subgraph checkpointing, conditional routing, error propagation & recovery.  
   * GitHub: langchain-ai/langgraphjs (or core LangGraph patterns).  
   * Direct win: Turns our basic nesting into reliable, checkpointed hierarchical teams.  
2. **OpenAI Swarm (openai/swarm \+ TS ports like K-Mistele/swarm)**  
   * Why harvest: Extremely lightweight and elegant **handoff** mechanism for on-the-fly spawning — minimal boilerplate, maximum flexibility.  
   * Harvest targets: Agent-to-agent handoff via function returns, context passing, simple orchestration loop, spawn-from-within logic.  
   * GitHub: openai/swarm (study the core loop and adapt).  
   * Direct win: Instant dynamic spawning with zero overhead.  
3. **Mastra (mastra-ai/mastra)**  
   * Why harvest: Modern native TypeScript-first framework with practical .network() multi-agent routing and delegation.  
   * Harvest targets: Agent networking, memory-sharing strategies, TS-first lifecycle (spawn/monitor/terminate), built-in observability.  
   * GitHub: mastra-ai/mastra.  
   * Direct win: Gives us clean, opinionated TS patterns that match our model-router.ts perfectly.  
4. **CrewAI hierarchical process patterns (joaomdmoura/crewAI — port architecture)**  
   * Why harvest: Battle-tested manager → specialist delegation and role-based team spawning (even though Python, the orchestration logic is framework-agnostic).  
   * Harvest targets: Manager decomposition logic, allow\_delegation flags, hierarchical task assignment, controlled validation loops.  
   * GitHub: joaomdmoura/crewAI (extract the manager/specialist flow).  
   * Direct win: Role-based spawning that integrates with our skill decomposition.  
5. **ComposioHQ/agent-orchestrator**  
   * Why harvest: Parallel git-worktree agent orchestration — extremely relevant to our git-engine \+ sandbox.  
   * Harvest targets: Parallel spawn patterns, worktree isolation, result merging for multiple sub-agents.  
   * GitHub: ComposioHQ/agent-orchestrator.  
   * Direct win: Native Git-native scaling for long-running sub-tasks.

### **Functional Requirements (MVP \+ Phased)**

**Core Tools (expose via MCP and slash-commands):**

* spawn\_subagent(role, task, context?, parentId?) → returns agent handle \+ stream  
* handoff\_to\_subagent(targetRole, message)  
* monitor\_subagents(parentId) \+ terminate\_subagent(id)  
* smart\_orchestrate(task) → auto-decompose \+ spawn hierarchy

**Must-Have Features**

* Dynamic spawning with role/skill specialization (via model-router.ts)  
* Configurable nesting depth, spawn limits, and parallelism  
* State isolation (default) with controlled sharing (checkpointer integration)  
* Handoff protocols \+ result synthesis/merging  
* Full lifecycle management (spawn → monitor → timeout → terminate)  
* Enhanced loop/infinite-spawn prevention (tie into existing loop-detector.ts)  
* DanteForge verification gates on every sub-agent output \+ PDSE scoring  
* Background agent mode for long-running sub-tasks (extend background-agent.ts)  
* Git-native isolation (worktree per sub-agent via git-engine)

**Advanced (Phase 2+)**

* Auto-hierarchical decomposition (manager agent spawns specialists)  
* Visual orchestration graph (optional VS Code preview)  
* Self-healing via recovery-engine  
* Parallel multi-subagent execution with merge strategies

### **Non-Functional Requirements**

* Latency: \<200ms spawn overhead  
* Reliability: Zero orphaned agents; full checkpoint recovery  
* Scalability: Support 10+ concurrent nested agents in one session  
* Privacy/Security: Sandboxed (Docker/worktree) \+ DanteForge gates  
* Model-agnostic: Any provider via existing router  
* Observability: Full traces tied into session-store

### **Implementation Recommendations (DanteCode-Specific)**

* New module: packages/agent-orchestrator or extend core/multi-agent.ts  
* Core new file: subagent-spawner.ts \+ handoff-engine.ts  
* Reuse heavily: checkpointer.ts (per-agent state), recovery-engine.ts, model-router.ts (specialization), git-engine (worktree isolation), danteforge (verification), loop-detector.ts  
* MCP tool \+ slash-command support out of the box  
* Streaming responses for sub-agent progress

### **Phased Roadmap**

**Phase 1 (1 week):** Swarm-style handoffs \+ basic dynamic spawning (MVP that hits 8.5 immediately)  
**Phase 2 (2 weeks):** LangGraph.js subgraphs \+ checkpointed nesting \+ state management  
**Phase 3 (1–2 weeks):** Mastra/CrewAI hierarchical patterns \+ full lifecycle \+ parallel git-worktree support

**Phase 4 (1 week):** Composio-style scaling, DanteForge integration, testing on complex multi-step workflows, polish

### **Success Metrics & Verification**

* Internal benchmark: 15+ multi-agent research/coding tasks (before/after autonomy uplift)  
* Long-run stability: 30+ minute sessions with deep nesting without crashes/orphans  
* DanteForge pass rate on sub-agent outputs \>95%  
* SWE-bench or custom multi-agent suite improvement  
* Cache/checkpoint hit rate for resumed sessions

### **Risks & Mitigations**

* Spawn explosion → strict limits \+ loop-detector tie-in  
* State bloat → per-subagent checkpoint pruning (reuse existing logic)  
* Complexity → Start with Swarm lightweight patterns, then layer hierarchical  
* Maintenance → Harvest clean abstractions so updates to upstream are minimal

This PRD is ready to copy-paste straight into DanteCode’s planner/orchestrator or wave mode. It gives concrete GitHub targets, exact harvest points, and a tight integration path with your existing architecture (multi-agent.ts, background-agent.ts, checkpointer, DanteForge, git-engine).

Once shipped, spawning becomes a true superpower — dynamic, reliable, and production-ready. Let me know if you want API type signatures, a starter implementation stub in TS, or the next PRD (e.g., Verification/QA or Production Maturity)\!

**DanteCode WebFetch / Page Analysis Enhancement PRD v1.0**

**Objective:** Close the critical gaps identified in the live repo analysis (browser-agent.ts exists but lacks a true “smart extractor”, clean markdown output, structured/schema-based extraction, advanced caching, relevance filtering, and robust JS rendering \+ cleaning pipeline).  
**Target scores:** WebFetch / Page Analysis **9.0+** (from my current 7.0) and synergistic uplift to WebSearch.

**Scope:** Build a production-grade, intelligent WebFetch module that produces LLM-ready output (clean markdown \+ structured JSON), integrates with DanteForge verification, caching via checkpointer, and works model-agnostically.

### **Top 4-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

Selected based on March 2026 ecosystem (strong TS support, LLM-optimized extraction, self-hostable where possible, MIT/Apache licenses).

1. **Stagehand (browserbase/stagehand)**  
   * Why harvest: Best-in-class TypeScript-native AI browser automation framework built on Playwright. Perfect upgrade path for existing browser-agent.ts.  
   * Harvest targets: extract() API with Zod schemas or natural language instructions, act() \+ observe() patterns, self-healing selectors, structured output, auto-caching of successful extractions.  
   * GitHub: [https://github.com/browserbase/stagehand](https://github.com/browserbase/stagehand)  
   * Direct win: Turns generic browser control into precise, schema-driven page analysis.  
2. **Firecrawl (firecrawl/firecrawl \+ @mendable/firecrawl-js SDK)**  
   * Why harvest: Current gold standard for turning any URL into clean, LLM-ready Markdown \+ structured JSON. Widely used in top agents.  
   * Harvest targets: Markdown cleaning pipeline, schema-based extraction, pre/post actions (scroll/click/wait), batch processing patterns, output formatting (markdown \+ JSON \+ metadata).  
   * GitHub: [https://github.com/firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) (core) \+ JS SDK. Self-host option available.  
   * Direct win: Instant high-quality “smart extractor” with minimal code.  
3. **Crawlee (apify/crawlee)**  
   * Why harvest: Most robust production-grade Node.js/TypeScript web scraping & browser automation framework. Excellent for reliability at scale.  
   * Harvest targets: PlaywrightCrawler patterns, session management, proxy/stealth handling, request queuing, data storage abstractions, anti-blocking best practices.  
   * GitHub: [https://github.com/apify/crawlee](https://github.com/apify/crawlee)  
   * Direct win: Makes our fetch layer production-mature and resilient.  
4. **Crawl4AI (unclecode/crawl4ai)**  
   * Why harvest: Advanced open-source extraction with sophisticated caching and hybrid strategies (CSS \+ LLM).  
   * Harvest targets: CacheMode architecture (ENABLED/BYPASS/WRITE\_ONLY), relevance scoring (BM25 \+ cosine), dual extraction pipelines, markdown cleaning (preserve tables/headings), noise removal heuristics.  
   * GitHub: [https://github.com/unclecode/crawl4ai](https://github.com/unclecode/crawl4ai)  
   * Direct win: Professional caching \+ quality filtering layer we can port.  
5. **LLM Scraper patterns (various TS implementations)**  
   * Why harvest: Lightweight TypeScript libraries using function calling \+ Playwright for schema-driven extraction.  
   * Harvest targets: Prompt engineering for extraction, structured output parsing, hybrid local LLM refinement.  
   * Direct win: Lightweight fallback and model-router integration.

### **Functional Requirements (MVP \+ Phased)**

**Core MCP Tools / Slash Commands:**

* web\_fetch(url, instructions?, schema?, options?) → {markdown, structuredData, metadata, sources}  
* smart\_extract(url, goal) → auto-decomposed intelligent extraction  
* batch\_fetch(urls, commonInstructions)

**Must-Have Features**

* JS rendering via Playwright/Stagehand (handle SPAs)  
* Clean markdown output (headings, tables, lists preserved; ads/nav/footers removed)  
* Schema-based or natural-language structured JSON extraction (Zod preferred)  
* Intelligent caching (URL \+ instruction hash → persistent via checkpointer.ts)  
* Relevance filtering and deduplication  
* Citations and source metadata  
* DanteForge verification hooks on extracted claims  
* Fallback chain: Cache → Firecrawl-style → Stagehand agentic → basic fetch

**Advanced (Phase 2+)**

* Pre-actions (login flows, infinite scroll, clicks)  
* Multi-page / site mapping with subagent spawning  
* Vision-based extraction fallback for complex layouts  
* Query-aware extraction (tie into model-router)

### **Non-Functional Requirements**

* Latency: \<3s typical cached/smart extract, \<8s cold JS-heavy page  
* Output quality: Clean, concise, LLM-optimized (target token efficiency)  
* Reliability: \>95% success rate on modern sites (with retries \+ stealth)  
* Privacy: Local-first where possible, configurable proxies  
* Integration: Full MCP \+ streaming where applicable \+ Git worktree safety

### **Implementation Recommendations (DanteCode-Specific)**

* New module: packages/web-extractor or major enhancement to core/browser-agent.ts  
* Create: smart-extractor.ts, fetch-engine.ts, markdown-cleaner.ts  
* Heavy reuse: model-router.ts (for light refinement), checkpointer.ts (caching), danteforge (PDSE \+ gates on output), git-engine (optional local snapshots), loop-detector.ts  
* Make Firecrawl and Stagehand optional (API key or self-hosted)  
* Add comprehensive tests using existing SWE-bench style harness

### **Phased Roadmap**

**Phase 1 (1 week):** Firecrawl JS SDK integration \+ basic caching \+ markdown output (quick jump to 8.0–8.5)  
**Phase 2 (1–2 weeks):** Stagehand agentic extraction \+ schema support \+ Crawlee reliability layer  
**Phase 3 (1–2 weeks):** Crawl4AI-style advanced caching \+ cleaning \+ relevance scoring \+ DanteForge deep integration

**Phase 4 (1 week):** Polish, batch support, multi-page, benchmarks, VS Code preview enhancements

### **Success Metrics & Verification**

* Human \+ DanteForge eval on 25 diverse pages (news, docs, SPAs, e-commerce)  
* Cache hit rate \>65% in typical research sessions  
* Output cleanliness and structure score improvement  
* Autonomy uplift on web-heavy agent tasks  
* Production readiness: high test coverage, error recovery

### **Risks & Mitigations**

* Site changes breaking selectors → Stagehand self-healing \+ fallback pipelines  
* Rate limits / blocks → Heavy caching \+ Crawlee stealth patterns \+ optional proxies  
* Token bloat → Aggressive cleaning \+ optional summarization gates  
* Complexity → Start with SDK-first (Firecrawl), then deepen with Stagehand

This PRD is ready for direct ingestion into DanteCode’s planner. It gives concrete GitHub links and harvest targets while tying tightly into your existing architecture (browser-agent, DanteForge, checkpointer, model-router, git-engine).

Once complete, WebFetch should become one of DanteCode’s strongest capabilities and pair perfectly with the WebSearch module we defined earlier. Let me know if you want API type signatures, a starter TS stub, or the next PRD (e.g., Verification/QA or Production Maturity)\!

# **V+E Masterplan**

## **DanteCode Research \+ Orchestration Uplift**

### **Web Research Engine \+ Subagent Orchestrator**

## **1\. Executive judgment**

This should be built as a **single masterplan with two coordinated machines**:

1. **Research Machine**  
   Native search, fetch, extraction, ranking, caching, citations, and research workflows.  
2. **Subagent Orchestration Machine**  
   Dynamic spawning, handoffs, checkpointed nesting, lifecycle control, worktree isolation, and synthesis.

The PRD’s strongest insight is that both machines already point to the same existing DanteCode spine:

* `checkpointer`  
* `recovery-engine`  
* `model-router`  
* `git-engine`  
* `background-agent`  
* `multi-agent`  
* DanteForge verification / PDSE / gates

So this should not be built as “two random packages.” It should be built as a **shared runtime uplift** with:

* one state model,  
* one verification model,  
* one event stream,  
* one capability registry,  
* and two domain machines on top.

## **2\. What the PRD is really saying**

The uploaded document identifies two missing capabilities:

### **A. Web research is underpowered**

The PRD calls out:

* generic browser fallback,  
* no native DuckDuckGo,  
* no dedicated cache,  
* weak smart extractor,  
* weak citations and ranking.

### **B. Subagent orchestration is underpowered**

The PRD calls out:

* basic nesting exists,  
* but spawning control, hierarchy, handoffs, isolation, persistence, and long-run autonomy are not yet strong enough.

Those are not unrelated.  
A strong research system naturally becomes one of the first workloads that should be delegated to subagents. The PRD even hints at that with:

* optional `smart_research(query)` for multi-hop subagent mode,  
* and `smart_orchestrate(task)` for automatic decomposition and spawning.

So the correct V+E shape is:

* **Machine 1:** Research Engine  
* **Machine 2:** Subagent Orchestrator  
* **Shared Contracts:** events, state, checkpoints, verification, task packets, citations, evidence

## **3\. Final product thesis**

### **Product thesis**

DanteCode becomes a **research-capable autonomous coding/runtime system** that can:

* perform high-quality native web research,  
* cache and extract structured evidence,  
* spawn specialized subagents to parallelize complex tasks,  
* checkpoint and recover those subagents,  
* verify their outputs through DanteForge,  
* and synthesize results safely.

### **Business thesis**

This improves:

* autonomy,  
* quality of research-dependent coding tasks,  
* multi-step task completion,  
* and long-run durability.

### **Technical thesis**

This is not just “add web search” and “add subagents.”  
This is a foundational uplift to DanteCode’s:

* retrieval,  
* delegation,  
* state handling,  
* and verification.

## **4\. Scope**

## **In scope**

### **Research**

* native DuckDuckGo search  
* structured search results  
* cached fetch and extraction  
* smart page cleaning  
* relevance ranking  
* deduplication  
* citations  
* structured extraction via schema or instructions  
* optional multi-hop research mode

### **Orchestration**

* dynamic subagent spawning  
* hierarchical nesting  
* handoffs  
* lifecycle control  
* monitor/terminate  
* checkpointed recovery  
* git/worktree isolation  
* background agent extension  
* synthesis/merge of subagent outputs

### **Shared**

* MCP exposure  
* slash-command support  
* event logging  
* checkpointer integration  
* recovery integration  
* model-router integration  
* DanteForge verification hooks  
* test harness and benchmarks

## **Out of scope for first release**

* browser stealth/proxies as first-class production feature  
* visual orchestration UI as a required deliverable  
* unlimited deep-agent swarms  
* full autonomous research browsing without guardrails  
* remote fleet orchestration  
* speculative “perfect” self-healing beyond checkpoint recovery

## **5\. Purpose and problem statement**

DanteCode needs stronger autonomy, but autonomy fails if:

* research quality is weak,  
* fetched pages are noisy,  
* subagents lose state,  
* or child agents spawn uncontrollably.

The uploaded PRD’s target scores make the intent clear:

* WebSearch and WebFetch should move from around 7.0 to 9.0+  
* Agent Spawning and Reasoning should move from roughly 8.0 / 7.0 to 9.5+ / 8.5+

So the masterplan objective is:

Build a production-grade Research \+ Orchestration runtime that improves research quality, delegation quality, and long-run task completion without sacrificing determinism, safety, or verification.

## **6\. Inputs and outputs**

## **Inputs**

* user prompts  
* repo state  
* URLs  
* search queries  
* schemas/instructions for extraction  
* agent task packets  
* role/skill hints  
* model-router capabilities  
* checkpoint state  
* worktree context  
* optional MCP tool inputs

## **Outputs**

### **Research outputs**

* structured search results  
* normalized citations  
* cleaned markdown  
* extracted JSON  
* ranked and deduped sources  
* cache records  
* evidence bundle

### **Orchestration outputs**

* subagent handles  
* lifecycle telemetry  
* task packet history  
* handoff packets  
* child checkpoints  
* synthesized child outputs  
* merge summaries  
* verification reports

### **Shared outputs**

* event logs  
* audit JSONL  
* DanteForge verification signals  
* benchmark traces  
* test results

## **7\. Shared architecture**

This is the most important V+E correction.

Do not build:

* one web package with its own state model  
* one agent package with another state model

Instead build a **shared foundation**.

## **7.1 Shared runtime contracts**

### **A. Task packet**

Every child research/spawn/orchestration task should use the same task packet shape.

export interface RuntimeTaskPacket {

 id: string;

 kind: "research" | "fetch-extract" | "subagent-task" | "synthesis";

 parentId?: string;

 objective: string;

 context: Record\<string, unknown\>;

 role?: string;

 constraints?: {

   maxDepth?: number;

   maxParallel?: number;

   timeoutMs?: number;

   budgetTokens?: number;

 };

 inputs?: {

   query?: string;

   url?: string;

   schema?: Record\<string, unknown\>;

 };

}

### **B. Checkpoint contract**

Shared checkpoint record:

* task state  
* parent/child relationship  
* progress markers  
* output artifacts  
* retry/handoff info

### **C. Event contract**

Unified event kinds:

* `research.search.started`  
* `research.search.completed`  
* `research.fetch.started`  
* `research.extract.completed`  
* `subagent.spawned`  
* `subagent.handoff`  
* `subagent.timeout`  
* `subagent.terminated`  
* `runtime.synthesis.completed`  
* `runtime.verification.passed`  
* `runtime.verification.failed`

### **D. Verification contract**

Every major output can be routed through DanteForge gates:

* evidence presence  
* source/citation completeness  
* anti-stub  
* PDSE  
* structure validity  
* final synthesis integrity

## **7.2 Shared organs**

### **Organ 1 — Runtime State Spine**

Backed by:

* `checkpointer`  
* `session-store`  
* `recovery-engine`

### **Organ 2 — Capability Router**

Backed by:

* `model-router`  
* per-provider capability declarations  
* future search provider registry  
* future subagent role specializations

### **Organ 3 — Verification Spine**

Backed by:

* DanteForge  
* PDSE  
* output scoring  
* post-run evaluations

### **Organ 4 — Isolation Spine**

Backed by:

* git-engine  
* worktrees  
* background-agent isolation  
* Docker/sandbox boundaries

## **8\. Machine A — Research Engine**

## **8.1 Purpose**

Turn DanteCode’s current research from generic fallback behavior into a first-class research system with:

* native search  
* structured extraction  
* smart cleaning  
* caching  
* and trustworthy citations

This directly reflects the uploaded PRD’s must-haves and architecture recommendation.

## **8.2 Research Engine organs**

### **A. Search Provider Layer**

Primary target: native DuckDuckGo.  
The PRD explicitly wants native DuckDuckGo via ddgs, with structured results, filters, and retries/backoff.

### **B. Fetch \+ Extract Layer**

Pipeline:

1. page acquisition  
2. Playwright/Stagehand interaction if needed  
3. cleaned markdown generation  
4. schema/instruction extraction  
5. metadata and citation packaging

This mirrors the PRD’s smart extractor pipeline:  
Playwright/Stagehand → Firecrawl-style cleaning → Crawl4AI-style relevance filter → optional lightweight model refine.

### **C. Cache Layer**

Hybrid cache:

* session LRU  
* persistent key-value on top of `checkpointer` or session store

The PRD explicitly calls for hybrid caching and normalized query/URL hashing.

### **D. Ranking \+ Dedup Layer**

Handles:

* relevance scoring  
* near-duplicate collapse  
* source diversity  
* evidence ranking

### **E. Research Synthesizer**

Transforms multi-page results into:

* summarized evidence  
* extracted fields  
* source-grounded responses  
* machine-consumable artifacts

## **8.3 APIs**

export interface WebSearchOptions {

 region?: string;

 safeSearch?: "off" | "moderate" | "strict";

 timeRange?: "day" | "week" | "month" | "year";

 maxResults?: number;

 useCache?: boolean;

}

export interface WebSearchResult {

 title: string;

 url: string;

 snippet: string;

 date?: string;

 source?: string;

 score?: number;

 cacheHit?: boolean;

}

export interface FetchExtractOptions {

 instructions?: string;

 schema?: Record\<string, unknown\>;

 useBrowser?: boolean;

 useCache?: boolean;

}

export interface FetchExtractResult {

 url: string;

 markdown: string;

 structuredJson?: Record\<string, unknown\>;

 metadata: Record\<string, unknown\>;

 citations: Array\<{ title?: string; url: string; snippet?: string }\>;

}

Core tool surface from PRD:

* `web_search(query, options)`  
* `web_fetch_and_extract(url, instructions?, schema?)`  
* optional `smart_research(query)`

## **8.4 File plan**

Recommended additive structure:

packages/web-research/

 src/

   types.ts

   search/

     provider-registry.ts

     duckduckgo.ts

     ranking.ts

     dedupe.ts

   fetch/

     fetcher.ts

     browser-extractor.ts

     cleaner.ts

     schema-extractor.ts

   cache/

     cache-key.ts

     session-cache.ts

     persistent-cache.ts

   synthesis/

     research-synthesizer.ts

   index.ts

Then integrate into:

* MCP tool registration  
* slash commands  
* model-router hooks  
* DanteForge verification path

## **8.5 SLOs**

Based on PRD targets:

* cached search under 1.5s  
* full search+extract under 6s  
* cache hit rate above 60% in realistic multi-turn sessions  
* test coverage above 80% for the new module

## **9\. Machine B — Subagent Orchestrator**

## **9.1 Purpose**

Turn subagents into a real production feature rather than basic nesting/background support.

The uploaded PRD explicitly wants:

* dynamic spawning,  
* configurable nesting,  
* state isolation,  
* handoffs,  
* lifecycle management,  
* loop prevention,  
* verification,  
* background mode,  
* and git-native isolation.

## **9.2 Orchestrator organs**

### **A. Spawner**

Creates child agents with:

* role  
* objective  
* context  
* constraints  
* model/provider selection

### **B. Hierarchy Manager**

Supports:

* parent-child mapping  
* nested subgraphs  
* conditional routing  
* child result escalation

### **C. Handoff Engine**

Swarm-style lightweight transfer plus stronger DanteCode packet persistence.

The PRD explicitly points to Swarm-style handoff logic as an MVP accelerator.

### **D. Lifecycle Controller**

Spawn → monitor → timeout → terminate → recover.

### **E. Loop / Explosion Guard**

Tie directly into existing loop-detector and spawn limits.

### **F. Isolation Layer**

Every child may get:

* isolated state  
* controlled shared context  
* optional git worktree  
* optional background execution

### **G. Output Synthesizer**

Merges child outputs, reviews them, scores them, and returns a parent-safe result.

## **9.3 APIs**

export interface SpawnSubagentOptions {

 role: string;

 task: string;

 context?: Record\<string, unknown\>;

 parentId?: string;

 maxDepth?: number;

 timeoutMs?: number;

 worktree?: boolean;

 background?: boolean;

}

export interface SubagentHandle {

 id: string;

 role: string;

 parentId?: string;

 status: "running" | "completed" | "failed" | "timed-out" | "terminated";

}

export interface HandoffRequest {

 fromId: string;

 targetRole: string;

 message: string;

 context?: Record\<string, unknown\>;

}

export interface MonitorSubagentsResult {

 parentId: string;

 children: SubagentHandle\[\];

 summary: string;

}

Core surface from PRD:

* `spawn_subagent(role, task, context?, parentId?)`  
* `handoff_to_subagent(targetRole, message)`  
* `monitor_subagents(parentId)`  
* `terminate_subagent(id)`  
* `smart_orchestrate(task)`

## **9.4 File plan**

Recommended structure:

packages/agent-orchestrator/

 src/

   types.ts

   subagent-spawner.ts

   hierarchy-manager.ts

   handoff-engine.ts

   lifecycle-manager.ts

   synthesis-engine.ts

   state/

     child-checkpoints.ts

     shared-context.ts

   isolation/

     worktree-manager.ts

     sandbox-manager.ts

   guards/

     loop-guard.ts

     spawn-limits.ts

   index.ts

Then weld into:

* `core/multi-agent.ts`  
* `background-agent.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* `git-engine`  
* DanteForge verification hooks

## **9.5 SLOs**

From PRD:

* spawn overhead under 200ms  
* zero orphaned agents  
* support 10+ concurrent nested agents  
* full traceability in session store  
* recovery after interruption  
* 95% DanteForge pass rate on sub-agent outputs

## **10\. Shared roadmap**

The uploaded PRD provides separate phased roadmaps for each machine. The V+E version should merge them into one execution order that reduces risk.

## **Phase 0 — Shared contracts**

Build first:

* runtime task packet  
* checkpoint schema  
* event schema  
* verification schema  
* citation schema  
* subagent parent/child schema

No feature expansion before shared contracts.

## **Phase 1 — Research MVP \+ Spawn MVP**

### **Research**

* native DuckDuckGo  
* basic cache  
* simple fetch

### **Orchestrator**

* Swarm-style handoffs  
* basic dynamic spawning  
* spawn limits

This phase should already produce a meaningful uplift, matching the PRD’s “hits 8.5 immediately” logic for each stream.

## **Phase 2 — Smart extraction \+ checkpointed hierarchy**

### **Research**

* Firecrawl/Stagehand-style extractor  
* cleaning  
* relevance filtering

### **Orchestrator**

* LangGraph-style checkpointed nesting  
* state mapping parent↔child  
* full child lifecycle state

## **Phase 3 — Parallelism and specialization**

### **Research**

* multi-provider search  
* query rewriting  
* multi-hop research

### **Orchestrator**

* hierarchical manager/specialist patterns  
* role specialization  
* parallel git worktree support

## **Phase 4 — Verification, benchmarks, polish**

### **Shared**

* DanteForge integration  
* benchmark suites  
* research-heavy workflow testing  
* complex multi-agent workflow testing  
* scoring and quality gates  
* docs and CLI polish

## **11\. Organ-to-OSS mapping**

This is one of the strongest parts of the uploaded PRD.

## **Research harvest map**

* **ddgs family** → native DuckDuckGo core, filters, retry/backoff, structured result shape  
* **Firecrawl** → markdown/JSON extraction, schema extraction, pre-actions, async patterns  
* **Crawl4AI** → cache modes, relevance filtering, cleaning architecture, hybrid extraction concepts  
* **Stagehand** → TS-first Playwright extraction and structured interaction patterns  
* **Qwen Code web\_search tool** → provider abstraction, config/fallbacks, citation UX, tool disable patterns

## **Orchestration harvest map**

* **LangGraph.js** → subgraphs, checkpointed hierarchy, conditional routing, error propagation  
* **OpenAI Swarm** → lightweight handoffs and spawn-from-within model  
* **Mastra** → TS-native lifecycle and networked agent patterns  
* **CrewAI patterns** → manager/specialist decomposition and controlled delegation loops  
* **Composio agent-orchestrator** → worktree isolation and parallel agent orchestration patterns

## **12\. Verification and gates**

## **12.1 Research gates**

A research result is not considered high-confidence unless:

* source list exists  
* extracted content is non-empty  
* citations are attached  
* dedupe/ranking ran  
* cache metadata is recorded  
* structure passes schema or extraction validity checks

## **12.2 Orchestration gates**

A subagent result is not considered acceptable unless:

* agent state is terminal  
* no orphan child remains  
* checkpoint exists  
* handoff history is recorded when applicable  
* worktree cleanup rules are satisfied  
* DanteForge verification ran

## **12.3 Shared gates**

* anti-stub  
* PDSE  
* source/evidence presence  
* output schema validity  
* loop detector did not trigger unresolved violations  
* runtime event log complete

## **13\. Test charter**

## **Unit tests**

### **Research**

* query normalization  
* cache-key stability  
* cache read/write  
* ranking  
* dedupe  
* schema extraction result validation

### **Orchestrator**

* spawn packet construction  
* child state transitions  
* handoff packet correctness  
* timeout handling  
* spawn-limit enforcement  
* parent-child checkpoint mapping

## **Integration tests**

### **Research**

* query → search → fetch → extract → citations  
* cache hit path  
* browser-backed page path  
* structured schema extraction path

### **Orchestrator**

* parent spawns child  
* child hands off to specialist  
* child timeout and recovery  
* background child execution  
* parallel child runs  
* worktree-based child isolation

## **Golden flows**

### **GF-01**

A research query returns ranked structured results with citations and a valid cache entry.

### **GF-02**

A JS-heavy page is fetched, browser-assisted, cleaned, and extracted into markdown and structured output.

### **GF-03**

A parent task spawns specialists, monitors them, and synthesizes final output without orphaning children.

### **GF-04**

A child agent times out, recovers from checkpoint, and resumes or hands off.

### **GF-05**

A multi-hop research workflow uses both machines: search task spawns child researchers, each fetches/extracts evidence, and parent synthesizes the final report.

That last flow is the real combined-product proof.

## **14\. Evidence bundle**

Every significant run should emit:

{"at":"2026-03-20T00:00:00Z","kind":"research.search.started","taskId":"r1","query":"..."}

{"at":"2026-03-20T00:00:01Z","kind":"research.search.completed","taskId":"r1","results":8,"cacheHit":false}

{"at":"2026-03-20T00:00:02Z","kind":"subagent.spawned","taskId":"s1","parentId":"r1","role":"research-specialist"}

{"at":"2026-03-20T00:00:05Z","kind":"research.extract.completed","taskId":"r2","url":"https://...","citations":3}

{"at":"2026-03-20T00:00:07Z","kind":"runtime.synthesis.completed","taskId":"r1","children":2,"verification":"passed"}

## **15\. Risks and corrections**

## **Risk 1 — research complexity spiral**

The PRD names multiple best-in-class tools. That is good for harvesting, but dangerous if copied all at once.

### **Correction**

Use staged adoption:

* native search first  
* cache second  
* structured extract third  
* browser/JS-heavy edge cases fourth

## **Risk 2 — subagent spawn explosion**

The PRD already identifies this.

### **Correction**

Hard default limits:

* max depth  
* max children  
* max parallel children  
* spawn cooldown  
* loop-guard integration

## **Risk 3 — too many state systems**

If research cache, subagent state, and runtime event history all use different storage conventions, this gets messy fast.

### **Correction**

One shared state spine:

* checkpoints  
* persistent cache  
* runtime audit log  
* child task state

## **Risk 4 — verification becomes an afterthought**

The PRD wisely wants DanteForge hooks in both workstreams.

### **Correction**

Verification must be in the flow, not just post-hoc.  
No “done” state without:

* evidence  
* structure  
* and gate success

## **16\. Runbook**

## **Step 1**

Define shared contracts first.  
No package explosion before shared contracts.

## **Step 2**

Build research MVP:

* native search  
* cache  
* simple extraction  
* citations

## **Step 3**

Build spawn MVP:

* spawn packet  
* handoff  
* monitor  
* terminate  
* limits

## **Step 4**

Weld both together through:

* runtime events  
* checkpointer  
* synthesis  
* verification

## **Step 5**

Add smart extraction and checkpointed hierarchy.

## **Step 6**

Add parallelism, specialization, and worktree isolation.

## **Step 7**

Run benchmark suites and enforce gates before claiming autonomy uplift.

## **17\. What “done” means**

This masterplan is complete only when all are true:

1. DanteCode has native, cached, structured research that is clearly better than fallback browsing.  
2. Research outputs include usable citations and structured evidence.  
3. DanteCode can dynamically spawn, monitor, hand off, and terminate child agents safely.  
4. Child agents recover from checkpoints without orphaning.  
5. Research workflows can call subagents and synthesize results through the shared runtime.  
6. DanteForge verifies both research outputs and subagent outputs.  
7. Benchmark uplift is demonstrated on research-heavy and multi-agent tasks.  
8. The architecture remains model-agnostic and MCP-compatible as required by the PRD.

## **18\. Final judgment**

The uploaded PRD is good.  
The V+E correction is to stop treating it as two isolated upgrades.

The right masterplan is:

* **Research Engine** for evidence quality  
* **Subagent Orchestrator** for delegation quality  
* **Shared runtime spine** for durability, verification, and synthesis

That is the clean way to make DanteCode materially better rather than just more complicated.

The next best move is to turn this V+E Masterplan into a **Codex-ready execution packet** with exact file paths, generation order, and acceptance gates.

Please continue with codex ready execution packet

Thought for 52s

Below is the **Codex-ready V+E Execution Packet** for the uploaded PRD.

It keeps the PRD’s core shape intact, but makes one critical correction: **treat Web Research and Subagent Orchestration as two machines sharing one runtime spine**, not two separate feature islands. That matches the PRD’s own scope, reuse targets, phased roadmap, and success criteria.

# **Codex-ready V+E Execution Packet**

## **RO-01 — DanteCode Research Engine \+ Subagent Orchestrator**

## **0\. Executive verdict**

Build this as a **single runtime uplift** with three lanes:

1. **Shared Runtime Spine**  
2. **Research Engine**  
3. **Subagent Orchestrator**

The uploaded PRD already points to the right reuse spine:

* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* `git-engine`  
* `background-agent.ts`  
* `multi-agent.ts`  
* DanteForge verification / PDSE gates.

The OSS harvest targets are also directionally correct:

* **Qwen Code** for multi-provider web-search tool design and citation UX,  
* **LangGraph** for subgraphs and checkpoint persistence,  
* **Stagehand** for structured extraction with schema support,  
* **Agent Orchestrator** for worktree-based parallel agent coordination.

---

# **1\. Product definition**

## **1.1 Objective**

Close the research and autonomy gaps by shipping:

* native web search  
* smart fetch/extract  
* caching  
* citations  
* dynamic subagent spawning  
* handoffs  
* checkpointed nesting  
* git/worktree isolation  
* DanteForge verification on outputs

This is exactly the intent of the PRD’s research and subagent sections, including its stated target score uplift and phased approach.

## **1.2 Non-goals for MVP**

* no full visual orchestration UI as a hard dependency  
* no proxy/stealth-first browser stack  
* no uncontrolled agent swarms  
* no giant browser framework rewrite before native search exists

That sequencing is consistent with the PRD’s own phased rollout and risk mitigation language.

---

# **2\. Canonical architecture**

## **2.1 Shared runtime spine**

Do not build two separate state systems.

Everything must share:

* one task packet contract  
* one event schema  
* one checkpoint schema  
* one verification path  
* one audit/evidence model

### **Target package plan**

packages/runtime-spine/

 src/

   task-packets.ts

   runtime-events.ts

   checkpoint-types.ts

   verification-types.ts

   evidence-types.ts

   index.ts

packages/web-research/

 src/...

packages/agent-orchestrator/

 src/...

### **Why**

The PRD explicitly says both workstreams must integrate with the same existing DanteCode systems: checkpointer, recovery engine, model router, git engine, and DanteForge verification.

## **2.2 Research Engine machine**

Responsibilities:

* `web_search`  
* `web_fetch_and_extract`  
* optional `smart_research`  
* ranking  
* dedupe  
* cache  
* citations  
* structured extraction

This is directly from the PRD’s tool surface and must-have list.

## **2.3 Subagent Orchestrator machine**

Responsibilities:

* `spawn_subagent`  
* `handoff_to_subagent`  
* `monitor_subagents`  
* `terminate_subagent`  
* optional `smart_orchestrate`  
* nesting  
* lifecycle  
* limits  
* worktree isolation  
* synthesis

This is directly from the PRD’s orchestration surface and must-have list.

---

# **3\. Shared contracts**

## **3.1 Runtime task packet**

Create:  
`packages/runtime-spine/src/task-packets.ts`

export interface RuntimeTaskPacket {

 id: string;

 kind: "research" | "fetch-extract" | "subagent-task" | "synthesis";

 parentId?: string;

 objective: string;

 context: Record\<string, unknown\>;

 role?: string;

 constraints?: {

   maxDepth?: number;

   maxParallel?: number;

   timeoutMs?: number;

   budgetTokens?: number;

 };

 inputs?: {

   query?: string;

   url?: string;

   schema?: Record\<string, unknown\>;

   instructions?: string;

 };

}

## **3.2 Runtime event schema**

Create:  
`packages/runtime-spine/src/runtime-events.ts`

export type RuntimeEventKind \=

 | "research.search.started"

 | "research.search.completed"

 | "research.fetch.started"

 | "research.fetch.completed"

 | "research.extract.completed"

 | "research.cache.hit"

 | "subagent.spawned"

 | "subagent.progress"

 | "subagent.handoff"

 | "subagent.timeout"

 | "subagent.terminated"

 | "runtime.synthesis.completed"

 | "runtime.verification.passed"

 | "runtime.verification.failed";

## **3.3 Checkpoint schema**

Create:  
`packages/runtime-spine/src/checkpoint-types.ts`

Every checkpoint must record:

* parent/child relationship  
* task packet  
* progress markers  
* retry counters  
* output artifacts  
* handoff state  
* worktree reference if present

## **3.4 Verification schema**

Create:  
`packages/runtime-spine/src/verification-types.ts`

All research and subagent outputs must carry:

* evidence references  
* source/citation count  
* structure/schema pass/fail  
* DanteForge gate results  
* PDSE result where applicable

---

# **4\. Target file plan**

## **4.1 Shared runtime spine**

packages/runtime-spine/

 src/

   task-packets.ts

   runtime-events.ts

   checkpoint-types.ts

   verification-types.ts

   evidence-types.ts

   index.ts

 test/

   task-packets.test.ts

   runtime-events.test.ts

## **4.2 Research Engine**

This follows the PRD’s recommendation to create `packages/web-research` or equivalent, and keeps it modular.

packages/web-research/

 src/

   types.ts

   search/

     provider-registry.ts

     duckduckgo.ts

     ranking.ts

     dedupe.ts

   fetch/

     fetcher.ts

     browser-extractor.ts

     cleaner.ts

     schema-extractor.ts

   cache/

     cache-key.ts

     session-cache.ts

     persistent-cache.ts

   synthesis/

     research-synthesizer.ts

   index.ts

 test/

## **4.3 Subagent Orchestrator**

This follows the PRD’s recommendation for a new `packages/agent-orchestrator` or equivalent extension around `multi-agent.ts`.

packages/agent-orchestrator/

 src/

   types.ts

   subagent-spawner.ts

   hierarchy-manager.ts

   handoff-engine.ts

   lifecycle-manager.ts

   synthesis-engine.ts

   state/

     child-checkpoints.ts

     shared-context.ts

   isolation/

     worktree-manager.ts

     sandbox-manager.ts

   guards/

     loop-guard.ts

     spawn-limits.ts

   index.ts

 test/

## **4.4 Existing DanteCode integration targets**

Expected touchpoints, based on the PRD:

* `core/multi-agent.ts`  
* `background-agent.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* `git-engine`  
* MCP tool registration  
* slash-command registration  
* DanteForge verification bridge.

---

# **5\. Phase plan**

## **Phase 0 — Shared contracts first**

Do this before any feature work.

### **RSO-G1**

Files:

* `packages/runtime-spine/src/task-packets.ts`  
* `packages/runtime-spine/src/runtime-events.ts`  
* `packages/runtime-spine/src/checkpoint-types.ts`  
* `packages/runtime-spine/src/verification-types.ts`  
* tests

Acceptance:

* contracts compile  
* packet validation exists  
* parent/child relationships are representable  
* event kinds are fixed and test-covered

---

## **Phase 1 — Research MVP**

This aligns with the PRD’s phase 1: native ddgs search, basic cache, simple fetch.

### **RSO-G2**

Files:

* `packages/web-research/src/types.ts`  
* `packages/web-research/src/search/provider-registry.ts`  
* `packages/web-research/src/search/duckduckgo.ts`  
* tests

Acceptance:

* `web_search(query, options)` returns structured results  
* provider registry supports at least one provider  
* search result shape is stable  
* no browser dependency required

### **RSO-G3**

Files:

* `packages/web-research/src/cache/cache-key.ts`  
* `packages/web-research/src/cache/session-cache.ts`  
* `packages/web-research/src/cache/persistent-cache.ts`  
* tests

Acceptance:

* query/URL normalization is deterministic  
* session cache works  
* persistent cache path works  
* cache hit metadata returned

### **RSO-G4**

Files:

* `packages/web-research/src/fetch/fetcher.ts`  
* `packages/web-research/src/index.ts`  
* tests

Acceptance:

* `web_fetch_and_extract` basic fetch path works for static pages  
* metadata returned  
* citations attached  
* cache path integrated

---

## **Phase 2 — Research smart extraction**

This aligns with the PRD’s phase 2: Stagehand/Firecrawl/Crawl4AI-style extractor and cleaning.

### **RSO-G5**

Files:

* `packages/web-research/src/fetch/cleaner.ts`  
* `packages/web-research/src/search/ranking.ts`  
* `packages/web-research/src/search/dedupe.ts`  
* tests

Acceptance:

* content cleaning removes obvious noise  
* ranking score computed  
* duplicates collapsed deterministically

### **RSO-G6**

Files:

* `packages/web-research/src/fetch/browser-extractor.ts`  
* `packages/web-research/src/fetch/schema-extractor.ts`  
* tests

Acceptance:

* browser-backed extraction is optional  
* schema or instruction extraction path works  
* structured JSON path validated  
* fallback path exists for non-browser pages

### **RSO-G7**

Files:

* `packages/web-research/src/synthesis/research-synthesizer.ts`  
* tests

Acceptance:

* multi-result synthesis produces evidence bundle  
* citations survive synthesis  
* output can be passed into verification

---

## **Phase 3 — Subagent MVP**

This aligns with the PRD’s phase 1 orchestration target: Swarm-style handoffs plus basic dynamic spawning.

### **RSO-G8**

Files:

* `packages/agent-orchestrator/src/types.ts`  
* `packages/agent-orchestrator/src/subagent-spawner.ts`  
* `packages/agent-orchestrator/src/guards/spawn-limits.ts`  
* tests

Acceptance:

* `spawn_subagent` works  
* spawn limits enforce depth and count  
* child handle returned  
* parent-child mapping saved

### **RSO-G9**

Files:

* `packages/agent-orchestrator/src/handoff-engine.ts`  
* `packages/agent-orchestrator/src/lifecycle-manager.ts`  
* tests

Acceptance:

* `handoff_to_subagent` works  
* status transitions exist  
* timeout/terminate states exist  
* no orphan state on termination

### **RSO-G10**

Files:

* `packages/agent-orchestrator/src/state/child-checkpoints.ts`  
* `packages/agent-orchestrator/src/state/shared-context.ts`  
* tests

Acceptance:

* child checkpoints persist and restore  
* default isolation with controlled sharing exists  
* context handoff is explicit

---

## **Phase 4 — Hierarchy and worktree isolation**

This aligns with the PRD’s phase 2 and phase 3 orchestration roadmap: checkpointed nesting, hierarchy, git-native isolation.

### **RSO-G11**

Files:

* `packages/agent-orchestrator/src/hierarchy-manager.ts`  
* `packages/agent-orchestrator/src/guards/loop-guard.ts`  
* tests

Acceptance:

* nested child graphs supported  
* loop prevention enforced  
* escalation to parent works

### **RSO-G12**

Files:

* `packages/agent-orchestrator/src/isolation/worktree-manager.ts`  
* `packages/agent-orchestrator/src/isolation/sandbox-manager.ts`  
* tests

Acceptance:

* optional worktree-per-subagent path exists  
* cleanup rules defined  
* sandbox hooks exposed  
* failure leaves recoverable state

### **RSO-G13**

Files:

* `packages/agent-orchestrator/src/synthesis-engine.ts`  
* tests

Acceptance:

* child outputs can be merged/synthesized  
* synthesis references source child handles  
* verification handoff is ready

---

## **Phase 5 — DanteCode integration weld**

This is where the new packages stop being islands.

### **RSO-G14**

Integrate with:

* `core/multi-agent.ts`  
* `background-agent.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* tests

Acceptance:

* research tasks can be routed through current runtime  
* subagents can be spawned from current runtime  
* recovery works after interruption  
* background tasks and child tasks do not split state models

### **RSO-G15**

Integrate with:

* MCP tool registration  
* slash-command registry  
* streaming progress surfaces  
* tests

Acceptance:

* tools exposed:  
  * `web_search`  
  * `web_fetch_and_extract`  
  * `spawn_subagent`  
  * `handoff_to_subagent`  
  * `monitor_subagents`  
  * `terminate_subagent`  
* progress streaming works for long tasks

---

## **Phase 6 — Verification and benchmarks**

This aligns with the PRD’s phase 4 for both machines: DanteForge integration, benchmarks, research-heavy and multi-agent workflow testing, polish.

### **RSO-G16**

Files:

* verification bridge files in relevant package or core integration  
* benchmark fixtures  
* test suites

Acceptance:

* research outputs pass:  
  * evidence presence  
  * citation completeness  
  * schema validity  
* subagent outputs pass:  
  * terminal state  
  * no orphan child  
  * checkpoint presence  
  * DanteForge verification  
* benchmark suite added for:  
  * 20+ research tasks  
  * 15+ multi-agent tasks, matching the PRD’s metrics.

---

# **6\. Golden flows**

## **GF-01 — Native research path**

Input:

* query

Pass:

* search returns structured results  
* cache metadata returned  
* citations exist

## **GF-02 — Fetch and extract static page**

Input:

* URL \+ extraction instructions

Pass:

* markdown extracted  
* metadata included  
* citations attached  
* cache written

## **GF-03 — Browser-assisted extraction**

Input:

* JS-heavy page \+ schema

Pass:

* browser path invoked  
* structured JSON produced  
* fallback path available if browser path fails

## **GF-04 — Spawn and monitor child agent**

Input:

* parent objective requiring specialist

Pass:

* child spawned  
* handle returned  
* monitor path works  
* child reaches terminal state cleanly

## **GF-05 — Handoff and recovery**

Input:

* child timeout or failure

Pass:

* handoff packet exists  
* replacement or resumed child can continue  
* no orphan child state

## **GF-06 — Combined proof**

Input:

* multi-hop research task

Pass:

* parent spawns research children  
* children search/fetch/extract  
* parent synthesizes  
* final output has citations and passes verification

GF-06 is the real proof of product coherence.

---

# **7\. Hard gates**

## **Build gates**

* all new packages build  
* no circular dependency between runtime spine, research, and orchestrator packages

## **Type gates**

* strict TS compile passes  
* public interfaces exported from each package

## **Test gates**

* unit tests for all new modules  
* integration tests for all golden flows  
* recovery and checkpoint resume tests included

## **Safety gates**

* no subagent spawn without limits  
* no child left orphaned after failure  
* no extracted output marked success without evidence/citations  
* no browser path required for basic research success  
* no second hidden state model outside checkpoint/session spine

---

# **8\. Success criteria**

The packet is complete only when all are true:

1. `web_search` works natively and returns structured, ranked results.  
2. `web_fetch_and_extract` supports static and optional browser-backed extraction.  
3. research outputs include citations and evidence metadata.  
4. subagents can be spawned, monitored, handed off, terminated, and resumed.  
5. parent-child checkpointing works.  
6. worktree isolation is available for long-running or risky children.  
7. research and orchestration can be combined in one workflow.  
8. DanteForge verification is applied to both research outputs and child outputs.  
9. benchmark suites show measurable uplift aligned to the PRD’s target direction.

---

# **9\. Risks and corrections**

## **Risk 1 — trying to harvest too much at once**

The PRD names a good stack, but copying all patterns immediately would create too much surface area.

Correction:

* native search first  
* cache second  
* simple fetch third  
* browser extraction after that  
* hierarchy after spawn MVP  
* worktree isolation after basic child lifecycle is stable

## **Risk 2 — state fragmentation**

If research cache, child state, and evidence logs all diverge, this becomes brittle.

Correction:

* one runtime spine package  
* one checkpoint model  
* one event vocabulary

## **Risk 3 — spawn explosion**

The PRD already identifies this.

Correction:

* hard depth limits  
* hard child count limits  
* loop guard  
* cooldowns  
* explicit failure states

## **Risk 4 — verification as afterthought**

The PRD explicitly wants DanteForge hooks for both research and subagents.

Correction:

* wire verification in at phase 5/6, not “someday later”  
* no done-state without evidence and structure

---

# **10\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing RO-01: DanteCode Research Engine \+ Subagent Orchestrator.

Goal:

Build a shared runtime spine plus two machines:

1\) Research Engine

2\) Subagent Orchestrator

The uploaded PRD requires native web research, structured extraction, caching, citations, dynamic subagent spawning, hierarchical orchestration, checkpointed recovery, git/worktree isolation, MCP compatibility, and DanteForge verification.

Hard rules:

\- No stubs

\- No TODO placeholders

\- Files under 500 LOC where practical

\- Add tests in every generation

\- Use one shared runtime state model

\- Do not create separate hidden checkpoint/event systems per package

\- No uncontrolled child spawning

\- No success state without evidence/citations for research

\- No success state without terminal child state \+ checkpoint integrity for subagents

Create these packages:

1\. packages/runtime-spine

2\. packages/web-research

3\. packages/agent-orchestrator

Generation order:

G1:

\- packages/runtime-spine/src/task-packets.ts

\- packages/runtime-spine/src/runtime-events.ts

\- packages/runtime-spine/src/checkpoint-types.ts

\- packages/runtime-spine/src/verification-types.ts

\- tests

G2:

\- packages/web-research/src/types.ts

\- packages/web-research/src/search/provider-registry.ts

\- packages/web-research/src/search/duckduckgo.ts

\- tests

G3:

\- packages/web-research/src/cache/cache-key.ts

\- packages/web-research/src/cache/session-cache.ts

\- packages/web-research/src/cache/persistent-cache.ts

\- tests

G4:

\- packages/web-research/src/fetch/fetcher.ts

\- packages/web-research/src/index.ts

\- tests

G5:

\- packages/web-research/src/fetch/cleaner.ts

\- packages/web-research/src/search/ranking.ts

\- packages/web-research/src/search/dedupe.ts

\- tests

G6:

\- packages/web-research/src/fetch/browser-extractor.ts

\- packages/web-research/src/fetch/schema-extractor.ts

\- tests

G7:

\- packages/web-research/src/synthesis/research-synthesizer.ts

\- tests

G8:

\- packages/agent-orchestrator/src/types.ts

\- packages/agent-orchestrator/src/subagent-spawner.ts

\- packages/agent-orchestrator/src/guards/spawn-limits.ts

\- tests

G9:

\- packages/agent-orchestrator/src/handoff-engine.ts

\- packages/agent-orchestrator/src/lifecycle-manager.ts

\- tests

G10:

\- packages/agent-orchestrator/src/state/child-checkpoints.ts

\- packages/agent-orchestrator/src/state/shared-context.ts

\- tests

G11:

\- packages/agent-orchestrator/src/hierarchy-manager.ts

\- packages/agent-orchestrator/src/guards/loop-guard.ts

\- tests

G12:

\- packages/agent-orchestrator/src/isolation/worktree-manager.ts

\- packages/agent-orchestrator/src/isolation/sandbox-manager.ts

\- tests

G13:

\- packages/agent-orchestrator/src/synthesis-engine.ts

\- tests

G14:

Integrate with:

\- core/multi-agent.ts

\- background-agent.ts

\- checkpointer.ts

\- recovery-engine.ts

\- model-router.ts

\- tests

G15:

Integrate tool/command exposure:

\- MCP tool registration

\- slash-command registry

\- streaming progress surfaces

\- tests

G16:

Integrate DanteForge verification and benchmark suites.

Required APIs:

\- web\_search(query, options)

\- web\_fetch\_and\_extract(url, instructions?, schema?)

\- spawn\_subagent(role, task, context?, parentId?)

\- handoff\_to\_subagent(targetRole, message)

\- monitor\_subagents(parentId)

\- terminate\_subagent(id)

Golden flows:

\- native research

\- fetch and extract static page

\- browser-assisted extraction

\- spawn and monitor child

\- handoff and recovery

\- combined proof: parent spawns research children, children search/fetch/extract, parent synthesizes verified result

At the end of every generation report:

\- files changed

\- tests added

\- build/typecheck/test status

\- risks

\- next generation

Do not claim completion until the combined proof flow passes.

---

# **11\. Final judgment**

The PRD is worth building.

The one thing that would make it fail is building it as:

* “one web module”  
* plus “one subagent module”  
* plus “some later glue”

That is the wrong order.

The right order is:

* **shared runtime spine**  
* **research MVP**  
* **spawn MVP**  
* **hierarchy/isolation**  
* **verification weld**  
* **combined proof**

That gives you a real system instead of three disconnected ideas.

