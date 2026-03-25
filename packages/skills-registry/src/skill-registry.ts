// ============================================================================
// @dantecode/skills-registry — In-Memory Skill Registry
// Manages registered skills with scope tracking and collision detection.
// ============================================================================

import type { SkillEntry } from "./discover-skills.js";
import { resolveSkillPrecedence } from "./resolve-skill-precedence.js";

export interface RegistryCollision {
  /** The name that collides. */
  name: string;
  /** All entries with this name across scopes. */
  entries: SkillEntry[];
}

export class SkillRegistry {
  private _entries: SkillEntry[] = [];
  private _collisions: RegistryCollision[] = [];

  /**
   * Register a batch of discovered entries. Detects collisions.
   * A collision is when the same name appears more than once across all registered entries.
   */
  register(entries: SkillEntry[]): void {
    this._entries.push(...entries);
    this._detectCollisions();
  }

  /**
   * Look up a skill by name.
   * Returns highest-precedence entry (project > user > compat).
   */
  lookup(name: string): SkillEntry | undefined {
    const resolved = resolveSkillPrecedence(this._entries);
    return resolved.find((e) => e.name === name);
  }

  /**
   * List all non-disabled entries (resolved by precedence).
   */
  list(): SkillEntry[] {
    const resolved = resolveSkillPrecedence(this._entries);
    return resolved.filter((e) => !e.disabled);
  }

  /**
   * List all collisions detected.
   */
  getCollisions(): RegistryCollision[] {
    return [...this._collisions];
  }

  /**
   * Check if a collision exists for the given name.
   */
  hasCollision(name: string): boolean {
    return this._collisions.some((c) => c.name === name);
  }

  /**
   * Clear and re-populate from a fresh set of entries.
   */
  reset(entries: SkillEntry[]): void {
    this._entries = [];
    this._collisions = [];
    this.register(entries);
  }

  /**
   * Return all entries for all scopes (raw, unresolved).
   */
  listAll(): SkillEntry[] {
    return [...this._entries];
  }

  /**
   * Internal: detect collisions from the current _entries list.
   * A collision exists when the same name appears more than once.
   */
  private _detectCollisions(): void {
    const byName = new Map<string, SkillEntry[]>();

    for (const entry of this._entries) {
      const existing = byName.get(entry.name);
      if (existing === undefined) {
        byName.set(entry.name, [entry]);
      } else {
        existing.push(entry);
      }
    }

    this._collisions = [];
    for (const [name, entries] of byName) {
      if (entries.length > 1) {
        this._collisions.push({ name, entries });
      }
    }
  }
}
