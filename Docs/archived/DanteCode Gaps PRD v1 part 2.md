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

## **DanteCode WebFetch / Page Analysis Uplift**

### **Smart Extractor, Clean Markdown, Structured JSON, Caching, and Verification**

## **1\. Executive judgment**

This should be built as a **first-class machine**, not as a few upgrades inside `browser-agent.ts`.

The PRD is clear about the current gap: DanteCode has browser capability, but it still lacks a true smart extractor, clean markdown output, structured/schema extraction, advanced caching, relevance filtering, and a robust JS-rendering plus cleaning pipeline. The target is to move WebFetch / Page Analysis from roughly 7.0 to 9.0+ and lift WebSearch with it.

The right V+E interpretation is:

* **WebSearch finds candidate sources**  
* **WebFetch / Page Analysis turns those sources into LLM-ready evidence**  
* **DanteForge verifies the evidence**  
* **Subagents can later scale extraction across pages/sites**

So this machine is not optional polish. It is one of the core engines that makes the broader research stack real.

## **2\. Product thesis**

DanteCode should have a **production-grade intelligent page analysis module** that can:

* fetch static or JS-heavy pages,  
* render and interact when needed,  
* strip noise aggressively,  
* preserve useful structure like headings, tables, and lists,  
* extract structured JSON via schema or natural-language instructions,  
* cache intelligently,  
* attach citations and metadata,  
* and feed the result into DanteForge verification.

The core thesis is simple:

**A URL is not useful to DanteCode until it becomes clean, trustworthy, structured evidence.**

## **3\. Purpose and problem statement**

The PRD identifies the exact failure mode: the current page-analysis layer can browse, but it cannot yet produce **high-quality, LLM-ready output** consistently enough. The result is weak extraction quality, noisy content, poor token efficiency, missing structured outputs, and fragile behavior on JS-heavy pages.

This masterplan exists to solve four problems at once:

1. **Acquisition problem**  
   Some pages require plain fetch, some require JS rendering, some require interactive actions.  
2. **Cleanliness problem**  
   Raw HTML or generic browser text is too noisy.  
3. **Structure problem**  
   The system needs both markdown and structured JSON, not just one or the other.  
4. **Trust problem**  
   Extracted claims need citations, metadata, and DanteForge verification hooks.

## **4\. Scope**

## **In scope**

This machine must deliver:

* `web_fetch(url, instructions?, schema?, options?)`  
* `smart_extract(url, goal)`  
* `batch_fetch(urls, commonInstructions)`  
* JS rendering via Playwright/Stagehand  
* clean markdown output  
* schema-based or natural-language JSON extraction  
* intelligent caching through `checkpointer.ts`  
* relevance filtering and deduplication  
* citations and source metadata  
* DanteForge verification hooks  
* fallback chain across cache, smart extraction, and basic fetch.

## **Later-phase scope**

The PRD also correctly reserves for later:

* login/pre-actions,  
* infinite scroll and clicks,  
* multi-page/site mapping,  
* vision-based fallback for difficult layouts,  
* query-aware extraction via model-router.

## **Out of scope for MVP**

The V+E correction is to keep the MVP tight. Do **not** begin with:

* full site-crawler autonomy,  
* universal login automation,  
* vision-first extraction,  
* stealth/proxy-heavy enterprise scraping stack,  
* or multi-page subagent expansion as a dependency.

Those belong after the core single-page extraction engine is stable.

## **5\. Architecture**

The right architecture is a **layered extractor pipeline**, not one giant file.

## **5.1 Canonical machine layout**

### **Layer A — Request Planner**

Determines:

* plain fetch vs browser path  
* whether schema extraction is required  
* whether cache can satisfy request  
* whether pre-actions are required  
* whether fallback escalation is needed

### **Layer B — Fetch Engine**

Handles:

* HTTP fetch  
* browser-rendered fetch  
* action-driven rendering  
* retries/timeouts  
* metadata capture

### **Layer C — Cleaner**

Transforms page content into:

* clean markdown  
* preserved headings/tables/lists  
* stripped nav/footer/ads/chrome  
* token-efficient LLM-ready text

### **Layer D — Structured Extractor**

Produces:

* schema-based JSON where a schema exists  
* instruction-based JSON where only a goal exists  
* confidence and extraction diagnostics

### **Layer E — Relevance / Dedupe Layer**

Scores extracted content and removes repeated or low-value content.

### **Layer F — Cache Layer**

