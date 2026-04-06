# Competitive Dimension Assessment
## DanteCode: 18-Dimension Competitive Scoring vs. 27 Competitors

**Assessment Date:** 2026-04-06 (HONEST REWRITE — prior scores were inflated)
**Sprint Update:** 2026-04-06 (Session 3) — Council worktree race fixes (10 conditions), DEEP_REFLECTION_INSTRUCTION, context budget dynamic truncation, terminal error detection, mid-stream safe resume
**Method:** DanteForge `assess` tool — competitive benchmarking against 27 real competitors
**Rank:** **27/28** (avg score 59.8 → ~64 post-sprint vs field average ~68)
**Prior documents claiming 8.9–9.1/10 were self-referential and not competitive — they are WRONG**

---

## Competitive Scoring Summary (18 Dimensions)

Changes from Inferno Sprint marked with ↑

| # | Dimension | Our Score | Field Best | Best By | Gap | Severity |
|---|-----------|:---------:|:----------:|---------|:---:|----------|
| 1 | **Developer Experience** | **91** | 91 | Cursor / GH Copilot CLI | 0 | ✅ LEADING |
| 2 | **Spec-Driven Pipeline** | **80** | 80 | Kiro (AWS) | 0 | ✅ LEADING |
| 3 | Functionality | 85 | 88 | Devin | -3 | Minor |
| 4 | Documentation | 85 | 92 | Swimm | -7 | Minor |
| 5 | Planning Quality | 82 | 85 | MetaGPT | -3 | Minor |
| 6 | Maintainability | 77 | 80 | Claude Code | -3 | Minor |
| 7 | Security | 70 | 85 | Zencoder | -15 | **Major** |
| 8 | Performance | 70 | 80 | Codex CLI (OpenAI) | -10 | **Major** |
| 9 | Self-Improvement | 55 | 72 | CodiumAI/Qodo | -17 | **Major** |
| 10 | Testing | 56 | 92 | Qodo 2.0 | -36 | **CRITICAL** |
| 11 | Error Handling | **60** ↑+10 | 80 | CodeRabbit | -20 | **CRITICAL** |
| 12 | UX Polish | **58** ↑+8 | 92 | Cursor | -34 | **CRITICAL** |
| 13 | Ecosystem / MCP | **68** ↑+8 | 90 | Claude Code | -22 | **CRITICAL** |
| 14 | Token Economy | **58** ↑+18 | 75 | Claude Code | -17 | **CRITICAL** |
| 15 | Convergence / Self-Healing | **52** ↑+14 | 85 | Devin | -33 | **CRITICAL** |
| 16 | Autonomy | **42** ↑+5 | 92 | Devin | -50 | **CRITICAL** |
| 17 | Enterprise Readiness | 35 | 90 | Zencoder | -55 | **CRITICAL** |
| 18 | Community Adoption | 15 | 95 | Cursor / GH Copilot CLI | -80 | **CRITICAL** |

**Competitive Average Score (pre-sprint):** 59.8 / 100
**Competitive Average Score (post-sprint estimate):** ~64.5 / 100
**Leaderboard Rank:** 27 out of 28 (unchanged — need community adoption to move)
**Fake-Completion Risk:** REDUCED — sprint wired existing code rather than building new abstractions

### Sprint Score Changes — Session 1 + Session 2 + Session 3 Combined

| Dimension | Score | Change | Evidence |
|-----------|-------|--------|----------|
| Token Economy | 58 | +18 | `shouldTruncateToolOutput` wired with dynamic limits (green=50KB, yellow=10KB, red=5KB, critical=2KB); adaptive `maxTokens`; `LanguageModelUsage` accumulator; budget tier printed to stdout |
| Convergence | 52 | +14 | `LoopDetector` + `TaskCircuitBreaker` → STANDARD→REDUCED_SCOPE→MINIMAL; RecoveryEngine auto-triggers; **10 council worktree race conditions fixed** — sequential lane merges now reliable |
| Error Handling | 60 | +10 | `DanteErrorType` classifier; `classifyError/isRetryable/isTerminal` wired into agent-loop; terminal errors (Auth/Billing) abort immediately; `streamingStarted` mid-stream safe-resume (Cline pattern); `process.on` fix |
| UX Polish | 58 | +8 | Industrial Editorial design (VSCode + Desktop); Ink incremental line-diffing in `stream-renderer.ts`; 30fps webview throttle; context gauge in stream header |
| Ecosystem/MCP | 68 | +8 | 15 → 35 tools, `mcp-manifest.json` published for third-party discovery |
| Autonomy | 42 | +5 | `DEEP_REFLECTION_INSTRUCTION` (4+ consecutive failures → full re-assessment); `streamingStarted` safe resume prevents loop on mid-stream errors; `PIVOT_INSTRUCTION` unchanged for 2–3 failures |

### What This Sprint Did NOT Fix
- Community Adoption (15): Zero public presence — cannot be fixed by code
- Enterprise Readiness (35): Requires external certifications — not code work
- Testing (56): Error path coverage still thin
- Autonomy vs Devin (92): Still 50 points behind — architecture exists but unproven in the wild

---

## What the Previous Documents Got Wrong

