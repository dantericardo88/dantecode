// ============================================================================
// DanteCode VS Code Extension — Inline Completion Provider v2
// Cursor-level perceived speed with streaming FIM, balanced-brace multiline
// guard, adaptive debounce, cross-file context, and PDSE inline diagnostics.
// ============================================================================

import * as vscode from "vscode";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";
import { ModelRouterImpl, parseModelReference } from "@dantecode/core";
import { runLocalPDSEScorer } from "@dantecode/danteforge";
import { gatherCrossFileContext } from "./cross-file-context.js";

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

export function buildFIMPrompt(input: FIMPromptInput, multilineOverride?: boolean): FIMPromptResult {
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
  const range = new vscode.Range(position, new vscode.Position(position.line, position.character + 1));
  const diag = new vscode.Diagnostic(
    range,
    `PDSE ${score}/100 – ${reason}`,
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
 */
export class DanteCodeCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache: CacheEntry[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRequestId = 0;
  private lastKeystrokeTimes: number[] = [];

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

    // Adaptive debounce: reduce delay when typing quickly
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
      const charsPerSec = this.lastKeystrokeTimes.length / elapsed;
      if (charsPerSec > 3) {
        debounceMs = Math.min(baseDebounceMs, 100);
      }
    }

    // Build a cache key from last 3 lines before cursor + suffix head
    const prefixLines = prefix.split("\n");
    const last3Lines = prefixLines.slice(-3).join("\n");
    const suffixHead = suffix.slice(0, 100);
    const cacheKey = `${selectedModel}:${language}:${position.line}:${last3Lines}:${suffixHead}`;

    const cached = this.lookupCache(cacheKey);
    if (cached) {
      return cached;
    }

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
    }

    return completions;
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
    const multilineConfig = config.get<string>("inline.multiline") ??
      config.get<string>("multilineCompletions", "auto");
    const isMultilineContext = shouldUseMultilineCompletion(prefix, suffix);
    const isMultiline =
      multilineConfig === "always" ||
      (multilineConfig === "auto" && isMultilineContext);

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

    const fimPrompt = buildFIMPrompt(
      { prefix, suffix, language, filePath, crossFileContext },
      multilineConfig === "always" ? true : multilineConfig === "never" ? false : undefined,
    );

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
      completionText = await router.generate(
        [{ role: "user", content: fimPrompt.userPrompt }],
        {
          system: fimPrompt.systemPrompt,
          maxTokens: fimPrompt.maxTokens,
        },
      );
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
        pdseReason = score.violations.length > 0
          ? score.violations[0]!.message
          : "below quality threshold";
      }
    } catch {
      gateLabel = "";
    }

    // Build the completion text — append PDSE warning comment for low scores
    let insertText = cleaned;
    if (pdseWarnings && pdseScore !== undefined && pdseScore < pdseThreshold) {
      insertText += `\n// PDSE ${pdseScore}/100 – ${pdseReason}`;
      addInlinePDSEDiagnostic(document, position, pdseScore, pdseReason);
    }

    const item = new vscode.InlineCompletionItem(insertText, new vscode.Range(position, position));

    // Attach PDSE gate info and confidence marker as filter text
    const confidenceMarker = cleaned.length < 10 ? " [?]" : "";
    item.filterText = `dantecode${gateLabel}${confidenceMarker}`;

    return [item];
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
    const result = await router.stream(
      [{ role: "user", content: fimPrompt.userPrompt }],
      {
        system: fimPrompt.systemPrompt,
        maxTokens: fimPrompt.maxTokens,
        abortSignal,
      },
    );

    let text = "";
    for await (const chunk of result.textStream) {
      text += chunk;

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
