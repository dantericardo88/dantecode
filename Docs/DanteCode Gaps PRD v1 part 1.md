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

