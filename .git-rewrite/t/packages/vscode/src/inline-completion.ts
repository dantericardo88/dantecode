// ============================================================================
// DanteCode VS Code Extension — Inline Completion Provider v2
// Cursor-level perceived speed with streaming FIM, balanced-brace multiline
// guard, adaptive debounce, cross-file context, and PDSE inline diagnostics.
// ============================================================================

import * as vscode from "vscode";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";
import { ModelRouterImpl, parseModelReference, FIMEngine } from "@dantecode/core";
import { runLocalPDSEScorer } from "@dantecode/danteforge";
import { gatherCrossFileContext } from "./cross-file-context.js";
import { CompletionTelemetry } from "./completion-telemetry.js";
import { recordAccept, recordPrefixPattern } from "./completion-telemetry.js";
import { PrefixTreeCache } from "./prefix-tree-cache.js";

// Module-level FIMEngine instance — used to build FIM prompts via core/fim-engine.ts
const fimEngine = new FIMEngine({ prefixLines: 60, suffixLines: 25 });

const DEFAULT_DEBOUNCE_MS = 180;
const MULTILINE_MAX_TOKENS = 512;
const SINGLE_LINE_MAX_TOKENS = 256;

/**
 * Maximum number of cached completions to retain. Older entries are evicted
 * using a simple FIFO strategy.
 */
const MAX_CACHE_SIZE = 150;

/**
 * Maximum age of a cache entry in milliseconds before it is considered stale.
 */
const CACHE_TTL_MS = 90_000;

/**
 * Maximum consecutive empty lines allowed in multiline streaming before
 * cutting off. Prevents runaway blank-line generation.
 */
const MAX_CONSECUTIVE_EMPTY_LINES = 2;

interface CacheEntry {
  key: string;
  items: vscode.InlineCompletionItem[];
  timestamp: number;
}

interface FIMPromptInput {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
  crossFileContext?: string;
}

interface FIMPromptResult {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export function resolveInlineCompletionModel(defaultModel: string, fimModel?: string): string {
  return fimModel?.trim() ? fimModel.trim() : defaultModel;
}

export function getInlineCompletionDebounceMs(provider: string, customMs?: number): number {
  if (customMs !== undefined && customMs > 0) return customMs;
  switch (provider) {
    case "ollama":
      return 100;
    case "grok":
      return 150;
    default:
      return DEFAULT_DEBOUNCE_MS;
  }
}

export function buildFIMPrompt(
  input: FIMPromptInput,
  multilineOverride?: boolean,
): FIMPromptResult {
  const isMultilineContext = shouldUseMultilineCompletion(input.prefix, input.suffix);
  const multiline = multilineOverride !== undefined ? multilineOverride : isMultilineContext;
  const prefixWindow = multiline ? input.prefix.slice(-8000) : input.prefix.slice(-5000);
  const suffixWindow = multiline
    ? input.suffix.split("\n").slice(0, 10).join("\n").slice(0, 2000)
    : input.suffix.slice(0, 1000);

  const systemParts = [
    "You are a fill-in-the-middle code completion engine.",
    `Language: ${input.language}`,
    `File: ${input.filePath}`,
  ];

  if (input.crossFileContext) {
    systemParts.push("Cross-file context:", input.crossFileContext);
  }

  systemParts.push(
    multiline
      ? "Complete the next block of code and preserve indentation."
      : "Complete the next span of code naturally at the cursor position.",
    "Return ONLY the completion text with no explanations or markdown fences.",
  );

  const userPrompt = [
    "<|fim_prefix|>",
    prefixWindow,
    "<|fim_suffix|>",
    suffixWindow,
    "<|fim_middle|>",
  ].join("");

  return {
    systemPrompt: systemParts.join("\n"),
    userPrompt,
    maxTokens: multiline ? MULTILINE_MAX_TOKENS : SINGLE_LINE_MAX_TOKENS,
  };
}

/**
 * Checks whether brackets/braces/parens are balanced in a code string.
 * Used by the multiline streaming guard to decide when to stop.
 */
export function areBracketsBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (depth < 0) return true; // closing bracket for outer scope = done
  }
  return depth <= 0;
}

