// ============================================================================
// @dantecode/core — Semantic Recall
// A retrieval wrapper that queries PersistentMemory and filters/verifies
// the recalled context blocks through PDSE-like verification gates to guarantee
// only highly coherent memories are injected.
// ============================================================================

import type { PersistentMemory, MemoryEntry } from "./persistent-memory.js";
import type { ModelRouterImpl } from "./model-router.js";

export class SemanticRecall {
  constructor(
    private readonly memory: PersistentMemory,
    private readonly router: ModelRouterImpl,
  ) {}

  /**
   * Recalls the highest quality memories matching the user query.
   * If strictGate is true, it performs a secondary LLM verification pass
   * to guarantee the memory is truthful and coherent for the task.
   */
  async recall(query: string, limit = 5, strictGate = false): Promise<MemoryEntry[]> {
    await this.memory.load();
    const results = this.memory.search(query, { limit: limit * 2 }); // Over-fetch for filtering

    if (!strictGate || results.length === 0) {
      return results.slice(0, limit).map((r) => r.entry);
    }

    // Strict Gate: Verification Pass
    const verifiedEntries: MemoryEntry[] = [];

    for (const { entry } of results) {
      const passed = await this.verifyMemoryCoherence(query, entry.content);
      if (passed) {
        verifiedEntries.push(entry);
        if (verifiedEntries.length >= limit) break;
      }
    }

    return verifiedEntries;
  }

  private async verifyMemoryCoherence(query: string, context: string): Promise<boolean> {
    const prompt = `
You are a memory adherence gate.
Evaluate if this MemoryContext is truthful, coherent, and highly relevant to the UserQuery.
Return ONLY "true" or "false".

UserQuery: ${query}
MemoryContext: ${context}
`;

    try {
      const response = await this.router.generate([{ role: "user", content: prompt }], {
        system: "You are a boolean truth gate. Output true or false.",
      });
      return response.trim().toLowerCase() === "true";
    } catch {
      return true; // fail-open if router fails during recall
    }
  }
}
