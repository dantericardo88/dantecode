import { describe, it, expect } from "vitest";
import {
  htmlToReadableText,
  extractReadableArticle,
  extractByCSS,
  extractPageMetadata,
  parseHTML,
} from "./html-parser.js";

// ============================================================================
// htmlToReadableText
// ============================================================================

describe("htmlToReadableText", () => {
  it("strips HTML tags and preserves text", () => {
    const result = htmlToReadableText("<p>Hello <b>world</b></p>");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<");
  });

  it("removes script and style blocks", () => {
    const html = `
      <div>Keep me</div>
      <script>alert('evil')</script>
      <style>.hidden { display: none }</style>
      <div>And me</div>
    `;
    const result = htmlToReadableText(html);
    expect(result).toContain("Keep me");
    expect(result).toContain("And me");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("display");
  });

  it("removes SVG blocks", () => {
    const html = "<div>Text</div><svg><path d='M0 0'/></svg><p>More</p>";
    const result = htmlToReadableText(html);
    expect(result).toContain("Text");
    expect(result).toContain("More");
    expect(result).not.toContain("path");
  });

  it("converts list items to bullet points", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    const result = htmlToReadableText(html);
    expect(result).toContain("- Item 1");
    expect(result).toContain("- Item 2");
  });

  it("decodes HTML entities (named and numeric)", () => {
    const html = "5 &gt; 3 &amp; 2 &lt; 4 &quot;test&quot; &#39;single&#39; &#x2022; bullet";
    const result = htmlToReadableText(html);
    expect(result).toContain("5 > 3 & 2 < 4");
    expect(result).toContain('"test"');
    expect(result).toContain("'single'");
    expect(result).toContain("\u2022");
  });

  it("removes HTML comments", () => {
    const html = "Before <!-- this is a comment --> After";
    const result = htmlToReadableText(html);
    expect(result).toContain("Before");
    expect(result).toContain("After");
    expect(result).not.toContain("comment");
  });

  it("collapses excessive whitespace", () => {
    const html = "<p>Hello</p>   \n\n\n\n   <p>World</p>";
    const result = htmlToReadableText(html);
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });
});

// ============================================================================
// extractReadableArticle
// ============================================================================

describe("extractReadableArticle", () => {
  it("extracts content from <article> tags", () => {
    const html = `
      <nav><a href="/">Home</a></nav>
      <article>
        <h1>Article Title</h1>
        <p>This is the main article content with plenty of text to ensure it passes the length threshold for content detection.</p>
        <p>Second paragraph with more content.</p>
      </article>
      <footer>Copyright 2025</footer>
    `;
    const result = extractReadableArticle(html);
    expect(result).toContain("Article Title");
    expect(result).toContain("main article content");
    expect(result).not.toContain("Copyright");
  });

  it("extracts content from <main> tag when no <article>", () => {
    const html = `
      <header>Header</header>
      <main>
        <h1>Main Content</h1>
        <p>This is the main page content area with enough text to pass the minimum length requirement for extraction.</p>
      </main>
      <aside>Sidebar</aside>
    `;
    const result = extractReadableArticle(html);
    expect(result).toContain("Main Content");
  });

  it("removes nav, footer, aside, sidebar content", () => {
    const html = `
      <nav>Navigation links</nav>
      <div class="content">
        <p>Main content text that should be extracted because it has sufficient length and density for the readability algorithm.</p>
      </div>
      <div class="sidebar">Sidebar content</div>
      <footer>Footer content</footer>
    `;
    const result = extractReadableArticle(html);
    expect(result).toContain("Main content text");
  });

  it("uses text density scoring for blocks without semantic tags", () => {
    const html = `
      <body>
        <div class="menu"><a href="/">A</a><a href="/b">B</a><a href="/c">C</a></div>
        <div class="post">
          <p>This is a long article paragraph with substantial text content that should score high on text density because there are many words relative to the number of HTML tags present in this block.</p>
          <p>Another paragraph with plenty of text to boost density scoring further up the ranking chain.</p>
        </div>
        <div class="ads"><span>Ad 1</span><span>Ad 2</span></div>
      </body>
    `;
    const result = extractReadableArticle(html);
    expect(result).toContain("long article paragraph");
  });

  it("falls back to full page when no good content block found", () => {
    const html = "<span>Simple</span>";
    const result = extractReadableArticle(html);
    expect(result).toContain("Simple");
  });
});

// ============================================================================
// extractByCSS
// ============================================================================

