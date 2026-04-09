// ============================================================================
// @dantecode/memory-engine — Remote Embedding Provider
// Auto-detects the best available embedding provider at startup.
// Priority: OpenAI → Google → Ollama → null (TF-IDF fallback)
// No new deps — delegates to @dantecode/core createEmbeddingProvider.
// ============================================================================

import { createEmbeddingProvider } from "@dantecode/core";

/**
 * Returns the best available embedding function, probing providers in order:
 *   1. OpenAI (OPENAI_API_KEY) — text-embedding-3-small, 1536 dims
 *   2. Google (GOOGLE_API_KEY / GEMINI_API_KEY) — text-embedding-004, 768 dims
 *   3. Ollama (http://localhost:11434 health check) — nomic-embed-text, 768 dims
 *   4. null — caller falls back to LocalEmbeddingProvider (TF-IDF)
 */
export async function detectBestEmbeddingProvider(): Promise<
  ((text: string) => Promise<number[]>) | null
> {
  // 1. OpenAI
  if (process.env["OPENAI_API_KEY"]) {
    try {
      const p = createEmbeddingProvider("openai");
      await p.embedSingle("ping"); // validate key works
      return (text) => p.embedSingle(text);
    } catch {
      // key invalid or network error — try next
    }
  }

  // 2. Google
  if (process.env["GOOGLE_API_KEY"] || process.env["GEMINI_API_KEY"]) {
    try {
      const p = createEmbeddingProvider("google");
      await p.embedSingle("ping");
      return (text) => p.embedSingle(text);
    } catch {
      // try next
    }
  }

  // 3. Ollama (no key needed, just needs to be running)
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const p = createEmbeddingProvider("ollama");
      return (text) => p.embedSingle(text);
    }
  } catch {
    // ollama not running
  }

  return null; // fall back to TF-IDF
}
