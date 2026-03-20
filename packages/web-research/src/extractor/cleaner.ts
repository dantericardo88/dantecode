import * as cheerio from "cheerio";

/**
 * Advanced content cleaner for extract readability-grade text.
 * Targets main article content and strips noise.
 */
export class AdvancedContentCleaner {
  clean(html: string): string {
    const $ = cheerio.load(html);

    // Remove non-content elements
    $("script, style, iframe, noscript, footer, header, nav, aside, .ads, .sidebar, .menu").remove();

    // Strategy 1: Look for common article containers
    const article = $("article, .post, .article, .content, #main, #content").first();
    const target = article.length > 0 ? article : $("body");

    // Strategy 2: Extract text from common block elements
    let extracted = "";
    target.find("h1, h2, h3, h4, p, li").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 20) {
        extracted += text + "\n\n";
      }
    });

    return extracted.trim();
  }
}
