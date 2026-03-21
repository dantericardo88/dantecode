import type { EvidenceBundle, EvidenceSource } from "@dantecode/runtime-spine";
import { SemanticDeduper } from "../extractor/deduper.js";

/**
 * Aggregates multiple evidence sources into a single EvidenceBundle.
 */
export class EvidenceAggregator {
  private deduper = new SemanticDeduper();

  aggregate(sources: EvidenceSource[], contentChunks: string[]): EvidenceBundle {
    const dedupedChunks = this.deduper.dedupe(contentChunks, 0.7);
    const combinedContent = dedupedChunks.join("\n\n---\n\n");

    return {
      content: combinedContent,
      facts: [], // TODO: Future enhancement for fact extraction
      citations: sources,
      metadata: {
        sourceCount: sources.length,
        chunkCount: dedupedChunks.length,
        aggregatedAt: new Date().toISOString(),
      },
    };
  }
}
