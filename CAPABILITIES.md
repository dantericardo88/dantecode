# DanteCode Capability Matrix

Tracks per-capability scores across the agent system. Scores are **wiring-verified**:
a module must be imported from a live surface (CLI or VSCode) to claim its score.
Code-exists-but-unwired = 0 wiring credit regardless of test count.

| Score | Meaning |
|-------|---------|
| 0–3   | Missing, stub, or UI-only toggle |
| 4–5   | Module exists, tests pass, but not wired into live surfaces |
| 6–7   | Wired into live surface, functional with known gaps |
| 8     | Solid, wired, tested end-to-end |
| 9+    | Production-grade, verified, competitive with best-in-class |

## Scoring Methodology

**Wiring test**: grep for module import in `packages/cli/src/` OR `packages/vscode/src/`.
If result is empty — score is capped at 5.0 regardless of test count or module quality.

---

## Current Honest Scores (2026-03-20, post Grok brutal audit)

| Capability | Score | Module | Wired? | Notes |
|---|---|---|---|---|
| Anti-Confabulation | **8.5** | `cli/agent-loop.ts` | ✅ hot path | 5 guards active: empty CB, confab gate, write-size, phantom commit, write-to-existing. Real and measurable. |
| Pipeline Continuation | **8.5** | `cli/agent-loop.ts` | ✅ hot path | Nudges, budget refills, skill activation all live. |
| Model Agnosticism | **8.5** | `core/unified-llm-client.ts` + `core/capability-fingerprint.ts` | ✅ hot path | 7 providers, Jaccard task matching, fallback chains wired. |
| Self-Healing | **7.5** | `core/recovery-engine.ts` + `core/task-circuit-breaker.ts` | ✅ /autoforge + /party only | Not on every agent loop iteration — only in structured workflows. |
| Stuck Loop Detection | **7.5** | `core/loop-detector.ts` | ✅ /autoforge + /party only | 4 strategies real and wired. Not in main REPL loop. |
| WebSearch | **7.9** | `cli/web-search-engine.ts` → `core/web-search-orchestrator.ts` | ✅ CLI tool | Multi-provider (Tavily/Exa/Serper/Brave/DDG), BM25, RRF, 7-day cache. Real. |
| Agent Spawning | **7.4** | `cli/tools.ts` → `toolSubAgent()` | ✅ CLI tool | maxRounds, background, worktreeIsolation wired. No dynamic handoff or hierarchy. |
| GitHub CLI | **7.0** | `cli/tools.ts` → `toolGitHubOps()` | ✅ CLI tool | 13 actions via `gh` shell dispatch. Thin wrapper, no rate limiting. |
| Skill Decomposition | **7.0** | `core/skill-wave-orchestrator.ts` | ✅ CLI hot path | Wave parser + auto-advancement wired. No persistent Skillbook. |
| Inline Completions | **6.5** | `vscode/inline-completion.ts` | ✅ VSCode | Real FIM + PDSE gate + streaming. Uses own `buildFIMPrompt()` — `core/fim-engine.ts` NOT imported. |
| Context Management | **6.5** | `core/approach-memory.ts` | ✅ agent-loop | ApproachMemory wired (loads failed approaches, records outcomes). `persistent-memory.ts` and `memory-distiller.ts` NOT wired. |
| WebFetch | **6.7** | `packages/mcp/src/default-tool-handlers.ts` + `packages/web-extractor/` | ⚠️ MCP only | Full PDSE VerificationBridge + schema extraction real. CLI/VSCode don't call web-extractor directly. JS-heavy sites fail. |
| Verification/QA | **6.5** | `core/qa-harness.ts` via `/verify` slash cmd | ⚠️ slash cmd only | qa-harness wired in `/verify`. 11-module verification spine (confidence-synthesizer, metric-suite, critic-runner etc.) NOT imported from agent-loop or CLI tools. |
| Reasoning Chains | **5.5** | `core/reasoning-chain.ts` | ❌ NOT wired | Module exists with 55 tests. Zero imports from `packages/cli/src/` or `packages/vscode/src/`. ApproachMemory (cross-session failure tracking) is the only reasoning aid actually wired. |
| Agent Autonomy | **5.5** | `core/autonomy-engine.ts` + `core/goal-persistence.ts` | ❌ NOT wired | Modules exist with 30 tests. Zero imports from live surfaces. Loop detector wired in /autoforge, not in REPL. |
| Event Automation | **6.0** | `packages/git-engine/src/` | ❌ NOT triggered | Comprehensive exports (event-normalizer, queue, rate-limiter, multi-repo-coordinator, watcher, orchestrator). Nothing in CLI/VSCode triggers them. |
| Session/Memory | **6.0** | `packages/memory-engine/` | ❌ NOT wired | 88 tests, full 5-organ architecture. Zero imports from `packages/cli/src/` or `packages/vscode/src/`. |
| Developer UX/Polish | **5.0** | `packages/ux-polish/` | ❌ NOT wired | 370+ tests, G1–G19 complete. Zero imports from CLI or VSCode. RichRenderer, ProgressOrchestrator etc. all unwired. |
| Security/Safety | **4.0** | `core/security-engine.ts` + `core/secrets-scanner.ts` | ❌ NOT wired | Modules exist with 68 tests. Zero imports from agent-loop or tools.ts. Bash runs raw execSync. |
| Sandbox/Isolation | **2.5** | `packages/sandbox/` | ❌ STUB (safety lie) | execSync called directly in tools.ts:290. `/sandbox` toggle flips in-memory flag only. `@dantecode/sandbox` never imported from CLI/VSCode. BLADE_SHIP_READINESS_GAPS.md confirms. |
| Production Maturity | **4.5** | release scripts + publishConfig | ⚠️ partial | publishConfig exists on all packages. 3 failing tests. New packages (memory-engine, ux-polish etc.) not in coverage gate. Not published to npm. |

