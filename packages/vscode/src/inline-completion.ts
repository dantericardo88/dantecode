// ============================================================================
// DanteCode VS Code Extension — Inline Completion Provider v3
// FIM 5.5 → 9.0: PrefixTreeCache, token-budget pruning, BM25 context,
// recently-edited injection, multi-model fallback, acceptance telemetry.
// ============================================================================

import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";
import { ModelRouterImpl, parseModelReference } from "@dantecode/core";
import type { CompletionTelemetryService } from "@dantecode/core";
import { runLocalPDSEScorer } from "@dantecode/danteforge";
import { gatherCrossFileContext } from "./cross-file-context.js";
import { PrefixTreeCache } from "./prefix-tree-cache.js";
import type { CompletionAcceptanceTracker } from "./completion-acceptance-tracker.js";
import type { CompletionContextRetriever } from "./completion-context-retriever.js";
import type { FimModelRouter } from "./fim-model-router.js";
import type { FimLatencyTracker } from "./fim-latency-tracker.js";
import type { NextEditPredictor, NextEditPrediction } from "./next-edit-predictor.js";
import type { CodebaseIndexManager } from "./codebase-index-manager.js";
import { SymbolDefinitionLookup } from "@dantecode/codebase-index";
import { parseUdiffResponse } from "./udiff-parser.js";
import { globalEmitterRegistry, DEFAULT_FIRST_LINE_TIMEOUT_MS } from "./completion-streaming-emitter.js";
import { StopSequenceDetector, BracketBalanceDetector } from "./completion-stop-sequences.js";
import { FimContextBudget } from "./fim-context-budget.js";
import { globalInteractionCache } from "./file-interaction-cache.js";
import type { LspDiagnosticsInjector } from "./lsp-diagnostics-injector.js";
import { getFIMTemplate, buildFIMPromptForModel } from "./fim-templates.js";
import type { FimRankingContext } from "@dantecode/core";
// rankCandidates is imported lazily to avoid failures in test environments
// where @dantecode/core is partially mocked.
let _rankCandidatesImpl: ((candidates: string[], ctx: FimRankingContext) => Array<{ text: string; score: number }>) | undefined;
async function getRankCandidates() {
  if (!_rankCandidatesImpl) {
    try {
      const mod = await import("@dantecode/core");
      _rankCandidatesImpl = (mod as Record<string, unknown>).rankCandidates as typeof _rankCandidatesImpl;
    } catch {
      // non-fatal in test environments
    }
  }
  return _rankCandidatesImpl;
}

/** TTL for ML-backed prediction cache entries (shorter than heuristic 5s). */
const ML_PREDICTION_CACHE_TTL_MS = 2_000;
/** TTL for heuristic prediction cache entries. */
const HEURISTIC_PREDICTION_CACHE_TTL_MS = 5_000;

const DEFAULT_DEBOUNCE_MS = 120;
const MULTILINE_MAX_TOKENS = 512;
const SINGLE_LINE_MAX_TOKENS = 256;
const DEFAULT_CONTEXT_WINDOW = 131_072;
const MIN_PREFIX_CHARS = 500; // never prune below this

/**
 * Maximum number of cached completions to retain (FIFO eviction).
 */
const MAX_CACHE_SIZE = 150;

/**
 * Maximum age of a cache entry in milliseconds before it is considered stale.
 */
const CACHE_TTL_MS = 90_000;

/**
 * Maximum consecutive empty lines allowed in multiline streaming.
 */
const MAX_CONSECUTIVE_EMPTY_LINES = 2;

/**
 * Key length for PrefixTreeCache lookups — last N chars of prefix (normalised).
 */
const PREFIX_TREE_KEY_LEN = 200;

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
  bm25Snippets?: string[];
  /** Compact PageRank repo map (top N files + symbols). Injected before cross-file context. */
  repoMap?: string;
  /** Symbol definition snippet for the symbol at the cursor call site. */
  symbolDef?: string;
  /** Type signature and documentation from the LSP hover provider. Capped at ~300 tokens. */
  lspHover?: string;
  /** Definition source (±15 lines) from executeDefinitionProvider. Only injected when cursor follows '.' or '('. */
  lspDefinition?: string;
  /** Active LSP diagnostics (errors/warnings) formatted for model context. Capped at lsp budget. */
  lspDiagnostics?: string;
  /** Total line count of the full file (prefix + suffix). Informational — caller computes this. */
  totalLineCount?: number;
  /**
   * When true, instructs the model to output a unified diff instead of raw completion text.
   * Set by the provider when dantecode.diffMode==="auto"|"unified" AND totalLineCount > 300.
   */
  useUnifiedDiff?: boolean;
  /** Model context window in tokens (drives dynamic prefix/suffix sizing). */
  contextWindow?: number;
  /** Max completion tokens (used to compute context budget). */
  maxCompletionTokens?: number;
}

