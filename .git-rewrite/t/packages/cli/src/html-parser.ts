// ============================================================================
// @dantecode/cli — HTML Parser
// Robust HTML parsing and content extraction without external dependencies.
// Replaces fragile regex-based extraction with structured parsing.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ParsedDocument {
  title: string;
  description: string;
  mainContent: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
}

export interface ContentBlock {
  tag: string;
  content: string;
  textLength: number;
  tagCount: number;
  score: number;
}

// ----------------------------------------------------------------------------
// Core HTML → Text Conversion
// ----------------------------------------------------------------------------

/**
 * Converts HTML to readable text with improved entity handling and
 * structure preservation. Handles nested elements correctly.
 */
export function htmlToReadableText(html: string): string {
  let text = html;

  // Remove script, style, noscript, and template blocks (including nested)
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<template[\s\S]*?<\/template>/gi, "");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Remove SVG blocks
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Convert <br> to newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Convert list items to bullet points
  text = text.replace(/<li[^>]*>/gi, "\n- ");

  // Add newlines around block-level elements
  const blockTags =
    "div|p|h[1-6]|hr|blockquote|pre|section|article|header|footer|nav|aside|main|ul|ol|table|tr|dd|dt|figcaption|figure|details|summary";
  text = text.replace(new RegExp(`<\\/(?:${blockTags})\\s*>`, "gi"), "\n");
  text = text.replace(new RegExp(`<(?:${blockTags})\\b[^>]*>`, "gi"), "\n");

  // Convert table cells to spacing
  text = text.replace(/<\/t[dh]\s*>/gi, "\t");

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = decodeHTMLEntities(text);

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Decodes common HTML entities (named + numeric).
 */
function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&ndash;": "\u2013",
    "&mdash;": "\u2014",
    "&laquo;": "\u00AB",
    "&raquo;": "\u00BB",
    "&bull;": "\u2022",
    "&hellip;": "\u2026",
    "&copy;": "\u00A9",
    "&reg;": "\u00AE",
    "&trade;": "\u2122",
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replaceAll(entity, char);
  }

  // Handle numeric entities: &#123; and &#x1A;
  result = result.replace(/&#(\d+);/g, (_, code) => {
    const num = parseInt(code, 10);
    return num > 0 && num < 0x10ffff ? String.fromCodePoint(num) : "";
  });
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const num = parseInt(hex, 16);
    return num > 0 && num < 0x10ffff ? String.fromCodePoint(num) : "";
  });

  return result;
}

// ----------------------------------------------------------------------------
// Content Extraction (Readability Algorithm)
// ----------------------------------------------------------------------------

/**
 * Extracts the main readable article content from HTML using a
 * text-density scoring algorithm (inspired by Readability / Qwen).
 *
 * Strategy:
 * 1. Remove non-content blocks (nav, footer, sidebar, ads)
 * 2. Score remaining blocks by text-to-tag ratio
 * 3. Boost semantic content tags (article, main, .content)
 * 4. Return highest-scoring block
 */
export function extractReadableArticle(html: string): string {
  // First, try semantic content containers (highest priority)
  const semanticContent = extractSemanticContent(html);
  if (semanticContent && semanticContent.length > 200) {
    return htmlToReadableText(semanticContent);
  }

  // Remove known non-content areas before scoring
  let cleaned = html;
  cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  cleaned = cleaned.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  cleaned = cleaned.replace(/<header[\s\S]*?<\/header>/gi, "");
  cleaned = cleaned.replace(
    /<div[^>]+(?:class|id)="[^"]*(?:sidebar|menu|nav|footer|banner|ad|cookie|popup|modal|comment)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    "",
  );

  // Extract the body if present
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch?.[1] ?? cleaned;

  // Score top-level blocks by text density
  const blocks = extractContentBlocks(body);
  if (blocks.length === 0) {
    return htmlToReadableText(html);
  }

  // Sort by score descending and take the best block
  blocks.sort((a, b) => b.score - a.score);
  const best = blocks[0]!;

  // If the best block has very low text density, fall back to full page
  if (best.textLength < 100) {
    return htmlToReadableText(html);
  }

  return htmlToReadableText(best.content);
}

/**
 * Tries to extract content from semantic HTML5 containers.
 */
function extractSemanticContent(html: string): string | null {
  // Priority order: article > main > role="main" > .content/.post/.entry
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+role="main"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+(?:class|id)="[^"]*(?:content|article|post|entry|story|body-text)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] && match[1].length > 200) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extracts div/section blocks and scores them by text-to-tag ratio.
 * Higher ratio = more likely to be content, not chrome.
 */
function extractContentBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // Match top-level div and section blocks
  const blockPattern = /<(div|section)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(html)) !== null) {
    const tag = match[1]!;
    const content = match[2]!;

    // Count text length (without tags)
    const textOnly = content.replace(/<[^>]+>/g, "").trim();
    const textLength = textOnly.length;

    // Count tags
    const tagMatches = content.match(/<[^>]+>/g);
    const tagCount = tagMatches ? tagMatches.length : 0;

    // Text-to-tag ratio (higher = more content-like)
    const density = tagCount > 0 ? textLength / tagCount : textLength;

    // Boost score for content-like class/id names
    const fullMatch = match[0]!;
    let boost = 1.0;
    if (
      /(?:class|id)="[^"]*(?:content|article|post|entry|text|body|readme)[^"]*"/i.test(fullMatch)
    ) {
      boost = 2.0;
    }
    // Penalize for non-content class/id names
    if (
      /(?:class|id)="[^"]*(?:sidebar|menu|nav|widget|footer|header|ad|meta|share|social)[^"]*"/i.test(
        fullMatch,
      )
    ) {
      boost = 0.1;
    }

    // Count paragraphs (strong content signal)
    const pCount = (content.match(/<p[\s >]/gi) || []).length;

    const score = density * boost * (1 + pCount * 0.5);

    if (textLength > 50) {
      blocks.push({ tag, content: match[0]!, textLength, tagCount, score });
    }
  }

  return blocks;
}

