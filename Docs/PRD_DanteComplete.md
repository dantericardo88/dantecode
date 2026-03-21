# EXECUTION PACKET: DanteComplete — Inline Completions Upgrade
## Inline Completions (7.0 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteComplete |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/vscode` (existing, extend) + `@dantecode/core` (FIMEngine) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~500 source + ~250 tests |
| **Sprint Time** | 1.5-2.5 hours for Claude Code |

---

## 1. The Situation

DanteCode's inline completion system is already substantial — 1,444 LOC across 4 files with 71 tests:

| Component | LOC | What It Does |
|---|---|---|
| `inline-completion.ts` | 612 | Full InlineCompletionItemProvider with streaming FIM, balanced-brace multiline guard, adaptive debounce, PDSE inline diagnostics |
| `fim-engine.ts` | 420 | Model-agnostic FIM prompt builder (StarCoder, CodeLlama, DeepSeek-Coder, Claude, GPT, generic), memory context injection |
| `cross-file-context.ts` | 211 | Cross-file context gathering for richer completions |
| `prefix-tree-cache.ts` | 201 | FIFO cache with 150 entries, 90s TTL |

**What's already working:**
- Streaming FIM completions with ghost text (VSCode native)
- Tab-accept (VSCode native)
- Adaptive debounce per provider (Ollama: 100ms, Grok: 150ms, default: 180ms)
- Balanced-brace multiline guard (prevents runaway generation)
- Cross-file context injection (imports from related files)
- PDSE inline diagnostics (squiggly warnings on low-quality completions)
- Cache with eviction
- 6 model family support with model-specific FIM formats
- Memory/RAG context injection into prompts

**What's missing for 9.0 (4 targeted additions):**

1. **Accept/reject telemetry** — no tracking of which completions users accept vs dismiss. No data flows back to Model Personality Profiles.
2. **Smart cache invalidation** — FIFO + TTL is naive. Cache should invalidate when the file is edited above the cursor (context changed).
3. **Completion prefetching** — no prediction of the next completion while user reviews the current one.
4. **Accept-pattern learning** — no adaptation based on user behavior (e.g., "this user always rejects single-line completions but accepts multiline" → bias toward multiline).

---

## 2. Competitive Benchmark

### Cursor (9.8 — the benchmark for inline completions)
- Tab completion with multi-cursor support
- Copilot++ predictor that reads intent from editing patterns
- Full codebase indexing for context
- Background prefetching of likely next completions
- Learning from accept/reject to improve suggestions

### Claude Code (8.5)
- Not an IDE — no inline completions by design (terminal-first)
- VSCode extension has basic completions but not the focus

### GitHub Copilot (9.5)
- Industry-defining inline completion
- Deep telemetry on accept/reject/edit patterns
- Per-language model tuning based on billions of accept signals
- Partial accept (Tab-Tab for word-by-word acceptance)

### OpenCode (8.0)
- LSP-based completion through language servers
- Not a primary feature — OpenCode focuses on chat/agent

### DanteCode Current (7.0 feature / lower proven)
- Solid FIM engine with 6 model families
- PDSE diagnostics on completions (unique to DanteCode)
- Adaptive debounce and multiline guard
- Missing: telemetry, prefetch, learning, smart invalidation

---

## 3. Component Specifications

### 3.1 — Accept/Reject Telemetry (`vscode/src/completion-telemetry.ts`)

Track every completion event for learning and Model Personality Profile integration.