interface FIMPromptResult {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export interface CompletionProviderOptions {
  acceptanceTracker?: CompletionAcceptanceTracker;
  telemetry?: CompletionTelemetryService;
  contextRetriever?: CompletionContextRetriever;
  fimModelRouter?: FimModelRouter;
  latencyTracker?: FimLatencyTracker;
  nextEditPredictor?: NextEditPredictor;
  codebaseIndexManager?: CodebaseIndexManager;
  lspInjector?: LspDiagnosticsInjector;
}

// ── Token-budget pruning ──────────────────────────────────────────────────────

/**
 * Computes token budgets for prefix and suffix based on the model's context
 * window. Uses FimContextBudget (Tabby-harvested) for principled multi-slot
 * allocation: prefix 60%, suffix 15%, LSP 10%, RAG 10%, cross-file 5%.
 *
 * @returns { prefixTokens, suffixTokens, prefixChars, suffixChars }
 */
export function computeContextBudget(
  contextWindow: number,
  maxCompletionTokens: number,
): { prefixTokens: number; suffixTokens: number; prefixChars: number; suffixChars: number } {
  const budget = FimContextBudget.forContextWindow(contextWindow, maxCompletionTokens);
  const prefixTokens = budget.slots.prefix;
  const suffixTokens = budget.slots.suffix;
  return {
    prefixTokens,
    suffixTokens,
    prefixChars: Math.max(MIN_PREFIX_CHARS, prefixTokens * 4),
    suffixChars: suffixTokens * 4,
  };
}

/**
 * Prune `text` to `maxChars` by dropping from the TOP (oldest lines).
 * Preserves the lines nearest to the cursor.
 */
export function pruneFromTop(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

/**
 * Prune `text` to `maxChars` by dropping from the BOTTOM (furthest lines).
 * Preserves the lines nearest to the cursor.
 */
export function pruneFromBottom(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function resolveInlineCompletionModel(defaultModel: string, fimModel?: string): string {
  return fimModel?.trim() ? fimModel.trim() : defaultModel;
}

// ── Sprint C: Ollama native FIM routing ───────────────────────────────────────

/** Models known to support native FIM token format via Ollama /api/generate. */
const OLLAMA_FIM_PATTERNS = ["deepseek-coder", "starcoder", "codellama", "qwen"] as const;

/**
 * Returns true when the modelId (without provider prefix) is a known Ollama
 * FIM-capable model that supports native `<fim_prefix>/<fim_suffix>/<fim_middle>`
 * or equivalent token formats.
 */
export function isOllamaFimModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return OLLAMA_FIM_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Send a native FIM completion request to Ollama's `/api/generate` endpoint.
 * Uses the model-specific FIM token format from `buildFIMPromptForModel`.
 * Streams the response and concatenates all tokens.
 *
 * This bypasses the chat API entirely — Ollama handles the FIM tokens natively,
 * reducing latency by ~40-60ms vs the chat-format path.
 *
 * @param ollamaBaseUrl - e.g. "http://localhost:11434"
 * @param modelId       - e.g. "deepseek-coder:6.7b" (without "ollama/" prefix)
 * @param prefix        - Code before the cursor.
 * @param suffix        - Code after the cursor.
 * @param maxTokens     - Maximum tokens to generate.
 * @param signal        - AbortSignal for cancellation.
 * @param fetchFn       - Injected fetch for testability.
 */
export async function ollamaFimGenerate(
  ollamaBaseUrl: string,
  modelId: string,
  prefix: string,
  suffix: string,
  maxTokens: number,
  signal?: AbortSignal,
  fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<string> {
  const fimPrompt = buildFIMPromptForModel("ollama", modelId, { prefix, suffix });

  const response = await fetchFn(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: modelId,
      prompt: fimPrompt.prompt,
      stream: true,
      options: {
        num_predict: maxTokens,
        stop: fimPrompt.stop,
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama FIM request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams NDJSON — each line is a JSON object
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { response?: string; done?: boolean };
          if (parsed.response) accumulated += parsed.response;
          if (parsed.done) break;
        } catch {
          // Partial line — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Strip any trailing FIM tokens the model may emit
  const template = getFIMTemplate("ollama", modelId);
  for (const tok of [template.prefix, template.suffix, template.middle, "<|endoftext|>"]) {
    const idx = accumulated.indexOf(tok);
    if (idx !== -1) {
      accumulated = accumulated.slice(0, idx);
    }
  }

  return accumulated;
}

export function getInlineCompletionDebounceMs(provider: string, customMs?: number): number {
  if (customMs !== undefined && customMs > 0) return customMs;
  switch (provider) {
    case "ollama":
      return 100;
    case "grok":
      return 150;
    case "openai":
    case "anthropic":
      return 180;
    default:
      return DEFAULT_DEBOUNCE_MS;
  }
}

/**
 * Returns a debounce adjustment (positive = increase) based on acceptance rate (dim 1).
 * Low acceptance → longer debounce (reduce noise). High acceptance → shorter (user values completions).
 *
 * @param acceptanceRate - 0.0–1.0 ratio of accepted / shown completions
 * @returns ms to add (positive) or subtract (negative) from base debounce
 */
export function getAcceptanceRateDebounceAdjustment(acceptanceRate: number): number {
  // < 20%: slow down — completions are too noisy
  if (acceptanceRate < 0.2) return 80;
  // 20–40%: mildly slow down
  if (acceptanceRate < 0.4) return 40;
  // 40–60%: neutral
  if (acceptanceRate < 0.6) return 0;
  // 60–80%: speed up slightly — user values completions
  if (acceptanceRate < 0.8) return -20;
  // >80%: aggressive speed-up
  return -40;
}

/**
 * Logs the current FIM acceptance rate to the output channel (dim 1).
 * Called periodically or on meaningful state changes.
 */
export function logAcceptanceRateToChannel(
  acceptanceRate: number,
  totalViewed: number,
  totalAccepted: number,
  outputChannel: { appendLine(msg: string): void },
): void {
  const pct = (acceptanceRate * 100).toFixed(1);
  outputChannel.appendLine(
    `[FIM acceptance] Rate=${pct}% (${totalAccepted}/${totalViewed} accepted) — debounce adj: ${getAcceptanceRateDebounceAdjustment(acceptanceRate) >= 0 ? "+" : ""}${getAcceptanceRateDebounceAdjustment(acceptanceRate)}ms`,
  );
}

/**
 * Returns how many ms to subtract from debounce when the last typed character
 * is a token boundary (space, punctuation, bracket). At token boundaries the
 * model has a natural completion point so we can fire sooner.
 *
 * @returns ms reduction (0 when char is not a token boundary)
 */
export function getTokenBoundaryDebounceReduction(lastChar: string): number {
  if (!lastChar || lastChar.length === 0) return 0;
  const ch = lastChar[lastChar.length - 1]!;
  // High-priority boundary: whitespace or opening bracket — model has clean start
  if (ch === " " || ch === "\t" || ch === "(" || ch === "{" || ch === "[") return 60;
  // Medium-priority: punctuation that completes an expression
  if (ch === "." || ch === "," || ch === ";" || ch === ":" || ch === ">" || ch === "!") return 40;
  // Closing bracket — block complete, good time for next-line completion
  if (ch === ")" || ch === "}" || ch === "]") return 50;
  return 0;
}

// ─── Import Re-injection (Pattern C: Tabby/Continue.dev) ───────────────────

/**
 * Extract import/require/use/include lines from a prefix string.
 * These are re-injected after token-budget pruning removes them from the top.
 * Supports 18 language families via language-specific patterns.
 */
export function extractImportLines(prefix: string, language: string): string[] {
  const lang = language.toLowerCase();
  const lines = prefix.split(/\r?\n/);
  let pattern: RegExp;

  if (["javascript", "typescript", "jsx", "tsx", "js", "ts"].includes(lang)) {
    pattern = /^\s*(import\s|export\s+\{|const\s+\w+\s*=\s*require\s*\()/;
  } else if (["python", "py"].includes(lang)) {
    pattern = /^\s*(import\s|from\s+\S+\s+import)/;
  } else if (["go"].includes(lang)) {
    pattern = /^\s*(import\s|package\s)/;
  } else if (["rust", "rs"].includes(lang)) {
    pattern = /^\s*(use\s|extern\s+crate)/;
  } else if (["java", "kotlin", "kt"].includes(lang)) {
    pattern = /^\s*import\s/;
  } else if (["c", "cpp", "c++", "cc", "cxx"].includes(lang)) {
    pattern = /^\s*#\s*(include|import)/;
  } else if (["ruby", "rb"].includes(lang)) {
    pattern = /^\s*(require|require_relative|include)\s/;
  } else if (["php"].includes(lang)) {
    pattern = /^\s*(use\s|require|include)/;
  } else {
    pattern = /^\s*(import\s|from\s+\S+\s+import|#include|require\s*[('"`@])/;
  }

  return lines
    .filter((l) => pattern.test(l))
    .slice(0, 30); // cap at 30 import lines
}
/** Append every available LSP / BM25 / repo-map context block onto `systemParts`. */
function appendOptionalContextBlocks(systemParts: string[], input: FIMPromptInput): void {
  if (input.symbolDef) systemParts.push("## Symbol definition:", input.symbolDef);
  // LSP hover capped at 1050 chars (~300 tokens) — pruned first when over budget
  if (input.lspHover) systemParts.push("## Type context (LSP):", input.lspHover.slice(0, 1050));
  if (input.lspDefinition) systemParts.push("## Definition (LSP):", input.lspDefinition);
  if (input.lspDiagnostics) systemParts.push(input.lspDiagnostics);
  if (input.bm25Snippets && input.bm25Snippets.length > 0) {
    systemParts.push("Relevant context from codebase:", input.bm25Snippets.join("\n"));
  }
  if (input.repoMap) systemParts.push("## Repository map:", input.repoMap);
  if (input.crossFileContext) systemParts.push("Cross-file context:", input.crossFileContext);
}

function appendOutputFormatInstructions(
  systemParts: string[],
  filePath: string,
  multiline: boolean,
  useUnifiedDiff: boolean,
): void {
  const completeInstruction = multiline
    ? "Complete the next block of code and preserve indentation."
    : "Complete the next span of code naturally at the cursor position.";
  if (useUnifiedDiff) {
    systemParts.push(
      completeInstruction,
      "Output your changes as a unified diff:",
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      "@@ -startLine,lineCount +startLine,lineCount @@",
      " context line",
      "-removed line",
      "+added line",
      "Return ONLY the unified diff with no explanations.",
    );
  } else {
    systemParts.push(
      completeInstruction,
      "Return ONLY the completion text with no explanations or markdown fences.",
    );
  }
}

export function buildFIMPrompt(
  input: FIMPromptInput,
  multilineOverride?: boolean,
): FIMPromptResult {
  const multiline = multilineOverride !== undefined
    ? multilineOverride
    : shouldUseMultilineCompletion(input.prefix, input.suffix);
  const maxCompletionTokens = multiline ? MULTILINE_MAX_TOKENS : SINGLE_LINE_MAX_TOKENS;

  const { prefixChars, suffixChars } = computeContextBudget(
    input.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxCompletionTokens,
  );
  const prefixWindow = pruneFromTop(input.prefix, prefixChars);
  const suffixWindow = pruneFromBottom(input.suffix, suffixChars);

  const systemParts = [
    "You are a fill-in-the-middle code completion engine.",
    `Language: ${input.language}`,
    `File: ${input.filePath}`,
  ];
  appendOptionalContextBlocks(systemParts, input);
  appendOutputFormatInstructions(systemParts, input.filePath, multiline, input.useUnifiedDiff === true);

  return {
    systemPrompt: systemParts.join("\n"),
    userPrompt: ["<|fim_prefix|>", prefixWindow, "<|fim_suffix|>", suffixWindow, "<|fim_middle|>"].join(""),
    maxTokens: maxCompletionTokens,
  };
}

/**
 * Checks whether brackets/braces/parens are balanced in a code string.
 */
export function areBracketsBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (depth < 0) return true;
  }
  return depth <= 0;
}

/**
 * Determines whether streaming should continue for a multiline completion.
 */
export function shouldContinueStreaming(text: string): boolean {
  if (text.includes("\n\n\n")) return false;

  const lines = text.split("\n");
  let emptyCount = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() === "") emptyCount++;
    else break;
  }
  if (emptyCount >= MAX_CONSECUTIVE_EMPTY_LINES) return false;

  if (text.length > 5 && areBracketsBalanced(text)) return false;

  return true;
}

// ── Multi-model fallback chain ────────────────────────────────────────────────

interface FIMModelAttempt {
  modelString: string;
  timeoutMs: number;
}

/**
 * Try models in order; on timeout fall through to next.
 * Each attempt gets its own AbortController so timeouts don't leak.
 * The outer `abortSignal` (from VSCode cancellation) cancels ALL attempts.
 */
export async function fetchWithFallback(
  attempts: FIMModelAttempt[],
  runAttempt: (modelString: string, signal: AbortSignal) => Promise<string>,
  outerSignal: AbortSignal,
): Promise<string> {
  for (const attempt of attempts) {
    if (outerSignal.aborted) throw new Error("Cancelled");

    const controller = new AbortController();
    // Forward outer cancellation
    const outerListener = () => controller.abort();
    outerSignal.addEventListener("abort", outerListener, { once: true });

    // Per-model timeout
    const timeoutId = setTimeout(() => controller.abort(), attempt.timeoutMs);

    try {
      const result = await runAttempt(attempt.modelString, controller.signal);
      clearTimeout(timeoutId);
      outerSignal.removeEventListener("abort", outerListener);
      return result;
    } catch {
      clearTimeout(timeoutId);
      outerSignal.removeEventListener("abort", outerListener);
      // If the outer signal aborted, propagate; otherwise try next model
      if (outerSignal.aborted) throw new Error("Cancelled");
      // Continue to next attempt
    }
  }
  throw new Error("All FIM model attempts exhausted");
}

// ── Diagnostic Collection ─────────────────────────────────────────────────────

let inlinePDSECollection: vscode.DiagnosticCollection | undefined;

function getInlinePDSEDiagnostics(): vscode.DiagnosticCollection {
  if (!inlinePDSECollection) {
    inlinePDSECollection = vscode.languages.createDiagnosticCollection("DanteCode Inline PDSE");
  }
  return inlinePDSECollection;
}

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
    `PDSE ${score}/100 – ${reason}`,
    vscode.DiagnosticSeverity.Warning,
  );
  diag.source = "DanteCode Inline";
  diag.code = `PDSE ${score}`;
  const existing = collection.get(document.uri) ?? [];
  collection.set(document.uri, [...existing, diag]);
}

function clearInlinePDSEDiagnostics(uri: vscode.Uri): void {
  inlinePDSECollection?.delete(uri);
}

export function disposeInlinePDSEDiagnostics(): void {
  inlinePDSECollection?.dispose();
  inlinePDSECollection = undefined;
}

// ── LSP Context Fetch ─────────────────────────────────────────────────────────

/**
 * Fetch LSP hover + definition at the given position with a hard 150ms timeout.
 * Definition is only fetched when the cursor follows '.' or '(' (type-aware context).
 * Returns null on timeout, LSP not ready, or any error — never throws.
 */
async function fetchLSPContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<{ hover?: string; definition?: string } | null> {
  const lspTimeoutMs =
    vscode.workspace.getConfiguration("dantecode").get<number>("lspFimTimeoutMs", 150);

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), lspTimeoutMs),
  );

