export class Dedupe {
  /**
   * Removes duplicate or highly similar sections from markdown content.
   * Splits by double newline and compares chunks.
   */
  dedupe(markdown: string): string {
    const chunks = markdown.split(/\n\s*\n/);
    const seen = new Set<string>();
    const result: string[] = [];

    for (const chunk of chunks) {
      const normalized = chunk.trim().toLowerCase().replace(/\W/g, "");
      if (normalized.length < 10) {
        result.push(chunk);
        continue;
      }

      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(chunk);
      }
    }

    return result.join("\n\n");
  }
}