Stores outputs keyed by:

* URL  
* normalized instructions  
* schema signature  
* render mode / action signature

### **Layer G — Verification Layer**

Routes extracted claims and outputs through:

* source metadata checks  
* evidence completeness checks  
* DanteForge gates / PDSE where appropriate

This architecture is exactly what the PRD is reaching for with its recommended harvest targets and fallback chain.

## **5.2 Recommended package shape**

The PRD suggests either a new `packages/web-extractor` or a major enhancement to `core/browser-agent.ts`. The V+E answer is: **create a new package and keep `browser-agent.ts` as an integration surface, not the whole machine.**

Recommended structure:

packages/web-extractor/  
 src/  
   types.ts  
   request-planner.ts  
   fetch-engine.ts  
   markdown-cleaner.ts  
   smart-extractor.ts  
   schema-extractor.ts  
   relevance-scorer.ts  
   dedupe.ts  
   cache/  
     cache-key.ts  
     session-cache.ts  
     persistent-cache.ts  
   providers/  
     basic-fetch.ts  
     firecrawl-adapter.ts  
     stagehand-adapter.ts  
     crawlee-adapter.ts  
   index.ts  
 test/

Then integrate into:

* `core/browser-agent.ts`  
* `checkpointer.ts`  
* `model-router.ts`  
* DanteForge verification bridge  
* MCP tool registration  
* slash-command registration

## **6\. Organ-to-OSS harvest map**

The PRD’s OSS list is strong and should be preserved almost exactly, but with one V+E rule: **harvest patterns, not dependency sprawl**.

### **Stagehand**

Use for:

* schema-driven extraction  
* natural-language extraction instructions  
* Playwright-native page interaction  
* self-healing interaction patterns

This is the best model for turning generic browser control into precise page analysis.

### **Firecrawl**

Use for:

* markdown-cleaning patterns  
* structured extraction flow  
* pre/post action concepts  
* output format shape: markdown \+ JSON \+ metadata

This is the fastest path to initial quality lift.

### **Crawlee**

Use for:

* reliability layer  
* browser/session management  
* request queue concepts  
* anti-blocking / robustness patterns

This is the production-hardening layer, not the first abstraction to expose directly.

### **Crawl4AI**

Use for:

* cache-mode design  
* relevance scoring  
* dual extraction strategies  
* markdown cleaning heuristics  
* noise filtering

This is the best reference for advanced cache and cleaning behavior.

### **LLM Scraper patterns**

Use for:

* lightweight structured extraction fallback  
* prompt design for extraction  
* hybrid local-model refinement

This is a good fallback layer when heavier systems are unavailable.

## **7\. Public APIs**

The PRD already proposes the correct public surface. Keep it.

### **Core tools**

* `web_fetch(url, instructions?, schema?, options?)`  
* `smart_extract(url, goal)`  
* `batch_fetch(urls, commonInstructions)`

### **Recommended TypeScript contracts**

export interface WebFetchOptions {  
 useCache?: boolean;  
 forceBrowser?: boolean;  
 maxWaitMs?: number;  
 preActions?: Array\<Record\<string, unknown\>\>;  
 cleanLevel?: "light" | "standard" | "aggressive";  
}

export interface WebFetchResult {  
 url: string;  
 markdown: string;  
 structuredData?: Record\<string, unknown\>;  
 metadata: {  
   title?: string;  
   finalUrl?: string;  
   status?: number;  
   renderMode: "http" | "browser" | "browser-actions";  
   cacheHit: boolean;  
   extractedAt: string;  
 };  
 sources: Array\<{  
   url: string;  
   title?: string;  
   snippet?: string;  
 }\>;  
}

## **8\. Integration plan**

## **8.1 Checkpointer**

Use `checkpointer.ts` as the persistent cache substrate, exactly as the PRD recommends. Cache keys should combine:

* normalized URL  
* normalized instructions  
* schema hash  
* render/action signature.

## **8.2 Model-router**

Use `model-router.ts` only for:

* optional lightweight refinement,  
* extraction fallback,  
* query-aware extraction in later phases.

Do not make model routing mandatory for basic clean markdown output. That would make the baseline path too expensive and too fragile.

## **8.3 DanteForge**

DanteForge should verify:

* extracted claims,  
* evidence presence,  
* output completeness,  
* structural validity.

That is explicitly required in the PRD and is one of the strongest parts of it.

## **8.4 Git-engine and loop-detector**

These should be auxiliary:

* local snapshots for difficult extraction/debugging  
* protection against endless retry/render loops

They are useful, but not the core of the machine.

## **9\. Execution pipeline**

The runtime should follow a deterministic fallback chain:

### **Step 1 — Cache probe**

If cache entry exists and is still valid for the same extraction contract, return it.

### **Step 2 — Fast extraction path**

Try a Firecrawl-style or basic-fetch markdown path first for speed and cost efficiency.

### **Step 3 — Agentic extraction path**

Escalate to Stagehand/browser path when:

* page is JS-heavy,  
* schema extraction fails,  
* or clean content is insufficient.

### **Step 4 — Basic fallback**

If advanced extraction paths fail, return the best safe basic extraction rather than hard-failing silently.

That matches the PRD’s explicit fallback chain requirement.

## **10\. Phased roadmap**

The PRD’s phased roadmap is good and should be kept almost intact.

## **Phase 1 — Fast quality uplift**

Implement:

* Firecrawl-style extraction path  
* basic caching  
* clean markdown output

Target:

* immediate jump toward 8.0–8.5.

## **Phase 2 — Agentic precision**

Implement:

* Stagehand agentic extraction  
* schema support  
* Crawlee reliability patterns

Target:

* stronger SPA/JS-heavy handling  
* more reliable structured extraction.

## **Phase 3 — Advanced quality and verification**

Implement:

* Crawl4AI-style cache modes  
* cleaning heuristics  
* relevance scoring  
* deeper DanteForge integration

Target:

* 9.0+ quality path.

## **Phase 4 — Product polish**

Implement:

* batch support  
* multi-page support  
* benchmarks  
* VS Code preview improvements

Target:

* polished production capability.

## **11\. Non-functional requirements / SLOs**

The PRD’s NFRs should become hard gates.

### **SLOs**

* `<3s` typical cached or smart extract  
* `<8s` cold JS-heavy page  
* `>95%` success on modern sites with retries/stealth where relevant  
* local-first behavior where possible  
* full MCP \+ streaming integration  
* Git worktree safety compatibility.

### **Additional V+E gate**

Also enforce:

* token efficiency score,  
* markdown cleanliness score,  
* structured extraction validity score.

## **12\. Verification model**

## **12.1 Output gates**

No fetch/extract result is “green” unless all are true:

* markdown exists and is non-trivial,  
* metadata exists,  
* at least one source/citation exists,  
* extraction path recorded,  
* cache metadata recorded,  
* schema validity passes if schema requested.

## **12.2 DanteForge gates**

DanteForge should evaluate:

* claim traceability,  
* structure completeness,  
* anti-stub / non-placeholder output,  
* confidence on extracted claims.

## **12.3 Human eval corpus**

The PRD already defines the right eval shape:

* 25 diverse pages:  
  * news  
  * docs  
  * SPAs  
  * e-commerce.

Keep that. It is a good benchmark set.

## **13\. Test charter**

## **Unit tests**

* URL normalization  
* cache-key generation  
* cache reads/writes  
* markdown cleaning  
* relevance scoring  
* deduplication  
* schema extraction validation  
* fallback-chain selection

## **Integration tests**

* static page → markdown  
* JS-heavy SPA → browser extraction  
* schema extraction path  
* instruction-only extraction path  
* cache hit path  
* batch fetch path

## **Golden flows**

### **GF-01**

A simple docs page returns:

* clean markdown,  
* metadata,  
* citations,  
* and cache entry.

### **GF-02**

A JS-heavy page escalates to browser mode and still returns structured output.

### **GF-03**

A schema-driven extraction returns valid JSON plus clean markdown.

### **GF-04**

A repeated request returns from cache and stays under cached-latency target.

### **GF-05**

A noisy page strips nav/footer/ads while preserving tables/headings/lists.

### **GF-06**

A multi-page batch returns consistent structured outputs and source metadata.

## **14\. Risks and corrections**

The PRD’s risk section is good, but here is the V+E correction.

### **Risk 1 — Selector fragility**

The PRD proposes Stagehand self-healing and fallback chains. Correct.

### **Correction**

Never rely on one extraction path. Keep the fallback ladder explicit and observable.

### **Risk 2 — Rate limits / blocking**

The PRD correctly points to caching, Crawlee-style reliability, and optional proxies.

### **Correction**

Make reliability hardening phase-based. Do not start with proxy complexity unless needed.

### **Risk 3 — Token bloat**