// ----------------------------------------------------------------------------
// CSS Selector Extraction
// ----------------------------------------------------------------------------

/**
 * Extracts content matching a CSS selector from HTML.
 * Supports: #id, .class, tag, tag.class, tag#id, and [attr] selectors.
 * Handles nested elements correctly using bracket counting.
 */
export function extractByCSS(html: string, selector: string): string | null {
  let pattern: RegExp;
  let tagName = "[a-z][a-z0-9]*";

  if (selector.startsWith("#")) {
    // ID selector: #my-id
    const id = escapeRegex(selector.slice(1));
    pattern = new RegExp(`<(${tagName})[^>]+id="${id}"[^>]*>`, "i");
  } else if (selector.startsWith(".")) {
    // Class selector: .my-class — use \b for word boundary matching
    const cls = escapeRegex(selector.slice(1));
    pattern = new RegExp(`<(${tagName})[^>]+class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, "i");
  } else if (selector.includes("#")) {
    // tag#id selector
    const [tag, id] = selector.split("#");
    tagName = escapeRegex(tag!);
    pattern = new RegExp(`<(${tagName})[^>]+id="${escapeRegex(id!)}"[^>]*>`, "i");
  } else if (selector.includes(".")) {
    // tag.class selector — use \b for word boundary matching
    const [tag, cls] = selector.split(".");
    tagName = escapeRegex(tag!);
    pattern = new RegExp(
      `<(${tagName})[^>]+class="[^"]*\\b${escapeRegex(cls!)}\\b[^"]*"[^>]*>`,
      "i",
    );
  } else {
    // Tag selector: div, article, main, etc.
    tagName = escapeRegex(selector);
    pattern = new RegExp(`<(${tagName})\\b[^>]*>`, "i");
  }

  const openMatch = pattern.exec(html);
  if (!openMatch) return null;

  // Use bracket counting to find the matching closing tag
  const actualTag = openMatch[1]!;
  const startIdx = openMatch.index!;
  const afterOpen = startIdx + openMatch[0].length;

  let depth = 1;
  const openRe = new RegExp(`<${actualTag}\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`</${actualTag}\\s*>`, "gi");

  // Scan from after the opening tag
  openRe.lastIndex = afterOpen;
  closeRe.lastIndex = afterOpen;

  let endIdx = html.length;

  while (depth > 0) {
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);

    if (!nextClose) {
      // No more closing tags — take everything
      break;
    }

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      closeRe.lastIndex = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        endIdx = nextClose.index + nextClose[0].length;
        break;
      }
    }
  }

  const extracted = html.slice(startIdx, endIdx);
  return htmlToReadableText(extracted);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ----------------------------------------------------------------------------
// Page Metadata Extraction
// ----------------------------------------------------------------------------

/**
 * Extracts page metadata (title, description, canonical URL, author, etc.)
 * from HTML head elements.
 */
export function extractPageMetadata(html: string): {
  title: string | null;
  description: string | null;
  author: string | null;
  canonical: string | null;
} {
  const title = extractMetaValue(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    extractMetaContent(html, "description") ?? extractMetaProperty(html, "og:description");
  const author = extractMetaContent(html, "author") ?? extractMetaProperty(html, "article:author");
  const canonical = extractLinkHref(html, "canonical");

  return {
    title: title ? decodeHTMLEntities(title).trim() : null,
    description: description ? decodeHTMLEntities(description).trim() : null,
    author: author ? decodeHTMLEntities(author).trim() : null,
    canonical,
  };
}

function extractMetaValue(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1]?.replace(/<[^>]+>/g, "").trim() || null;
}

function extractMetaContent(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+name="${escapeRegex(name)}"[^>]+content="([^"]*)"` +
      `|<meta[^>]+content="([^"]*)"[^>]+name="${escapeRegex(name)}"`,
    "i",
  );
  const match = html.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function extractMetaProperty(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+property="${escapeRegex(property)}"[^>]+content="([^"]*)"` +
      `|<meta[^>]+content="([^"]*)"[^>]+property="${escapeRegex(property)}"`,
    "i",
  );
  const match = html.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function extractLinkHref(html: string, rel: string): string | null {
  const pattern = new RegExp(
    `<link[^>]+rel="${escapeRegex(rel)}"[^>]+href="([^"]*)"` +
      `|<link[^>]+href="([^"]*)"[^>]+rel="${escapeRegex(rel)}"`,
    "i",
  );
  const match = html.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

// ----------------------------------------------------------------------------
// Full Document Parsing
// ----------------------------------------------------------------------------

/**
 * Parses an HTML document and extracts structured content.
 */
export function parseHTML(html: string): ParsedDocument {
  const metadata = extractPageMetadata(html);

  // Extract headings
  const headings: string[] = [];
  const headingPattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingPattern.exec(html)) !== null) {
    const text = hMatch[2]!.replace(/<[^>]+>/g, "").trim();
    if (text) headings.push(text);
  }

  // Extract links
  const links: Array<{ text: string; href: string }> = [];
  const linkPattern = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = linkPattern.exec(html)) !== null) {
    const href = lMatch[1]!;
    const text = lMatch[2]!.replace(/<[^>]+>/g, "").trim();
    if (text && href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      links.push({ text, href });
    }
  }

  return {
    title: metadata.title ?? "",
    description: metadata.description ?? "",
    mainContent: extractReadableArticle(html),
    headings,
    links,
  };
}