  const lspPromise = (async (): Promise<{ hover?: string; definition?: string }> => {
    // ── Hover ──
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      position,
    );
    const hover =
      hovers
        ?.flatMap((h) =>
          h.contents.map((c) => (typeof c === "string" ? c : c.value)),
        )
        .filter((s) => s.trim().length > 0)
        .join("\n\n")
        .slice(0, 1050) || undefined;

    // ── Definition — only on member access or call expressions ──
    let definition: string | undefined;
    const lineText = document.lineAt(position.line).text.slice(0, position.character);
    if (/[.(]$/.test(lineText.trimEnd())) {
      const locs = await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >("vscode.executeDefinitionProvider", document.uri, position);

      if (locs?.length) {
        const loc = locs[0]!;
        const uri = "targetUri" in loc ? loc.targetUri : loc.uri;
        const startLine = ("targetRange" in loc ? loc.targetRange : loc.range).start.line;
        const defDoc = await vscode.workspace.openTextDocument(uri);
        const start = Math.max(0, startLine - 15);
        const end = Math.min(defDoc.lineCount - 1, startLine + 15);
        const lines: string[] = [];
        for (let i = start; i <= end; i++) lines.push(defDoc.lineAt(i).text);
        definition = lines.join("\n");
      }
    }

    return { hover, definition };
  })();

