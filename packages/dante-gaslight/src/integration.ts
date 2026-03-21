/**
 * integration.ts
 *
 * High-level DanteGaslight integration surface.
 * Manages sessions, stats, and the /gaslight slash commands.
 *
 * Sessions are persisted to disk via GaslightSessionStore so they survive
 * process restarts. The `bridge` CLI command can then load eligible sessions
 * and distill them into the Skillbook.
 *
 * Prior lessons are fed back into each critique prompt via `priorLessonProvider`,
 * closing the Gaslight→Skillbook→Gaslight feedback loop without coupling the packages.
 */

import type { GaslightConfig, GaslightSession, GaslightTrigger, GaslightStats } from "./types.js";
import { DEFAULT_GASLIGHT_CONFIG } from "./types.js";
import { detectTrigger } from "./triggers.js";
import { runIterationEngine, type EngineCallbacks } from "./iteration-engine.js";
import { computeStats } from "./stats.js";
import { GaslightSessionStore, type SessionStoreOptions } from "./session-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Integration options
// ─────────────────────────────────────────────────────────────────────────────

export interface GaslightIntegrationOptions {
  /**
   * Called before each session to retrieve prior Skillbook lessons relevant
   * to the draft being critiqued. Return an array of lesson titles/summaries.
   * These are injected into the Gaslighter prompt so the critique checks
   * whether past lessons have been applied.
   *
   * This is the wiring point for the Gaslight→Skillbook→Gaslight feedback loop.
   * The caller (agent-loop or CLI) resolves this from `getRelevantSkills()`.
   *
   * Example wiring:
   *   priorLessonProvider: (draft, taskClass) =>
   *     skillbookIntegration
   *       .getRelevantSkills({ summary: draft, taskClass })
   *       .map(s => s.title)
   */
  priorLessonProvider?: (
    draft: string,
    taskClass?: string,
  ) => Promise<string[]> | string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration class
// ─────────────────────────────────────────────────────────────────────────────

export class DanteGaslightIntegration {
  private config: GaslightConfig;
  private sessions: GaslightSession[] = [];
  private store: GaslightSessionStore;
  private options: GaslightIntegrationOptions;

  constructor(
    config: Partial<GaslightConfig> = {},
    storeOptions: SessionStoreOptions = {},
    options: GaslightIntegrationOptions = {},
  ) {
    this.config = { ...DEFAULT_GASLIGHT_CONFIG, ...config };
    this.store = new GaslightSessionStore(storeOptions);
    this.options = options;
  }

  /** Enable or disable the engine. */
  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
  }

  /** Get the current config. */
  getConfig(): Readonly<GaslightConfig> {
    return { ...this.config };
  }

  /**
   * Detect and optionally run a Gaslight session.
   * Returns null if no trigger fires or engine is disabled.
   *
   * Prior lessons are resolved automatically via `priorLessonProvider` (if
   * configured) unless `opts.priorLessons` is provided explicitly.
   */
  async maybeGaslight(opts: {
    message?: string;
    draft?: string;
    verificationScore?: number;
    taskClass?: string;
    sessionId?: string;
    /**
     * Explicit prior lessons to inject. When provided, skips `priorLessonProvider`.
     * Use this for one-off overrides; prefer configuring `priorLessonProvider`
     * on the integration for automatic wiring.
     */
    priorLessons?: string[];
    callbacks?: EngineCallbacks;
  }): Promise<GaslightSession | null> {
    const trigger = detectTrigger({
      message: opts.message,
      verificationScore: opts.verificationScore,
      taskClass: opts.taskClass,
      config: this.config,
      sessionId: opts.sessionId,
    });

    if (!trigger) return null;
    if (!opts.draft) return null;

    // Resolve prior lessons: explicit override > provider > none
    const priorLessons =
      opts.priorLessons ??
      (this.options.priorLessonProvider
        ? await this.options.priorLessonProvider(opts.draft, opts.taskClass)
        : undefined);

    return this.runSession(opts.draft, trigger, opts.callbacks, priorLessons);
  }

  /**
   * Explicitly run a Gaslight session (trigger already determined).
   *
   * - Session is persisted to disk immediately after completion.
   * - Oldest sessions are cleaned up to stay within `config.maxSessions`.
   */
  async runSession(
    draft: string,
    trigger: GaslightTrigger,
    callbacks: EngineCallbacks = {},
    priorLessons?: string[],
  ): Promise<GaslightSession> {
    const session = await runIterationEngine(draft, trigger, callbacks, {
      config: this.config,
      priorLessons,
    });
    this.sessions.push(session);
    this.store.save(session);
    // Enforce session cap — keep disk from growing unbounded
    if (this.config.maxSessions > 0) {
      this.store.cleanup(this.config.maxSessions);
    }
    return session;
  }

  /** Get aggregated stats across all sessions (in-memory + disk). */
  stats(): GaslightStats {
    return computeStats(this._mergedSessions());
  }

  /**
   * Get all sessions (in-memory + disk, deduped by sessionId).
   * In-memory sessions take precedence over disk versions.
   */
  getSessions(): GaslightSession[] {
    return this._mergedSessions();
  }

  /**
   * Get a session by ID.
   * Falls back to disk if not found in memory (handles cross-restart lookups).
   */
  getSession(sessionId: string): GaslightSession | undefined {
    return (
      this.sessions.find((s) => s.sessionId === sessionId) ??
      this.store.load(sessionId) ??
      undefined
    );
  }

  /** Slash command: /gaslight on */
  cmdOn(): string {
    this.setEnabled(true);
    return "DanteGaslight enabled. I will challenge weak outputs and run bounded refinement when triggered.";
  }

  /** Slash command: /gaslight off */
  cmdOff(): string {
    this.setEnabled(false);
    return "DanteGaslight disabled. No automatic refinement will occur.";
  }

  /** Slash command: /gaslight stats */
  cmdStats(): string {
    const s = this.stats();
    return [
      `DanteGaslight Stats:`,
      `  Total sessions: ${s.totalSessions}`,
      `  Sessions with PASS: ${s.sessionsWithPass}`,
      `  Sessions aborted: ${s.sessionsAborted}`,
      `  Avg iterations: ${s.averageIterations.toFixed(1)}`,
      `  Lesson-eligible: ${s.lessonEligibleCount}`,
      `  Distilled to Skillbook: ${s.distilledCount}`,
      `  Engine enabled: ${this.config.enabled}`,
    ].join("\n");
  }

  /** Slash command: /gaslight review — shows last session summary */
  cmdReview(): string {
    const sessions = this._mergedSessions();
    if (sessions.length === 0) return "No Gaslight sessions recorded yet.";
    const last = sessions[0] as GaslightSession;
    return [
      `Last session: ${last.sessionId}`,
      `  Trigger: ${last.trigger.channel}`,
      `  Iterations: ${last.iterations.length}`,
      `  Stop reason: ${last.stopReason ?? "in-progress"}`,
      `  Final gate: ${last.finalGateDecision ?? "none"}`,
      `  Lesson eligible: ${last.lessonEligible}`,
      ...(last.distilledAt ? [`  Distilled at: ${last.distilledAt}`] : []),
    ].join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Merge in-memory sessions with disk sessions, sorted newest-first by startedAt.
   * In-memory sessions shadow disk versions with the same ID.
   */
  private _mergedSessions(): GaslightSession[] {
    const inMemoryIds = new Set(this.sessions.map((s) => s.sessionId));
    const diskOnly = this.store.list().filter((s) => !inMemoryIds.has(s.sessionId));
    return [...this.sessions, ...diskOnly].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }
}
