// packages/cli/src/__tests__/markdown-renderer.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  renderLine,
  initialState,
  StreamingMarkdownRenderer,
} from "../markdown-renderer.js";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9]*[A-Z]/g, "");
}

describe("renderLine — headings", () => {
  it("renders h1 with bold magenta color", () => {
    const state = initialState();
    const out = renderLine("# Hello World", state);
    expect(stripAnsi(out)).toContain("Hello World");
    expect(out).toContain("\x1b[1m"); // BOLD
  });

  it("renders h2 with separator", () => {
    const state = initialState();
    const out = renderLine("## Section Title", state);
    expect(stripAnsi(out)).toContain("Section Title");
    expect(stripAnsi(out)).toContain("─");
  });

  it("renders h3", () => {
    const state = initialState();
    const out = renderLine("### Sub Section", state);
    expect(stripAnsi(out)).toContain("Sub Section");
  });
});

describe("renderLine — inline formatting", () => {
  it("renders **bold** text", () => {
    const state = initialState();
    const out = renderLine("This is **bold** text", state);
    expect(stripAnsi(out)).toContain("bold");
    expect(out).toContain("\x1b[1m"); // BOLD
  });

  it("renders *italic* text", () => {
    const state = initialState();
    const out = renderLine("This is *italic* text", state);
    expect(stripAnsi(out)).toContain("italic");
    expect(out).toContain("\x1b[3m"); // ITALIC
  });

  it("renders `inline code` with background", () => {
    const state = initialState();
    const out = renderLine("Use `const x = 1` here", state);
    expect(stripAnsi(out)).toContain("const x = 1");
    expect(out).toContain("\x1b[48;5;235m"); // BG_DARK
  });

  it("renders [link](url) with underline", () => {
    const state = initialState();
    const out = renderLine("See [docs](https://example.com)", state);
    expect(stripAnsi(out)).toContain("docs");
    expect(out).toContain("\x1b[4m"); // UNDERLINE
  });

  it("renders ~~strikethrough~~ as dimmed", () => {
    const state = initialState();
    const out = renderLine("~~deprecated~~", state);
    expect(out).toContain("\x1b[2m"); // DIM
  });
});

describe("renderLine — code fences", () => {
  it("opens a code fence with language label", () => {
    const state = initialState();
    renderLine("```typescript", state);
    expect(state.inCodeFence).toBe(true);
    expect(state.codeFenceLang).toBe("typescript");
  });

  it("closes a code fence on matching backticks", () => {
    const state = initialState();
    renderLine("```typescript", state);
    renderLine("```", state);
    expect(state.inCodeFence).toBe(false);
  });

  it("renders code inside fence with dark background", () => {
    const state = initialState();
    renderLine("```typescript", state);
    const codeLine = renderLine("const x = 1;", state);
    expect(codeLine).toContain("\x1b[48;5;235m"); // BG_DARK
    expect(stripAnsi(codeLine)).toContain("const x = 1;");
  });

  it("renders tilde fences (~~~)", () => {
    const state = initialState();
    renderLine("~~~python", state);
    expect(state.inCodeFence).toBe(true);
    expect(state.codeFenceLang).toBe("python");
  });

  it("does not close fence with different fence char", () => {
    const state = initialState();
    renderLine("```ts", state);
    renderLine("~~~", state); // different char — should NOT close
    expect(state.inCodeFence).toBe(true);
  });
});

describe("renderLine — lists and blockquotes", () => {
  it("renders bullet list item with dot", () => {
    const state = initialState();
    const out = renderLine("- Item one", state);
    expect(stripAnsi(out)).toContain("Item one");
    expect(stripAnsi(out)).toContain("•");
  });

  it("renders numbered list item", () => {
    const state = initialState();
    const out = renderLine("1. First item", state);
    expect(stripAnsi(out)).toContain("First item");
    expect(stripAnsi(out)).toContain("1.");
  });

  it("renders blockquote with pipe", () => {
    const state = initialState();
    const out = renderLine("> A quoted line", state);
    expect(stripAnsi(out)).toContain("│");
    expect(stripAnsi(out)).toContain("A quoted line");
  });

  it("renders horizontal rule as dashes", () => {
    const state = initialState();
    const out = renderLine("---", state);
    expect(stripAnsi(out)).toContain("─");
  });

  it("returns empty string for blank line", () => {
    const state = initialState();
    expect(renderLine("", state)).toBe("");
  });
});

describe("StreamingMarkdownRenderer", () => {
  let renderer: StreamingMarkdownRenderer;

  beforeEach(() => {
    renderer = new StreamingMarkdownRenderer();
  });

  it("buffers partial lines and returns complete lines", () => {
    const lines = renderer.push("Hello ");
    expect(lines).toHaveLength(0); // no newline yet

    const lines2 = renderer.push("World\n");
    expect(lines2).toHaveLength(1);
    expect(stripAnsi(lines2[0]!)).toContain("Hello World");
  });

  it("returns multiple lines when chunk contains multiple newlines", () => {
    const lines = renderer.push("Line 1\nLine 2\nLine 3\n");
    expect(lines).toHaveLength(3);
  });

  it("flush returns partial buffered line", () => {
    renderer.push("Partial line without newline");
    const flushed = renderer.flush();
    expect(flushed).toHaveLength(1);
    expect(stripAnsi(flushed[0]!)).toContain("Partial line without newline");
  });

  it("flush returns empty array when buffer is empty", () => {
    expect(renderer.flush()).toHaveLength(0);
  });

  it("reset clears buffer and state", () => {
    renderer.push("```typescript\n");
    expect(renderer.inCodeFence).toBe(true);
    renderer.reset();
    expect(renderer.inCodeFence).toBe(false);
    expect(renderer.flush()).toHaveLength(0);
  });

  it("tracks code fence state across push calls", () => {
    renderer.push("```ts\n");
    expect(renderer.inCodeFence).toBe(true);
    renderer.push("const x = 1;\n");
    renderer.push("```\n");
    expect(renderer.inCodeFence).toBe(false);
  });

  it("preserves token-chunked content correctly", () => {
    // Simulate streaming character by character
    const tokens = ["#", " ", "H", "e", "l", "l", "o", "\n"];
    let allLines: string[] = [];
    for (const tok of tokens) {
      allLines = allLines.concat(renderer.push(tok));
    }
    expect(allLines).toHaveLength(1);
    expect(stripAnsi(allLines[0]!)).toContain("Hello");
  });
});
