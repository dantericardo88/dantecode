// ============================================================================
// @dantecode/core — Pruning Engine
// Implements smart forgetting policies. Evaluates age and relevance to current
// AutonomyEngine goals, adjusts relevance scores, and triggers distillation.
// ============================================================================

import type { PersistentMemory } from "./persistent-memory.js";
import type { AutonomyEngine } from "./autonomy-engine.js";
import { tokenize, jaccardSimilarity } from "./approach-memory.js";

export interface PruningConfig {
  /** How much relevance score to decay per day (e.g. 0.05) */
  dailyDecayRate: number;
  /** Boost applied if memory matches an active goal */
  activeGoalBoost: number;
  /** Triggers a hard distill to this target count if we exceed max threshold */
  hardLimit: number;
}

export class PruningEngine {
  constructor(
    private readonly memory: PersistentMemory,
    private readonly autonomy: AutonomyEngine,
    private readonly config: PruningConfig = {
      dailyDecayRate: 0.05,
      activeGoalBoost: 0.3,
      hardLimit: 1000,
    },
  ) {}

  /**
   * Run the pruning cycle:
   * 1. Decay relevance based on age.
   * 2. Boost relevance based on alignment with active goals.
   * 3. Run distillation if limit exceeded.
   */
  async prune(): Promise<{ itemsEvaluated: number; distilled: number }> {
    await this.memory.load();
    await this.autonomy.load();

    const entries = this.memory.getAll();
    const activeGoals = this.autonomy.listGoals("active");
    const now = new Date().getTime();

    // Prepare goal tokens for fast Jaccard
    const goalTokenSets = activeGoals.map((g) => tokenize(g.description + " " + g.title));

    for (const entry of entries) {
      // 1. Time decay
      const ageMs = now - new Date(entry.lastAccessed).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decay = ageDays * this.config.dailyDecayRate;

      // 2. Goal relevance boost
      const entryTokens = tokenize(entry.content);
      let maxSim = 0;
      for (const gt of goalTokenSets) {
        const sim = jaccardSimilarity(entryTokens, gt);
        if (sim > maxSim) maxSim = sim;
      }

      // If highly relevant to an active goal, give it a massive boost.
      const boost = maxSim > 0.1 ? this.config.activeGoalBoost : 0;

      // Apply updates
      entry.relevanceScore = Math.max(0, entry.relevanceScore - decay + boost);
    }

    await this.memory.save();

    // 3. Hard limit distillation
    let distilled = 0;
    if (this.memory.size() > this.config.hardLimit) {
      const res = await this.memory.distill(Math.floor(this.config.hardLimit * 0.8));
      distilled = res.distilled + res.removed;
    } else {
      // Run a lightweight distill to merge near-duplicates anyway
      const res = await this.memory.distill(this.config.hardLimit);
      distilled = res.distilled;
    }

    return { itemsEvaluated: entries.length, distilled };
  }
}