The PRD correctly identifies aggressive cleaning and summarization gates.

### **Correction**

Token efficiency must be a testable output property, not a vague aspiration.

### **Risk 4 — Complexity explosion**

The PRD correctly says start SDK-first with Firecrawl-style wins, then deepen with Stagehand.

### **Correction**

That sequencing must be protected. Do not jump straight to the hardest agentic/browser path.

## **15\. Runbook**

### **Step 1**

Create the new package and core contracts.  
Do not bury this in `browser-agent.ts`.

### **Step 2**

Ship the fast path:

* cache  
* clean markdown  
* basic metadata  
* Firecrawl-style output structure

### **Step 3**

Add schema extraction and browser escalation.

### **Step 4**

Add relevance/dedupe and verification gates.

### **Step 5**

Add batch and multi-page support.

### **Step 6**

Run the 25-page benchmark corpus and enforce SLOs.

## **16\. Done definition**

This machine is complete only when all are true:

1. DanteCode can fetch and analyze both static and JS-heavy pages.  
2. Output is clean markdown plus optional structured JSON.  
3. Cache works through `checkpointer.ts`.  
4. Citations and metadata are preserved.  
5. DanteForge verification runs on extracted claims and outputs.  
6. The fallback chain is deterministic and observable.  
7. Batch fetch works.  
8. Benchmark corpus shows material cleanliness and structure improvement.  
9. WebFetch becomes a strong complement to the WebSearch module, exactly as the PRD intends.

## **17\. Final judgment**

This is a good PRD.

The main V+E correction is:

**Do not treat this as a browser tweak. Treat it as a dedicated WebFetch / Page Analysis machine inside the Research stack.**

That is the right way to get to 9.0+ instead of ending up with a smarter but still brittle browser helper.

The next best move is to turn this into a **Codex-ready V+E Execution Packet** with exact file order, generation plan, tests, and acceptance gates.

Plesase build Codex-ready V+E Execution Packet

I’m pulling the uploaded PRD text first, then I’m checking the current public docs for the specific external patterns it references so the packet doesn’t bake in stale assumptions.

Thought for 1m 12s

Below is the **Codex-ready V+E Execution Packet** for the uploaded **DanteCode WebFetch / Page Analysis Enhancement PRD v1.0**.

This packet keeps the PRD’s core intent intact:

* smart extractor  
* clean markdown  
* structured JSON  
* caching  
* relevance/dedupe  
* JS rendering  
* DanteForge verification  
* optional Firecrawl/Stagehand integration

It also respects current external tool realities:

* Stagehand supports `extract()` with schema or natural-language instructions, optional targeted selectors, and browser actions via `act()`.  
* Firecrawl supports prompt-based and schema-based extraction, multi-URL extraction, and async extraction jobs with status polling.  
* Crawlee provides both HTTP crawling and real browser crawling with Playwright/Puppeteer-style browser management.

# **Codex-ready V+E Execution Packet**

## **WF-01 — DanteCode WebFetch / Page Analysis Uplift**

## **0\. Executive call**

Build this as a **dedicated machine**, not as a minor patch inside `browser-agent.ts`.

### **Product outcome**

DanteCode gets a production-grade page-analysis stack that can:

* fetch static and JS-heavy pages,  
* clean them into LLM-ready markdown,  
* optionally extract structured JSON,  
* cache intelligently,  
* attach citations/metadata,  
* score relevance,  
* and route outputs through DanteForge verification.

### **Correct architecture**

* **new package:** `packages/web-extractor`  
* **integration surfaces:** `core/browser-agent.ts`, `checkpointer.ts`, `model-router.ts`, MCP tool registration, slash commands, DanteForge verification bridge

---

# **1\. Objective**

Implement the PRD’s target uplift for WebFetch / Page Analysis by shipping:

* `web_fetch(url, instructions?, schema?, options?)`  
* `smart_extract(url, goal)`  
* `batch_fetch(urls, commonInstructions)`

with:

* JS rendering for SPAs  
* clean markdown  
* schema or instruction-driven JSON extraction  
* persistent caching  
* relevance filtering  
* citations/source metadata  
* deterministic fallback chain  
* DanteForge verification hooks

This matches the uploaded PRD directly. The doc defines these exact tool surfaces, must-haves, fallback chain, and phased rollout. It also explicitly recommends a new `packages/web-extractor` or a major dedicated uplift, not just incidental changes.

## **1.1 Non-goals for MVP**

Do not start with:

* full login automation  
* multi-page/site crawl orchestration as a dependency  
* vision-first extraction  
* stealth/proxy-heavy enterprise scraping stack  
* mandatory LLM refinement for every request

Those stay phase-later, which is aligned with the PRD’s advanced-scope section.

---

# **2\. Repo boundary and ownership**

## **2.1 New package**

Create:

packages/web-extractor/  
 src/  
   types.ts  
   request-planner.ts  
   fetch-engine.ts  
   markdown-cleaner.ts  
   smart-extractor.ts  
   schema-extractor.ts  
   relevance-scorer.ts  
   dedupe.ts  
   cache/  
     cache-key.ts  
     session-cache.ts  
     persistent-cache.ts  
   providers/  
     basic-fetch.ts  
     firecrawl-adapter.ts  
     stagehand-adapter.ts  
     crawlee-adapter.ts  
   index.ts  
 test/

## **2.2 Existing files to integrate with**

* `core/browser-agent.ts`  
* `checkpointer.ts`  
* `model-router.ts`  
* DanteForge verification bridge  
* MCP tool registration  
* slash-command registration  
* optional `git-engine`  
* optional `loop-detector.ts`

This mirrors the PRD’s implementation recommendations and keeps the architecture additive instead of destabilizing core browser logic all at once.

---

# **3\. Canonical architecture**

## **3.1 Layered machine**

The implementation must follow this pipeline:

1. **Request Planner**  
2. **Fetch Engine**  
3. **Cleaner**  
4. **Structured Extractor**  
5. **Relevance / Dedupe**  
6. **Cache Layer**  
7. **Verification Layer**

## **3.2 Fallback chain**

Every request must follow a deterministic path:

1. cache probe  
2. fast extraction path  
3. agentic/browser extraction path  
4. basic fallback

This is directly required by the PRD:  
`Cache → Firecrawl-style → Stagehand agentic → basic fetch`.

---

# **4\. Public API contracts**

## **4.1 Core contracts**

Create `packages/web-extractor/src/types.ts` with:

export interface WebFetchOptions {  
 useCache?: boolean;  
 forceBrowser?: boolean;  
 maxWaitMs?: number;  
 preActions?: Array\<Record\<string, unknown\>\>;  
 cleanLevel?: "light" | "standard" | "aggressive";  
}

export interface WebFetchResult {  
 url: string;  
 markdown: string;  
 structuredData?: Record\<string, unknown\>;  
 metadata: {  
   title?: string;  
   finalUrl?: string;  
   status?: number;  
   renderMode: "http" | "browser" | "browser-actions";  
   cacheHit: boolean;  
   extractedAt: string;  
 };  
 sources: Array\<{  
   url: string;  
   title?: string;  
   snippet?: string;  
 }\>;  
}

## **4.2 Tool surface**

Required exposed functions:

* `webFetch(url, instructions?, schema?, options?)`  
* `smartExtract(url, goal)`  
* `batchFetch(urls, commonInstructions)`

These are the PRD’s core MCP/slash surfaces.

---

# **5\. Provider model**

## **5.1 Provider strategy**

Support three provider classes:

### **A. Basic fetch provider**

* fastest  
* cheapest  
* no JS requirement  
* default first try

### **B. Firecrawl adapter**

Use as the fast high-quality smart-extract path:

* prompt-based extraction  
* schema-based extraction  
* markdown \+ structured output  
* async job support when needed

Firecrawl’s current extract flow supports prompt and schema inputs, multiple URLs, and async job status polling.

### **C. Stagehand adapter**

Use as the agentic/browser path:

* browser interaction  
* schema extraction  
* instruction-only extraction  
* selector-scoped extraction  
* action-driven waiting and page interaction

Stagehand’s current docs support schema and instruction-based `extract()` and browser actions via `act()`, with optional selector targeting and cache behavior in Browserbase-backed deployments.

### **D. Crawlee adapter**

Use for reliability hardening:

* HTTP \+ browser crawler patterns  
* browser lifecycle handling  
* robust JS rendering path  
* anti-blocking/retry patterns

Crawlee’s current docs explicitly cover both HTTP crawling and real browser crawling.

## **5.2 Hard rule**

No provider is mandatory except `basic-fetch`.  
Firecrawl and Stagehand must remain optional and pluggable, consistent with the PRD.

---

# **6\. Cache design**

## **6.1 Cache requirements**

Implement:

* session cache  
* persistent cache  
* stable cache keys

