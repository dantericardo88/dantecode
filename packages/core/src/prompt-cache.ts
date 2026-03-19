// ============================================================================
// Prompt Cache — Anthropic cache_control markers for cost reduction
// Inspired by Aider's prompt caching strategy (up to 90% cost reduction).
// Marks stable prompt sections for caching by the Anthropic API.
// ============================================================================

/** A section of the prompt that may be cacheable. */
export interface CacheableSection {
  /** The text content of this section */
  content: string;
  /** Whether this section should have cache_control markers */
  cacheable: boolean;
  /** Cache breakpoint type (defaults to "ephemeral") */
  cacheType?: "ephemeral";
}

/**
 * Check whether the current provider supports prompt caching.
 * Currently only Anthropic's API supports cache_control.
 */
export function shouldUsePromptCache(provider: string): boolean {
  return provider === "anthropic";
}

/**
 * Build a cacheable prompt structure by marking stable sections.
 * Stable sections (system prompt, tool definitions) rarely change and
 * benefit greatly from caching. Dynamic sections (repo map, active files)
 * change per-request and should not be cached.
 *
 * @param systemPromptStatic - The static portion of the system prompt
 * @param toolDefinitions - Serialized tool definitions (stable per session)
 * @param dynamicContext - Per-request context (repo map, active files, etc.)
 * @returns Array of sections with cache markers
 */
export function buildCacheablePrompt(
  systemPromptStatic: string,
  toolDefinitions: string,
  dynamicContext?: string,
): CacheableSection[] {
  const sections: CacheableSection[] = [
    {
      content: systemPromptStatic,
      cacheable: true,
      cacheType: "ephemeral",
    },
    {
      content: toolDefinitions,
      cacheable: true,
      cacheType: "ephemeral",
    },
  ];

  if (dynamicContext) {
    sections.push({
      content: dynamicContext,
      cacheable: false,
    });
  }

  return sections;
}

/**
 * Convert cacheable sections into Anthropic API format with cache_control markers.
 * Each cacheable section gets `{ type: "text", text: "...", cache_control: { type: "ephemeral" } }`.
 */
export function toCacheControlBlocks(
  sections: CacheableSection[],
): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  return sections.map((section) => {
    const block: { type: "text"; text: string; cache_control?: { type: "ephemeral" } } = {
      type: "text",
      text: section.content,
    };
    if (section.cacheable) {
      block.cache_control = { type: section.cacheType ?? "ephemeral" };
    }
    return block;
  });
}

/**
 * Estimate prompt cache savings based on section sizes.
 * Returns the percentage of the prompt that can be cached.
 */
export function estimateCacheSavings(sections: CacheableSection[]): number {
  const totalChars = sections.reduce((sum, s) => sum + s.content.length, 0);
  if (totalChars === 0) return 0;

  const cacheableChars = sections
    .filter((s) => s.cacheable)
    .reduce((sum, s) => sum + s.content.length, 0);

  return cacheableChars / totalChars;
}