describe("extractByCSS", () => {
  it("extracts by #id selector", () => {
    const html = '<div><div id="main">Target content</div><div id="other">Not this</div></div>';
    const result = extractByCSS(html, "#main");
    expect(result).toContain("Target content");
    expect(result).not.toContain("Not this");
  });

  it("extracts by .class selector", () => {
    const html = '<div class="content">Target</div><div class="sidebar">Not this</div>';
    const result = extractByCSS(html, ".content");
    expect(result).toContain("Target");
  });

  it("extracts by tag selector", () => {
    const html = "<nav>Skip</nav><article>Article content here</article>";
    const result = extractByCSS(html, "article");
    expect(result).toContain("Article content here");
  });

  it("handles nested elements with bracket counting", () => {
    const html =
      '<div id="outer"><div>Inner 1</div><div>Inner 2</div></div><div id="sibling">After</div>';
    const result = extractByCSS(html, "#outer");
    expect(result).toContain("Inner 1");
    expect(result).toContain("Inner 2");
    expect(result).not.toContain("After");
  });

  it("handles tag.class selector", () => {
    const html = '<div class="post">Content</div><span class="post">Not div</span>';
    const result = extractByCSS(html, "div.post");
    expect(result).toContain("Content");
  });

  it("returns null when selector not found", () => {
    const html = "<div>Some content</div>";
    const result = extractByCSS(html, "#nonexistent");
    expect(result).toBeNull();
  });
});

// ============================================================================
// extractPageMetadata
// ============================================================================

describe("extractPageMetadata", () => {
  it("extracts title", () => {
    const html = "<html><head><title>My Page Title</title></head><body></body></html>";
    const meta = extractPageMetadata(html);
    expect(meta.title).toBe("My Page Title");
  });

  it("extracts meta description", () => {
    const html =
      '<html><head><meta name="description" content="Page description here"></head></html>';
    const meta = extractPageMetadata(html);
    expect(meta.description).toBe("Page description here");
  });

  it("extracts og:description as fallback", () => {
    const html = '<html><head><meta property="og:description" content="OG desc"></head></html>';
    const meta = extractPageMetadata(html);
    expect(meta.description).toBe("OG desc");
  });

  it("extracts author", () => {
    const html = '<html><head><meta name="author" content="John Doe"></head></html>';
    const meta = extractPageMetadata(html);
    expect(meta.author).toBe("John Doe");
  });

  it("extracts canonical link", () => {
    const html = '<html><head><link rel="canonical" href="https://example.com/page"></head></html>';
    const meta = extractPageMetadata(html);
    expect(meta.canonical).toBe("https://example.com/page");
  });

  it("returns nulls when no metadata found", () => {
    const html = "<html><body>No head</body></html>";
    const meta = extractPageMetadata(html);
    expect(meta.title).toBeNull();
    expect(meta.description).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.canonical).toBeNull();
  });

  it("decodes HTML entities in title", () => {
    const html = "<title>Tom &amp; Jerry&#39;s Page</title>";
    const meta = extractPageMetadata(html);
    expect(meta.title).toBe("Tom & Jerry's Page");
  });
});

// ============================================================================
// parseHTML
// ============================================================================

describe("parseHTML", () => {
  it("extracts headings from document", () => {
    const html = "<h1>Title</h1><p>Text</p><h2>Subtitle</h2><p>More text</p><h3>Section</h3>";
    const doc = parseHTML(html);
    expect(doc.headings).toEqual(["Title", "Subtitle", "Section"]);
  });

  it("extracts links from document", () => {
    const html =
      '<a href="https://example.com">Example</a> <a href="/page">Page</a> <a href="#anchor">Skip</a>';
    const doc = parseHTML(html);
    expect(doc.links).toHaveLength(2); // #anchor excluded
    expect(doc.links[0]).toEqual({ text: "Example", href: "https://example.com" });
  });

  it("sets title and description from metadata", () => {
    const html =
      '<html><head><title>My Site</title><meta name="description" content="A great site"></head><body><p>Content</p></body></html>';
    const doc = parseHTML(html);
    expect(doc.title).toBe("My Site");
    expect(doc.description).toBe("A great site");
  });

  it("provides mainContent via readability extraction", () => {
    const html =
      "<html><body><article><p>The main article content is here with enough words to be detected.</p></article></body></html>";
    const doc = parseHTML(html);
    expect(doc.mainContent).toContain("main article content");
  });
});