/**
 * Determines whether streaming should continue for a multiline completion.
 * Stops when: brackets are balanced, two consecutive blank lines appear,
 * or the text ends with a line that looks like a scope-closing statement.
 */
export function shouldContinueStreaming(text: string): boolean {
  // Stop on double blank line
  if (text.includes("\n\n\n")) return false;

  // Count consecutive empty lines at the end
  const lines = text.split("\n");
  let emptyCount = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() === "") emptyCount++;
    else break;
  }
  if (emptyCount >= MAX_CONSECUTIVE_EMPTY_LINES) return false;

  // Check bracket balance — if balanced, stop
  if (text.length > 5 && areBracketsBalanced(text)) return false;

  return true;
}

// ─── Diagnostic Collection for Inline PDSE Warnings ───────────────────────────

let inlinePDSECollection: vscode.DiagnosticCollection | undefined;

function getInlinePDSEDiagnostics(): vscode.DiagnosticCollection {
  if (!inlinePDSECollection) {
    inlinePDSECollection = vscode.languages.createDiagnosticCollection("DanteCode Inline PDSE");
  }
  return inlinePDSECollection;
}

/**
 * Adds a PDSE warning diagnostic at the completion position when the score
 * is below threshold. The diagnostic appears as a yellow squiggly in the
 * Problems panel, giving real-time quality feedback.
 */
function addInlinePDSEDiagnostic(
  document: vscode.TextDocument,
  position: vscode.Position,
  score: number,
  reason: string,
): void {
  const collection = getInlinePDSEDiagnostics();
  const range = new vscode.Range(
    position,
    new vscode.Position(position.line, position.character + 1),
  );
  const diag = new vscode.Diagnostic(
    range,
    `PDSE ${score}/100 \u2013 ${reason}`,
    vscode.DiagnosticSeverity.Warning,
  );
  diag.source = "DanteCode Inline";
  diag.code = `PDSE ${score}`;

  // Merge with existing diagnostics for this file
  const existing = collection.get(document.uri) ?? [];
  collection.set(document.uri, [...existing, diag]);
}

/**
 * Clears inline PDSE diagnostics for a document (called on new completion
 * requests so stale warnings don't linger).
 */
function clearInlinePDSEDiagnostics(uri: vscode.Uri): void {
  inlinePDSECollection?.delete(uri);
}

/**
 * Disposes the inline PDSE diagnostic collection. Called on deactivate.
 */
export function disposeInlinePDSEDiagnostics(): void {
  inlinePDSECollection?.dispose();
  inlinePDSECollection = undefined;
}

// ─── Completion Provider ──────────────────────────────────────────────────────

/**
 * DanteCodeCompletionProvider v2 — Cursor-level inline completions.
 *
 * Key improvements over v1:
 * - Streaming with balanced-brace multiline guard
 * - Cross-file context injection for smarter completions
 * - PDSE inline diagnostics (yellow squiggly + comment annotation)
 * - Configurable debounce with adaptive fast-typing detection
 * - Smart stop on double blank lines, balanced brackets, scope exits
 * - Completion telemetry (local-only, no external calls)
 * - Smart cache invalidation on edits above cursor
 * - Post-accept prefetching for reduced latency
 * - Adaptive hints from telemetry (debounce, multiline preference)
 */
