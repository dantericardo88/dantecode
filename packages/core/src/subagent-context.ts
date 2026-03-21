import { randomUUID } from "node:crypto";

/**
 * A memory entry stored within a context slice.
 */
export interface ContextMemoryEntry {
  key: string;
  value: string;
  source: "parent" | "agent" | "tool";
  timestamp: string;
}

/**
 * An isolated context slice for a sub-agent session.
 */
export interface ContextSlice {
  id: string;
  parentContextId?: string;
  agentId: string;
  sessionId: string;
  allowedTools: string[];
  memoryEntries: ContextMemoryEntry[];
  maxDepth: number;
  currentDepth: number;
  createdAt: string;
  metadata: Record<string, unknown>;
}

/**
 * Result of merging a child context back into a parent context.
 */
export interface ContextMergeResult {
  mergedEntries: ContextMemoryEntry[];
  conflicts: string[];
  newKeys: string[];
}

/**
 * Options for creating an isolated or child context.
 */
export interface IsolatedContextOptions {
  allowedTools?: string[];
  maxDepth?: number;
  inheritMemory?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Manages isolated context slices for sub-agent sessions.
 *
 * Provides memory isolation, tool whitelisting, depth limiting, and
 * context merging so that sub-agents operate within controlled boundaries
 * and their results can be safely propagated back to the parent.
 */
export class SubAgentContext {
  constructor() {}

  /**
   * Create a fresh isolated context for a new sub-agent session.
   *
   * @param agentId - Identifier for the agent that will own this context.
   * @param options - Optional configuration (tools, depth, metadata).
   * @returns A new {@link ContextSlice} at depth 0 with no parent.
   */
  createIsolatedContext(agentId: string, options: IsolatedContextOptions = {}): ContextSlice {
    const { allowedTools = [], maxDepth = 3, metadata = {} } = options;

    return {
      id: randomUUID(),
      agentId,
      sessionId: randomUUID(),
      allowedTools: [...allowedTools],
      memoryEntries: [],
      maxDepth,
      currentDepth: 0,
      createdAt: new Date().toISOString(),
      metadata: { ...metadata },
    };
  }

  /**
   * Create a child context derived from an existing parent context.
   *
   * The child inherits the parent's depth ceiling and, optionally, its
   * memory entries.  The child's `currentDepth` is one greater than the
   * parent's.
   *
   * @param parentContext - The context from which the child derives.
   * @param agentId - Identifier for the child agent.
   * @param options - Optional overrides (tools, inheritMemory, metadata).
   * @returns A new {@link ContextSlice} linked to the parent.
   */
  createChildContext(
    parentContext: ContextSlice,
    agentId: string,
    options: IsolatedContextOptions = {},
  ): ContextSlice {
    const {
      allowedTools = [...parentContext.allowedTools],
      maxDepth = parentContext.maxDepth,
      inheritMemory = false,
      metadata = {},
    } = options;

    const memoryEntries: ContextMemoryEntry[] = inheritMemory
      ? parentContext.memoryEntries.map((e) => ({
          ...e,
          source: "parent" as const,
        }))
      : [];

    return {
      id: randomUUID(),
      parentContextId: parentContext.id,
      agentId,
      sessionId: randomUUID(),
      allowedTools: [...allowedTools],
      memoryEntries,
      maxDepth,
      currentDepth: parentContext.currentDepth + 1,
      createdAt: new Date().toISOString(),
      metadata: { ...metadata },
    };
  }

  /**
   * Check whether a context is still within its allowed nesting depth.
   *
   * @param context - The context to validate.
   * @returns `true` if `currentDepth <= maxDepth`, `false` otherwise.
   */
  validateDepthLimit(context: ContextSlice): boolean {
    return context.currentDepth <= context.maxDepth;
  }

