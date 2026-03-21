/**
 * evidence-types.ts
 *
 * Types for structured evidence bundles.
 */

import { z } from "zod";
import { EvidenceSourceSchema } from "./verification-types.js";

export const EvidenceBundleSchema = z.object({
  /** The aggregated evidence text or structured data. */
  content: z.string(),

  /** Extracted facts or entities. */
  facts: z
    .array(
      z.object({
        statement: z.string(),
        confidence: z.number().min(0).max(1),
        sourceUrl: z.string().url().optional(),
      }),
    )
    .default([]),

  /** Citations used in the content. */
  citations: z.array(EvidenceSourceSchema).default([]),

  /** Metadata about the extraction process. */
  metadata: z.record(z.unknown()).default({}),
});

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