## **6.2 Cache key shape**

Key must include:

* normalized URL  
* normalized instructions  
* schema hash  
* render mode  
* pre-action signature

The PRD explicitly calls for URL \+ instruction hashing via `checkpointer.ts`, and this packet extends that correctly to schema/render/action identity so results do not collide incorrectly.

## **6.3 Backing store**

Persistent cache should integrate with `checkpointer.ts` first.  
Do not invent a separate persistence island.

---

# **7\. Cleaning and structure rules**

## **7.1 Markdown cleaner responsibilities**

`markdown-cleaner.ts` must:

* preserve headings  
* preserve lists  
* preserve tables where possible  
* remove nav/footer/ads/chrome  
* reduce token bloat  
* emit stable cleaned markdown

## **7.2 Structured extraction responsibilities**

`schema-extractor.ts` and `smart-extractor.ts` must support:

* schema-based JSON output  
* instruction-only extraction  
* fallback to light model-router refinement only when needed

## **7.3 Relevance layer**

`relevance-scorer.ts` \+ `dedupe.ts` must:

* score useful content  
* down-rank noise  
* collapse duplicates  
* keep provenance intact

These are direct PRD must-haves.

---

# **8\. Integration rules**

## **8.1 `browser-agent.ts`**

Do not make `browser-agent.ts` the whole implementation.  
It should become a client/integration surface for the new machine.

## **8.2 `checkpointer.ts`**

Must back persistent cache.

## **8.3 `model-router.ts`**

Use only for:

* optional extraction refinement  
* later query-aware extraction  
* fallback reasoning

Do not require a model-router hop for baseline markdown extraction.

## **8.4 DanteForge verification**

Every extracted result must be able to flow into DanteForge verification for:

* evidence presence  
* citation completeness  
* structural validity  
* extracted-claim review

This is a core PRD requirement, not phase-later.

---

# **9\. Generation plan**

## **WF-G1 — Contracts spine**

Files:

* `packages/web-extractor/src/types.ts`  
* `packages/web-extractor/src/index.ts`  
* tests

Acceptance:

* core request/result types compile  
* API surface is stable  
* no provider logic yet

---

## **WF-G2 — Cache keys and caches**

Files:

* `packages/web-extractor/src/cache/cache-key.ts`  
* `packages/web-extractor/src/cache/session-cache.ts`  
* `packages/web-extractor/src/cache/persistent-cache.ts`  
* tests

Acceptance:

* deterministic cache key generation  
* session cache read/write works  
* persistent cache path integrates with `checkpointer.ts`  
* cache metadata includes hit/miss and timestamp

---

## **WF-G3 — Basic fetch path**

Files:

* `packages/web-extractor/src/providers/basic-fetch.ts`  
* `packages/web-extractor/src/fetch-engine.ts`  
* tests

Acceptance:

* static pages can be fetched  
* metadata returned  
* output normalized into common `WebFetchResult`  
* no browser dependency required

---

## **WF-G4 — Markdown cleaner**

Files:

* `packages/web-extractor/src/markdown-cleaner.ts`  
* tests

Acceptance:

* noisy page content cleaned  
* headings/lists preserved  
* common nav/footer junk removed  
* output token size reduced materially in fixture tests

---

## **WF-G5 — Firecrawl adapter**

Files:

* `packages/web-extractor/src/providers/firecrawl-adapter.ts`  
* tests

Acceptance:

* optional provider wiring works  
* prompt and schema extraction paths supported  
* async extraction job handling supported where needed  
* provider remains optional / fail-soft

Firecrawl currently supports prompt/schema extraction and async polling, so the adapter should map cleanly to those capabilities rather than inventing a mismatched abstraction.

---

## **WF-G6 — Request planner**

Files:

* `packages/web-extractor/src/request-planner.ts`  
* tests

Acceptance:

* chooses cache / fast path / browser path deterministically  
* honors `forceBrowser`  
* records selected extraction path in metadata  
* no hidden provider selection logic

---

## **WF-G7 — Relevance and dedupe**

Files:

* `packages/web-extractor/src/relevance-scorer.ts`  
* `packages/web-extractor/src/dedupe.ts`  
* tests

Acceptance:

* duplicate extracted blocks collapse deterministically  
* noisy content scores lower  
* provenance survives ranking/dedupe

---

## **WF-G8 — Stagehand adapter**

Files:

* `packages/web-extractor/src/providers/stagehand-adapter.ts`  
* tests