  /**
   * Add a memory entry to a context slice.
   *
   * If an entry with the same key already exists, its value and timestamp
   * are updated in-place; the source is also updated to the latest writer.
   *
   * @param context - The context to mutate.
   * @param key - Lookup key for the entry.
   * @param value - Value to store.
   * @param source - Who produced this entry (`"parent"`, `"agent"`, or `"tool"`).
   */
  addMemoryEntry(
    context: ContextSlice,
    key: string,
    value: string,
    source: ContextMemoryEntry["source"],
  ): void {
    const existing = context.memoryEntries.find((e) => e.key === key);
    if (existing) {
      existing.value = value;
      existing.source = source;
      existing.timestamp = new Date().toISOString();
    } else {
      context.memoryEntries.push({
        key,
        value,
        source,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Retrieve a memory entry by key.
   *
   * @param context - The context to search.
   * @param key - The key to look up.
   * @returns The matching {@link ContextMemoryEntry}, or `undefined` if absent.
   */
  getMemoryEntry(context: ContextSlice, key: string): ContextMemoryEntry | undefined {
    return context.memoryEntries.find((e) => e.key === key);
  }

  /**
   * Merge child context memory entries back into the parent context.
   *
   * Entries that exist in both parent and child with different values are
   * recorded as conflicts.  New keys introduced by the child are recorded
   * in `newKeys`.  The parent context is mutated in place.
   *
   * @param parent - The parent context (mutated).
   * @param child - The child context whose entries are merged in.
   * @returns A {@link ContextMergeResult} describing the merge outcome.
   */
  mergeContextResults(parent: ContextSlice, child: ContextSlice): ContextMergeResult {
    const conflicts: string[] = [];
    const newKeys: string[] = [];

    for (const childEntry of child.memoryEntries) {
      const parentEntry = parent.memoryEntries.find((e) => e.key === childEntry.key);

      if (parentEntry) {
        if (parentEntry.value !== childEntry.value) {
          conflicts.push(childEntry.key);
          // Child result wins — overwrite parent with child's value.
          parentEntry.value = childEntry.value;
          parentEntry.source = childEntry.source;
          parentEntry.timestamp = childEntry.timestamp;
        }
      } else {
        newKeys.push(childEntry.key);
        parent.memoryEntries.push({ ...childEntry });
      }
    }

    return {
      mergedEntries: [...parent.memoryEntries],
      conflicts,
      newKeys,
    };
  }

  /**
   * Check whether a specific tool is permitted within this context.
   *
   * An empty `allowedTools` list is treated as "all tools allowed".
   *
   * @param context - The context to check against.
   * @param tool - The tool name to test.
   * @returns `true` if the tool may be used, `false` otherwise.
   */
  isToolAllowed(context: ContextSlice, tool: string): boolean {
    if (context.allowedTools.length === 0) return true;
    return context.allowedTools.includes(tool);
  }

  /**
   * Filter a list of requested tools down to only those permitted by the context.
   *
   * @param context - The context providing the allowlist.
   * @param requestedTools - The full list of tools the agent wants to use.
   * @returns The subset of `requestedTools` that are allowed.
   */
  filterTools(context: ContextSlice, requestedTools: string[]): string[] {
    if (context.allowedTools.length === 0) return [...requestedTools];
    return requestedTools.filter((t) => context.allowedTools.includes(t));
  }

  /**
   * Deep-clone a context slice, producing a fully independent copy.
   *
   * @param context - The context to clone.
   * @returns A new {@link ContextSlice} with the same data but a new `id`.
   */
  cloneContext(context: ContextSlice): ContextSlice {
    return {
      ...context,
      id: randomUUID(),
      allowedTools: [...context.allowedTools],
      memoryEntries: context.memoryEntries.map((e) => ({ ...e })),
      metadata: { ...context.metadata },
    };
  }

  /**
   * Remove all memory entries from a context slice.
   *
   * @param context - The context to clear (mutated in place).
   */
  clearMemory(context: ContextSlice): void {
    context.memoryEntries = [];
  }

  /**
   * Produce a human-readable summary of a context slice.
   *
   * @param context - The context to summarise.
   * @returns A multi-line string describing the context.
   */
  getContextSummary(context: ContextSlice): string {
    const lines: string[] = [
      `Context ID  : ${context.id}`,
      `Agent ID    : ${context.agentId}`,
      `Session ID  : ${context.sessionId}`,
      `Depth       : ${context.currentDepth} / ${context.maxDepth}`,
      `Created     : ${context.createdAt}`,
      `Parent      : ${context.parentContextId ?? "(none)"}`,
      `Tools       : ${context.allowedTools.length === 0 ? "(all)" : context.allowedTools.join(", ")}`,
      `Memory keys : ${context.memoryEntries.length === 0 ? "(none)" : context.memoryEntries.map((e) => e.key).join(", ")}`,
    ];

    const metaKeys = Object.keys(context.metadata);
    if (metaKeys.length > 0) {
      lines.push(`Metadata    : ${metaKeys.join(", ")}`);
    }

    return lines.join("\n");
  }
}
