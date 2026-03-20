import { WebFetchOptions } from "./types.js";

export class MarkdownCleaner {
  /**
   * Transforms raw HTML/text into clean, LLM-optimized markdown.
   * Strips nav, footer, ads, and script/style tags.
   * Preserves headings, tables, and lists.
   */
  clean(html: string, options: WebFetchOptions = {}): string {
    let content = html;

    // 1. Remove comments
    content = content.replace(/<!--[\s\S]*?-->/g, "");

    // 2. Remove script and style blocks entirely
    content = content
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<form[\s\S]*?<\/form>/gi, " ");

    // 3. Remove common nav/footer/ad selectors (heuristic)
    if (options.cleanLevel === "aggressive") {
      content = content
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<header[\s\S]*?<\/header>/gi, " ") // Sometimes header has useful info, but often it's chrome
        .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
    }

    // 4. Preserve structure tags by converting to markdown equivalents
    // Headings
    content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
    content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
    content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
    content = content.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n#### $1\n");

    // Lists
    content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
    content = content.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, "$1\n");
    content = content.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, "$1\n");

    // Tables (Simple conversion)
    content = content.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, "\n| $1 |");
    content = content.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, " $1 |");
    content = content.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, " **$1** |");

    // 5. Replace block-level tags with newlines
    content = content.replace(/<\/?(p|div|section|article|br|hr)[^>]*>/gi, "\n");

    // 6. Strip all remaining tags
    content = content.replace(/<[^>]+>/g, " ");

    // 7. Decode HTML entities (Simple version)
    content = this.decodeEntities(content);

    // 8. Final Cleanup: Whitespace and newlines
    content = content
      .split("\n")
      .map(line => line.trim().replace(/[^\S\n]+/g, " "))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n") // Max 2 newlines
      .trim();

    return content;
  }

  private decodeEntities(text: string): string {
    const entities: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
      "&nbsp;": " "
    };
    return text.replace(/&[a-z0-9]+;/gi, (match) => entities[match.toLowerCase()] || match);
  }

  extractTitle(html: string): string {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return match ? match[1].trim() : "";
  }
}