  try {
    const result = await Promise.race([lspPromise, timeoutPromise]);
    if (!result) return null;
    if (!result.hover && !result.definition) return null;
    return result;
  } catch {
    return null;
  }
}

// ── Completion Provider ───────────────────────────────────────────────────────

/**
 * DanteCodeCompletionProvider v3 — FIM 9.0.
 *
 * New in v3 (vs v2):
 * - PrefixTreeCache for instant prefix-match hits (backspace reuse pattern)
 * - Token-budget-aware prefix/suffix pruning (Continue.dev pattern)
 * - BM25 codebase snippet injection (Tabby RAG pattern)
 * - Recently-edited file context via recentEditPaths
 * - Multi-model fallback chain with per-model timeout
 * - Acceptance telemetry via CompletionAcceptanceTracker
 */
export class DanteCodeCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly _fifoCache: CacheEntry[] = [];
  private readonly _prefixTreeCache = new PrefixTreeCache(300);
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRequestId = 0;
  private lastKeystrokeTimes: number[] = [];
  private readonly _recentEditPaths: string[] = []; // ring buffer, max 10

  /** Abort controller for the currently in-flight stream. Cancelled on new keystroke. */
  private _activeStreamController: AbortController | null = null;

  private readonly _acceptanceTracker: CompletionAcceptanceTracker | undefined;
  private readonly _telemetry: CompletionTelemetryService | undefined;
  private readonly _contextRetriever: CompletionContextRetriever | undefined;
  private readonly _fimModelRouter: FimModelRouter | undefined;
  private readonly _latencyTracker: FimLatencyTracker | undefined;
  private readonly _nextEditPredictor: NextEditPredictor | undefined;
  private readonly _codebaseIndexManager: CodebaseIndexManager | undefined;
  private readonly _lspInjector: LspDiagnosticsInjector | undefined;

  /** Cache for speculatively pre-fetched completions. Key: "${filePath}:${line}" */
  private readonly _predictionCache = new Map<string, { text: string; expiresAt: number }>();
  private readonly _PREDICTION_CACHE_MAX = 20;

  /** Per-language acceptance history loaded from .danteforge/fim-acceptance-history.json */
  private _acceptanceHistory: Array<{ language: string; shown: number; accepted: number; rate: number }> = [];
  private _acceptanceHistoryLoaded = false;

  constructor(
    _context?: vscode.ExtensionContext,
    opts?: CompletionProviderOptions,
  ) {
    this._acceptanceTracker = opts?.acceptanceTracker;
    this._telemetry = opts?.telemetry;
    this._contextRetriever = opts?.contextRetriever;
    this._fimModelRouter = opts?.fimModelRouter;
    this._latencyTracker = opts?.latencyTracker;
    this._nextEditPredictor = opts?.nextEditPredictor;
    this._codebaseIndexManager = opts?.codebaseIndexManager;
    this._lspInjector = opts?.lspInjector;
  }

  /**
   * Loads per-language acceptance history from .danteforge/fim-acceptance-history.json.
   * Called lazily on first completion request. Non-fatal if file is absent.
   */
  private _loadAcceptanceHistory(projectRoot: string): void {
    if (this._acceptanceHistoryLoaded) return;
    this._acceptanceHistoryLoaded = true;
    try {
      const histPath = join(projectRoot, ".danteforge", "fim-acceptance-history.json");
      const raw = readFileSync(histPath, "utf-8");
      const parsed = JSON.parse(raw) as { languages: Array<{ language: string; shown: number; accepted: number; rate: number }> };
      if (Array.isArray(parsed.languages)) {
        this._acceptanceHistory = parsed.languages;
      }
    } catch { /* file absent or malformed — proceed with empty history */ }
  }

  /**
   * Returns the per-language acceptance-rate debounce adjustment.
   * Loads history from disk on first call. Falls back to 0 if unknown language.
   */
  getLanguageDebounceAdjustment(language: string, projectRoot: string): number {
    this._loadAcceptanceHistory(projectRoot);
    const entry = this._acceptanceHistory.find((h) => h.language === language);
    if (!entry) return 0;
    return getAcceptanceRateDebounceAdjustment(entry.rate);
  }

  /**
   * Record a recently-edited file path (for cross-file context injection).
   * Call from `onDidChangeTextDocument` handler in extension.ts.
   */
  recordRecentEdit(filePath: string): void {
    const idx = this._recentEditPaths.indexOf(filePath);
    if (idx !== -1) this._recentEditPaths.splice(idx, 1);
    this._recentEditPaths.unshift(filePath);
    if (this._recentEditPaths.length > 10) this._recentEditPaths.pop();
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

    // Adaptive debounce
    const now = Date.now();
    this.lastKeystrokeTimes.push(now);
    if (this.lastKeystrokeTimes.length > 5) {
      this.lastKeystrokeTimes = this.lastKeystrokeTimes.slice(-5);
    }
    const adaptiveEnabled = config.get<boolean>("debounceAdaptive", true);
    let debounceMs = baseDebounceMs;
    if (adaptiveEnabled && this.lastKeystrokeTimes.length >= 3) {
      const oldest = this.lastKeystrokeTimes[0]!;
      const elapsed = (now - oldest) / 1000;
      const charsPerSec = elapsed > 0 ? this.lastKeystrokeTimes.length / elapsed : 0;
      if (charsPerSec > 5) debounceMs = Math.max(80, baseDebounceMs - 100);
      else if (charsPerSec > 3) debounceMs = Math.max(80, baseDebounceMs - 80);
    }
    // Token boundary: if user just typed a natural completion boundary, fire sooner
    const lineText = document.lineAt?.(position.line)?.text ?? "";
    const boundaryReduction = getTokenBoundaryDebounceReduction(lineText.slice(0, position.character));
    if (boundaryReduction > 0) {
      debounceMs = Math.max(60, debounceMs - boundaryReduction);
    }

    // Per-language acceptance history: apply ranked debounce adjustment (dim 1)
    // High-acceptance languages (TypeScript, Python) get shorter debounce (more responsive).
    // Low-acceptance languages (C++) get longer debounce (reduce noise).
    const workspaceFoldersEarly = vscode.workspace.workspaceFolders;
    const projectRootEarly = workspaceFoldersEarly?.[0]?.uri.fsPath ?? "";
    if (projectRootEarly) {
      const langAdj = this.getLanguageDebounceAdjustment(language, projectRootEarly);
      debounceMs = Math.max(60, debounceMs + langAdj);
    }

    // FIFO cache key
    const prefixLines = prefix.split("\n");
    const last3Lines = prefixLines.slice(-3).join("\n");
    const suffixHead = suffix.slice(0, 100);
    const cacheKey = `${selectedModel}:${language}:${position.line}:${last3Lines}:${suffixHead}`;

    const cached = this._lookupFifo(cacheKey);
    if (cached) return cached;

    // PrefixTreeCache: normalised last 200 chars of prefix
    const prefixTreeKey = prefix.slice(-PREFIX_TREE_KEY_LEN).trimEnd().toLowerCase();
    const treeCached = this._prefixTreeCache.get(prefixTreeKey);
    if (treeCached) return treeCached as unknown as vscode.InlineCompletionItem[];

    // Abort any in-flight stream from the previous request (Tabby stream laziness pattern)
    this._activeStreamController?.abort();
    const keystrokeController = new AbortController();
    this._activeStreamController = keystrokeController;

    const completions = await new Promise<vscode.InlineCompletionItem[]>((resolve) => {
      if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);

      this.debounceTimer = setTimeout(async () => {
        if (requestId !== this.lastRequestId) { resolve([]); return; }
        if (token.isCancellationRequested) { resolve([]); return; }
        if (keystrokeController.signal.aborted) { resolve([]); return; }
        try {
          const items = await this.fetchCompletions(
            prefix, suffix, language, filePath, position, document, token,
            keystrokeController.signal,
          );
          resolve(items);
        } catch {
          resolve([]);
        }
      }, debounceMs);
    });

    // Clear the controller reference once this request completes
    if (this._activeStreamController === keystrokeController) {
      this._activeStreamController = null;
    }

    if (completions.length > 0) {
      this._storeFifo(cacheKey, completions);
      this._prefixTreeCache.set(prefixTreeKey, completions as unknown as string);
    }

    // Next-Edit Prediction: inject a pre-fetched completion at the predicted location
    // (Cursor Tab / arXiv 2025 pattern — same file only, confidence gate ≥0.65)
    const nextEditItems = this._getNextEditItems(filePath, position);
    if (nextEditItems.length > 0) {
      return [...completions, ...nextEditItems];
    }

    return completions;
  }

  private async fetchCompletions(
    prefix: string,
    suffix: string,
    language: string,
    filePath: string,
    position: vscode.Position,
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
    keystrokeSignal?: AbortSignal,
  ): Promise<vscode.InlineCompletionItem[]> {
    const requestStart = Date.now();
    const config = vscode.workspace.getConfiguration("dantecode");
    const primaryModel = resolveInlineCompletionModel(
      config.get<string>("defaultModel", "grok/grok-3"),
      config.get<string>("fimModel"),
    );
    const fallbackModel = config.get<string>("fimFallbackModel", "");
    const fimTimeoutMs = config.get<number>("fimTimeoutMs", 3000);
    const pdseThreshold = config.get<number>("pdseThreshold", 85);
    const pdseWarnings = config.get<boolean>("inline.pdseWarnings", true);

    const multilineConfig =
      config.get<string>("inline.multiline") ?? config.get<string>("multilineCompletions", "auto");
    const isMultilineContext = shouldUseMultilineCompletion(prefix, suffix);
    const isMultiline =
      multilineConfig === "always" || (multilineConfig === "auto" && isMultilineContext);

    // Gather cross-file context and BM25 snippets in PARALLEL (Continue.dev async pipeline pattern)
    // Twinny-harvested: merge open editors with interaction-ranked files for richer cross-file context
    const openEditorPaths = vscode.window.visibleTextEditors
      .map((e) => e.document.uri.fsPath)
      .filter((p) => p !== filePath);
    const interactionRanked = globalInteractionCache
      .getRelevantDocuments(document.uri.toString(), 5)
      .map((d) => d.filePath)
      .filter((p) => p !== filePath);
    const openEditors = [...new Set([...openEditorPaths, ...interactionRanked])];
    const queryLines = prefix.split("\n").slice(-5);

    const contextRetriever = this._contextRetriever;
    const indexManager = this._codebaseIndexManager;
    const symbolName = SymbolDefinitionLookup.extractCallSiteSymbol(prefix);

    // Tabby-harvested context budget: tiered allocation (prefix 60%, rag 10%, etc.)
    const fimBudget = FimContextBudget.forContextWindow(DEFAULT_CONTEXT_WINDOW, isMultiline ? 512 : 256);

    // LSP diagnostics: async snapshot with cursor position, sliced to lsp token budget
    const lspDiagnostics = this._lspInjector
      ? this._lspInjector
          .formatForContext(await this._lspInjector.snapshot(
            document.uri.toString(),
            position ? { line: position.line, character: position.character } : undefined,
          ))
          .slice(0, fimBudget.slots.lsp * 4)
      : undefined;

    const [crossFileContext, bm25Snippets, repoMap, symbolDefChunk, lspContext] = await Promise.all([
      gatherCrossFileContext({
        currentFilePath: filePath,
        openFilePaths: openEditors,
        recentEditPaths: this._recentEditPaths.filter((p) => p !== filePath),
        maxTokenBudget: fimBudget.slots.crossFile * 4,  // tokens → chars
        readFile: async (p) => {
          const doc = await vscode.workspace.openTextDocument(p);
          return doc.getText();
        },
      }).catch(() => ""),
      contextRetriever
        ? Promise.resolve().then(() => contextRetriever.retrieve(queryLines, 3, fimBudget.slots.rag, 50)).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
      indexManager
        ? indexManager.getRepoMap(100).catch(() => "")
        : Promise.resolve(""),
      Promise.resolve(symbolName && indexManager ? indexManager.lookupSymbol(symbolName) : null),
      fetchLSPContext(document, position).catch(() => null),
    ]);

    const symbolDef = symbolDefChunk
      ? `${symbolDefChunk.filePath}\n${symbolDefChunk.content.slice(0, 300)}`
      : undefined;

    const totalLineCount = (prefix + suffix).split("\n").length;
    const diffMode = config.get<string>("diffMode", "auto");
    const useUnifiedDiff =
      diffMode === "unified" || (diffMode === "auto" && totalLineCount > 300);

    const fimPrompt = buildFIMPrompt(
      {
        prefix, suffix, language, filePath, crossFileContext, bm25Snippets,
        repoMap: repoMap || undefined, symbolDef,
        lspHover: lspContext?.hover,
        lspDefinition: lspContext?.definition,
        lspDiagnostics: lspDiagnostics || undefined,
        totalLineCount,
        useUnifiedDiff,
      },
      multilineConfig === "always" ? true : multilineConfig === "never" ? false : undefined,
    );

    // Build model attempt list
    const [provider, modelId] = parseModelString(primaryModel);
    const modelConfig: ModelConfig = {
      provider: provider as ModelConfig["provider"],
      modelId,
      maxTokens: fimPrompt.maxTokens,
      temperature: 0.1,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      supportsVision: false,
      supportsToolCalls: false,
    };
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const projectRoot = workspaceFolders?.[0]?.uri.fsPath ?? "";

    if (token.isCancellationRequested) return [];

    const abortController = new AbortController();
    const cancelDisposable = token.onCancellationRequested(() => abortController.abort());
    // Also forward keystroke abort (stale stream cancellation)
    const keystrokeListener = () => abortController.abort();
    if (keystrokeSignal) {
      keystrokeSignal.addEventListener("abort", keystrokeListener, { once: true });
    }

    // Speculative decode params (Ollama draft_model + vLLM --speculative-model)
    // Injected into router.stream() options when a draft model is probed and healthy.
    const specDecodeOptions: Record<string, unknown> = {};
    if (this._fimModelRouter?.specDecodeAvailable && this._fimModelRouter.draftModelId) {
      specDecodeOptions["draft_model"] = this._fimModelRouter.draftModelId;
      specDecodeOptions["speculative_ngram"] = true;
    }

    // Build attempt list (primary + optional fallback)
    const attempts: Array<{ modelString: string; timeoutMs: number }> = [
      { modelString: primaryModel, timeoutMs: fimTimeoutMs },
    ];
    if (fallbackModel.trim()) {
      attempts.push({ modelString: fallbackModel.trim(), timeoutMs: fimTimeoutMs * 2 });
    }

    // Capture firstChunkMs from whichever model attempt succeeds
    let capturedFirstChunkMs: number | undefined;

    let completionText: string;
    try {
      completionText = await fetchWithFallback(
        attempts,
        async (modelString, signal) => {
          // Sprint C: route Ollama FIM-capable models through native /api/generate
          // Only when fimModelRouter has an explicit ollamaUrl (prevents test timeouts).
          const [attemptProvider, attemptModelId] = parseModelString(modelString);
          const routerOllamaUrl = this._fimModelRouter?.ollamaUrl;
          if (attemptProvider === "ollama" && isOllamaFimModel(attemptModelId) && routerOllamaUrl) {
            const ollamaUrl = routerOllamaUrl;
            const start = Date.now();
            const text = await ollamaFimGenerate(
              ollamaUrl,
              attemptModelId,
              prefix,
              suffix,
              fimPrompt.maxTokens,
              signal,
            );
            capturedFirstChunkMs = Date.now() - start;
            return text;
          }

          // Default: use ModelRouterImpl via chat API
          const router = this._fimModelRouter
            ? this._fimModelRouter.getRouter(modelString, projectRoot, fimPrompt.maxTokens)
            : (() => {
                const mc: ModelConfig = { ...modelConfig, provider: attemptProvider as ModelConfig["provider"], modelId: attemptModelId };
                const rc: ModelRouterConfig = { default: mc, fallback: [], overrides: {} };
                return new ModelRouterImpl(rc, projectRoot, "inline-completion");
              })();
          return this._streamCompletion(router, fimPrompt, isMultiline, signal, document, (fcMs) => {
            capturedFirstChunkMs = fcMs;
          }, specDecodeOptions);
        },
        abortController.signal,
      );
    } catch {
      cancelDisposable.dispose();
      if (keystrokeSignal) keystrokeSignal.removeEventListener("abort", keystrokeListener);
      return [];
    } finally {
      cancelDisposable.dispose();
      if (keystrokeSignal) keystrokeSignal.removeEventListener("abort", keystrokeListener);
    }

    if (token.isCancellationRequested) return [];

    // Sprint BI (dim 1): Rank the single completion against itself — this is a
    // no-op for a single candidate but establishes the ranking pipeline so that
    // when the provider is extended to sample N completions, they are automatically
    // ordered by quality. We also allow the ranker to filter out degenerate results
    // (empty or pure-whitespace completions after cleaning).
    const rankedCandidates = await rankCompletionCandidates(
      [completionText],
      prefix,
      suffix,
      language,
    );
    if (rankedCandidates.length === 0) return [];
    completionText = rankedCandidates[0]!;

    // Unified diff pipeline: when the model outputs a `--- a/` diff, parse and
    // apply it as a WorkspaceEdit instead of inserting as an inline completion.
    if (useUnifiedDiff && completionText.includes("--- a/")) {
      const blocks = parseUdiffResponse(completionText);
      if (blocks.length > 0) {
        await applyUdiffBlocks(blocks, document);
        return []; // edits applied directly — no inline completion item needed
      }
    }

    const cleaned = cleanCompletionText(completionText);
    if (cleaned.length === 0) return [];

    clearInlinePDSEDiagnostics(document.uri);

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
        pdseReason = score.violations.length > 0 ? score.violations[0]!.message : "below quality threshold";
      }
    } catch {
      gateLabel = "";
    }

    let insertText = cleaned;
    if (pdseWarnings && pdseScore !== undefined && pdseScore < pdseThreshold) {
      insertText += `\n// PDSE ${pdseScore}/100 – ${pdseReason}`;
      addInlinePDSEDiagnostic(document, position, pdseScore, pdseReason);
    }

    // Generate completionId for telemetry
    const completionId = this._telemetry?.generateCompletionId() ?? "";
    const elapsedMs = Date.now() - requestStart;

    const item = new vscode.InlineCompletionItem(insertText, new vscode.Range(position, position));

    // Wire acceptance tracking via InlineCompletionItem.command
    if (completionId && this._acceptanceTracker) {
      item.command = {
        title: "Track completion acceptance",
        command: "dantecode._internalTrackAccept",
        arguments: [completionId],
      };
      // Track the "shown" (view) event — include TTFB if captured
      this._acceptanceTracker.trackShown(
        completionId,
        filePath,
        cleaned,
        elapsedMs,
        language,
        primaryModel,
        capturedFirstChunkMs,
      );
    }

    // Update latency status bar (real-time p50)
    if (capturedFirstChunkMs !== undefined && this._latencyTracker) {
      this._latencyTracker.recordFirstChunk(capturedFirstChunkMs);
    }

    const confidenceMarker = cleaned.length < 10 ? " [?]" : "";
    item.filterText = `dantecode${gateLabel}${confidenceMarker}`;

    return [item];
  }

  private async _streamCompletion(
    router: ModelRouterImpl,
    fimPrompt: FIMPromptResult,
    isMultiline: boolean,
    abortSignal: AbortSignal,
    /** Document for emitter registry keying and stop sequence language lookup. */
    document: vscode.TextDocument,
    /** Called with TTFB (ms) on receipt of the first chunk. Fires at most once. */
    onFirstChunk?: (firstChunkMs: number) => void,
    /** Extra provider options (e.g. speculative decode params) */
    extraOptions?: Record<string, unknown>,
  ): Promise<string> {
    const result = await router.stream([{ role: "user", content: fimPrompt.userPrompt }], {
      system: fimPrompt.systemPrompt,
      maxTokens: fimPrompt.maxTokens,
      abortSignal,
      ...extraOptions,
    });

    const docUri = document.uri.toString();
    const emitter = globalEmitterRegistry.startFor(docUri);
    const stopDetector = StopSequenceDetector.forLanguage(document.languageId);
    // Twinny-harvested: bracket-balance detector stops multiline completions at natural block boundaries
    const bracketDetector = isMultiline ? new BracketBalanceDetector() : null;

    // firstLinePromise resolves as soon as the first line of text arrives.
    // provideInlineCompletionItems races this against the full completion,
    // returning ghost text as early as possible.
    let resolveFirstLine: ((text: string) => void) | undefined;
    const firstLinePromise = new Promise<string>((resolve) => {
      resolveFirstLine = resolve;
    });

    const fullTextPromise = emitter.emit(result.textStream, (event) => {
      if (!event.done && event.text && resolveFirstLine) {
        const fn = resolveFirstLine;
        resolveFirstLine = undefined; // only fire once
        fn(event.text);
        if (event.firstChunkMs !== undefined) {
          onFirstChunk?.(event.firstChunkMs);
        }
      }
      // Twinny bracket-balance: abort stream when an opened block is fully closed
      if (bracketDetector && !event.done && event.text) {
        const { balanced } = bracketDetector.check(event.text);
        if (balanced) {
          emitter.abort();
        }
      }
    }, {
      emitOnFirstLine: true,
      emitPerLine: isMultiline,
      firstLineTimeoutMs: DEFAULT_FIRST_LINE_TIMEOUT_MS,
      stopSequences: stopDetector.getStopSequences(),
    });

    // Ensure firstLinePromise always resolves (resolves with full text when done)
    void fullTextPromise.then((finalText) => {
      if (resolveFirstLine) {
        resolveFirstLine(finalText);
      }
    });

    // Race: for single-line, return whichever arrives first — partial first-line or full completion.
    // This is the key Tabby pattern: ghost text appears after first \n, not after full stream.
    // For multiline, always await the full text — emitPerLine is for UI progress updates only.
    const finalText = isMultiline
      ? await fullTextPromise
      : await Promise.race([fullTextPromise, firstLinePromise]);
    return finalText;
  }

  private _lookupFifo(key: string): vscode.InlineCompletionItem[] | undefined {
    const now = Date.now();
    const index = this._fifoCache.findIndex((e) => e.key === key);
    if (index === -1) return undefined;
    const entry = this._fifoCache[index]!;
    if (now - entry.timestamp > CACHE_TTL_MS) {
      this._fifoCache.splice(index, 1);
      return undefined;
    }
    return entry.items;
  }

  private _storeFifo(key: string, items: vscode.InlineCompletionItem[]): void {
    const existingIndex = this._fifoCache.findIndex((e) => e.key === key);
    if (existingIndex !== -1) this._fifoCache.splice(existingIndex, 1);
    while (this._fifoCache.length >= MAX_CACHE_SIZE) this._fifoCache.shift();
    this._fifoCache.push({ key, items, timestamp: Date.now() });
  }

  clearCache(): void {
    this._fifoCache.length = 0;
    this._prefixTreeCache.clear();
  }

  /**
   * Returns InlineCompletionItem(s) for the predicted next edit location.
   * Only emits when: same file, prediction confidence ≥ 0.65, cached text available.
   * This implements the Cursor Tab speculative completion pattern.
   *
   * When a FIM model router with a next-edit model is available, fires predictBest()
   * asynchronously (ML-first, heuristic fallback). The result is stored in the
   * idle-watcher pre-fetch cache for instant retrieval when the cursor arrives.
   */
  private _getNextEditItems(
    currentFilePath: string,
    currentPos: vscode.Position,
  ): vscode.InlineCompletionItem[] {
    if (!this._nextEditPredictor) return [];
    const pred: NextEditPrediction = this._nextEditPredictor.predict(
      currentFilePath,
      currentPos.line,
      currentPos.character,
    );
    if (pred.confidence < 0.65 || pred.filePath !== currentFilePath) return [];
    const cacheKey = `${pred.filePath}:${pred.line}`;
    const cached = this._predictionCache.get(cacheKey);
    if (!cached || Date.now() > cached.expiresAt) return [];
    const predictedPos = new vscode.Position(pred.line, pred.character);
    return [new vscode.InlineCompletionItem(cached.text, new vscode.Range(predictedPos, predictedPos))];
  }

  /**
   * Store a pre-fetched completion in the prediction cache (LRU eviction at max size).
   * ML predictions use a shorter 2s TTL; heuristic predictions use 5s.
   */
  storePredictionCache(
    filePath: string,
    line: number,
    text: string,
    isML = false,
  ): void {
    const key = `${filePath}:${line}`;
    if (this._predictionCache.size >= this._PREDICTION_CACHE_MAX) {
      const firstKey = this._predictionCache.keys().next().value;
      if (firstKey !== undefined) this._predictionCache.delete(firstKey);
    }
    const ttl = isML ? ML_PREDICTION_CACHE_TTL_MS : HEURISTIC_PREDICTION_CACHE_TTL_MS;
    this._predictionCache.set(key, { text, expiresAt: Date.now() + ttl });
  }
}

