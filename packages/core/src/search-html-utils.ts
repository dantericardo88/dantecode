// ============================================================================
// @dantecode/core — Minimal HTML text extraction for search providers
// Lightweight version that avoids circular dependency with cli/html-parser.
// ============================================================================

/**
 * Converts HTML to readable text. Minimal version for search result parsing.
 * Strips tags, decodes common entities, collapses whitespace.
 */
export function htmlToReadableText(html: string): string {
  let text = html;

  // Remove script/style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Convert <br> to newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&apos;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // Decode numeric entities
  text = text.replace(/&#(\d+);/g, (_, code) => {
    const num = parseInt(code, 10);
    return num > 0 && num < 0x10ffff ? String.fromCodePoint(num) : "";
  });
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const num = parseInt(hex, 16);
    return num > 0 && num < 0x10ffff ? String.fromCodePoint(num) : "";
  });

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
