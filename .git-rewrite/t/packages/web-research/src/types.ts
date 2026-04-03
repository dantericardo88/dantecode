import { z } from "zod";
import { EvidenceSourceSchema } from "@dantecode/runtime-spine";

export const SearchResultSchema = EvidenceSourceSchema.extend({
  snippet: z.string(),
  position: z.number().int(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

export interface SearchOptions {
  limit?: number;
  region?: string;
  safeSearch?: boolean;
}

export interface SearchProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
