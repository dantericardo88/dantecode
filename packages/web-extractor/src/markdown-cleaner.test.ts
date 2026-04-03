import { describe, it, expect } from "vitest";
import { MarkdownCleaner } from "./markdown-cleaner.js";

describe("MarkdownCleaner", () => {
  const cleaner = new MarkdownCleaner();

  it("should strip script and style tags", () => {
    const html = `<html><head><style>body { color: red; }</style></head><body><h1>Title</h1><script>alert('hi')</script><p>Hello</p></body></html>`;
    const cleaned = cleaner.clean(html);
    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("style");
    expect(cleaned).toContain("# Title");
    expect(cleaned).toContain("Hello");
  });

  it("should normalize whitespace and preserve paragraphs", () => {
    const html = `<p>Hello    \n\n   World</p>`;
    const cleaned = cleaner.clean(html);
    expect(cleaned).toBe("Hello\n\nWorld");
  });

  it("should extract title", () => {
    const html = `<html><head><title>My Page</title></head><body><h1>Content</h1></body></html>`;
    const title = cleaner.extractTitle(html);
    expect(title).toBe("My Page");
  });
});
