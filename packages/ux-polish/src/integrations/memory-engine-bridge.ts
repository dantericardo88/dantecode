/**
 * memory-engine-bridge.ts — @dantecode/ux-polish
 *
 * G19 — Memory Engine / UXPreferences weld.
 * Wires UXPreferences to a MemoryOrchestrator-compatible store so that
 * preferences survive cross-session recall (not just file persistence).
 *
 * Uses a structural interface to avoid circular dependencies with
 * @dantecode/memory-engine.
 */

import { UXPreferences } from "../preferences/ux-preferences.js";
import type { UXPreferenceRecord } from "../types.js";

// ---------------------------------------------------------------------------
// Structural interface — mirrors MemoryOrchestrator public API
// ---------------------------------------------------------------------------

/** Structural match for MemoryOrchestrator (avoids circular dep). */
export interface MemoryOrchestratorLike {
  memoryStore(key: string, value: unknown, scope?: string): Promise<void>;
  memoryRecall(
    query: string,
    limit?: number,
    scope?: string,
  ): Promise<Array<{ key: string; value: unknown }>>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface MemoryEnginePreferencesOptions {
  /** UXPreferences instance to wrap. */
  preferences: UXPreferences;
  /** Memory orchestrator for cross-session persistence. */
  memory?: MemoryOrchestratorLike | null;
  /** Memory scope/namespace for the preferences key. Default: "ux-polish". */
  scope?: string;
  /** Key used in the memory store. Default: "uxPreferences". */
  memoryKey?: string;
}

// ---------------------------------------------------------------------------
// MemoryEnginePreferences
// ---------------------------------------------------------------------------

/**
 * Wraps UXPreferences with optional Memory Engine backing.
 *
 * - `persist()` — writes current prefs to the memory engine
 * - `restore()` — recalls prefs from memory engine and applies them
 *
 * File-based persistence from UXPreferences still operates normally;
 * this class adds a second, cross-session recall layer.
 */
export class MemoryEnginePreferences {
  private readonly _prefs: UXPreferences;
  private readonly _memory: MemoryOrchestratorLike | null;
  private readonly _scope: string;
  private readonly _key: string;

  constructor(opts: MemoryEnginePreferencesOptions) {
    this._prefs = opts.preferences;
    this._memory = opts.memory ?? null;
    this._scope = opts.scope ?? "ux-polish";
    this._key = opts.memoryKey ?? "uxPreferences";
  }

  /** The wrapped UXPreferences instance. */
  get preferences(): UXPreferences {
    return this._prefs;
  }

  /** Whether a Memory Engine is wired in. */
  get hasMemoryEngine(): boolean {
    return this._memory !== null;
  }

  /**
   * Persists the current preferences to the Memory Engine.
   * No-op if no memory engine is configured.
   */
  async persist(): Promise<void> {
    if (!this._memory) return;
    const current = this._prefs.getAll();
    await this._memory.memoryStore(this._key, current, this._scope);
  }

  /**
   * Recalls preferences from the Memory Engine and applies them.
   * Returns `true` if preferences were successfully restored, `false` otherwise.
   */
  async restore(): Promise<boolean> {
    if (!this._memory) return false;

    try {
      const results = await this._memory.memoryRecall(this._key, 1, this._scope);
      if (results.length === 0) return false;

      const recalled = results[0]!.value;
      if (!recalled || typeof recalled !== "object") return false;

      this._prefs.update(recalled as Partial<UXPreferenceRecord>);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Persists and then immediately re-reads to verify the round-trip.
   * Useful for diagnostics. Returns `true` if round-trip succeeded.
   */
  async verifyRoundTrip(): Promise<boolean> {
    if (!this._memory) return false;
    const before = this._prefs.getAll();
    await this.persist();
    const ok = await this.restore();
    if (!ok) return false;
    const after = this._prefs.getAll();
    // Spot-check a few key fields
    return (
      before.theme === after.theme &&
      before.density === after.density &&
      before.onboardingComplete === after.onboardingComplete
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton convenience
// ---------------------------------------------------------------------------

let _singleton: MemoryEnginePreferences | null = null;

export function getMemoryEnginePreferences(
  opts?: MemoryEnginePreferencesOptions,
): MemoryEnginePreferences {
  if (!_singleton) {
    if (!opts) throw new Error("MemoryEnginePreferences singleton not yet created; pass opts.");
    _singleton = new MemoryEnginePreferences(opts);
  }
  return _singleton;
}

export function resetMemoryEnginePreferences(): void {
  _singleton = null;
}
