// ============================================================================
// Autonomy Engine — Persistent goal tracking and meta-reasoning for autonomous
// agent operation. Tracks goals across sessions, performs PDSE-gated meta-
// reasoning passes, and decides next actions based on goal state.
//
// Inspired by BabyAGI task management + AutoGPT goal tracking +
// OpenHands autonomous operation patterns.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tokenize, jaccardSimilarity } from "./approach-memory.js";

// ----------------------------------------------------------------------------
// Public interfaces
// ----------------------------------------------------------------------------

/** A single tracked goal in the autonomy engine. */
export interface AgentGoal {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Detailed description of what the goal entails. */
  description: string;
  /** Current lifecycle status. */
  status: "active" | "completed" | "abandoned" | "blocked";
  /** Higher number = higher priority (descending sort). */
  priority: number;
  /** ISO timestamp when goal was created. */
  createdAt: string;
  /** ISO timestamp when goal was last modified. */
  updatedAt: string;
  /** Observable criteria that must be true for the goal to be complete. */
  completionCriteria: string[];
  /** IDs of sub-goals that decompose this goal. */
  subGoals: string[];
  /** Free-form progress notes appended over time. */
  progressNotes: string[];
  /**
   * Probability-of-Desired-State-Estimation score [0, 1].
   * Goals below the viability threshold are candidates for pruning.
   */
  pdseScore?: number;
}

/** Structured output of a meta-reasoning pass. */
export interface ReasoningMetaResult {
  /** Whether the engine recommends replanning (e.g., no active goals). */
  shouldReplan: boolean;
  /** Whether the engine recommends abandoning a low-viability goal. */
  shouldAbandon: boolean;
  /** Human-readable recommendation text for prompt injection. */
  recommendation: string;
  /** Confidence in the recommendation [0, 1]. */
  confidence: number;
  /** Intermediate reasoning steps that led to the result. */
  reasoningSteps: string[];
}

/** Record of a status transition applied by adaptive replanning. */
export interface GoalAdaptation {
  /** ID of the goal that was adapted. */
  goalId: string;
  /** Status before the adaptation. */
  previousStatus: AgentGoal["status"];
  /** Status after the adaptation. */
  newStatus: AgentGoal["status"];
  /** Human-readable reason for the change. */
  reason: string;
  /** ISO timestamp of the adaptation. */
  timestamp: string;
}

/** Constructor options for {@link AutonomyEngine}. */
export interface AutonomyEngineOptions {
  /**
   * Directory to persist goal state.
   * @default ".dantecode/goals"
   */
  storageDir?: string;
  /**
   * Number of steps between automatic meta-reasoning passes.
   * @default 15
   */
  metaReasoningInterval?: number;
  /**
   * Minimum acceptable PDSE score — goals below this are prunable.
   * @default 0.5
   */
  pdseViabilityThreshold?: number;
  /**
   * Injectable fs façade for testing (avoids hitting the real filesystem).
   */
  fsFn?: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
  };
}

// ----------------------------------------------------------------------------
// AutonomyEngine
// ----------------------------------------------------------------------------

/**
 * Persistent goal-tracking and meta-reasoning engine.
 *
 * Lifecycle:
 *   1. Instantiate with a project root.
 *   2. Call `resume()` or `load()` at session start.
 *   3. Call `addGoal()` / `updateGoal()` as the agent makes progress.
 *   4. Call `incrementStep()` after each agent step; check
 *      `shouldRunMetaReasoning()` to trigger `metaReason()` periodically.
 *   5. Call `decideNextAction()` when the agent needs direction.
 */
export class AutonomyEngine {
  private readonly goals: Map<string, AgentGoal> = new Map();
  private stepCount = 0;
  private readonly adaptationHistory: GoalAdaptation[] = [];
  private loaded = false;

