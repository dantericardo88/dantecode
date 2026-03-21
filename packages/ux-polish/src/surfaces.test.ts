/**
 * surfaces.test.ts — @dantecode/ux-polish
 * Tests for CLI, REPL, and VS Code surface adapters.
 */

import { describe, it, expect } from "vitest";
import { CliSurface } from "./surfaces/cli-surface.js";
import { ReplSurface } from "./surfaces/repl-surface.js";
import { VscodeSurface } from "./surfaces/vscode-surface.js";
import { ThemeEngine } from "./theme-engine.js";
import type { ProgressState } from "./types.js";

const noColor = new ThemeEngine({ colors: false });

// ---------------------------------------------------------------------------
// CliSurface
// ---------------------------------------------------------------------------

describe("CliSurface", () => {
  it("render() returns output string without writing to stdout", () => {
    const surface = new CliSurface({ theme: noColor, writeToStdout: false });
    const output = surface.render({ kind: "success", content: "ok" });
    expect(output).toContain("ok");
  });

  it("success() renders success line", () => {
    const surface = new CliSurface({ theme: noColor, writeToStdout: false });
    const output = surface.render({ kind: "success", content: "build passed" });
    expect(output).toContain("build passed");
  });

  it("error() renders error line", () => {
    const surface = new CliSurface({ theme: noColor, writeToStdout: false });
    const output = surface.render({ kind: "error", content: "build failed" });
    expect(output).toContain("build failed");
  });

  it("buildStatusLine() includes provided parts", () => {
    const surface = new CliSurface({ theme: noColor, writeToStdout: false });
    const line = surface.buildStatusLine({ model: "claude-3", tokens: 500 });
    expect(line).toContain("model:claude-3");
    expect(line).toContain("tokens:500");
  });

  it("spinnerActive is false initially", () => {
    const surface = new CliSurface({ writeToStdout: false });
    expect(surface.spinnerActive).toBe(false);
  });

  it("startSpinner sets spinnerActive=true when writeToStdout=false", () => {
    const surface = new CliSurface({ writeToStdout: false });
    surface.startSpinner("loading...");
    expect(surface.spinnerActive).toBe(true);
    surface.stopSpinner();
  });

  it("stopSpinner sets spinnerActive=false", () => {
    const surface = new CliSurface({ writeToStdout: false });
    surface.startSpinner("loading...");
    surface.stopSpinner();
    expect(surface.spinnerActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReplSurface
// ---------------------------------------------------------------------------

describe("ReplSurface", () => {
  it("render() returns output string", () => {
    const surface = new ReplSurface({ theme: noColor });
    const output = surface.render({ kind: "text", content: "hello" });
    expect(output).toBe("hello");
  });

  it("formatResponse() renders markdown", () => {
    const surface = new ReplSurface({ theme: noColor });
    const output = surface.formatResponse("# Hello\nWorld");
    expect(output).toContain("Hello");
  });

  it("formatPrompt() includes model info when provided", () => {
    const surface = new ReplSurface({ theme: noColor });
    const prompt = surface.formatPrompt({ model: "claude-3", tokens: 100 });
    expect(prompt).toContain("claude-3");
    expect(prompt).toContain("100");
  });

  it("formatPrompt() with no context returns basic prompt", () => {
    const surface = new ReplSurface({ theme: noColor });
    const prompt = surface.formatPrompt();
    expect(prompt).toContain(">");
  });

  it("formatCommandEcho() prefixes with ←", () => {
    const surface = new ReplSurface({ theme: noColor });
    expect(surface.formatCommandEcho("/magic")).toContain("/magic");
  });

  it("formatPdseInline() shows score", () => {
    const surface = new ReplSurface({ theme: noColor });
    const pass = surface.formatPdseInline(0.9);
    const warn = surface.formatPdseInline(0.6);
    const fail = surface.formatPdseInline(0.3);
    expect(pass).toContain("0.90");
    expect(warn).toContain("0.60");
    expect(fail).toContain("0.30");
  });

  it("separator() returns a non-empty string", () => {
    const surface = new ReplSurface({ theme: noColor });
    expect(surface.separator().length).toBeGreaterThan(0);
  });

  it("sessionHeader() includes sessionId", () => {
    const surface = new ReplSurface({ theme: noColor });
    expect(surface.sessionHeader("abc-123")).toContain("abc-123");
  });
});

// ---------------------------------------------------------------------------
// VscodeSurface
// ---------------------------------------------------------------------------

describe("VscodeSurface", () => {
  it("render() emits a 'render' message", () => {
    const surface = new VscodeSurface({ theme: noColor });
    const msg = surface.render({ kind: "text", content: "hello" });
    expect(msg.kind).toBe("render");
    expect(msg.timestamp).toBeTruthy();
  });

  it("sendProgress() emits a 'progress' message", () => {
    const surface = new VscodeSurface({ theme: noColor });
    const state: ProgressState = {
      id: "p1",
      phase: "Building",
      status: "running",
      progress: 50,
    };
    const msg = surface.sendProgress(state);
    expect(msg.kind).toBe("progress");
  });

  it("sendSuggestions() emits a 'suggestion' message", () => {
    const surface = new VscodeSurface({ theme: noColor });
    const msg = surface.sendSuggestions([
      { command: "/verify", label: "Verify", reason: "test", priority: "high" },
    ]);
    expect(msg.kind).toBe("suggestion");
  });

  it("updateStatusBar() emits a 'status-bar' message", () => {
    const surface = new VscodeSurface({ theme: noColor });
    const msg = surface.updateStatusBar({ text: "DanteCode", color: "success" });
    expect(msg.kind).toBe("status-bar");
  });

  it("sendPdseScore() emits a 'pdse' message", () => {
    const surface = new VscodeSurface({ theme: noColor });
    const msg = surface.sendPdseScore(0.85, "pdse");
    expect(msg.kind).toBe("pdse");
  });

  it("postMessage callback is invoked", () => {
    const received: unknown[] = [];
    const surface = new VscodeSurface({
      theme: noColor,
      postMessage: (m) => {
        received.push(m);
      },
    });
    surface.render({ kind: "text", content: "test" });
    expect(received).toHaveLength(1);
  });

  it("getMessageLog() returns all emitted messages", () => {
    const surface = new VscodeSurface({ theme: noColor });
    surface.render({ kind: "text", content: "a" });
    surface.sendPdseScore(0.9);
    expect(surface.getMessageLog()).toHaveLength(2);
  });

  it("clearLog() empties the message log", () => {
    const surface = new VscodeSurface({ theme: noColor });
    surface.render({ kind: "text", content: "x" });
    surface.clearLog();
    expect(surface.getMessageLog()).toHaveLength(0);
  });

  it("formatProgressLine() includes phase and percent", () => {
    const surface = new VscodeSurface({ theme: noColor });
    const state: ProgressState = {
      id: "p",
      phase: "Testing",
      status: "running",
      progress: 75,
    };
    const line = surface.formatProgressLine(state);
    expect(line).toContain("Testing");
    expect(line).toContain("75");
  });

  it("buildStatusBarItem() returns item with text", () => {
    const surface = new VscodeSurface({ theme: noColor });
    const item = surface.buildStatusBarItem({ model: "claude-3", pdseScore: 0.9 });
    expect(item.text).toContain("claude-3");
    expect(item.color).toBe("success");
  });
});