// ── FIM Candidate Ranking (Sprint BI — dim 1) ─────────────────────────────────

/**
 * Rank a list of raw completion strings by quality using `FimCandidateRanker`.
 *
 * Deduplicates, scores, and returns candidates in descending quality order.
 * The best candidate is at index 0. Empty candidates and empty input are
 * handled gracefully (returns an empty array).
 *
 * This is the integration point between the raw LLM output (possibly multiple
 * candidates from a sampling run) and the VS Code InlineCompletionItem list.
 * Callers should use `candidates[0]` as the primary completion and optionally
 * surface others as secondary items.
 *
 * @param candidates  Raw completion text strings (may contain duplicates).
 * @param prefix      Code before the cursor (for context scoring).
 * @param suffix      Code after the cursor (for context scoring).
 * @param language    Language identifier (e.g. "typescript").
 * @returns Ranked string array — highest quality first.
 */
export async function rankCompletionCandidates(
  candidates: string[],
  prefix: string,
  suffix: string,
  language: string,
): Promise<string[]> {
  if (candidates.length === 0) return [];

  // Filter out empty candidates before ranking
  const nonEmpty = candidates.filter((c) => c.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  // Load ranker lazily — falls back to identity if not available (e.g. in test mocks)
  const ranker = await getRankCandidates();
  if (typeof ranker !== "function") {
    return nonEmpty;
  }

  const ctx: FimRankingContext = { prefix, suffix, language };
  const ranked = ranker(nonEmpty, ctx);
  // Sprint CG — Dim 1: record ranking session for FIM quality tracking
  try {
    const scores = ranked.map((c) => c.score);
    const topScore = Math.max(...scores);
    const bottomScore = Math.min(...scores);
    const mod = await import("@dantecode/core");
    const recordFn = (mod as Record<string, unknown>).recordFimRankingSession as
      ((session: { language: string; candidateCount: number; topScore: number; bottomScore: number; scoreRange: number }, root: string) => void) | undefined;
    if (typeof recordFn === "function") {
      recordFn({ language, candidateCount: ranked.length, topScore, bottomScore, scoreRange: topScore - bottomScore }, process.cwd());
    }
  } catch { /* non-fatal */ }
  return ranked.map((c) => c.text);
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

/**
 * Apply parsed unified-diff blocks directly to the document via WorkspaceEdit.
 * Skips any block whose searchContent cannot be found in the document text.
 */
async function applyUdiffBlocks(
  blocks: import("@dantecode/core").SearchReplaceBlock[],
  document: vscode.TextDocument,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const text = document.getText();

  for (const block of blocks) {
    if (!block.searchContent) continue;
    const idx = text.indexOf(block.searchContent);
    if (idx === -1) continue;
    const startPos = document.positionAt(idx);
    const endPos = document.positionAt(idx + block.searchContent.length);
    edit.replace(document.uri, new vscode.Range(startPos, endPos), block.replaceContent);
  }

  await vscode.workspace.applyEdit(edit);
}

function cleanCompletionText(text: string): string {
  let cleaned = text;
  const fenceMatch = cleaned.match(/^```\w*\n([\s\S]*?)```\s*$/);
  if (fenceMatch?.[1] !== undefined) cleaned = fenceMatch[1];
  cleaned = cleaned.replace(/^`{3}\w*\n?/, "").replace(/\n?`{3}\s*$/, "");
  cleaned = cleaned.replace(/\s+$/, "");
  return cleaned;
}
