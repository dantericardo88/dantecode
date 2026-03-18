// ============================================================================
// DanteCode VS Code Extension — Inline Completion Provider
// Provides ghost-text inline completions by sending the document prefix,
// suffix, and language to the model router. Includes debouncing, caching,
// and PDSE gate status annotation.
// ============================================================================

import * as vscode from "vscode";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";
import { ModelRouterImpl, parseModelReference } from "@dantecode/core";
import { runLocalPDSEScorer } from "@dantecode/danteforge";

const DEFAULT_DEBOUNCE_MS = 200;
const MULTILINE_MAX_TOKENS = 512;
const SINGLE_LINE_MAX_TOKENS = 256;

/**
 * Maximum number of cached completions to retain. Older entries are evicted
 * using a simple FIFO strategy.
 */
const MAX_CACHE_SIZE = 100;

/**
 * Cached completion entry keyed by a hash of the request context.
 */
interface CacheEntry {
  key: string;
  items: vscode.InlineCompletionItem[];
  timestamp: number;
}

/**
 * Maximum age of a cache entry in milliseconds before it is considered stale.
 */
const CACHE_TTL_MS = 60_000;

interface FIMPromptInput {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
}

interface FIMPromptResult {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export function resolveInlineCompletionModel(defaultModel: string, fimModel?: string): string {
  return fimModel?.trim() ? fimModel.trim() : defaultModel;
}

export function getInlineCompletionDebounceMs(provider: string): number {
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
  const prefixWindow = multiline ? input.prefix.slice(-6000) : input.prefix.slice(-2000);
  const suffixWindow = multiline
    ? input.suffix.split("\n").slice(0, 10).join("\n").slice(0, 2000)
    : input.suffix.slice(0, 1000);

  const systemPrompt = [
    "You are a fill-in-the-middle code completion engine.",
    `Language: ${input.language}`,
    `File: ${input.filePath}`,
    multiline
      ? "Complete the next block of code and preserve indentation."
      : "Complete the next span of code naturally at the cursor position.",
    "Return ONLY the completion text with no explanations or markdown fences.",
  ].join("\n");

  const userPrompt = [
    "<|fim_prefix|>",
    prefixWindow,
    "<|fim_suffix|>",
    suffixWindow,
    "<|fim_middle|>",
  ].join("");

  return {
    systemPrompt,
    userPrompt,
    maxTokens: multiline ? MULTILINE_MAX_TOKENS : SINGLE_LINE_MAX_TOKENS,
  };
}

/**
 * DanteCodeCompletionProvider implements the VS Code InlineCompletionItemProvider
 * interface to deliver AI-powered ghost-text completions. It integrates with
 * the DanteCode model router for multi-provider support and runs a local PDSE
 * scorer on generated completions to annotate them with quality information.
 *
 * Features:
 * - Debounces requests (200ms default, provider-aware)
 * - Caches recent completions to avoid redundant model calls
 * - Annotates completions with PDSE gate status in the detail field
 * - Supports cancellation via VS Code's CancellationToken
 */
export class DanteCodeCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache: CacheEntry[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRequestId = 0;

  /**
   * Provides inline completion items for the given document position.
   *
   * This method is called by VS Code whenever the user types or moves
   * the cursor. It debounces rapid calls and returns cached results
   * when available.
   *
   * @param document - The text document being edited.
   * @param position - The cursor position within the document.
   * @param context - VS Code inline completion context (trigger kind).
   * @param token - Cancellation token for aborting long-running requests.
   * @returns An array of inline completion items, or an empty array.
   */
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    // Generate a unique request ID so stale debounced callbacks can be discarded
    const requestId = ++this.lastRequestId;

    // Build the completion context from the document
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
    const debounceMs = getInlineCompletionDebounceMs(provider);

    // Build a cache key from the prefix tail (last 200 chars), language, model, and position
    const prefixTail = prefix.slice(-200);
    const suffixHead = suffix.slice(0, 100);
    const cacheKey = `${selectedModel}:${language}:${position.line}:${position.character}:${prefixTail}:${suffixHead}`;

    // Check the cache for a recent matching entry
    const cached = this.lookupCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Debounce: wait based on provider latency characteristics
    const completions = await new Promise<vscode.InlineCompletionItem[]>((resolve) => {
      if (this.debounceTimer !== undefined) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(async () => {
        // If the request was superseded by a newer one, return empty
        if (requestId !== this.lastRequestId) {
          resolve([]);
          return;
        }

        // If already cancelled, return empty
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
            token,
          );
          resolve(items);
        } catch {
          // Silently return empty on error — inline completions should
          // never disrupt the user's editing experience
          resolve([]);
        }
      }, debounceMs);
    });

    // Store successful non-empty completions in the cache
    if (completions.length > 0) {
      this.storeCache(cacheKey, completions);
    }

    return completions;
  }

  /**
   * Fetches completion text from the DanteCode model router, runs a local
   * PDSE score on the result, and wraps it in InlineCompletionItem objects.
   *
   * Uses streaming by default for faster time-to-first-token. For single-line
   * completions the stream is consumed only until the first newline, returning
   * the result as soon as possible. Falls back to `router.generate()` if
   * streaming fails (e.g. provider does not support it).
   */
  private async fetchCompletions(
    prefix: string,
    suffix: string,
    language: string,
    filePath: string,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    // Resolve the model configuration from VS Code settings
    const config = vscode.workspace.getConfiguration("dantecode");
    const modelString = resolveInlineCompletionModel(
      config.get<string>("defaultModel", "grok/grok-3"),
      config.get<string>("fimModel"),
    );
    const pdseThreshold = config.get<number>("pdseThreshold", 85);

    // Resolve multi-line completion mode from user configuration
    const multilineConfig = config.get<string>("multilineCompletions", "auto");
    const isMultilineContext = shouldUseMultilineCompletion(prefix, suffix);
    const isMultiline =
      multilineConfig === "always" ||
      (multilineConfig === "auto" && isMultilineContext);

    const [provider, modelId] = parseModelString(modelString);
    const fimPrompt = buildFIMPrompt(
      { prefix, suffix, language, filePath },
      multilineConfig === "always" ? true : multilineConfig === "never" ? false : undefined,
    );

    const modelConfig: ModelConfig = {
      provider: provider as ModelConfig["provider"],
      modelId,
      maxTokens: fimPrompt.maxTokens,
      temperature: 0.2,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: false,
    };

    const routerConfig: ModelRouterConfig = {
      default: modelConfig,
      fallback: [],
      overrides: {},
    };

    // Determine the project root from the workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const projectRoot = workspaceFolders?.[0]?.uri.fsPath ?? "";

    const router = new ModelRouterImpl(routerConfig, projectRoot, "inline-completion");

    // Check for cancellation before making the network request
    if (token.isCancellationRequested) {
      return [];
    }

    // Wire up the VS Code cancellation token to an AbortController so the
    // streaming request can be cancelled mid-flight.
    const abortController = new AbortController();
    const cancelDisposable = token.onCancellationRequested(() => {
      abortController.abort();
    });

    let completionText: string;

    try {
      // Attempt streaming first for faster time-to-first-token
      completionText = await this.streamCompletion(
        router,
        fimPrompt,
        isMultiline,
        abortController.signal,
      );
    } catch {
      // Fallback to blocking generate() if streaming is unavailable or fails
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

    // Check for cancellation after the network request completes
    if (token.isCancellationRequested) {
      return [];
    }

    // Clean up the completion text — remove markdown fences if the model
    // accidentally included them
    const cleaned = cleanCompletionText(completionText);

    if (cleaned.length === 0) {
      return [];
    }

    // Run a local PDSE score on the completed code to annotate quality
    const fullCode = prefix + cleaned + suffix;
    let gateLabel = "";
    try {
      const score = runLocalPDSEScorer(fullCode, projectRoot);
      const passLabel = score.overall >= pdseThreshold ? "PASS" : "WARN";
      gateLabel = ` [PDSE: ${score.overall} ${passLabel}]`;
    } catch {
      // If PDSE scoring fails, omit the gate label rather than blocking completion
      gateLabel = "";
    }

    // Create the inline completion item
    const item = new vscode.InlineCompletionItem(cleaned, new vscode.Range(position, position));

    // Attach PDSE gate info as a filter text that VS Code uses for sorting
    item.filterText = `dantecode${gateLabel}`;

    return [item];
  }

  /**
   * Streams a completion from the model router, returning text as soon as
   * possible. For single-line completions, consumption stops at the first
   * newline character. For multi-line completions, the full stream is consumed.
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
      // For single-line completions, return as soon as we have a complete line
      if (!isMultiline && text.includes("\n")) {
        text = text.split("\n")[0]!;
        break;
      }
    }

    return text;
  }

  /**
   * Looks up a cache entry by key. Returns the cached items if the entry
   * exists and has not expired, or undefined otherwise.
   */
  private lookupCache(key: string): vscode.InlineCompletionItem[] | undefined {
    const now = Date.now();
    const index = this.cache.findIndex((entry) => entry.key === key);

    if (index === -1) {
      return undefined;
    }

    const entry = this.cache[index]!;

    // Evict if stale
    if (now - entry.timestamp > CACHE_TTL_MS) {
      this.cache.splice(index, 1);
      return undefined;
    }

    return entry.items;
  }

  /**
   * Stores a completion result in the cache. Evicts the oldest entry
   * if the cache is at capacity.
   */
  private storeCache(key: string, items: vscode.InlineCompletionItem[]): void {
    // Remove existing entry for this key if present
    const existingIndex = this.cache.findIndex((entry) => entry.key === key);
    if (existingIndex !== -1) {
      this.cache.splice(existingIndex, 1);
    }

    // Evict oldest if at capacity
    while (this.cache.length >= MAX_CACHE_SIZE) {
      this.cache.shift();
    }

    this.cache.push({
      key,
      items,
      timestamp: Date.now(),
    });
  }

  /**
   * Clears the entire completion cache. Called when the model is switched
   * or the user explicitly requests a cache reset.
   */
  clearCache(): void {
    this.cache.length = 0;
  }
}

