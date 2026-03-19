/**
 * web-fetch-engine.test.ts
 *
 * 25 Vitest unit tests for WebFetchEngine using fetchFn injection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebFetchEngine } from "./web-fetch-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(
  mockFetch: ReturnType<typeof vi.fn>,
  body: string,
  status = 200,
  contentType = "text/html",
) {
  return mockFetch.mockResolvedValueOnce({
    text: async () => body,
    status,
    headers: {
      get: (h: string) => (h === "content-type" ? contentType : null),
    },
  });
}

const SIMPLE_HTML = `
<html>
  <head>
    <title>Test Page</title>
    <meta name="description" content="A simple test page">
  </head>
  <body>
    <p>Hello world. This is some content on the page.</p>
    <p>More content here to pad the word count for confidence scoring.</p>
  </body>
</html>
`;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("WebFetchEngine", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let engine: WebFetchEngine;

  beforeEach(() => {
    mockFetch = vi.fn();
    engine = new WebFetchEngine({ fetchFn: mockFetch });
  });

  // -------------------------------------------------------------------------
  // fetch() — basic behavior
  // -------------------------------------------------------------------------

  it("1. fetch() calls fetchFn with the provided URL", async () => {
    mockResponse(mockFetch, SIMPLE_HTML);
    await engine.fetch("https://example.com");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("2. fetch() returns FetchResult with the correct url", async () => {
    mockResponse(mockFetch, SIMPLE_HTML);
    const result = await engine.fetch("https://example.com");
    expect(result.url).toBe("https://example.com");
  });

  it("3. fetch() parses HTML title", async () => {
    mockResponse(mockFetch, SIMPLE_HTML);
    const result = await engine.fetch("https://example.com");
    expect(result.title).toBe("Test Page");
  });

  it("4. fetch() parses meta description", async () => {
    mockResponse(mockFetch, SIMPLE_HTML);
    const result = await engine.fetch("https://example.com");
    expect(result.description).toBe("A simple test page");
  });

  it("5. fetch() extracts text from HTML", async () => {
    mockResponse(mockFetch, SIMPLE_HTML);
    const result = await engine.fetch("https://example.com");
    expect(result.content).toContain("Hello world");
    expect(result.content).not.toContain("<p>");
  });

  it("6. fetch() handles JSON content with jsonPassthrough", async () => {
    const json = JSON.stringify({ key: "value", count: 42 });
    mockResponse(mockFetch, json, 200, "application/json");
    const result = await engine.fetch("https://api.example.com/data", {
      jsonPassthrough: true,
    });
    expect(result.content).toContain('"key"');
    expect(result.content).toContain('"value"');
  });

  it("7. fetch() handles fetch error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await engine.fetch("https://unreachable.example.com");
    expect(result.statusCode).toBe(0);
    expect(result.content).toContain("Error fetching URL");
    expect(result.confidence).toBe(0);
  });

  it("8. fetch() truncates long content", async () => {
    const longContent = "word ".repeat(20_000); // ~100K chars
    mockResponse(mockFetch, `<html><body><p>${longContent}</p></body></html>`);
    const smallEngine = new WebFetchEngine({
      fetchFn: mockFetch,
      maxContentLength: 100,
    });
    const result = await smallEngine.fetch("https://example.com");
    expect(result.content.length).toBeLessThanOrEqual(104); // 100 + ellipsis char
    expect(result.content).toMatch(/…$/);
  });

  it("9. fetch() returns the correct statusCode", async () => {
    mockResponse(mockFetch, "<html><body>Not found</body></html>", 404);
    const result = await engine.fetch("https://example.com/missing");
    expect(result.statusCode).toBe(404);
  });

  it("10. fetch() reads contentType from response headers", async () => {
    mockResponse(mockFetch, SIMPLE_HTML, 200, "text/html; charset=utf-8");
    const result = await engine.fetch("https://example.com");
    expect(result.contentType).toContain("text/html");
  });

  // -------------------------------------------------------------------------
  // fetchSmart()
  // -------------------------------------------------------------------------

  it("11. fetchSmart() starts with quick mode", async () => {
    // Return rich content so confidence is high enough to skip escalation
    const richHtml = `
      <html><head><title>Rich</title><meta name="description" content="Lots of info"></head>
      <body>${"word ".repeat(400)}</body></html>
    `;
    mockResponse(mockFetch, richHtml);
    const result = await engine.fetchSmart("https://example.com");
    expect(result.mode).toBe("quick");
    // Should only have called fetch once
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("12. fetchSmart() escalates on low confidence", async () => {
    // First response: empty page (low confidence)
    mockResponse(mockFetch, "<html><body></body></html>");
    // Second response: rich page
    mockResponse(mockFetch, SIMPLE_HTML);
    const result = await engine.fetchSmart("https://example.com");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.mode).toBe("full");
  });

  it("13. fetchSmart() returns high-confidence result without escalation", async () => {
    const richHtml = `
      <html>
        <head>
          <title>Great Article</title>
          <meta name="description" content="Very informative content about many things">
        </head>
        <body>${"information ".repeat(350)}</body>
      </html>
    `;
    const highConfEngine = new WebFetchEngine({
      fetchFn: mockFetch,
      lowConfidenceThreshold: 0.3,
    });
    mockResponse(mockFetch, richHtml);
    await highConfEngine.fetchSmart("https://example.com");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // extractTitle()
  // -------------------------------------------------------------------------

  it("14. extractTitle() parses the title tag", () => {
    const html = "<html><head><title>My Title</title></head></html>";
    expect(engine.extractTitle(html)).toBe("My Title");
  });

  it("15. extractTitle() returns empty string for missing title", () => {
    expect(engine.extractTitle("<html><head></head></html>")).toBe("");
  });

  // -------------------------------------------------------------------------
  // extractDescription()
  // -------------------------------------------------------------------------

  it("16. extractDescription() parses meta description", () => {
    const html = `<html><head><meta name="description" content="My Desc"></head></html>`;
    expect(engine.extractDescription(html)).toBe("My Desc");
  });

  it("17. extractDescription() returns empty string for no meta", () => {
    expect(engine.extractDescription("<html><head></head></html>")).toBe("");
  });

  // -------------------------------------------------------------------------
  // extractText()
  // -------------------------------------------------------------------------

  it("18. extractText() strips HTML tags", () => {
    const html = "<p>Hello <strong>world</strong>!</p>";
    const text = engine.extractText(html);
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<strong>");
    expect(text).toContain("Hello");
    expect(text).toContain("world");
  });

  it("19. extractText() collapses whitespace", () => {
    const html = "<p>  too    many   spaces   </p>";
    const text = engine.extractText(html);
    expect(text).not.toMatch(/\s{2,}/);
  });

  // -------------------------------------------------------------------------
  // computeConfidence()
  // -------------------------------------------------------------------------

  it("20. computeConfidence() returns 0 for empty content", () => {
    const result = {
      url: "https://x.com",
      mode: "quick" as const,
      content: "",
      statusCode: 200,
      contentType: "text/html",
      wordCount: 0,
      confidence: 0,
      fetchedAt: new Date().toISOString(),
    };
    expect(engine.computeConfidence(result)).toBe(0);
  });

  it("21. computeConfidence() gives credit for having a title", () => {
    const withTitle = {
      url: "https://x.com",
      mode: "quick" as const,
      content: "short",
      title: "My Title",
      statusCode: 200,
      contentType: "text/html",
      wordCount: 1,
      confidence: 0,
      fetchedAt: new Date().toISOString(),
    };
    const withoutTitle = { ...withTitle, title: undefined };
    expect(engine.computeConfidence(withTitle)).toBeGreaterThan(
      engine.computeConfidence(withoutTitle),
    );
  });

  it("22. computeConfidence() gives credit for content length", () => {
    const short = {
      url: "https://x.com",
      mode: "quick" as const,
      content: "hi",
      statusCode: 200,
      contentType: "text/html",
      wordCount: 1,
      confidence: 0,
      fetchedAt: new Date().toISOString(),
    };
    const long = { ...short, content: "word ".repeat(1_000) };
    expect(engine.computeConfidence(long)).toBeGreaterThan(
      engine.computeConfidence(short),
    );
  });

  // -------------------------------------------------------------------------
  // isJson()
  // -------------------------------------------------------------------------

  it("23. isJson() returns true for application/json content type", () => {
    expect(engine.isJson("{}", "application/json")).toBe(true);
  });

  it("24. isJson() detects JSON-parseable content regardless of content type", () => {
    expect(engine.isJson('{"a":1}', "text/plain")).toBe(true);
    expect(engine.isJson("[1,2,3]", "text/plain")).toBe(true);
    expect(engine.isJson("not json", "text/plain")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // truncateContent()
  // -------------------------------------------------------------------------

  it("25. truncateContent() adds ellipsis when content exceeds limit", () => {
    const tinyEngine = new WebFetchEngine({
      fetchFn: mockFetch,
      maxContentLength: 10,
    });
    const result = tinyEngine.truncateContent("Hello world this is long");
    expect(result).toBe("Hello worl\u2026");
    expect(result.length).toBe(11);
  });
});