Acceptance:

* browser extraction path works  
* instruction-only extraction supported  
* schema extraction supported  
* action-driven wait or page interaction supported  
* targeted extraction support exposed

Stagehand’s current docs support `extract()` with schema or instruction and `act()` for browser actions, which is exactly why it belongs in this layer.

---

## **WF-G9 — Structured extractors**

Files:

* `packages/web-extractor/src/schema-extractor.ts`  
* `packages/web-extractor/src/smart-extractor.ts`  
* tests

Acceptance:

* schema path validates output  
* instruction-only extraction path returns stable structure  
* optional light refinement path through `model-router.ts`  
* extraction diagnostics returned

---

## **WF-G10 — Crawlee reliability layer**

Files:

* `packages/web-extractor/src/providers/crawlee-adapter.ts`  
* tests

Acceptance:

* browser reliability hooks exposed  
* request/retry/session concepts wired in  
* not required for MVP success path  
* can be used by request planner for harder pages

Crawlee should be treated as the robustness layer, not as the only fetch engine.

---

## **WF-G11 — Batch fetch**

Files:

* add batch logic in `fetch-engine.ts` or dedicated helper  
* tests

Acceptance:

* `batchFetch(urls, commonInstructions)` works  
* consistent output shape  
* per-URL metadata preserved  
* partial failures represented clearly, not hidden

---

## **WF-G12 — DanteCode integration weld**

Files:

* integrate with `core/browser-agent.ts`  
* integrate with `checkpointer.ts`  
* integrate with `model-router.ts`  
* add MCP tool registration  
* add slash-command registration  
* tests

Acceptance:

* tools exposed end-to-end  
* streaming/progress available where applicable  
* no duplicated extraction logic left in old path if migrated  
* fallback chain observable in logs/metadata

---

## **WF-G13 — DanteForge verification bridge**

Files:

* verification bridge files in relevant package/core area  
* tests

Acceptance:

* extracted result can be verified for:  
  * evidence presence  
  * citation completeness  
  * structured output validity  
  * claim traceability  
* failures produce explicit non-green state

---

## **WF-G14 — Benchmark and eval harness**

Files:

* benchmark fixtures  
* eval harness  
* tests/reports

Acceptance:

* 25-page evaluation corpus implemented  
* categories include docs, news, SPA, e-commerce  
* report includes:  
  * cache hit rate  
  * cleanliness score  
  * structure validity  
  * latency  
  * failure reasons

These benchmark targets come straight from the PRD’s success metrics section.

---

# **10\. Golden flows**

## **GF-01 — Static docs page**

Input:

* URL

Pass:

* clean markdown returned  
* metadata returned  
* citations attached  
* cache entry written

## **GF-02 — JS-heavy page**

Input:

* SPA URL

Pass:

* request planner escalates to browser path  
* structured output still produced  
* render mode recorded as browser/browser-actions

## **GF-03 — Schema extraction**

Input:

* URL \+ schema

Pass:

* valid JSON returned  
* markdown still preserved  
* extraction diagnostics included

## **GF-04 — Cached repeat**

Input:

* same URL \+ same extraction contract

Pass:

* cache hit returned  
* latency under cached target  
* metadata reports cache hit

## **GF-05 — Noisy page cleanup**

Input:

* cluttered article/store page

Pass:

* nav/footer/ads removed  
* tables/headings/lists preserved  
* output materially more token-efficient

## **GF-06 — Batch fetch**

Input:

* multiple URLs \+ common instructions

Pass:

* consistent structured outputs  
* per-URL provenance preserved  
* partial failures explicit

---

# **11\. Hard gates**

## **Build gates**

* package builds cleanly  
* no circular dependency with `browser-agent.ts`, `checkpointer.ts`, or `model-router.ts`

## **Type gates**

* strict TS compile passes  
* provider interfaces stable

## **Test gates**

* unit tests for all new modules  
* integration tests for all golden flows  
* benchmark harness runs

## **Output gates**

No fetch result may be marked success unless:

* markdown exists and is non-trivial  
* metadata exists  
* citations/sources exist  
* extraction path recorded  
* cache metadata recorded  
* schema validity passes if schema requested

## **Safety gates**

* provider failures must fail-soft into next fallback  
* no hidden hard dependency on Firecrawl or Stagehand  
* no browser path required for static-page success  
* no result may silently discard provenance

---

# **12\. Success criteria**

This packet is complete only when all are true:

1. DanteCode can fetch static and JS-heavy pages.  
2. Output is clean markdown plus optional structured JSON.  
3. Cache works through `checkpointer.ts`.  
4. Citations and metadata are preserved.  
5. DanteForge verification runs on extracted outputs.  
6. Request planner executes the fallback chain deterministically.  
7. Batch fetch works.  
8. The 25-page benchmark corpus shows measurable quality improvement.  
9. WebFetch becomes a strong complement to the broader WebSearch / Research stack described in the PRD.

---

# **13\. Risks and corrections**

## **Risk 1 — overbuilding browser automation too early**

Correction:

* ship basic fetch \+ cleaner \+ cache first  
* add Stagehand after the fast path exists

## **Risk 2 — provider sprawl**

Correction:

* one result contract  
* one planner  
* optional adapters  
* no provider-specific result shapes leaking up the stack

## **Risk 3 — token bloat**

Correction:

* cleaner must be benchmarked, not just “seem cleaner”  
* enforce cleanliness/token-efficiency scoring

## **Risk 4 — verification too late**

Correction:

* wire DanteForge verification before declaring the machine done

## **Risk 5 — this becomes a silent sidecar to `browser-agent.ts`**

Correction:

* keep `packages/web-extractor` as the source of truth  
* let `browser-agent.ts` become a client surface

---

# **14\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing WF-01: DanteCode WebFetch / Page Analysis Uplift.

Goal:  
Build a dedicated web extraction machine for DanteCode that supports:  
\- clean markdown output  
\- optional structured JSON extraction  
\- JS rendering for SPAs  
\- persistent caching via checkpointer  
\- relevance filtering and dedupe  
\- citations and metadata  
\- deterministic fallback chain  
\- DanteForge verification hooks

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- Do not bury this implementation entirely inside browser-agent.ts  
\- packages/web-extractor is the source-of-truth package  
\- Firecrawl and Stagehand must remain optional  
\- No success state without markdown \+ metadata \+ source provenance  
\- No schema success state without validation  
\- Preserve provider-agnostic result contracts

Create:  
packages/web-extractor/  
 src/  
   types.ts  
   request-planner.ts  
   fetch-engine.ts  
   markdown-cleaner.ts  
   smart-extractor.ts  
   schema-extractor.ts  
   relevance-scorer.ts  
   dedupe.ts  
   cache/  
     cache-key.ts  
     session-cache.ts  
     persistent-cache.ts  
   providers/  
     basic-fetch.ts  
     firecrawl-adapter.ts  
     stagehand-adapter.ts  
     crawlee-adapter.ts  
   index.ts

Generation order:

G1:  
\- types.ts  
\- index.ts  
\- tests

G2:  
\- cache/cache-key.ts  
\- cache/session-cache.ts  
\- cache/persistent-cache.ts  
\- tests

G3:  
\- providers/basic-fetch.ts  
\- fetch-engine.ts  
\- tests

G4:  
\- markdown-cleaner.ts  
\- tests

G5:  
\- providers/firecrawl-adapter.ts  
\- tests

G6:  
\- request-planner.ts  
\- tests

G7:  
\- relevance-scorer.ts  
\- dedupe.ts  
\- tests

G8:  
\- providers/stagehand-adapter.ts  
\- tests

G9:  
\- schema-extractor.ts  
\- smart-extractor.ts  
\- tests

G10:  
\- providers/crawlee-adapter.ts  
\- tests

G11:  
\- batch fetch support  
\- tests

G12:  
Integrate with:  
\- core/browser-agent.ts  
\- checkpointer.ts  
\- model-router.ts  
\- MCP tool registration  
\- slash-command registration  
\- tests

G13:  
Integrate DanteForge verification bridge  
\- tests

G14:  
Benchmark/eval harness for 25-page corpus  
\- tests/reports

Required APIs:  
\- webFetch(url, instructions?, schema?, options?)  
\- smartExtract(url, goal)  
\- batchFetch(urls, commonInstructions)

Golden flows:  
\- static docs page  
\- JS-heavy page  
\- schema extraction  
\- cached repeat  
\- noisy page cleanup  
\- batch fetch

At the end of each generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until all golden flows pass.  
---

# **15\. Final judgment**

This PRD is worth building.

The most important implementation choice is this:

Build **one dedicated WebFetch / Page Analysis machine** with a provider-agnostic contract and deterministic fallback chain.

That is what turns the PRD from “browser improvements” into a real DanteCode capability.

