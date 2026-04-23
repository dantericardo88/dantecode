// ============================================================================
// packages/vscode/src/__tests__/terminal-output-manager.test.ts
// Tests for TerminalOutputManager — rolling buffer, ANSI strip, failure detect.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { TerminalOutputManager, stripAnsi, type TerminalDataEvent } from "../terminal-output-manager.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(terminalName: string, data: string): TerminalDataEvent {
  return {
    terminal: { name: terminalName },
    data,
  };
}

// ── stripAnsi ─────────────────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("strips CSI colour codes but preserves surrounding text", () => {
    const raw = "\x1b[31mERROR\x1b[0m: something went wrong";
    expect(stripAnsi(raw)).toBe("ERROR: something went wrong");
  });

  it("strips OSC window-title sequences", () => {
    const raw = "output\x1b]0;Terminal Title\x07more";
    expect(stripAnsi(raw)).toBe("outputmore");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

// ── TerminalOutputManager ─────────────────────────────────────────────────────

describe("TerminalOutputManager", () => {
  let mgr: TerminalOutputManager;

  beforeEach(() => {
    mgr = new TerminalOutputManager();
  });

  it("getBuffer() returns empty string when no data received", () => {
    expect(mgr.getBuffer()).toBe("");
    expect(mgr.getBuffer("bash")).toBe("");
  });

  it("onData() accumulates output across multiple writes to the same terminal", () => {
    mgr.onData(makeEvent("bash", "line one\n"));
    mgr.onData(makeEvent("bash", "line two\n"));
    expect(mgr.getBuffer("bash")).toBe("line one\nline two\n");
  });

  it("rolling buffer truncates to 8192 bytes on overflow", () => {
    const chunk = "x".repeat(5_000);
    mgr.onData(makeEvent("bash", chunk));
    mgr.onData(makeEvent("bash", chunk));
    // Total would be 10 000 — should be capped at 8 192
    expect(mgr.getBuffer("bash").length).toBeLessThanOrEqual(8_192);
  });

  it("getBuffer(name) returns the correct buffer for the named terminal", () => {
    mgr.onData(makeEvent("bash", "bash output"));
    mgr.onData(makeEvent("zsh", "zsh output"));
    expect(mgr.getBuffer("bash")).toBe("bash output");
    expect(mgr.getBuffer("zsh")).toBe("zsh output");
  });

  it("getBuffer() with no argument returns the last-written terminal buffer", () => {
    mgr.onData(makeEvent("bash", "first"));
    mgr.onData(makeEvent("zsh", "second"));
    expect(mgr.getBuffer()).toBe("second");
  });

  it("detectTestFailure() returns null when no failure pattern present", () => {
    mgr.onData(makeEvent("bash", "All tests passed!\n2 passed\n"));
    expect(mgr.detectTestFailure("bash")).toBeNull();
  });

  it("detectTestFailure() detects a vitest '2 failed' pattern", () => {
    mgr.onData(makeEvent("bash", "\n\nTest suite\n\n2 failed | 10 passed\n"));
    const result = mgr.detectTestFailure("bash");
    expect(result).not.toBeNull();
    expect(result).toContain("failed");
  });

  it("clear() empties the named terminal buffer only", () => {
    mgr.onData(makeEvent("bash", "bash output"));
    mgr.onData(makeEvent("zsh", "zsh output"));
    mgr.clear("bash");
    expect(mgr.getBuffer("bash")).toBe("");
    expect(mgr.getBuffer("zsh")).toBe("zsh output");
  });
});
