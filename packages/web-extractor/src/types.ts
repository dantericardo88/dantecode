import { z } from "zod";

export type RenderMode = "http" | "browser" | "browser-actions";

export interface WebFetchOptions {
  useCache?: boolean;
  forceBrowser?: boolean;
  maxWaitMs?: number;
  preActions?: Array<Record<string, unknown>>;
  cleanLevel?: "light" | "standard" | "aggressive";
  instructions?: string;
  schema?: z.ZodSchema | Record<string, unknown>;
}

export interface WebFetchResult {
  url: string;
  markdown: string;
  structuredData?: Record<string, unknown>;
  metadata: {
    title?: string;
    finalUrl?: string;
    status?: number;
    renderMode: RenderMode;
    cacheHit: boolean;
    extractedAt: string;
    relevanceScore?: number;
  };
  sources: Array<{
    url: string;
    title?: string;
    snippet?: string;
  }>;
  verificationWarnings?: string[];
}

export interface ExtractionGoal {
  url: string;
  goal: string;
  schema?: z.ZodSchema | Record<string, unknown>;
}

export interface FetchProvider {
  name: string;
  fetch(url: string, options: WebFetchOptions): Promise<Partial<WebFetchResult>>;
}
