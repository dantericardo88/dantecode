// ============================================================================
// @dantecode/core — Entity Extractor
// Automatically extracts named entities, tags, and creates short summaries
// from raw text block before saving them into PersistentMemory.
// ============================================================================

import type { ModelRouterImpl } from "./model-router.js";
import type { CoreMessage } from "ai";

export interface ExtractionResult {
  summary: string;
  entities: string[];
  category: "fact" | "decision" | "error" | "strategy" | "context";
}

export class EntityExtractor {
  constructor(private readonly router: ModelRouterImpl) {}

  /**
   * Processes a raw block of text to extract key entities, a concise summary,
   * and a high-level category for memory storage.
   */
  async extract(text: string): Promise<ExtractionResult> {
    const prompt = `
You are an expert memory processing engine.
Analyze the following text and extract its core meaning into a structured format.
The text represents an agent's memory or interaction history.

Return ONLY a valid JSON object matching this exact schema:
{
  "summary": "A concise 1-2 sentence summary of the core information.",
  "entities": ["entity1", "entity2", ...],
  "category": "fact" | "decision" | "error" | "strategy" | "context"
}

Categories explanation:
- fact: A piece of objective information, knowledge, or user preference.
- decision: An architecture, logic, or workflow decision made.
- error: An obstacle, stack trace, bug, or failed state encountered.
- strategy: Proposed plans, approaches, or roadmaps.
- context: General scene-setting or chronological context.

Text to analyze:
\`\`\`
${text}
\`\`\`
`;

    const messages: CoreMessage[] = [{ role: "user", content: prompt }];

    try {
      const response = await this.router.generate(messages, {
        system: "You are a memory processor. Output strictly valid JSON.",
        taskType: "extraction",
      });

      const cleanJsonStr = response
        .replace(/^[^{]*/, "")
        .replace(/[^}]*$/, "")
        .trim();

      const parsed = JSON.parse(cleanJsonStr);
      
      return {
        summary: parsed.summary ?? text.slice(0, 100),
        entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 10) : [],
        category: (parsed.category as ExtractionResult["category"]) ?? "context",
      };
    } catch (err) {
      console.warn("Entity extractor failed, falling back to heuristics:", err);
      return {
        summary: text.slice(0, 200) + (text.length > 200 ? "..." : ""),
        entities: [this.extractHeuristicTag(text)],
        category: "context",
      };
    }
  }

  private extractHeuristicTag(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("error") || lower.includes("fail")) return "error";
    if (lower.includes("decid") || lower.includes("choose")) return "decision";
    if (lower.includes("plan") || lower.includes("next")) return "strategy";
    return "memory";
  }
}