```typescript
/**
 * Completion telemetry — tracks accept/reject/partial-accept patterns.
 * Data is stored locally (never sent externally) and feeds into:
 *   1. Session-level stats (/cost command, session export)
 *   2. Model Personality Profiles (via DanteForge bridge)
 *   3. Accept-pattern learning (adaptive suggestions)
 *
 * Privacy: all data stays on disk in .dantecode/completion-telemetry.json.
 * No external telemetry. No cloud reporting. Local-only.
 */

export interface CompletionEvent {
  timestamp: string;
  modelId: string;
  language: string;
  filePath: string;
  completionLength: number;     // chars
  completionLines: number;      // lines
  isMultiline: boolean;
  outcome: "accepted" | "rejected" | "partial" | "expired";
  latencyMs: number;            // time from request to display
  pdseScore?: number;           // PDSE score if available
  cacheHit: boolean;            // served from cache
  contextTokens: number;        // tokens in the FIM prompt
}

export interface CompletionStats {
  totalShown: number;
  accepted: number;
  rejected: number;
  partial: number;
  expired: number;
  acceptRate: number;              // accepted / totalShown
  averageLatencyMs: number;
  cacheHitRate: number;
  byLanguage: Record<string, { shown: number; accepted: number; rate: number }>;
  byModel: Record<string, { shown: number; accepted: number; rate: number }>;
  multilineAcceptRate: number;
  singleLineAcceptRate: number;
}

export class CompletionTelemetry {
  private events: CompletionEvent[] = [];
  private storagePath: string;
  private maxEvents = 10_000;     // keep last 10K events, prune older

  constructor(projectRoot: string);

  /** Record a completion event. */
  record(event: CompletionEvent): void;

  /** Get aggregate stats. */
  getStats(): CompletionStats;

  /** Get stats filtered by model (for Model Personality Profiles). */
  getStatsByModel(modelId: string): CompletionStats;

  /** Get recent events for pattern analysis. */
  getRecent(count?: number): CompletionEvent[];

  /** Persist to disk. Call periodically (not on every event). */
  async flush(): Promise<void>;

  /** Load from disk on startup. */
  async load(): Promise<void>;

  /** Prune events older than 30 days. */
  prune(): number;

  /** Get the user's preference signal for multiline vs single-line. */
  getMultilinePreference(): "prefer-multiline" | "prefer-single" | "neutral";
}
```

**Wire into inline-completion.ts:**

After a completion is shown (in `provideInlineCompletionItems`):
```typescript
// Record that a completion was shown
telemetry.record({
  timestamp: new Date().toISOString(),
  modelId: currentModel,
  language: document.languageId,
  filePath: document.uri.fsPath,
  completionLength: completionText.length,
  completionLines: completionText.split("\n").length,
  isMultiline: completionText.includes("\n"),
  outcome: "shown",  // updated to "accepted" or "rejected" later
  latencyMs: Date.now() - requestStart,
  pdseScore,
  cacheHit: wasFromCache,
  contextTokens: promptTokens,
});
```

**Detecting accept vs reject:**

VSCode fires `vscode.window.onDidChangeTextDocument` when a completion is accepted (the text appears in the document). Register a listener that compares the inserted text against the last shown completion:

```typescript
// In the provider's constructor or activation:
vscode.workspace.onDidChangeTextDocument((event) => {
  if (lastShownCompletion && event.document === lastCompletionDocument) {
    const inserted = event.contentChanges[0]?.text ?? "";
    if (inserted === lastShownCompletion.text) {
      // Full accept
      updateLastEvent("accepted");
    } else if (inserted.length > 0 && lastShownCompletion.text.startsWith(inserted)) {
      // Partial accept (user took first part)
      updateLastEvent("partial");
    }
    // If neither, the user typed something else — "rejected" after TTL
  }
});

// Timeout-based rejection: if completion not accepted within 10s, mark as rejected
setTimeout(() => {
  if (lastEvent?.outcome === "shown") {
    updateLastEvent("rejected");
  }
}, 10_000);
```

---

### 3.2 — Smart Cache Invalidation

**File:** `packages/vscode/src/prefix-tree-cache.ts` — MODIFY

Current cache uses FIFO + TTL. Add edit-aware invalidation:

```typescript
/**
 * Invalidate cache entries for a file when the file is edited
 * above the cursor position (meaning the prefix context has changed).
 *
 * The cache key includes the prefix hash. When the file is edited
 * above the last completion position, all cache entries for that
 * file become stale because the prefix has changed.
 */

// Add to the existing cache class:

/** Track the last cursor position per file for invalidation. */
private lastCursorPositions = new Map<string, { line: number; version: number }>();

/** Called when a document changes. Invalidates affected entries. */
onDocumentChange(uri: string, changeRange: { startLine: number; endLine: number }, version: number): void {
  const lastPos = this.lastCursorPositions.get(uri);
  if (!lastPos) return;

  // If the edit is above or at the last cursor position, the prefix context changed
  if (changeRange.startLine <= lastPos.line) {
    // Invalidate all cache entries for this file
    this.invalidateFile(uri);
  }
}

/** Remove all cache entries whose key starts with the file URI. */
private invalidateFile(uri: string): void {
  const keysToRemove: string[] = [];
  for (const entry of this.entries) {
    if (entry.key.startsWith(uri)) {
      keysToRemove.push(entry.key);
    }
  }
  for (const key of keysToRemove) {
    this.remove(key);
  }
}
```

**Wire in extension.ts or inline-completion.ts:**
```typescript
vscode.workspace.onDidChangeTextDocument((event) => {
  for (const change of event.contentChanges) {
    completionCache.onDocumentChange(
      event.document.uri.toString(),
      { startLine: change.range.start.line, endLine: change.range.end.line },
      event.document.version,
    );
  }
});
```

---

### 3.3 — Completion Prefetching

**File:** `packages/vscode/src/inline-completion.ts` — ADD method to DanteCodeCompletionProvider

After a completion is accepted, immediately start generating the next likely completion at the new cursor position. This hides latency — the next suggestion is already ready when the user pauses.

```typescript
/**
 * Prefetch the next likely completion after the user accepts one.
 * Runs in background — does not block the editor. Result is
 * cached for instant display when the user triggers next completion.
 */
private async prefetchNext(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<void> {
  // Don't prefetch if user has moved to a different file
  if (token.isCancellationRequested) return;

  // Build the FIM prompt for the position AFTER the accepted completion
  const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const suffix = document.getText(new vscode.Range(position, document.positionAt(document.getText().length)));

  const input: FIMPromptInput = {
    prefix,
    suffix,
    language: document.languageId,
    filePath: document.uri.fsPath,
    crossFileContext: await gatherCrossFileContext(document),
  };

  try {
    const result = await this.generateCompletion(input, token);
    if (result && !token.isCancellationRequested) {
      // Store in cache for instant retrieval
      const cacheKey = this.buildCacheKey(document.uri.toString(), position, prefix);
      this.cache.set(cacheKey, [{
        insertText: result.text,
        range: new vscode.Range(position, position),
      }]);
    }
  } catch {
    // Prefetch failure is silent — it's speculative
  }
}
```

**Trigger after accept:**
In the `onDidChangeTextDocument` listener that detects acceptance:
```typescript
if (outcome === "accepted") {
  // Fire-and-forget prefetch
  const newPosition = new vscode.Position(
    event.contentChanges[0].range.end.line + insertedLines,
    endColumn,
  );
  this.prefetchNext(event.document, newPosition, new vscode.CancellationTokenSource().token);
}
```

---

### 3.4 — Accept-Pattern Learning

**File:** `packages/vscode/src/completion-telemetry.ts` — ADD analysis methods

Use telemetry data to adapt completion behavior:

```typescript
/**
 * Analyze accept/reject patterns and return adaptive hints.
 * These hints are consumed by the completion provider to adjust behavior.
 */
export interface CompletionAdaptiveHints {
  /** Should we bias toward multiline completions? */
  preferMultiline: boolean;
  /** Optimal debounce for this user's typing speed (ms). */
  suggestedDebounceMs: number;
  /** Languages where the user accepts most completions. */
  strongLanguages: string[];
  /** Languages where the user rarely accepts completions. */
  weakLanguages: string[];
  /** Models with highest accept rate for this user. */
  preferredModels: string[];
  /** Average accepted completion length (chars) — helps set maxTokens. */
  averageAcceptedLength: number;
}

/** Analyze telemetry and return adaptive hints. */
getAdaptiveHints(): CompletionAdaptiveHints {
  const stats = this.getStats();
  const recent = this.getRecent(500);  // last 500 events

  // Multiline preference
  const preferMultiline = stats.multilineAcceptRate > stats.singleLineAcceptRate + 0.1;

  // Debounce: analyze time between keystrokes and completion acceptance
  const acceptedEvents = recent.filter(e => e.outcome === "accepted");
  const avgLatency = acceptedEvents.length > 0
    ? acceptedEvents.reduce((s, e) => s + e.latencyMs, 0) / acceptedEvents.length
    : 180;
  // If user accepts fast, they want faster completions
  const suggestedDebounceMs = Math.max(80, Math.min(300, avgLatency * 0.6));

  // Language analysis
  const langStats = Object.entries(stats.byLanguage);
  const strongLanguages = langStats.filter(([, s]) => s.rate > 0.4).map(([l]) => l);
  const weakLanguages = langStats.filter(([, s]) => s.rate < 0.15 && s.shown > 20).map(([l]) => l);

  // Model analysis
  const modelStats = Object.entries(stats.byModel);
  const preferredModels = modelStats
    .filter(([, s]) => s.rate > 0.3)
    .sort((a, b) => b[1].rate - a[1].rate)
    .map(([m]) => m);

  // Accepted length
  const averageAcceptedLength = acceptedEvents.length > 0
    ? acceptedEvents.reduce((s, e) => s + e.completionLength, 0) / acceptedEvents.length
    : 200;

  return {
    preferMultiline,
    suggestedDebounceMs,
    strongLanguages,
    weakLanguages,
    preferredModels,
    averageAcceptedLength,
  };
}
```

**Wire into completion provider:**
On startup (or periodically), load adaptive hints and apply:
```typescript
// In DanteCodeCompletionProvider initialization:
const hints = this.telemetry.getAdaptiveHints();

// Apply hints
if (hints.suggestedDebounceMs !== this.debounceMs) {
  this.debounceMs = hints.suggestedDebounceMs;
}
if (hints.preferMultiline) {
  this.defaultMultiline = true;
}
// For weak languages, increase debounce to reduce noise
for (const lang of hints.weakLanguages) {
  this.languageDebounceOverrides.set(lang, hints.suggestedDebounceMs * 1.5);
}
```

---

## 4. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/vscode/src/completion-telemetry.ts` | 250 | Accept/reject tracking + adaptive hints |
| 2 | `packages/vscode/src/completion-telemetry.test.ts` | 150 | Telemetry tests |

### MODIFIED Files

| # | Path | Change | LOC Est. |
|---|---|---|---|
| 3 | `packages/vscode/src/inline-completion.ts` | Add prefetching, wire telemetry, apply adaptive hints | +120 |
| 4 | `packages/vscode/src/prefix-tree-cache.ts` | Add edit-aware invalidation (onDocumentChange) | +40 |
| 5 | `packages/vscode/src/extension.ts` | Initialize telemetry, wire document change listener | +20 |
| 6 | `packages/vscode/src/inline-completion.test.ts` | Add tests for prefetch + cache invalidation | +80 |

### Total: 2 new files + 4 modified, ~500 LOC source + ~250 LOC tests

---

## 5. Tests

### `completion-telemetry.test.ts` (~12 tests)
1. Record event → getStats() reflects it
2. Accept rate calculation: 5 accepted / 10 shown = 50%
3. Multiline vs single-line rate tracked separately
4. By-language breakdown correct
5. By-model breakdown correct
6. `getMultilinePreference()` returns "prefer-multiline" when multiline accept rate higher
7. `getMultilinePreference()` returns "neutral" when insufficient data
8. `getAdaptiveHints()` returns correct debounce suggestion
9. `getAdaptiveHints()` identifies strong and weak languages
10. `flush()` → `load()` roundtrip preserves events
11. `prune()` removes events older than 30 days
12. Max events cap at 10,000