export class DanteCodeCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache: CacheEntry[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRequestId = 0;
  private lastKeystrokeTimes: number[] = [];

  // ── B2: Smart cache invalidation ────────────────────────────────────────
  /** The position at which the most recent completion was requested. */
  private _lastRequestPosition: vscode.Position | undefined;
  /** URI of the document for which _lastRequestPosition was recorded. */
  private _lastRequestUri: string | undefined;

  // ── B3: Prefetch support ─────────────────────────────────────────────────
  private _prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  private _prefetchCache = new Map<
    string,
    { items: vscode.InlineCompletionItem[]; expiresAt: number }
  >();

  /** Trie cache used for edit-aware invalidation. Exposed for extension.ts wiring. */
  readonly completionCache: PrefixTreeCache = new PrefixTreeCache(MAX_CACHE_SIZE);

  /** Local-only completion telemetry tracker. */
  private readonly telemetry: CompletionTelemetry;

  /** Adaptive debounce override applied from telemetry hints (ms). */
  debounceMs: number = DEFAULT_DEBOUNCE_MS;

  /** Whether to default to multiline completions based on telemetry preference. */
  defaultMultiline: boolean = false;

  /** Per-language debounce overrides for weak languages (from adaptive hints). */
  readonly languageDebounceOverrides: Map<string, number> = new Map();

  /** Last shown completion reference for accept-detection. */
  private lastShownCompletion: { text: string; document: vscode.TextDocument } | undefined;

  /** Index into telemetry.getRecent() for the last recorded event. */
  private lastEventIndex = -1;

  constructor() {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    this.telemetry = new CompletionTelemetry(projectRoot);
    // Load telemetry and apply adaptive hints — fully non-blocking
    void this.telemetry.load().then(() => {
      this._applyAdaptiveHints();
    });
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const requestId = ++this.lastRequestId;

    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const suffix = document.getText(
      new vscode.Range(
        position,
        new vscode.Position(document.lineCount - 1, Number.MAX_SAFE_INTEGER),
      ),
    );
    const language = document.languageId;
    const filePath = document.uri.fsPath;
    const config = vscode.workspace.getConfiguration("dantecode");
    const selectedModel = resolveInlineCompletionModel(
      config.get<string>("defaultModel", "grok/grok-3"),
      config.get<string>("fimModel"),
    );
    const [provider] = parseModelString(selectedModel);
    const customDebounce = config.get<number>("inline.debounceMs", 0);
    const baseDebounceMs = getInlineCompletionDebounceMs(provider, customDebounce);

    // Apply per-language debounce override for weak languages
    const langOverride = this.languageDebounceOverrides.get(language);
    const effectiveBase = langOverride ?? baseDebounceMs;

    // Adaptive debounce: reduce delay when typing quickly
    const now = Date.now();
    this.lastKeystrokeTimes.push(now);
    if (this.lastKeystrokeTimes.length > 5) {
      this.lastKeystrokeTimes = this.lastKeystrokeTimes.slice(-5);
    }
    const adaptiveEnabled = config.get<boolean>("debounceAdaptive", true);
    let debounceMs = effectiveBase;
    if (adaptiveEnabled && this.lastKeystrokeTimes.length >= 3) {
      const oldest = this.lastKeystrokeTimes[0]!;
      const elapsed = (now - oldest) / 1000;
      const charsPerSec = this.lastKeystrokeTimes.length / elapsed;
      // Graduated adaptive curve: faster typing => lower debounce (floor 80ms)
      if (charsPerSec > 5) {
        debounceMs = Math.max(80, effectiveBase - 100);
      } else if (charsPerSec > 3) {
        debounceMs = Math.max(80, effectiveBase - 80);
      }
    }

    // Update cursor position for smart cache invalidation
    this.completionCache.updateCursorPosition(document.uri.toString(), position.line);

    // ── B2: Track last request position for cache invalidation ──────────────
    this._lastRequestPosition = position;
    this._lastRequestUri = document.uri.toString();

    // Build a cache key from last 3 lines before cursor + suffix head
    const prefixLines = prefix.split("\n");
    const last3Lines = prefixLines.slice(-3).join("\n");
    const suffixHead = suffix.slice(0, 100);
    const cacheKey = `${selectedModel}:${language}:${position.line}:${last3Lines}:${suffixHead}`;

    // ── B3: Check prefetch cache first ───────────────────────────────────────
    const prefetchKey = `prefetch:${document.uri.toString()}:${position.line}`;
    const prefetched = this._prefetchCache.get(prefetchKey);
    if (prefetched && prefetched.expiresAt > Date.now()) {
      this._prefetchCache.delete(prefetchKey);
      return prefetched.items;
    }

    const cached = this.lookupCache(cacheKey);
    if (cached) {
      return cached;
    }

    const requestStart = Date.now();

    const completions = await new Promise<vscode.InlineCompletionItem[]>((resolve) => {
      if (this.debounceTimer !== undefined) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(async () => {
        if (requestId !== this.lastRequestId) {
          resolve([]);
          return;
        }

        if (token.isCancellationRequested) {
          resolve([]);
          return;
        }

        try {
          const items = await this.fetchCompletions(
            prefix,
            suffix,
            language,
            filePath,
            position,
            document,
            token,
          );
          resolve(items);
        } catch {
          resolve([]);
        }
      }, debounceMs);
    });

    if (completions.length > 0) {
      this.storeCache(cacheKey, completions);

      // Record telemetry — outcome starts as "rejected", updated on accept detection
      const item = completions[0];
      const completionText =
        item !== undefined && "insertText" in item ? String(item.insertText) : "";
      const latencyMs = Date.now() - requestStart;
      const isMultiline = completionText.includes("\n");
      this.telemetry.record({
        timestamp: new Date().toISOString(),
        modelId: selectedModel,
        language,
        filePath,
        completionLength: completionText.length,
        completionLines: completionText.split("\n").length,
        isMultiline,
        outcome: "rejected",
        latencyMs,
        cacheHit: false,
        contextTokens: 0,
      });
      this.lastEventIndex = this.telemetry.getRecent().length - 1;
      this.lastShownCompletion = { text: completionText, document };
    }

    // ── B3: Schedule background prefetch for next line ───────────────────────
    this._schedulePrefetch(document, position);

    return completions;
  }

  /**
   * Handles a document change event for smart cache invalidation (B2).
   * If an edit occurred at or above the last cursor position where a
   * completion was requested, the cache entry for that document is cleared.
   */
  invalidateCacheForEdit(
    document: vscode.TextDocument,
    changes: readonly vscode.TextDocumentContentChangeEvent[],
  ): void {
    if (!this._lastRequestPosition || this._lastRequestUri !== document.uri.toString()) {
      return;
    }
    for (const change of changes) {
      if (change.range.end.line <= this._lastRequestPosition.line) {
        const uriStr = document.uri.toString();
        for (let i = this.cache.length - 1; i >= 0; i--) {
          const entry = this.cache[i]!;
          if (entry.key.includes(`:${this._lastRequestPosition.line}:`)) {
            this.cache.splice(i, 1);
          }
        }
        for (const key of this._prefetchCache.keys()) {
          if (key.startsWith(`prefetch:${uriStr}:`)) {
            this._prefetchCache.delete(key);
          }
        }
        break;
      }
    }
  }

  /**
   * Schedules a background prefetch for the next line after `position` (B3).
   * The prefetch fires after 500ms of idle time. Results are cached for 2s.
   */
  private _schedulePrefetch(document: vscode.TextDocument, position: vscode.Position): void {
    if (this._prefetchTimer !== undefined) {
      clearTimeout(this._prefetchTimer);
    }
    this._prefetchTimer = setTimeout(async () => {
      const nextPos = new vscode.Position(position.line + 1, 0);
      if (nextPos.line < document.lineCount) {
        const cacheKey = `prefetch:${document.uri.toString()}:${nextPos.line}`;
        try {
          const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), nextPos));
          const suffix = document.getText(
            new vscode.Range(
              nextPos,
              new vscode.Position(document.lineCount - 1, Number.MAX_SAFE_INTEGER),
            ),
          );
          const items = await this._generateCompletions(document, nextPos, prefix, suffix);
          this._prefetchCache.set(cacheKey, { items, expiresAt: Date.now() + 2000 });
        } catch {
          /* prefetch failure is silent */
        }
      }
    }, 500);
  }

  /**
   * Internal helper used by prefetch to generate completions without
   * going through the debounce/cache machinery (B3).
   */
  private async _generateCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    prefix: string,
    suffix: string,
  ): Promise<vscode.InlineCompletionItem[]> {
    const fakeToken: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
    return this.fetchCompletions(
      prefix,
      suffix,
      document.languageId,
      document.uri.fsPath,
      position,
      document,
      fakeToken,
    );
  }

  /**
   * Handle a document change event for accept detection and cache invalidation.
   * Called from the onDidChangeTextDocument listener wired in extension.ts.
   */
  handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (
      this.lastShownCompletion === undefined ||
      event.document !== this.lastShownCompletion.document ||
      event.contentChanges.length === 0
    ) {
      return;
    }

    const inserted = event.contentChanges[0]?.text ?? "";
    const shown = this.lastShownCompletion.text;

    if (inserted === shown) {
      // Full accept
      this._updateLastEventOutcome("accepted");

      // Fire-and-forget prefetch at the new cursor position
      const change = event.contentChanges[0]!;
      const insertedLines = inserted.split("\n").length - 1;
      const lastLineContent = inserted.includes("\n") ? inserted.split("\n").pop()! : "";
      const newLine = change.range.start.line + insertedLines;
      const newChar = inserted.includes("\n") ? lastLineContent.length : inserted.length;
      const newPosition = new vscode.Position(newLine, newChar);
      const cts = new vscode.CancellationTokenSource();
      void this.prefetchNext(event.document, newPosition, cts.token);
    } else if (inserted.length > 0 && shown.startsWith(inserted)) {
      // Partial accept
      this._updateLastEventOutcome("partial");
    }

    this.lastShownCompletion = undefined;
  }

  /**
   * Prefetch the next likely completion after the user accepts one.
   * Runs in background — failure is silent, never blocks the editor.
   */
  async prefetchNext(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (token.isCancellationRequested) return;

    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const suffix = document.getText(
      new vscode.Range(
        position,
        new vscode.Position(document.lineCount - 1, Number.MAX_SAFE_INTEGER),
      ),
    );
    const language = document.languageId;
    const filePath = document.uri.fsPath;

    try {
      const items = await this.fetchCompletions(
        prefix,
        suffix,
        language,
        filePath,
        position,
        document,
        token,
      );
      if (items.length > 0 && !token.isCancellationRequested) {
        const config = vscode.workspace.getConfiguration("dantecode");
        const modelString = resolveInlineCompletionModel(
          config.get<string>("defaultModel", "grok/grok-3"),
          config.get<string>("fimModel"),
        );
        const prefixLines = prefix.split("\n");
        const last3Lines = prefixLines.slice(-3).join("\n");
        const suffixHead = suffix.slice(0, 100);
        const cacheKey = `${modelString}:${language}:${position.line}:${last3Lines}:${suffixHead}`;
        this.storeCache(cacheKey, items);
      }
    } catch {
      // Prefetch failure is silent — it is speculative
    }
  }

  /**
   * Fetches completion text from the model router with streaming, cross-file
   * context, balanced-brace multiline guard, and PDSE inline diagnostics.
   */
  private async fetchCompletions(
    prefix: string,
    suffix: string,
    language: string,
    filePath: string,
    position: vscode.Position,
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const config = vscode.workspace.getConfiguration("dantecode");
    const modelString = resolveInlineCompletionModel(
      config.get<string>("defaultModel", "grok/grok-3"),
      config.get<string>("fimModel"),
    );
    const pdseThreshold = config.get<number>("pdseThreshold", 85);
    const pdseWarnings = config.get<boolean>("inline.pdseWarnings", true);

    // Resolve multi-line completion mode
    const multilineConfig =
      config.get<string>("inline.multiline") ?? config.get<string>("multilineCompletions", "auto");
    const isMultilineContext = shouldUseMultilineCompletion(prefix, suffix);
    const isMultiline =
      multilineConfig === "always" ||
      (multilineConfig === "auto" && (isMultilineContext || this.defaultMultiline));

    const [provider, modelId] = parseModelString(modelString);

    // Gather cross-file context (non-blocking, best-effort)
    let crossFileContext = "";
    try {
      const openEditors = vscode.window.visibleTextEditors
        .map((e) => e.document.uri.fsPath)
        .filter((p) => p !== filePath);
      crossFileContext = await gatherCrossFileContext({
        currentFilePath: filePath,
        openFilePaths: openEditors,
        maxTokenBudget: 1000,
        readFile: async (p) => {
          const doc = await vscode.workspace.openTextDocument(p);
          return doc.getText();
        },
      });
    } catch {
      // Cross-file context is best-effort
    }

    // Build FIM context and prompt via core FIMEngine (replaces local buildFIMPrompt).
    // FIMEngine.buildContext() slices prefix/suffix lines, detects language from filePath.
    // We inject crossFileContext as memoryContext and use "generic" format so the router
    // receives a clean prefix/suffix/FIM-token prompt without model-specific encoding.
    const fimCtx = fimEngine.buildContext(filePath, prefix + suffix, prefix.length);
    if (crossFileContext) {
      (fimCtx as { memoryContext?: string }).memoryContext = crossFileContext;
    }
    const fimPromptRaw = fimEngine.buildPrompt(fimCtx, "generic");
    // Adapt FIMPrompt (single prompt string) => FIMPromptResult shape used by streamCompletion.
    const fimPrompt: FIMPromptResult = {
      systemPrompt: [
        "You are a fill-in-the-middle code completion engine.",
        `Language: ${language}`,
        `File: ${filePath}`,
        ...(crossFileContext ? ["Cross-file context:", crossFileContext] : []),
        isMultiline
          ? "Complete the next block of code and preserve indentation."
          : "Complete the next span of code naturally at the cursor position.",
        "Return ONLY the completion text with no explanations or markdown fences.",
      ].join("\n"),
      userPrompt: fimPromptRaw.prompt,
      maxTokens: isMultiline ? MULTILINE_MAX_TOKENS : SINGLE_LINE_MAX_TOKENS,
    };

    const modelConfig: ModelConfig = {
      provider: provider as ModelConfig["provider"],
      modelId,
      maxTokens: fimPrompt.maxTokens,
      temperature: 0.1,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: false,
    };

    const routerConfig: ModelRouterConfig = {
      default: modelConfig,
      fallback: [],
      overrides: {},
    };

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const projectRoot = workspaceFolders?.[0]?.uri.fsPath ?? "";

    const router = new ModelRouterImpl(routerConfig, projectRoot, "inline-completion");

    if (token.isCancellationRequested) return [];

    const abortController = new AbortController();
    const cancelDisposable = token.onCancellationRequested(() => {
      abortController.abort();
    });

    let completionText: string;

    try {
      completionText = await this.streamCompletion(
        router,
        fimPrompt,
        isMultiline,
        abortController.signal,
      );
    } catch {
      if (token.isCancellationRequested) {
        cancelDisposable.dispose();
        return [];
      }
      completionText = await router.generate([{ role: "user", content: fimPrompt.userPrompt }], {
        system: fimPrompt.systemPrompt,
        maxTokens: fimPrompt.maxTokens,
      });
    } finally {
      cancelDisposable.dispose();
    }

    if (token.isCancellationRequested) return [];

    const cleaned = cleanCompletionText(completionText);
    if (cleaned.length === 0) return [];

    // Clear stale inline PDSE diagnostics for this document
    clearInlinePDSEDiagnostics(document.uri);

    // Run PDSE scoring
    const fullCode = prefix + cleaned + suffix;
    let gateLabel = "";
    let pdseScore: number | undefined;
    let pdseReason = "";
    try {
      const score = runLocalPDSEScorer(fullCode, projectRoot);
      pdseScore = score.overall;
      const passLabel = score.overall >= pdseThreshold ? "PASS" : "WARN";
      gateLabel = ` [PDSE: ${score.overall} ${passLabel}]`;

      if (score.overall < pdseThreshold) {
        pdseReason =
          score.violations.length > 0 ? score.violations[0]!.message : "below quality threshold";
      }
    } catch {
      gateLabel = "";
    }

    // Build the completion text -- append PDSE warning comment for low scores
    let insertText = cleaned;
    if (pdseWarnings && pdseScore !== undefined && pdseScore < pdseThreshold) {
      insertText += `\n// PDSE ${pdseScore}/100 \u2013 ${pdseReason}`;
      addInlinePDSEDiagnostic(document, position, pdseScore, pdseReason);
    }

    const item = new vscode.InlineCompletionItem(insertText, new vscode.Range(position, position));

    // Attach PDSE gate info and confidence marker as filter text
    const confidenceMarker = cleaned.length < 10 ? " [?]" : "";
    item.filterText = `dantecode${gateLabel}${confidenceMarker}`;

    // ── B4: Telemetry wiring ─────────────────────────────────────────────────
    const completionId = `${filePath}:${position.line}:${position.character}:${cleaned.length}`;
    recordPrefixPattern(prefix);
    (
      item as vscode.InlineCompletionItem & {
        command?: { command: string; title: string; arguments?: unknown[] };
      }
    ).command = {
      command: "dantecode._recordCompletionAccept",
      title: "Record completion accept",
      arguments: [completionId],
    };
    DanteCodeCompletionProvider._pendingAcceptIds.set(completionId, true);

    return [item];
  }

  /** B4: Pending accept IDs — maps completion IDs awaiting user accept gesture. */
  static readonly _pendingAcceptIds = new Map<string, boolean>();

  /**
   * Called by the VS Code command `dantecode._recordCompletionAccept` when
   * a user accepts an inline completion item (B4).
   */
  static recordCompletionAccept(completionId: string): void {
    if (DanteCodeCompletionProvider._pendingAcceptIds.has(completionId)) {
      recordAccept(completionId);
      DanteCodeCompletionProvider._pendingAcceptIds.delete(completionId);
    }
  }

  /**
   * Streams a completion from the model router with intelligent stop logic.
   *
   * Single-line: stops at first newline.
   * Multi-line: uses balanced-brace guard, double-blank-line detection,
   * and scope-exit heuristics to know when to stop streaming.
   */
  private async streamCompletion(
    router: ModelRouterImpl,
    fimPrompt: FIMPromptResult,
    isMultiline: boolean,
    abortSignal: AbortSignal,
  ): Promise<string> {
    const result = await router.stream([{ role: "user", content: fimPrompt.userPrompt }], {
      system: fimPrompt.systemPrompt,
      maxTokens: fimPrompt.maxTokens,
      abortSignal,
    });

    let text = "";
    const streamStart = Date.now();
    let firstChunkLogged = false;

    for await (const chunk of result.textStream) {
      text += chunk;

      if (!firstChunkLogged) {
        firstChunkLogged = true;
        const latencyMs = Date.now() - streamStart;
        if (latencyMs > 200) {
          console.log(`[DanteCode] First chunk latency: ${latencyMs}ms (target <150ms)`);
        }
      }

      // Single-line: stop at first newline
      if (!isMultiline && text.includes("\n")) {
        text = text.split("\n")[0]!;
        break;
      }

      // Multiline: use smart streaming guard
      if (isMultiline && text.length > 5 && !shouldContinueStreaming(text)) {
        break;
      }
    }

    return text;
  }

  private lookupCache(key: string): vscode.InlineCompletionItem[] | undefined {
    const now = Date.now();
    const index = this.cache.findIndex((entry) => entry.key === key);
    if (index === -1) return undefined;

    const entry = this.cache[index]!;
    if (now - entry.timestamp > CACHE_TTL_MS) {
      this.cache.splice(index, 1);
      return undefined;
    }

    return entry.items;
  }

  private storeCache(key: string, items: vscode.InlineCompletionItem[]): void {
    const existingIndex = this.cache.findIndex((entry) => entry.key === key);
    if (existingIndex !== -1) {
      this.cache.splice(existingIndex, 1);
    }
    while (this.cache.length >= MAX_CACHE_SIZE) {
      this.cache.shift();
    }
    this.cache.push({ key, items, timestamp: Date.now() });
  }

  clearCache(): void {
    this.cache.length = 0;
    this.completionCache.clear();
  }

  /** Apply adaptive hints derived from accumulated telemetry data. */
  private _applyAdaptiveHints(): void {
    const hints = this.telemetry.getAdaptiveHints();

    if (hints.suggestedDebounceMs !== this.debounceMs) {
      this.debounceMs = hints.suggestedDebounceMs;
    }
    if (hints.preferMultiline) {
      this.defaultMultiline = true;
    }
    for (const lang of hints.weakLanguages) {
      this.languageDebounceOverrides.set(lang, hints.suggestedDebounceMs * 1.5);
    }
  }

  /** Update the outcome of the last recorded telemetry event. */
  private _updateLastEventOutcome(outcome: "accepted" | "partial"): void {
    const recent = this.telemetry.getRecent();
    if (this.lastEventIndex >= 0 && this.lastEventIndex < recent.length) {
      const original = recent[this.lastEventIndex];
      if (original !== undefined) {
        // Record a corrected event to represent the true outcome
        this.telemetry.record({ ...original, outcome });
        this.lastEventIndex = -1;
      }
    }
  }
}

