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

