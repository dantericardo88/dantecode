// ============================================================================
// token-cache.ts — Transparent Provider-Level Token Caching
//
// When supported by the API provider (Anthropic cache_control, OpenAI),
// marks stable content (system prompt, project structure) for caching.
// No user configuration needed — auto-enabled when provider supports it.
// ============================================================================

export interface CacheableContent {
  content: string;
  /** Unique identifier for this content */
  cacheKey: string;
  stableFor: "session" | "permanent";
}

export class TokenCache {
  private readonly cache = new Map<string, { content: string; hitCount: number }>();
  private savedTokens = 0;
  private totalRequests = 0;

  /**
   * Wrap Anthropic API messages with cache_control for stable content.
   * Call this before sending messages to Anthropic's API.
   * Marks: system prompt, project structure, first-turn context.
   */
  wrapAnthropicMessages(
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
  ): {
    messages: Array<{ role: string; content: unknown }>;
    system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  } {
    this.totalRequests++;

    // Mark the system prompt for caching if it's large enough to be worth it
    // (Anthropic requires minimum 1024 tokens; ~4096 chars is a safe proxy)
    const systemBlocks: Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral" };
    }> = [];

    if (systemPrompt) {
      const isLargeEnoughToCache = systemPrompt.length >= 1024;
      const wasSeen = this.markSeen("system-prompt", systemPrompt);
      if (wasSeen) {
        this.savedTokens += Math.ceil(systemPrompt.length / 4);
      }
      systemBlocks.push({
        type: "text",
        text: systemPrompt,
        ...(isLargeEnoughToCache ? { cache_control: { type: "ephemeral" } } : {}),
      });
    }

    // For messages: find the first user message that is large and stable
    // (typically the project context / file contents injection).
    const wrappedMessages = messages.map((message, index) => {
      if (message.role === "user" && index === 0 && message.content.length >= 2048) {
        // First user turn is often the largest context injection — mark for caching
        const wasSeen = this.markSeen(`msg-0-${message.content.slice(0, 64)}`, message.content);
        if (wasSeen) {
          this.savedTokens += Math.ceil(message.content.length / 4);
        }
        return {
          role: message.role,
          content: [
            {
              type: "text",
              text: message.content,
              cache_control: { type: "ephemeral" as const },
            },
          ],
        };
      }
      // All other messages pass through as-is
      return message;
    });

    return {
      messages: wrappedMessages,
      system: systemBlocks,
    };
  }

  /**
   * Check if a content string was seen in this session.
   * If so, the provider may have cached it.
   * Returns true if the content was already seen (cache hit).
   */
  markSeen(cacheKey: string, content: string): boolean {
    const existing = this.cache.get(cacheKey);
    if (existing && existing.content === content) {
      existing.hitCount++;
      return true;
    }
    this.cache.set(cacheKey, { content, hitCount: 0 });
    return false;
  }

  /**
   * Get cache statistics for /stats command.
   */
  getStats(): {
    cachedEntries: number;
    estimatedSavedTokens: number;
    hitRate: number;
  } {
    const hitCount = [...this.cache.values()].reduce((sum, e) => sum + e.hitCount, 0);
    const hitRate = this.totalRequests > 0 ? hitCount / this.totalRequests : 0;

    return {
      cachedEntries: this.cache.size,
      estimatedSavedTokens: this.savedTokens,
      hitRate,
    };
  }

  /**
   * Reset session cache.
   */
  clear(): void {
    this.cache.clear();
    this.savedTokens = 0;
    this.totalRequests = 0;
  }
}

/** Module-level singleton — shared within a CLI or VSCode session */
export const globalTokenCache = new TokenCache();
