# DanteCode Adoption Queue
_Patterns ready for implementation | Updated: 2026-04-14_

This file is consumed by `danteforge_harvest_next_pattern`. Each entry is a concrete
OSS pattern extracted and ready to implement — constitutional harvest complete,
mechanics understood, file targets identified.

---

## Queue (Priority Order)

### AQ-01 — Anthropic Token Counter Integration (P0)
**Source:** Plandex (adaptive-token-budget)
**Sprint:** A (pre-work)
**Target file:** `packages/vscode/src/fim-context-budget.ts`
**Mechanic:** Use `@anthropic-ai/sdk` token counter for accurate token counts before
each FIM request. FimContextBudget currently estimates 4 chars/token — replace with
exact count for prefix/suffix, keep fast estimate for quick decisions.
**Done when:** `FimContextBudget.accurateCount(text)` returns real token count via SDK.

### AQ-02 — Image Preprocessing Pipeline (P0)
**Source:** Screenshot-to-code (image-preprocessing-pipeline)
**Sprint:** C
**Target file:** `packages/vscode/src/screenshot-to-code.ts` (CREATE)
**Mechanic:** Accept base64 data URL, check dimensions (≤7990px) and size (≤5MB).
If over dimension: resize preserving aspect ratio using `sharp`. If over size: JPEG
quality loop from 95 down by 5 until ≤5MB. Return `{mediaType, base64}`.
**Done when:** 1MB PNG resizes correctly; 10MB image compresses to ≤5MB.

### AQ-03 — Streaming Tool-Call Delta Buffer (P0)
**Source:** Screenshot-to-code (streaming-tool-call-delta-buffering)
**Sprint:** C
**Target file:** `packages/core/src/model-router.ts`
**Mechanic:** `StreamEventParser` accumulates partial JSON from `input_json_delta` events.
Emit `tool_call_delta` events as JSON builds. Sidebar shows live tool call arguments.
**Done when:** Tool call args visible in sidebar as they stream, before tool completes.

### AQ-04 — Plan Rewind via Commit SHAs (P1)
**Source:** Plandex (plan-rewind-commit-sha)
**Sprint:** B
**Target file:** `packages/core/src/plan-streamer.ts` (CREATE)
**Mechanic:** Maintain `CommitLog: {sha, timestamp, affectedFiles, description}[]`.
`undoTo(sha)` reverts only files in `affectedFiles` that changed between current and target.
**Done when:** `dantecode plan rewind --steps 2` rolls back last 2 plan steps.

### AQ-05 — SSE Adaptive First-Token Timeout (P1)
**Source:** Plandex (sse-heartbeat-adaptive-timeout)
**Sprint:** core (any sprint)
**Target file:** `packages/core/src/model-router.ts`
**Mechanic:** `timeout = base(90s) + Math.min(maxExtra, (totalTokens/150000) * slope(90s))`.
Reset timer on each received chunk. Emit `timeout` event if no data for calculated duration.
**Done when:** Large 128k context requests get 15min timeout; small requests get 90s.

### AQ-06 — Incremental Code Preview Streaming (P1)
**Source:** Screenshot-to-code (incremental-code-preview-streaming)
**Sprint:** C
**Target file:** `packages/vscode/src/screenshot-to-code.ts`
**Mechanic:** Divide generated code into 18 chunks (min 200 chars each). Send each chunk
with brief delay. Track `sentLength` to allow resumption on error without restart.
**Done when:** Code appears progressively in sidebar during generation (not all-at-once).

### AQ-07 — Multi-Image Strategy Instructions (P1)
**Source:** Screenshot-to-code (vision-multi-image-prompt-engineering)
**Sprint:** C
**Target file:** `packages/vscode/src/screenshot-to-code.ts`
**Mechanic:** When >1 screenshot provided: detect if they're same page (link them),
navigation tabs (add nav logic), or unrelated (scaffold separately).
**Done when:** Paste 2 screenshots → component has navigation between them.

### AQ-08 — HTML Content Extraction with Fallback Chain (P1)
**Source:** Screenshot-to-code (html-content-extraction-fallback-chain)
**Sprint:** C
**Target file:** `packages/vscode/src/screenshot-to-code.ts`
**Mechanic:** Chain: strip markdown fences → find custom wrapper → match DOCTYPE+html →
match standalone html → return raw text. Each step regex with DOTALL flag.
**Done when:** LLM output with markdown fences or custom wrappers correctly extracted.

---

## Completed (Implemented)

| Pattern | Source | Sprint | File |
|---|---|---|---|
| Stop Sequence Trie | Tabby | 7 | `completion-stop-sequences.ts` |
| FIM Context Budget | Tabby | 7 | `fim-context-budget.ts` |
| Early Ghost Text Emission | Tabby | 7 | `completion-streaming-emitter.ts` |
| AST Chunker | Tabby | 7 | `ast-chunker.ts` |
| Bracket-Balance Stop Detection | Twinny | OSS run 1 | `completion-stop-sequences.ts` |
| File Interaction Relevance Scoring | Twinny | OSS run 1 | `file-interaction-cache.ts` |
| SEARCH/REPLACE Parser | Aider | 4 | `udiff-parser.ts` |
| Browser CLI Tool | OpenHands | 6 | `browser-cli.ts` |
| Debug Control | OpenHands | 6 | `debug-control.ts` |
| SWE-bench Runner | OpenHands | 6 | `swe-bench-runner.ts` |
| Task Decomposer | OpenHands | 6 | `task-decomposer.ts` |

---
_Run `/oss` again to discover new repos and grow the library._