  private readonly filePath: string;
  private readonly metaReasoningInterval: number;
  private readonly pdseViabilityThreshold: number;
  private readonly fs: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
  };

  constructor(projectRoot: string, options: AutonomyEngineOptions = {}) {
    const storageDir = options.storageDir ?? ".dantecode/goals";
    this.filePath = join(projectRoot, storageDir, "goals.json");
    this.metaReasoningInterval = options.metaReasoningInterval ?? 15;
    this.pdseViabilityThreshold = options.pdseViabilityThreshold ?? 0.5;
    this.fs = options.fsFn ?? { readFile, writeFile, mkdir };
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  /**
   * Load goals from disk. Idempotent — subsequent calls are no-ops.
   * A missing file is treated as an empty goal set (not an error).
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await this.fs.readFile(this.filePath, "utf-8");
      const parsed: AgentGoal[] = JSON.parse(raw as string);
      if (Array.isArray(parsed)) {
        for (const goal of parsed) {
          this.goals.set(goal.id, goal);
        }
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Corrupted file — start fresh rather than crashing the agent.
      }
      // ENOENT or parse error → empty state, already set above
    }
  }

  /**
   * Persist the current goal map to disk.
   * Creates parent directories as needed.
   */
  async save(): Promise<void> {
    const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/") === -1
      ? this.filePath.lastIndexOf("\\")
      : this.filePath.lastIndexOf("/"));

    try {
      await this.fs.mkdir(dir.length > 0 ? dir : ".", { recursive: true });
    } catch {
      // Best-effort directory creation
    }

    const data = JSON.stringify([...this.goals.values()], null, 2);
    await this.fs.writeFile(this.filePath, data, "utf-8");
  }

  // --------------------------------------------------------------------------
  // Goal CRUD
  // --------------------------------------------------------------------------

  /**
   * Create a new active goal and persist it.
   *
   * @param title - Short label for the goal.
   * @param description - Detailed description.
   * @param criteria - Completion criteria list.
   * @param priority - Higher = more important. Default 0.
   * @returns The newly created {@link AgentGoal}.
   */
  async addGoal(
    title: string,
    description: string,
    criteria: string[],
    priority = 0,
  ): Promise<AgentGoal> {
    await this.load();

    const now = new Date().toISOString();
    const goal: AgentGoal = {
      id: randomUUID(),
      title,
      description,
      status: "active",
      priority,
      createdAt: now,
      updatedAt: now,
      completionCriteria: [...criteria],
      subGoals: [],
      progressNotes: [],
    };

    this.goals.set(goal.id, goal);
    await this.save();
    return goal;
  }

  /**
   * Apply partial updates to an existing goal.
   * Appends to `progressNotes` rather than replacing them.
   *
   * @param id - Goal ID to update.
   * @param updates - Fields to merge into the goal.
   * @throws {Error} if the goal ID is not found.
   */
  async updateGoal(
    id: string,
    updates: Partial<Pick<AgentGoal, "status" | "progressNotes" | "pdseScore" | "subGoals">>,
  ): Promise<void> {
    await this.load();

    const goal = this.goals.get(id);
    if (!goal) {
      throw new Error(`AutonomyEngine: goal "${id}" not found`);
    }

    if (updates.status !== undefined) {
      goal.status = updates.status;
    }
    if (updates.pdseScore !== undefined) {
      goal.pdseScore = updates.pdseScore;
    }
    if (updates.subGoals !== undefined) {
      goal.subGoals = [...updates.subGoals];
    }
    if (updates.progressNotes !== undefined) {
      // Append new notes rather than overwrite
      goal.progressNotes = [...goal.progressNotes, ...updates.progressNotes];
    }

    goal.updatedAt = new Date().toISOString();
    await this.save();
  }

  /**
   * Retrieve a single goal by ID.
   *
   * @param id - Goal UUID.
   * @returns The goal or `undefined` if not found.
   */
  getGoal(id: string): AgentGoal | undefined {
    return this.goals.get(id);
  }

  /**
   * List all goals, optionally filtered by status, sorted by priority descending.
   *
   * @param status - Optional status filter.
   * @returns Sorted array of matching goals.
   */
  listGoals(status?: AgentGoal["status"]): AgentGoal[] {
    let goals = [...this.goals.values()];
    if (status !== undefined) {
      goals = goals.filter((g) => g.status === status);
    }
    return goals.sort((a, b) => b.priority - a.priority);
  }

  // --------------------------------------------------------------------------
  // Meta-reasoning
  // --------------------------------------------------------------------------

  /**
   * Run a meta-reasoning pass over the current goal state.
   *
   * Analyses:
   *   - Whether any active goals remain.
   *   - Whether any active goal has a PDSE score below the viability threshold.
   *   - Whether all goals are complete (positive outcome).
   *
   * @param currentContext - Free-form string describing the current situation.
   * @param stepCount - Optional override for the current step count.
   * @returns A structured {@link ReasoningMetaResult}.
   */
  metaReason(currentContext: string, stepCount?: number): ReasoningMetaResult {
    const reasoningSteps: string[] = [];
    const activeGoals = this.listGoals("active");
    const completedGoals = this.listGoals("completed");
    const abandonedGoals = this.listGoals("abandoned");
    const blockedGoals = this.listGoals("blocked");
    const allGoals = [...this.goals.values()];

    reasoningSteps.push(
      `Step ${stepCount ?? this.stepCount}: Inspecting ${allGoals.length} total goals ` +
        `(active=${activeGoals.length}, completed=${completedGoals.length}, ` +
        `blocked=${blockedGoals.length}, abandoned=${abandonedGoals.length}).`,
    );

    // Use context similarity to detect topic drift (informational only)
    if (currentContext.trim().length > 0 && activeGoals.length > 0) {
      const contextTokens = tokenize(currentContext);
      const topGoalTokens = tokenize(activeGoals[0]!.description);
      const similarity = jaccardSimilarity(contextTokens, topGoalTokens);
      reasoningSteps.push(
        `Context similarity to top goal "${activeGoals[0]!.title}": ${similarity.toFixed(2)}.`,
      );
    }

    // Case 1: No active goals and no goals at all → prompt user
    if (allGoals.length === 0) {
      reasoningSteps.push("No goals defined. Recommending initial goal definition.");
      return {
        shouldReplan: true,
        shouldAbandon: false,
        recommendation:
          "No goals are currently defined. Please define goals before proceeding.",
        confidence: 0.95,
        reasoningSteps,
      };
    }

    // Case 2: All goals completed → celebrate
    if (activeGoals.length === 0 && completedGoals.length > 0 && blockedGoals.length === 0) {
      reasoningSteps.push("All goals are complete. Session objective achieved.");
      return {
        shouldReplan: false,
        shouldAbandon: false,
        recommendation:
          "All goals have been completed successfully. Consider defining new objectives.",
        confidence: 0.99,
        reasoningSteps,
      };
    }

    // Case 3: No active goals but some are blocked → replan
    if (activeGoals.length === 0 && blockedGoals.length > 0) {
      reasoningSteps.push(
        `No active goals. ${blockedGoals.length} goal(s) are blocked. Recommending replan.`,
      );
      return {
        shouldReplan: true,
        shouldAbandon: false,
        recommendation:
          `No active goals remain. ${blockedGoals.length} blocked goal(s) need attention. ` +
          "Replan to unblock or define new goals.",
        confidence: 0.85,
        reasoningSteps,
      };
    }

    // Case 4: Active goals exist but one or more are below PDSE threshold
    const lowPdseGoals = activeGoals.filter(
      (g) => g.pdseScore !== undefined && g.pdseScore < this.pdseViabilityThreshold,
    );
    if (lowPdseGoals.length > 0) {
      const titles = lowPdseGoals.map((g) => `"${g.title}"`).join(", ");
      reasoningSteps.push(
        `Found ${lowPdseGoals.length} goal(s) with PDSE below threshold ` +
          `(${this.pdseViabilityThreshold}): ${titles}.`,
      );
      return {
        shouldReplan: false,
        shouldAbandon: true,
        recommendation:
          `Goal(s) ${titles} have low viability scores. Consider abandoning or replanning them.`,
        confidence: 0.8,
        reasoningSteps,
      };
    }

    // Case 5: Normal — active goals with healthy PDSE
    reasoningSteps.push(
      `${activeGoals.length} active goal(s) with acceptable PDSE. Continuing execution.`,
    );
    return {
      shouldReplan: false,
      shouldAbandon: false,
      recommendation: `Continue working on: "${activeGoals[0]!.title}".`,
      confidence: 0.7,
      reasoningSteps,
    };
  }

  // --------------------------------------------------------------------------
  // Adaptive replanning
  // --------------------------------------------------------------------------

  /**
   * Transition a goal's status as new evidence emerges, and record the
   * adaptation in the history for audit purposes.
   *
   * @param goalId - Goal to adapt.
   * @param reason - Human-readable explanation.
   * @returns The recorded {@link GoalAdaptation}.
   * @throws {Error} if the goal is not found.
   */
  adaptiveReplan(goalId: string, reason: string): GoalAdaptation {
    const goal = this.goals.get(goalId);
    if (!goal) {
      throw new Error(`AutonomyEngine: cannot replan — goal "${goalId}" not found`);
    }

    const previousStatus = goal.status;
    // Heuristic: if a goal is active and reason mentions failure/block, block it;
    // otherwise mark it completed.
    let newStatus: AgentGoal["status"];
    const lowerReason = reason.toLowerCase();
    if (
      lowerReason.includes("fail") ||
      lowerReason.includes("block") ||
      lowerReason.includes("stuck") ||
      lowerReason.includes("cannot")
    ) {
      newStatus = "blocked";
    } else if (lowerReason.includes("abandon") || lowerReason.includes("irrelevant")) {
      newStatus = "abandoned";
    } else {
      newStatus = "completed";
    }

    goal.status = newStatus;
    goal.updatedAt = new Date().toISOString();
    goal.progressNotes = [...goal.progressNotes, `Adaptation: ${reason}`];

    const adaptation: GoalAdaptation = {
      goalId,
      previousStatus,
      newStatus,
      reason,
      timestamp: new Date().toISOString(),
    };

    this.adaptationHistory.push(adaptation);
    return adaptation;
  }

  // --------------------------------------------------------------------------
  // Action decision
  // --------------------------------------------------------------------------

  /**
   * Return a plain-English directive for the agent's next action, derived
   * from current goal state.
   *
   * Priority:
   *   1. Unblock blocked goals.
   *   2. Prompt to define goals if none exist.
   *   3. Continue with the highest-priority active goal.
   *
   * @param context - Current context string (unused in heuristic but reserved).
   * @returns Directive string.
   */
  decideNextAction(_context: string): string {
    const activeGoals = this.listGoals("active");
    const blockedGoals = this.listGoals("blocked");

    if (blockedGoals.length > 0) {
      const top = blockedGoals[0]!;
      return `Unblock goal "${top.title}": ${top.description}`;
    }

    if (activeGoals.length === 0) {
      return "No active goals. Define new goals to continue autonomous operation.";
    }

    const top = activeGoals[0]!;
    const criteria =
      top.completionCriteria.length > 0
        ? ` Criteria: ${top.completionCriteria.slice(0, 2).join("; ")}.`
        : "";
    return `Continue working on "${top.title}": ${top.description}.${criteria}`;
  }

  // --------------------------------------------------------------------------
  // Maintenance
  // --------------------------------------------------------------------------

  /**
   * Abandon all active goals whose PDSE score is below `minPdseScore`.
   *
   * @param minPdseScore - Threshold. Defaults to the engine's configured
   *   `pdseViabilityThreshold`.
   * @returns Number of goals abandoned.
   */
  pruneDeadPaths(minPdseScore?: number): number {
    const threshold = minPdseScore ?? this.pdseViabilityThreshold;
    let pruned = 0;

    for (const goal of this.goals.values()) {
      if (
        goal.status === "active" &&
        goal.pdseScore !== undefined &&
        goal.pdseScore < threshold
      ) {
        goal.status = "abandoned";
        goal.updatedAt = new Date().toISOString();
        goal.progressNotes = [
          ...goal.progressNotes,
          `Auto-pruned: PDSE ${goal.pdseScore.toFixed(2)} below threshold ${threshold}.`,
        ];
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Return the full adaptation history.
   */
  getAdaptationHistory(): GoalAdaptation[] {
    return [...this.adaptationHistory];
  }

  /**
   * Increment the internal step counter by 1.
   * Call this after each agent reasoning step.
   */
  incrementStep(): void {
    this.stepCount++;
  }

  /**
   * Whether a meta-reasoning pass should run at the current step.
   * Returns `true` every `metaReasoningInterval` steps (but not at step 0).
   */
  shouldRunMetaReasoning(): boolean {
    return this.stepCount > 0 && this.stepCount % this.metaReasoningInterval === 0;
  }

  // --------------------------------------------------------------------------
  // Session resume
  // --------------------------------------------------------------------------

  /**
   * Load goals and return a formatted summary suitable for injecting into a
   * model prompt at session start.
   *
   * @param sessionId - Optional session label for logging context.
   * @returns Multi-line prompt string.
   */
  async resume(sessionId?: string): Promise<string> {
    await this.load();

    const activeGoals = this.listGoals("active");
    const completedGoals = this.listGoals("completed");
    const blockedGoals = this.listGoals("blocked");
    const label = sessionId ? ` (session: ${sessionId})` : "";

    const lines: string[] = [
      `=== Autonomy Engine Resume${label} ===`,
      `Active goals: ${activeGoals.length} | Completed: ${completedGoals.length} | Blocked: ${blockedGoals.length}`,
    ];

    if (activeGoals.length === 0 && blockedGoals.length === 0) {
      lines.push("No active goals. Define objectives to begin.");
    } else {
      if (activeGoals.length > 0) {
        lines.push("\nActive goals (highest priority first):");
        for (const g of activeGoals) {
          const pdse =
            g.pdseScore !== undefined ? ` [PDSE: ${g.pdseScore.toFixed(2)}]` : "";
          lines.push(`  [${g.priority}] ${g.title}${pdse}: ${g.description}`);
          if (g.completionCriteria.length > 0) {
            lines.push(`    Criteria: ${g.completionCriteria.join("; ")}`);
          }
        }
      }

      if (blockedGoals.length > 0) {
        lines.push("\nBlocked goals (require attention):");
        for (const g of blockedGoals) {
          lines.push(`  [BLOCKED] ${g.title}: ${g.description}`);
        }
      }
    }

    lines.push("=== End Resume ===");
    return lines.join("\n");
  }
}