function shouldUseMultilineCompletion(prefix: string, suffix: string): boolean {
  const trimmedPrefix = prefix.trimEnd();
  if (trimmedPrefix.length === 0) {
    return false;
  }

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

/**
 * Parses a model string like "grok/grok-3" into a [provider, modelId] tuple.
 * Bare model IDs are resolved via the shared runtime catalog heuristics.
 */
function parseModelString(model: string): [string, string] {
  const parsed = parseModelReference(model);
  return [parsed.provider, parsed.modelId];
}

/**
 * Removes common LLM artifacts from completion text: markdown code fences,
 * leading/trailing whitespace (beyond a single trailing newline), and
 * any "```language" blocks that the model may have wrapped around the output.
 */
function cleanCompletionText(text: string): string {
  let cleaned = text;

  // Strip markdown code fences (```language ... ```)
  const fenceMatch = cleaned.match(/^```\w*\n([\s\S]*?)```\s*$/);
  if (fenceMatch?.[1] !== undefined) {
    cleaned = fenceMatch[1];
  }

  // Remove any leading/trailing backtick lines that are not part of a fence
  cleaned = cleaned.replace(/^`{3}\w*\n?/, "").replace(/\n?`{3}\s*$/, "");

  // Trim trailing whitespace but preserve intentional indentation
  cleaned = cleaned.replace(/\s+$/, "");

  return cleaned;
}
