/**
 * integration.ts
 *
 * High-level DanteGaslight integration surface.
 * Manages sessions, stats, and the /gaslight slash commands.
 */

import type { GaslightConfig, GaslightSession, GaslightTrigger, GaslightStats } from "./types.js";
import { DEFAULT_GASLIGHT_CONFIG } from "./types.js";
import { detectTrigger } from "./triggers.js";
import { runIterationEngine, type EngineCallbacks } from "./iteration-engine.js";
import { computeStats } from "./stats.js";

export class DanteGaslightIntegration {
  private config: GaslightConfig;
  private sessions: GaslightSession[] = [];

  constructor(config: Partial<GaslightConfig> = {}) {
    this.config = { ...DEFAULT_GASLIGHT_CONFIG, ...config };
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
   */
  async maybeGaslight(opts: {
    message?: string;
    draft?: string;
    verificationScore?: number;
    taskClass?: string;
    sessionId?: string;
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

    return this.runSession(opts.draft, trigger, opts.callbacks);
  }

  /**
   * Explicitly run a Gaslight session (trigger already determined).
   */
  async runSession(
    draft: string,
    trigger: GaslightTrigger,
    callbacks: EngineCallbacks = {},
  ): Promise<GaslightSession> {
    const session = await runIterationEngine(draft, trigger, callbacks, { config: this.config });
    this.sessions.push(session);
    return session;
  }

  /** Get aggregated stats across all sessions. */
  stats(): GaslightStats {
    return computeStats(this.sessions);
  }

  /** Get all sessions. */
  getSessions(): GaslightSession[] {
    return [...this.sessions];
  }

  /** Get a session by ID. */
  getSession(sessionId: string): GaslightSession | undefined {
    return this.sessions.find(s => s.sessionId === sessionId);
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
      `  Engine enabled: ${this.config.enabled}`,
    ].join("\n");
  }

  /** Slash command: /gaslight review — shows last session summary */
  cmdReview(): string {
    if (this.sessions.length === 0) return "No Gaslight sessions recorded yet.";
    const last = this.sessions[this.sessions.length - 1] as GaslightSession;
    return [
      `Last session: ${last.sessionId}`,
      `  Trigger: ${last.trigger.channel}`,
      `  Iterations: ${last.iterations.length}`,
      `  Stop reason: ${last.stopReason ?? "in-progress"}`,
      `  Final gate: ${last.finalGateDecision ?? "none"}`,
      `  Lesson eligible: ${last.lessonEligible}`,
    ].join("\n");
  }
}
