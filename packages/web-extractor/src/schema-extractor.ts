import { z } from "zod";
import { ModelRouterImpl } from "@dantecode/core";
import { WebFetchOptions } from "./types.js";

export class SchemaExtractor {
  private router: ModelRouterImpl;

  constructor(router: ModelRouterImpl) {
    this.router = router;
  }

  async extract(
    markdown: string,
    options: WebFetchOptions,
  ): Promise<Record<string, unknown> | undefined> {
    if (!options.schema && !options.instructions) {
      return undefined;
    }

    let systemPrompt = `You are an expert at structured data extraction. 
Extract information from the provided markdown according to the instructions and/or schema.
Reply ONLY with valid JSON. No markdown blocks, just raw JSON.`;

    if (options.instructions) {
      systemPrompt += `\nInstructions: ${options.instructions}`;
    }

    // truncate content to fit context window (~40k chars)
    const safeContent = markdown.slice(0, 40000);

    try {
      const response = await this.router.generate([{ role: "user", content: safeContent }], {
        system: systemPrompt,
      });

      const parsed = JSON.parse(response);

      if (options.schema) {
        if (options.schema instanceof z.ZodType) {
          return options.schema.parse(parsed);
        }
        // If it's a raw object, we just return it as is or attempt a loose match
        return parsed;
      }

      return parsed;
    } catch (err) {
      console.error(`Schema extraction failed: ${err}`);
      return undefined;
    }
  }
}
