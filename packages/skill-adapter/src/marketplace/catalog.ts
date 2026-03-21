// ============================================================================
// @dantecode/skill-adapter — Skill Catalog
// In-memory catalog with search, filter, and persistence.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { SkillSourceFormat } from "../parsers/universal-parser.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface CatalogEntry {
  name: string;
  description: string;
  source: SkillSourceFormat;
  sourcePath: string;
  installedPath: string;
  version: string; // semver or "0.0.0"
  author?: string;
  tags: string[];
  verificationScore?: number;
  verificationTier?: string;
  installedAt: string; // ISO timestamp
  updatedAt: string;
}

// ----------------------------------------------------------------------------
// SkillCatalog
// ----------------------------------------------------------------------------

/**
 * In-memory skill catalog backed by `.dantecode/skill-catalog.json`.
 * Supports search, filter by tag/source/tier, upsert, remove, and persistence.
 */
export class SkillCatalog {
  private entries: Map<string, CatalogEntry> = new Map();
  private catalogPath: string;

  constructor(projectRoot: string) {
    this.catalogPath = join(projectRoot, ".dantecode", "skill-catalog.json");
  }

  /**
   * Loads the catalog from disk. Creates an empty catalog on ENOENT.
   * Resets to empty if the stored JSON is invalid.
   */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.catalogPath, "utf-8");
    } catch (err: unknown) {
      if (isEnoent(err)) {
        this.entries = new Map();
        return;
      }
      // Other read errors — reset to empty
      this.entries = new Map();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.entries = new Map();
      return;
    }

    if (!Array.isArray(parsed)) {
      this.entries = new Map();
      return;
    }

    this.entries = new Map();
    for (const item of parsed) {
      if (isCatalogEntry(item)) {
        this.entries.set(item.name, item);
      }
    }
  }

  /**
   * Saves the catalog to disk with 2-space indentation.
   * Creates parent directories as needed.
   */
  async save(): Promise<void> {
    const dir = dirname(this.catalogPath);
    await mkdir(dir, { recursive: true });
    const data = JSON.stringify(Array.from(this.entries.values()), null, 2);
    await writeFile(this.catalogPath, data, "utf-8");
  }

  /**
   * Case-insensitive search across name, description, and tags.
   * Returns all entries if query is empty.
   */
  search(query: string): CatalogEntry[] {
    if (!query.trim()) {
      return this.getAll();
    }
    const q = query.toLowerCase();
    return Array.from(this.entries.values()).filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  /**
   * Returns entries where the tags array contains `tag` (case-insensitive).
   */
  filterByTag(tag: string): CatalogEntry[] {
    const t = tag.toLowerCase();
    return Array.from(this.entries.values()).filter((e) =>
      e.tags.some((et) => et.toLowerCase() === t),
    );
  }

  /**
   * Returns entries matching the given source format.
   */
  filterBySource(source: SkillSourceFormat): CatalogEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.source === source);
  }

  /**
   * Returns entries matching the given verification tier.
   */
  filterByTier(tier: "guardian" | "sentinel" | "sovereign"): CatalogEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.verificationTier === tier);
  }

  private static readonly TIER_ORDER: Record<string, number> = {
    guardian: 0,
    sentinel: 1,
    sovereign: 2,
  };

  /**
   * Returns entries whose verification tier meets or exceeds the given minimum tier.
   * Entries with no verificationTier are excluded.
   */
  filterByTierMinimum(minimumTier: "guardian" | "sentinel" | "sovereign"): CatalogEntry[] {
    const minLevel = SkillCatalog.TIER_ORDER[minimumTier] ?? 0;
    return Array.from(this.entries.values()).filter((e) => {
      if (!e.verificationTier) return false;
      return (SkillCatalog.TIER_ORDER[e.verificationTier] ?? -1) >= minLevel;
    });
  }

  /**
   * Adds or replaces an entry by name.
   */
  upsert(entry: CatalogEntry): void {
    this.entries.set(entry.name, entry);
  }

  /**
   * Removes an entry by name. Returns true if found and removed.
   */
  remove(name: string): boolean {
    return this.entries.delete(name);
  }

  /**
   * Returns all entries sorted alphabetically by name.
   */
  getAll(): CatalogEntry[] {
    return Array.from(this.entries.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Returns a single entry by name, or null if not found.
   */
  get(name: string): CatalogEntry | null {
    return this.entries.get(name) ?? null;
  }
}

// ----------------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["name"] === "string" &&
    typeof v["description"] === "string" &&
    typeof v["source"] === "string" &&
    typeof v["sourcePath"] === "string" &&
    typeof v["installedPath"] === "string" &&
    typeof v["version"] === "string" &&
    Array.isArray(v["tags"]) &&
    typeof v["installedAt"] === "string" &&
    typeof v["updatedAt"] === "string"
  );
}