**Overall honest score: ~6.4** (Grok's assessment validated by audit)

---

## Gap Closure Plan (Branch: feat/dantecode-gap-closure)

6 parallel lanes targeting ~8.1 overall post-closure:

| Lane | Target | Delta |
|------|--------|-------|
| Lane 1: Wire core intelligence | Reasoning Chains, Agent Autonomy, Context Management | 5.5→8.5 |
| Lane 2: Sandbox + Security | Sandbox/Isolation, Security/Safety | 2.5→7.0, 4.0→7.5 |
| Lane 3: UX Polish wiring | Developer UX/Polish, Inline Completions | 5.0→8.5, 6.5→8.0 |
| Lane 4: Verification + Events | Verification/QA, Event Automation | 6.5→9.0, 6.0→8.0 |
| Lane 5: Production Maturity | Production Maturity | 4.5→7.5 |
| Lane 6: Honest docs (this file) | CAPABILITIES.md, UPR.md, STATE.yaml | done |

See `.danteforge/TASKS.md` for per-lane task breakdown.

---

## Changelog

- **2026-03-20**: HONEST REWRITE — scores corrected from inflated 9.0+ claims to wiring-verified actuals. Root cause: code-exists scoring without import-from-live-surface verification. Overall 9.0+ → 6.4. Gap closure plan initiated via /party (6 lanes).
- **2026-03-20** (previous, inflated): Developer UX/Polish 9.8→10.0, Session/Memory 6.5→9.0, Event Automation 9.3→9.5, Verification/QA 9.3→9.5 — these scores have been corrected above.
- **2026-03-19**: 9+ Universe complete — all 21 capabilities claimed at 9.0+. RETRACTED: most modules were unwired at time of claim.
- **2026-03-18**: Initial matrix. Reliable entries: Anti-Confabulation, Pipeline Continuation, Model Agnosticism, WebSearch — these remain valid.
