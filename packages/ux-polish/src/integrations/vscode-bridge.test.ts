/**
 * vscode-bridge.test.ts — @dantecode/ux-polish
 * Tests for G15 — VS Code polish weld.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { VscodeBridge } from "./vscode-bridge.js";
import { VscodeSurface } from "../surfaces/vscode-surface.js";
import { ThemeEngine } from "../theme-engine.js";
import type { VscodeMessage } from "../surfaces/vscode-surface.js";

function makeBridge(onMessage?: (msg: VscodeMessage) => void) {
  const theme = new ThemeEngine({ colors: false });
  const surface = new VscodeSurface({ theme });
  return new VscodeBridge({ surface, theme, onMessage });
}

describe("VscodeBridge", () => {
  let bridge: VscodeBridge;

  beforeEach(() => {
    bridge = makeBridge();
  });

  describe("syncTheme()", () => {
    it("dispatches a theme-sync message", () => {
      const messages: VscodeMessage[] = [];
      const b = makeBridge((msg) => messages.push(msg));
      const theme = new ThemeEngine({ colors: false });
      b.syncTheme(theme);
      expect(messages.length).toBeGreaterThan(0);
      const payload = messages[0]!.payload as Record<string, unknown>;
      expect(payload["type"]).toBe("theme-sync");
    });

    it("includes theme name in payload", () => {
      const messages: VscodeMessage[] = [];
      const b = makeBridge((msg) => messages.push(msg));
      const theme = new ThemeEngine({ theme: "matrix", colors: false });
      b.syncTheme(theme);
      const payload = messages[0]!.payload as Record<string, unknown>;
      expect(payload["name"]).toBe("matrix");
    });
  });

  describe("buildSidebarPanel()", () => {
    it("returns a VscodeMessage", () => {
      const msg = bridge.buildSidebarPanel({
        id: "panel-1",
        title: "Status",
        items: [{ label: "Build", detail: "passing" }],
      });
      expect(msg.kind).toBeDefined();
      const payload = msg.payload as Record<string, unknown>;
      expect(payload["type"]).toBe("sidebar-panel");
    });

    it("includes title in payload", () => {
      const msg = bridge.buildSidebarPanel({ id: "p", title: "MyPanel", items: [] });
      const payload = msg.payload as Record<string, unknown>;
      expect(payload["title"]).toBe("MyPanel");
    });

    it("includes items in payload", () => {
      const msg = bridge.buildSidebarPanel({
        id: "p",
        title: "P",
        items: [{ label: "A" }, { label: "B" }],
      });
      const payload = msg.payload as Record<string, unknown>;
      expect((payload["items"] as unknown[]).length).toBe(2);
    });
  });

  describe("buildStatusBarSegment()", () => {
    it("returns a StatusBarItem with text", () => {
      const item = bridge.buildStatusBarSegment([{ text: "Build: passing" }]);
      expect(item.text).toContain("Build: passing");
    });

    it("concatenates multiple parts", () => {
      const item = bridge.buildStatusBarSegment([
        { text: "PDSE: 90%" },
        { text: "branch: main" },
      ]);
      expect(item.text).toContain("PDSE: 90%");
      expect(item.text).toContain("branch: main");
    });

    it("includes tooltip from parts", () => {
      const item = bridge.buildStatusBarSegment([
        { text: "Build", tooltip: "All tests pass" },
      ]);
      expect(item.tooltip).toContain("All tests pass");
    });
  });

  describe("renderProgress()", () => {
    it("sends progress message to surface", () => {
      const messages: VscodeMessage[] = [];
      const theme = new ThemeEngine({ colors: false });
      const surface = new VscodeSurface({
        theme,
        postMessage: (msg) => messages.push(msg),
      });
      const b = new VscodeBridge({ surface, theme });
      b.renderProgress({
        id: "p1",
        phase: "Building",
        status: "running",
        progress: 50,
      });
      const progressMessages = messages.filter((m) => m.kind === "progress");
      expect(progressMessages.length).toBeGreaterThan(0);
    });
  });

  describe("renderSuggestions()", () => {
    it("calls sendSuggestions on surface", () => {
      const theme = new ThemeEngine({ colors: false });
      const surface = new VscodeSurface({ theme });
      const b = new VscodeBridge({ surface, theme });
      b.renderSuggestions([
        { command: "/verify", label: "Verify", reason: "test", priority: "high" },
      ]);
      const log = b.getMessageLog();
      expect(log.some((m) => m.kind === "suggestion")).toBe(true);
    });
  });

  describe("renderPdseScore()", () => {
    it("sends pdse message", () => {
      bridge.renderPdseScore(0.87, "High");
      const log = bridge.getMessageLog();
      expect(log.some((m) => m.kind === "pdse")).toBe(true);
    });
  });

  describe("getMessageLog() / clearLog()", () => {
    it("returns accumulated messages", () => {
      bridge.renderPdseScore(0.5);
      expect(bridge.getMessageLog().length).toBeGreaterThan(0);
    });

    it("clearLog() empties the log", () => {
      bridge.renderPdseScore(0.5);
      bridge.clearLog();
      expect(bridge.getMessageLog().length).toBe(0);
    });
  });
});
