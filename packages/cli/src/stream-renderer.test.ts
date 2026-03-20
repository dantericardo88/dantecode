import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { StreamRenderer } from "./stream-renderer.js";

// Mock @dantecode/core so tests don't need the built package
vi.mock("@dantecode/core", () => {
  class UXEngine {
    constructor(_opts?: unknown) {}
    formatMarkdown(text: string) { return text; }
    generateHint(score: number) { return `hint:${score.toFixed(2)}`; }
    buildStatusLine(opts: { pdseScore?: number }) {
      return `[pdse:${opts.pdseScore?.toFixed(2)}]`;
    }
  }
  return { UXEngine };
});

describe("StreamRenderer", () => {
  let writes: string[];

  beforeEach(() => {
    writes = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Backward compat: boolean constructor still works
  it("boolean constructor (true=silent) buffers without writing", () => {
    const r = new StreamRenderer(true);
    r.write("hello");
    r.finish();
    expect(writes).toHaveLength(0);
    expect(r.getFullText()).toBe("hello");
  });

  // 2. boolean constructor (false=not silent) writes to stdout
  it("boolean constructor (false) writes tokens to stdout", () => {
    const r = new StreamRenderer(false);
    r.write("token");
    expect(writes.some((w) => w.includes("token"))).toBe(true);
  });

  // 3. options object: silent mode
  it("options.silent=true suppresses all stdout output", () => {
    const r = new StreamRenderer({ silent: true });
    r.printHeader();
    r.write("hi");
    r.finish();
    expect(writes).toHaveLength(0);
  });

  // 4. printHeader writes model label
  it("printHeader() writes DanteCode label", () => {
    const r = new StreamRenderer({ modelLabel: "grok/grok-3", colors: false });
    r.printHeader();
    expect(writes.some((w) => w.includes("DanteCode"))).toBe(true);
    expect(writes.some((w) => w.includes("grok/grok-3"))).toBe(true);
  });

  // 5. printHeader called twice is idempotent
  it("printHeader() is idempotent — only prints once", () => {
    const r = new StreamRenderer({ colors: false });
    r.printHeader();
    r.printHeader();
    const headers = writes.filter((w) => w.includes("DanteCode"));
    expect(headers).toHaveLength(1);
  });

  // 6. write accumulates in buffer
  it("write() accumulates tokens in getFullText()", () => {
    const r = new StreamRenderer({ silent: true });
    r.write("hello ");
    r.write("world");
    expect(r.getFullText()).toBe("hello world");
  });

  // 7. reset clears buffer
  it("reset() clears buffer and header state", () => {
    const r = new StreamRenderer({ colors: false });
    r.printHeader();
    r.write("data");
    r.reset();
    expect(r.getFullText()).toBe("");
    // printHeader should be callable again after reset
    r.printHeader();
    const headers = writes.filter((w) => w.includes("DanteCode"));
    expect(headers.length).toBeGreaterThanOrEqual(2);
  });

  // 8. finish appends newline when buffer non-empty
  it("finish() writes newline when buffer has content", () => {
    const r = new StreamRenderer({ colors: false });
    r.write("text");
    r.finish();
    expect(writes.some((w) => w === "\n")).toBe(true);
  });

  // 9. finish with PDSE score renders footer
  it("finish({ pdseScore }) renders PDSE footer", () => {
    const r = new StreamRenderer({ colors: false });
    r.write("data");
    r.finish({ pdseScore: 0.91 });
    expect(writes.some((w) => w.includes("pdse:0.91"))).toBe(true);
  });

  // 10. finish with tokens renders footer
  it("finish({ tokens }) renders token count footer", () => {
    const r = new StreamRenderer({ colors: false });
    r.write("x");
    r.finish({ tokens: 1500 });
    expect(writes.some((w) => w.includes("tokens:1500"))).toBe(true);
  });

  // 11. annotateToolCall — start
  it("annotateToolCall start writes tool name", () => {
    const r = new StreamRenderer({ colors: false });
    r.annotateToolCall({ kind: "start", toolName: "Bash", detail: "ls -la" });
    expect(writes.some((w) => w.includes("Bash"))).toBe(true);
  });

  // 12. annotateToolCall — end
  it("annotateToolCall end writes success indicator", () => {
    const r = new StreamRenderer({ colors: false });
    r.annotateToolCall({ kind: "end", toolName: "Write" });
    expect(writes.some((w) => w.includes("Write"))).toBe(true);
  });

  // 13. annotateToolCall — blocked
  it("annotateToolCall blocked writes 'blocked'", () => {
    const r = new StreamRenderer({ colors: false });
    r.annotateToolCall({ kind: "blocked", toolName: "GitPush" });
    expect(writes.some((w) => w.includes("blocked"))).toBe(true);
  });

  // 14. annotateToolCall silent does nothing
  it("annotateToolCall in silent mode produces no output", () => {
    const r = new StreamRenderer({ silent: true });
    r.annotateToolCall({ kind: "start", toolName: "Bash" });
    expect(writes).toHaveLength(0);
  });

  // 15. showPdseScore renders hint
  it("showPdseScore() writes status line", () => {
    const r = new StreamRenderer({ colors: false });
    r.showPdseScore(0.87, "verify");
    expect(writes.some((w) => w.includes("0.87"))).toBe(true);
  });

  // 16. showPdseScore silent does nothing
  it("showPdseScore() in silent mode produces no output", () => {
    const r = new StreamRenderer({ silent: true });
    r.showPdseScore(0.9);
    expect(writes).toHaveLength(0);
  });

  // 17. printSeparator with label
  it("printSeparator() includes label in output", () => {
    const r = new StreamRenderer({ colors: false });
    r.printSeparator("Step 1");
    expect(writes.some((w) => w.includes("Step 1"))).toBe(true);
  });

  // 18. printSeparator without label
  it("printSeparator() without label produces line characters", () => {
    const r = new StreamRenderer({ colors: false });
    r.printSeparator();
    expect(writes.some((w) => w.includes("─"))).toBe(true);
  });

  // 19. printSeparator silent does nothing
  it("printSeparator() in silent mode produces no output", () => {
    const r = new StreamRenderer({ silent: true });
    r.printSeparator("x");
    expect(writes).toHaveLength(0);
  });

  // 20. finish with no content produces no newline
  it("finish() with empty buffer produces no trailing newline", () => {
    const r = new StreamRenderer({ colors: false });
    r.finish();
    expect(writes.filter((w) => w === "\n")).toHaveLength(0);
  });
});
