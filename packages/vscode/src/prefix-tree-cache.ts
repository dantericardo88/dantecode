// ============================================================================
// DanteCode VS Code Extension -- Prefix Tree (Trie) Cache
// A trie-backed LRU cache for FIM completions. Given a code prefix string
// the cache returns the completion associated with the longest matching
// prefix, enabling partial reuse of earlier results when the user continues
// typing on the same line.
// ============================================================================

/**
 * Internal trie node. Each node stores an optional completion value and a
 * map of children keyed by the next character.
 */
interface TrieNode {
  children: Map<string, TrieNode>;
  /** The completion text stored at this node, or `undefined` if no entry terminates here. */
  value: string | undefined;
  /** Timestamp of last access -- used for LRU eviction. */
  lastAccess: number;
}

function createNode(): TrieNode {
  return { children: new Map(), value: undefined, lastAccess: 0 };
}

/**
 * A trie-based LRU cache for FIM inline completions.
 *
 * - **`set(prefix, completion)`** stores a completion keyed by a prefix string.
 * - **`get(prefix)`** walks the trie from the root, collecting the deepest
 *   node that holds a value, and returns its completion. This means a query
 *   for `"function foo"` will match an earlier entry stored under `"function f"`.
 * - When the number of stored entries exceeds `maxEntries` the least-recently
 *   accessed entry is evicted.
 * - **`onDocumentChange(uri, changeStartLine, newVersion)`** invalidates the
 *   cache when an edit occurs at or above the last known cursor line for a file.
 */
export class PrefixTreeCache {
  private readonly root: TrieNode = createNode();
  private readonly maxEntries: number;
  private entryCount = 0;

  /** Per-file last-seen document version (for change tracking). */
  private fileVersions = new Map<string, number>();

  /** Per-file last cursor line (to detect edits above cursor). */
  private lastCursorByFile = new Map<string, number>();

  constructor(maxEntries = 100) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Returns the completion for the longest prefix of `prefix` that exists
   * in the trie, or `undefined` if no prefix matches at all.
   */
  get(prefix: string): string | undefined {
    let node: TrieNode = this.root;
    let bestValue: string | undefined;
    let bestNode: TrieNode | undefined;

    // Check the root itself -- an empty-string key is stored here.
    if (node.value !== undefined) {
      bestValue = node.value;
      bestNode = node;
    }

    for (const ch of prefix) {
      const child = node.children.get(ch);
      if (!child) {
        break;
      }
      node = child;
      if (node.value !== undefined) {
        bestValue = node.value;
        bestNode = node;
      }
    }

    // Update LRU timestamp on access.
    if (bestNode) {
      bestNode.lastAccess = Date.now();
    }

    return bestValue;
  }

  /**
   * Stores `completion` under the exact key `prefix`. If an entry already
   * exists for `prefix` it is overwritten without changing the entry count.
   * When the cache exceeds `maxEntries`, the least-recently accessed entry
   * is evicted.
   */
  set(prefix: string, completion: string): void {
    let node: TrieNode = this.root;

    for (const ch of prefix) {
      let child = node.children.get(ch);
      if (!child) {
        child = createNode();
        node.children.set(ch, child);
      }
      node = child;
    }

    if (node.value === undefined) {
      this.entryCount++;
    }

    node.value = completion;
    node.lastAccess = Date.now();

    // Evict least-recently used entries if over capacity.
    while (this.entryCount > this.maxEntries) {
      this.evictLRU();
    }
  }

  /**
   * Removes all entries from the cache.
   */
  clear(): void {
    this.root.children.clear();
    this.entryCount = 0;
  }

  /**
   * The number of stored completion entries.
   */
  get size(): number {
    return this.entryCount;
  }

  /**
   * Called when a document changes. Invalidates the entire trie cache when
   * the edit starts at or above the last known cursor line for that file.
   *
   * The trie does not store per-URI keys, so when an edit above the cursor
   * is detected we clear the whole cache -- any cached completion may now be
   * stale because the prefix context has changed.
   */
  onDocumentChange(uri: string, changeStartLine: number, newVersion: number): void {
    const lastLine = this.lastCursorByFile.get(uri) ?? 0;
    if (changeStartLine <= lastLine) {
      // Edit is at or above the cursor -- prefix context has changed.
      this.clear();
      this.fileVersions.set(uri, newVersion);
    }
  }

  /**
   * Update the tracked cursor line for a file. Call this each time a
   * completion is requested so `onDocumentChange` has an accurate reference.
   */
  updateCursorPosition(uri: string, line: number): void {
    this.lastCursorByFile.set(uri, line);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Walks the entire trie to find and remove the entry with the oldest
   * `lastAccess` timestamp. Also prunes empty branch chains.
   */
  private evictLRU(): void {
    let oldestTime = Infinity;
    let oldestPath: string[] = [];

    const walk = (node: TrieNode, path: string[]): void => {
      if (node.value !== undefined && node.lastAccess < oldestTime) {
        oldestTime = node.lastAccess;
        oldestPath = [...path];
      }
      for (const [ch, child] of node.children) {
        walk(child, [...path, ch]);
      }
    };

    walk(this.root, []);

    if (oldestPath.length === 0) {
      // Should not happen, but guard defensively.
      return;
    }

    // Remove the value at the oldest path.
    let node: TrieNode = this.root;
    for (const ch of oldestPath) {
      const child = node.children.get(ch);
      if (!child) {
        return; // Defensive: tree was mutated concurrently.
      }
      node = child;
    }
    node.value = undefined;
    this.entryCount--;

    // Prune empty leaf chains from the bottom up.
    this.pruneChain(oldestPath);
  }

  /**
   * Walks the path from root to the node at `path`, then removes trailing
   * nodes that have no children and no value (empty leaves).
   */
  private pruneChain(path: string[]): void {
    // Build the chain of (parent, char, child) tuples.
    const chain: Array<{ parent: TrieNode; char: string; child: TrieNode }> = [];
    let current: TrieNode = this.root;
    for (const ch of path) {
      const child = current.children.get(ch);
      if (!child) {
        return;
      }
      chain.push({ parent: current, char: ch, child });
      current = child;
    }

    // Walk backwards and prune while the node is a dead leaf.
    for (let i = chain.length - 1; i >= 0; i--) {
      const link = chain[i]!;
      if (link.child.children.size === 0 && link.child.value === undefined) {
        link.parent.children.delete(link.char);
      } else {
        break;
      }
    }
  }
}
