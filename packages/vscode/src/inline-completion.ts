// ============================================================================
// DanteCode VS Code Extension — Inline Completion Provider
// Provides ghost-text inline completions by sending the document prefix,
// suffix, and language to the model router. Includes debouncing, caching,
// and PDSE gate status annotation.
// ============================================================================

import * as vscode from "vscode";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";
import { ModelRouterImpl } from "@dantecode/core";
import { runLocalPDSEScorer } from "@dantecode/danteforge";

/**
 * Debounce delay in milliseconds. The provider waits this long after the
 * last keystroke before sending a completion request to the model.
 */
const DEBOUNCE_MS = 500;

/**
 * Maximum number of cached completions to retain. Older entries are evicted
 * using a simple FIFO strategy.
 */
const MAX_CACHE_SIZE = 50;

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
const CACHE_TTL_MS = 30_000;

/**
 * DanteCodeCompletionProvider implements the VS Code InlineCompletionItemProvider
 * interface to deliver AI-powered ghost-text completions. It integrates with
 * the DanteCode model router for multi-provider support and runs a local PDSE
 * scorer on generated completions to annotate them with quality information.
 *
 * Features:
 * - Debounces requests (500ms after last keystroke)
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

    // Build a cache key from the prefix tail (last 200 chars), language, and position
    const prefixTail = prefix.slice(-200);
    const suffixHead = suffix.slice(0, 100);
    const cacheKey = `${language}:${position.line}:${position.character}:${prefixTail}:${suffixHead}`;

    // Check the cache for a recent matching entry
    const cached = this.lookupCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Debounce: wait DEBOUNCE_MS after the last keystroke
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
      }, DEBOUNCE_MS);
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
    const modelString = config.get<string>("defaultModel", "grok/grok-3");
    const pdseThreshold = config.get<number>("pdseThreshold", 85);

    const [provider, modelId] = parseModelString(modelString);

    const modelConfig: ModelConfig = {
      provider: provider as ModelConfig["provider"],
      modelId,
      maxTokens: 256,
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

    // Build the fill-in-the-middle prompt
    const systemPrompt = [
      `You are a code completion engine. Complete the code at the cursor position.`,
      `Language: ${language}`,
      `File: ${filePath}`,
      `Return ONLY the completion text. No explanations, no markdown fences, no prefixes.`,
      `The completion should naturally continue from the prefix and lead into the suffix.`,
    ].join("\n");

    const userPrompt = [
      `<prefix>`,
      prefix.slice(-2000),
      `</prefix>`,
      `<suffix>`,
      suffix.slice(0, 1000),
      `</suffix>`,
      `Complete the code at the cursor position between <prefix> and <suffix>.`,
      `Return ONLY the raw completion text.`,
    ].join("\n");

    // Check for cancellation before making the network request
    if (token.isCancellationRequested) {
      return [];
    }

    const completionText = await router.generate([{ role: "user", content: userPrompt }], {
      system: systemPrompt,
      maxTokens: 256,
    });

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

/**
 * Parses a model string like "grok/grok-3" into a [provider, modelId] tuple.
 * If no slash is present, defaults to "grok" as the provider.
 */
function parseModelString(model: string): [string, string] {
  const slashIndex = model.indexOf("/");
  if (slashIndex >= 0) {
    return [model.substring(0, slashIndex), model.substring(slashIndex + 1)];
  }
  return ["grok", model];
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