### Additional tests in `inline-completion.test.ts` (~6 tests)
13. Cache invalidation: edit above cursor → cache entries removed
14. Cache invalidation: edit below cursor → cache entries preserved
15. Cache invalidation: edit in different file → no effect
16. Prefetch after accept fires (mock — verify method called)
17. Adaptive hints applied: debounce changes with telemetry data
18. Weak language gets higher debounce

**Total: ~18 tests**

---

## 6. Claude Code Execution Instructions

**Single sprint, 1.5-2.5 hours. 2 phases.**

```
Phase 1: Telemetry + Cache Invalidation (1-1.5h)
  1. Create packages/vscode/src/completion-telemetry.ts (events, stats, adaptive hints)
  2. Create packages/vscode/src/completion-telemetry.test.ts (12 tests)
  3. Modify packages/vscode/src/prefix-tree-cache.ts — add onDocumentChange invalidation
  4. Run: cd packages/vscode && npx vitest run
  GATE: All existing 71 tests + new tests pass

Phase 2: Wiring + Prefetch (0.5-1h)
  5. Modify packages/vscode/src/inline-completion.ts:
     - Import and initialize CompletionTelemetry
     - Record events on completion shown
     - Detect accept/reject via onDidChangeTextDocument
     - Add prefetchNext() method
     - Apply adaptive hints on startup
  6. Modify packages/vscode/src/extension.ts:
     - Initialize telemetry on activate
     - Wire document change listener for cache invalidation
  7. Add 6 new tests to inline-completion.test.ts
  8. Run: cd packages/vscode && npx vitest run
  GATE: All tests pass, 0 regressions on existing 71 tests
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- **ZERO regressions on existing 71 inline-completion tests**
- Telemetry data is LOCAL ONLY — never sent to any external service
- Telemetry storage path: `.dantecode/completion-telemetry.json`
- Prefetch is fire-and-forget — failure is silent, never blocks editor
- Accept detection must handle edge cases: user types over completion, user undoes, user pastes
- All telemetry operations are async and non-blocking — never delay the editor

---

## 7. Privacy Guarantee

**All completion telemetry stays on the local machine.** The data is stored in `.dantecode/completion-telemetry.json` inside the project directory. It is never sent to any server, API, or third party. The file should be added to `.gitignore` by default (it's user-specific, not project-specific).

The telemetry tracks: timestamps, model IDs, language, completion length, accept/reject outcome, latency, and cache hit rate. It does NOT store: the actual completion text, file contents, or code snippets. This means the telemetry file is safe to share for debugging without exposing source code.

---

## 8. How This Feeds Model Personality Profiles

The `getStatsByModel()` method provides per-model accept rates that feed directly into DanteForge's Model Personality Profile system:

```
CompletionTelemetry.getStatsByModel("grok/grok-3")
  → { shown: 500, accepted: 180, rate: 0.36 }
  → "Grok-3 has a 36% inline completion accept rate"

CompletionTelemetry.getStatsByModel("anthropic/claude-sonnet-4")
  → { shown: 300, accepted: 195, rate: 0.65 }
  → "Claude Sonnet has a 65% inline completion accept rate"
```

This data becomes part of the model profile's `categories.inline_completion` stats, enabling the router to select better models for FIM tasks.

---

## 9. Success Criteria

| Criteria | Target |
|---|---|
| Accept/reject events tracked locally | ✅ |
| Stats available via telemetry.getStats() | ✅ |
| Smart cache invalidation on edits above cursor | ✅ |
| Prefetch fires after completion acceptance | ✅ |
| Adaptive hints adjust debounce and multiline preference | ✅ |
| Privacy: zero external data transmission | ✅ |
| Existing 71 inline-completion tests | 0 regressions |
| All new files | PDSE ≥ 85, anti-stub clean |

---

*"The best completion is the one that's already waiting when you need it."*
