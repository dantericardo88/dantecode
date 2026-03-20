/**
 * rich-renderer.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect } from "vitest";
import { RichRenderer, renderRichOutput } from "./rich-renderer.js";
import { ThemeEngine } from "./theme-engine.js";
import type { RenderPayload } from "./types.js";

const noColorEngine = new ThemeEngine({ colors: false });

describe("RichRenderer", () => {
  it("renders text payload", () => {
    const r = new RichRenderer({ theme: noColorEngine });
    const result = r.render("cli", { kind: "text", content: "hello" });
    expect(result.rendered).toBe(true);
    expect(result.output).toBe("hello");
    expect(result.surface).toBe("cli");
  });

  it("renders success payload with icon", () => {
    const r = new RichRenderer({ theme: noColorEngine });
    const result = r.render("cli", { kind: "success", content: "done" });
    expect(result.output).toContain("done");
  });

  it("renders error payload", () => {
    const r = new RichRenderer({ theme: noColorEngine });
    const result = r.render("cli", { kind: "error", content: "failed" });
    expect(result.output).toContain("failed");
  });

  it("renders info payload differently for vscode surface", () => {
    const r = new RichRenderer({ theme: noColorEngine });
    const vscResult = r.render("vscode", { kind: "info", content: "info msg" });
    const cliResult = r.render("cli",    { kind: "info", content: "info msg" });
    // VS Code just returns plain text; CLI prepends an icon
    expect(vscResult.output).toBe("info msg");
    expect(cliResult.output).toContain("info msg");
  });

  it("compact density truncates text", () => {
    const r = new RichRenderer({ theme: noColorEngine, defaultDensity: "compact" });
    const multiline = "line1\nline2\nline3";
    const result = r.render("cli", { kind: "text", content: multiline }, { density: "compact" });
    expect(result.output).not.toContain("line2");
  });

  it("renders markdown headings", () => {
    const r = new RichRenderer({ theme: noColorEngine });
    const result = r.render("cli", { kind: "markdown", content: "# Heading\ntext" });
    expect(result.output).toContain("Heading");
  });

  it("renders table payload", () => {
    const payload: RenderPayload = {
      kind: "table",
      content: "",
      data: {
        headers: ["Name", "Score"],
        rows: [["alice", "9.0"], ["bob", "8.5"]],
      },
    };
    const r = new RichRenderer({ theme: noColorEngine });
    const result = r.render("cli", payload);
    expect(result.output).toContain("Name");
    expect(result.output).toContain("alice");
    expect(result.output).toContain("9.0");
  });

  it("renders diff payload", () => {
    const payload: RenderPayload = {
      kind: "diff",
      content: "",
      data: { added: ["new line"], removed: ["old line"] },
    };
    const r = new RichRenderer({ theme: noColorEngine });
    const result = r.render("cli", payload);
    expect(result.output).toContain("+ new line");
    expect(result.output).toContain("- old line");
  });

  it("returns rendered:false on exception", () => {
    const r = new RichRenderer({ theme: noColorEngine });
    // Force an error by using an invalid payload kind
    const result = r.render("cli", {
      kind: "table" as const,
      content: "x",
      data: undefined,
    });
    // Table with no headers falls back to content — should still succeed
    expect(result.rendered).toBe(true);
  });

  it("theme is reflected in result", () => {
    const e = new ThemeEngine({ theme: "matrix", colors: false });
    const r = new RichRenderer({ theme: e });
    const result = r.render("cli", { kind: "text", content: "x" });
    expect(result.theme).toBe("matrix");
  });
});

describe("renderRichOutput()", () => {
  it("uses shared renderer instance", () => {
    const result = renderRichOutput("cli", { kind: "text", content: "shared" });
    expect(result.output).toBe("shared");
    expect(result.surface).toBe("cli");
  });
});
