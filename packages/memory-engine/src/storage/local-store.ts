// ============================================================================
// @dantecode/memory-engine — Local Store
// File-based persistence for the long-term memory layers.
// Stores MemoryItems as JSON files in .dantecode/memory/<scope>/<layer>/.
// ============================================================================

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryItem, MemoryLayer, MemoryScope } from "../types.js";

const DEFAULT_MEMORY_DIR = ".dantecode/memory";

export interface LocalStoreOptions {
  baseDir?: string;
  writeFileFn?: (path: string, data: string) => Promise<void>;
  readFileFn?: (path: string) => Promise<string>;
  mkdirFn?: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  readdirFn?: (path: string) => Promise<string[]>;
  unlinkFn?: (path: string) => Promise<void>;
}

/**
 * File-based local store.
 *
 * Directory structure:
 * ```
 * {projectRoot}/{baseDir}/{scope}/{layer}/
 *   {key}.json  — individual MemoryItem files
 * ```
 *
 * - Scope isolation: separate directories per scope+layer
 * - Atomic: each item is a separate file (no full-store rewrites)
 * - Index file per directory for fast listing
 */
export class LocalStore {
  private readonly projectRoot: string;
  private readonly baseDir: string;
  private readonly writeFileFn: (p: string, d: string) => Promise<void>;
  private readonly readFileFn: (p: string) => Promise<string>;
  private readonly mkdirFn: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  private readonly readdirFn: (p: string) => Promise<string[]>;
  private readonly unlinkFn: (p: string) => Promise<void>;

  constructor(projectRoot: string, options: LocalStoreOptions = {}) {
    this.projectRoot = projectRoot;
    this.baseDir = options.baseDir ?? DEFAULT_MEMORY_DIR;
    this.writeFileFn = options.writeFileFn ?? ((p, d) => writeFile(p, d, "utf-8"));
    this.readFileFn = options.readFileFn ?? ((p) => readFile(p, "utf-8"));
    this.mkdirFn =
      options.mkdirFn ??
      ((p, opts) => mkdir(p, { recursive: opts?.recursive ?? true }).then(() => undefined));
    this.readdirFn = options.readdirFn ?? ((p) => readdir(p).then((e) => e.map(String)));
    this.unlinkFn = options.unlinkFn ?? unlink;
  }

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  /** Persist a MemoryItem to disk. */
  async put(item: MemoryItem): Promise<void> {
    const dir = this.layerDir(item.scope, item.layer);
    await this.mkdirFn(dir, { recursive: true });
    const filePath = join(dir, this.fileName(item.key));
    await this.writeFileFn(filePath, JSON.stringify(item, null, 2));
  }

  /** Persist multiple items in sequence. */
  async putMany(items: MemoryItem[]): Promise<void> {
    for (const item of items) {
      await this.put(item);
    }
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  /** Load a single MemoryItem by key, scope, and layer. Returns null if missing. */
  async get(key: string, scope: MemoryScope, layer: MemoryLayer): Promise<MemoryItem | null> {
    const filePath = join(this.layerDir(scope, layer), this.fileName(key));
    try {
      const raw = await this.readFileFn(filePath);
      return JSON.parse(raw) as MemoryItem;
    } catch {
      return null;
    }
  }

  /** List all items in a scope+layer. Returns empty array if directory missing. */
  async list(scope: MemoryScope, layer: MemoryLayer): Promise<MemoryItem[]> {
    const dir = this.layerDir(scope, layer);
    try {
      const files = await this.readdirFn(dir);
      const items: MemoryItem[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await this.readFileFn(join(dir, file));
          items.push(JSON.parse(raw) as MemoryItem);
        } catch {
          // Skip corrupted files
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  /** List all items across all known scopes + layers. */
  async listAll(): Promise<MemoryItem[]> {
    const scopes: MemoryScope[] = ["session", "project", "user", "global"];
    const layers: MemoryLayer[] = ["checkpoint", "semantic", "entity", "snapshot"];
    const all: MemoryItem[] = [];
    for (const scope of scopes) {
      for (const layer of layers) {
        const items = await this.list(scope, layer);
        all.push(...items);
      }
    }
    return all;
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  /** Delete a single item. Returns true if it existed. */
  async delete(key: string, scope: MemoryScope, layer: MemoryLayer): Promise<boolean> {
    const filePath = join(this.layerDir(scope, layer), this.fileName(key));
    try {
      await this.unlinkFn(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Delete all items in a scope+layer. Returns count deleted. */
  async deleteAll(scope: MemoryScope, layer: MemoryLayer): Promise<number> {
    const dir = this.layerDir(scope, layer);
    try {
      const files = await this.readdirFn(dir);
      let count = 0;
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          await this.unlinkFn(join(dir, file));
          count++;
        } catch {
          // ignore
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  /** Delete multiple items by key list. */
  async deleteBatch(
    keys: string[],
    scope: MemoryScope,
    layer: MemoryLayer,
  ): Promise<number> {
    let count = 0;
    for (const key of keys) {
      const deleted = await this.delete(key, scope, layer);
      if (deleted) count++;
    }
    return count;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private layerDir(scope: MemoryScope, layer: MemoryLayer): string {
    return join(this.projectRoot, this.baseDir, scope, layer);
  }

  /** Sanitize key to safe filename. */
  private fileName(key: string): string {
    return key.replace(/[/\\:*?"<>|]/g, "_").slice(0, 200) + ".json";
  }

  /** Exposed for testing. */
  getBaseDir(): string {
    return join(this.projectRoot, this.baseDir);
  }
}