export function shouldUseMultilineCompletion(prefix: string, suffix: string): boolean {
  const trimmedPrefix = prefix.trimEnd();
  if (trimmedPrefix.length === 0) return false;

  if (/[{[(]$/.test(trimmedPrefix) || /=>\s*$/.test(trimmedPrefix) || /:\s*$/.test(trimmedPrefix)) {
    return true;
  }

  const prefixLines = prefix.split("\n");
  const currentLine = prefixLines[prefixLines.length - 1] ?? "";
  const currentIndent = currentLine.match(/^\s*/)?.[0].length ?? 0;
  const suffixLines = suffix.split("\n").slice(0, 10);

  if (suffixLines.length > 1) {
    const nextMeaningfulLine = suffixLines.find((line) => line.trim().length > 0) ?? "";
    const nextIndent = nextMeaningfulLine.match(/^\s*/)?.[0].length ?? 0;
    if (nextIndent > currentIndent || nextMeaningfulLine.trim().startsWith("}")) {
      return true;
    }
  }

  return false;
}

function parseModelString(model: string): [string, string] {
  const parsed = parseModelReference(model);
  return [parsed.provider, parsed.modelId];
}

function cleanCompletionText(text: string): string {
  let cleaned = text;

  const fenceMatch = cleaned.match(/^```\w*\n([\s\S]*?)```\s*$/);
  if (fenceMatch?.[1] !== undefined) {
    cleaned = fenceMatch[1];
  }

  cleaned = cleaned.replace(/^`{3}\w*\n?/, "").replace(/\n?`{3}\s*$/, "");
  cleaned = cleaned.replace(/\s+$/, "");

  return cleaned;
}
