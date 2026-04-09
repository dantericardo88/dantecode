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
import {
  runFearSetEngine,
  type FearSetCallbacks,
  type FearSetEngineOptions,
} from "./fearset-engine.js";
import { classifyRiskWithLlm, buildFearSetTrigger } from "./risk-classifier.js";
import { computeFearSetStats, formatFearSetStats } from "./fearset-stats.js";
import { distillFearSetLesson } from "./lesson-distiller.js";
import { FearSetResultStore } from "./fearset-result-store.js";
import type { FearSetConfig, FearSetResult } from "@dantecode/runtime-spine";
import { DEFAULT_FEARSET_CONFIG } from "@dantecode/runtime-spine";

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
  priorLessonProvider?: (draft: string, taskClass?: string) => Promise<string[]> | string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration class
// ─────────────────────────────────────────────────────────────────────────────

export class DanteGaslightIntegration {
  private config: GaslightConfig;
  private fearSetConfig: FearSetConfig;
  private sessions: GaslightSession[] = [];
  private fearSetResults: FearSetResult[] = [];
  private store: GaslightSessionStore;
  private resultStore: FearSetResultStore;
  private options: GaslightIntegrationOptions;

  constructor(
    config: Partial<GaslightConfig> = {},
    storeOptions: SessionStoreOptions = {},
    options: GaslightIntegrationOptions = {},
    fearSetConfig: Partial<FearSetConfig> = {},
  ) {
    this.config = { ...DEFAULT_GASLIGHT_CONFIG, ...config };
    this.fearSetConfig = { ...DEFAULT_FEARSET_CONFIG, ...fearSetConfig };
    this.store = new GaslightSessionStore(storeOptions);
    this.resultStore = new FearSetResultStore({ cwd: storeOptions.cwd });
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
    /**
     * Confidence score from ConfidenceSynthesizer (0-1).
     * When below 0.5, fires the "novel-task" trigger channel.
     */
    confidenceScore?: number;
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
      confidenceScore: opts.confidenceScore,
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
  // DanteFearSet surface
  // ─────────────────────────────────────────────────────────────────────────

  /** Enable or disable FearSet. */
  setFearSetEnabled(enabled: boolean): void {
    this.fearSetConfig = { ...this.fearSetConfig, enabled };
  }

  /** Get the current FearSet config. */
  getFearSetConfig(): Readonly<FearSetConfig> {
    return { ...this.fearSetConfig };
  }

  /**
   * Run a FearSet session explicitly (used by /fearset command).
   *
   * @param context - The decision or task to fear-set.
   * @param callbacks - LLM + sandbox hooks.
   * @param engineOpts - Optional config overrides and prior lessons.
   */
  async runFearSet(
    context: string,
    callbacks: FearSetCallbacks = {},
    engineOpts: FearSetEngineOptions = {},
  ): Promise<FearSetResult> {
    const trigger = {
      channel: "explicit-user" as const,
      rationale: "Manual /fearset invocation.",
      at: new Date().toISOString(),
    };
    const result = await runFearSetEngine(context, trigger, callbacks, {
      ...engineOpts,
      config: { ...this.fearSetConfig, enabled: true, ...engineOpts.config },
    });
    this.fearSetResults.push(result);
    this.resultStore.save(result);
    if (this.fearSetConfig.maxResults > 0) {
      this.resultStore.cleanup(this.fearSetConfig.maxResults);
    }
    return result;
  }

  /**
   * Auto-trigger FearSet if the message/task meets risk criteria.
   * Returns null if FearSet is disabled or no trigger fires.
   */
  async maybeFearSet(opts: {
    message: string;
    taskClass?: string;
    verificationScore?: number;
    priorFailureCount?: number;
    priorLessons?: string[];
    callbacks?: FearSetCallbacks;
  }): Promise<FearSetResult | null> {
    // Two-tier hybrid classification:
    // Tier 1 (sync regex) runs first — zero latency fast path.
    // Tier 2 (LLM semantic) only fires when Tier 1 misses AND onClassify is provided.
    const classification = await classifyRiskWithLlm(
      opts.message,
      {
        taskClass: opts.taskClass,
        verificationScore: opts.verificationScore,
        priorFailureCount: opts.priorFailureCount,
        config: this.fearSetConfig,
      },
      opts.callbacks?.onClassify,
    );

    if (!classification.shouldTrigger) return null;

    const trigger = buildFearSetTrigger(classification, {
      taskClass: opts.taskClass,
    });
    if (!trigger) return null;

    const result = await runFearSetEngine(opts.message, trigger, opts.callbacks ?? {}, {
      config: this.fearSetConfig,
      priorLessons: opts.priorLessons,
    });
    this.fearSetResults.push(result);
    this.resultStore.save(result);
    if (this.fearSetConfig.maxResults > 0) {
      this.resultStore.cleanup(this.fearSetConfig.maxResults);
    }
    return result;
  }

  /**
   * Distill all passed, undistilled FearSet results into Skillbook proposals.
   * Uses disk-level markDistilled for replay protection across restarts.
   */
  distillFearSetLessons(): ReturnType<typeof distillFearSetLesson> {
    const allLessons: ReturnType<typeof distillFearSetLesson> = [];
    const merged = this._mergedFearSetResults();

    for (const result of merged) {
      if (!result.passed || result.distilledAt) continue;
      const lessons = distillFearSetLesson(result);
      allLessons.push(...lessons);
      // Persist distilledAt to disk for replay protection
      this.resultStore.markDistilled(result.id);
      // Also update in-memory copy
      const inMemIdx = this.fearSetResults.findIndex((r) => r.id === result.id);
      if (inMemIdx >= 0) {
        this.fearSetResults[inMemIdx] = {
          ...this.fearSetResults[inMemIdx]!,
          distilledAt: new Date().toISOString(),
        };
      }
    }

    return allLessons;
  }

  /**
   * Get all FearSet results (in-memory + disk, deduped by id, newest-first).
   * In-memory results shadow disk versions with the same ID.
   */
  getFearSetResults(): FearSetResult[] {
    return this._mergedFearSetResults();
  }

  // ─── /fearset slash commands ───────────────────────────────────────────────

  /** Slash command: /fearset on */
  cmdFearSetOn(): string {
    this.setFearSetEnabled(true);
    return "DanteFearSet enabled. I will run Fear-Setting (Define\u2192Prevent\u2192Repair+Benefits+Inaction) on risky or high-stakes tasks.";
  }

  /** Slash command: /fearset off */
  cmdFearSetOff(): string {
    this.setFearSetEnabled(false);
    return "DanteFearSet disabled.";
  }

  /** Slash command: /fearset stats */
  cmdFearSetStats(): string {
    return formatFearSetStats(computeFearSetStats(this._mergedFearSetResults()));
  }

  /** Slash command: /fearset review — shows last result summary */
  cmdFearSetReview(): string {
    const all = this._mergedFearSetResults();
    if (all.length === 0) return "No FearSet runs recorded yet.";
    const last = all[0]!;
    const columnsCompleted = last.columns.map((c) => c.name).join(", ");
    return [
      `Last FearSet run: ${last.id}`,
      `  Context: ${last.context.slice(0, 80)}`,
      `  Trigger: ${last.trigger.channel}`,
      `  Mode: ${last.mode}`,
      `  Columns: ${columnsCompleted}`,
      `  Robustness: ${last.robustnessScore?.overall.toFixed(2) ?? "n/a"} (${last.robustnessScore?.gateDecision ?? "pending"})`,
      `  Passed: ${last.passed}`,
      ...(last.stopReason ? [`  Stop reason: ${last.stopReason}`] : []),
      ...(last.synthesizedRecommendation
        ? [
            `  Recommendation: ${last.synthesizedRecommendation.decision.toUpperCase()} — ${last.synthesizedRecommendation.reasoning.slice(0, 80)}`,
          ]
        : []),
      ...(last.distilledAt ? [`  Distilled at: ${last.distilledAt}`] : []),
    ].join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Merge in-memory FearSet results with disk results, newest-first.
   * In-memory results shadow disk versions with the same ID.
   */
  private _mergedFearSetResults(): FearSetResult[] {
    const inMemIds = new Set(this.fearSetResults.map((r) => r.id));
    const diskOnly = this.resultStore.list().filter((r) => !inMemIds.has(r.id));
    return [...this.fearSetResults, ...diskOnly].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

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
