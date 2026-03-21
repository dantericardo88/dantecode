import { ModelRouterImpl } from "@dantecode/core";

export class RelevanceScorer {
  private router?: ModelRouterImpl;

  constructor(router?: ModelRouterImpl) {
    this.router = router;
  }

  /**
   * Scores the relevance of the markdown content against a goal.
   * Returns a score between 0 and 1.
   */
  async score(content: string, goal: string): Promise<number> {
    if (!goal || !content) return 0;

    const goalTerms = new Set(
      goal
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 3),
    );
    const contentTerms = new Set(
      content
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 3),
    );

    let matches = 0;
    for (const term of goalTerms) {
      if (contentTerms.has(term)) {
        matches++;
      }
    }

    const heuristicScore = goalTerms.size > 0 ? matches / goalTerms.size : 0;

    // If model router is available, we can use it for a more precise score
    if (this.router && content.length > 0) {
      try {
        const response = await this.router.generate(
          [
            {
              role: "user",
              content: `Goal: ${goal}\n\nContent Preview: ${content.slice(0, 2000)}\n\nRate the relevance of this content to the goal on a scale of 0.0 to 1.0. Reply ONLY with the number.`,
            },
          ],
          { system: "You are a relevance scoring assistant." },
        );

        const modelScore = parseFloat(response);
        if (!isNaN(modelScore)) {
          return heuristicScore * 0.3 + modelScore * 0.7;
        }
      } catch {
        // Fallback to heuristic
      }
    }

    return heuristicScore;
  }
}