The internal 11-dimension framework (DIMENSION_ASSESSMENT.md versions before this one) scored the project at 8.9–9.1/10 by measuring *internal engineering correctness* in isolation:
- "Engineering Maturity 9.3/10" — measures test count and CI pipelines, not autonomous task completion
- "Agentic Depth 9.0/10" — measures architecture (modules, LOC, packages), not agent convergence in the wild
- "Security 9.0/10" — measures sandbox enforcement code path, not external certifications or proven attack surface
- "UX Polish 9.0/10" — measured CLI helptext quality, not actual user experience vs Cursor's 9.2

These scores were internally consistent but **competitively meaningless**. They measured effort, not outcomes.

---

## Critical Gap Analysis (9 CRITICAL Dimensions)

### 1. Community Adoption — 15/100 (-80 from leader)
**Reality:** Zero external users. No public benchmarks. No GitHub stars visibility. No third-party skills ecosystem. No blog posts. No public proof of anything.
**Required:** Public launch, published benchmarks, open source presence, skills marketplace

### 2. Enterprise Readiness — 35/100 (-55 from leader)
**Reality:** No SOC 2. No ISO 27001. No RBAC. No data retention policy. No enterprise pricing. No audit log export. No support SLAs.
**Required:** At minimum: documented audit trails, RBAC foundations, compliance docs

### 3. Autonomy — 37/100 (-55 from leader)
**Reality:** Council+Gaslight+FearSet architecture EXISTS but convergence-self-healing loop (38/100) is unproven in the wild. Devin runs 92. Even Aider runs 70. Architecture ≠ autonomy.
**Required:** Demonstrated self-correction on real tasks without human intervention

### 4. Convergence / Self-Healing — 38/100 (-47 from leader)
**Reality:** CircuitBreaker, RecoveryEngine, CheckpointManager all exist in code. But the system does not demonstrably recover from failures and converge on solutions automatically. Fake-completion flag is evidence.
**Required:** End-to-end verify/repair loop that closes without human in the loop

### 5. Token Economy — 40/100 (-35 from leader)
**Reality:** We score lower than Claude Code (75) — the API we're wrapping. Budget fencing exists in code but isn't translating to measurable token savings at system level. Scored "89% cheaper" based on one cherry-picked simple task.
**Required:** Consistent token budgeting, intelligent routing, real multi-task cost data

### 6. Testing — 56/100 (-36 from leader)
**Reality:** 7k+ tests PASS but coverage is thin on error paths, integration scenarios, and e2e. Qodo 2.0 scores 92. Our testing scores our own test count, not quality or coverage breadth.
**Required:** E2E test suite, coverage gates >80%, error path coverage

### 7. Error Handling — 50/100 (-30 from leader)
**Reality:** Many async functions lack try/catch. Custom error classes sparse. Graceful degradation uneven. CodeRabbit scores 80 because error handling is their core product.
**Required:** Systematic error taxonomy, all async paths covered, actionable error messages

### 8. UX Polish — 50/100 (-42 from leader)
**Reality:** Cursor scores 92 because their UX is a polished product. Our CLI works but lacks loading states, progress indicators, and the moment-to-moment feel of a professional tool.
**Required:** Progress spinners, better status messages, consistent color/formatting, interactive prompts

### 9. Ecosystem / MCP — 60/100 (-30 from leader)
**Reality:** MCP server exists. Claude Code scores 90 because Anthropic built the protocol and has 100+ community servers. We have ~15 tools exposed and no third-party ecosystem.
**Required:** More tools, published MCP server, community adoption

---

## Major Gap Analysis (3 MAJOR Dimensions)

### Security — 70/100 (-15)
Good: DanteSandbox mandatory, anti-injection guards, rm-rf guards, destructive-git guard.
Missing: External certifications, pen-test results, documented threat model, secret scanning in CI.

### Performance — 70/100 (-10)
Good: <500ms startup, turbo cache, 145MB RSS.
Missing: Hot-path profiling data, large-repo benchmarks (>10k files), streaming response performance.

### Self-Improvement — 55/100 (-17)
Good: DanteSkillbook, DanteGaslight, ACE reflection loop all exist.
Missing: Demonstrable improvement over time. Lessons file has entries but no proof the system actually gets better at tasks.

---

## What We're Actually Leading In

**Developer Experience (91) — TIED FOR 1ST:**
The CLI ergonomics, plan mode, skill system, and spec-driven pipeline create a genuinely differentiated developer experience. This is a real moat.

**Spec-Driven Pipeline (80) — TIED FOR 1ST with Kiro:**
The PDSE (Plan → Design → Spec → Execute) pipeline with cryptographic receipts is unique. Kiro (AWS Bedrock) is our closest competitor here and has enterprise distribution. We must push this to 90+ before they do.

---

## Maturity Level

- **Current Maturity:** Level 4/6 (Beta — early customer ready, not production-ready)
- **Target Maturity:** Level 5/6 (Customer-ready)
- **Honest State:** We have elaborate architecture with unproven autonomous behavior. The foundation is strong. The surface area that matters to users (UX, reliability, ecosystem, adoption) is critically underdeveloped.

---

## Scoring from This Point Forward

All future assessments MUST use the 18-dimension competitive framework above, not an internal 11-dimension self-referential framework. A score only counts if it moves us up the competitive leaderboard.

**Rule:** If our new work does not close a gap against a named competitor, it does not count as progress.

---

*Updated: 2026-04-06*
*Prior versions of this document are SUPERSEDED — they used a non-competitive internal framework*
*Competitive data source: DanteForge assess tool, 27 competitors, hardcoded competitive scores*
