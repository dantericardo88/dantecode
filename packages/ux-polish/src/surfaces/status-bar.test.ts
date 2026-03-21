/**
 * status-bar.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StatusBar } from "./status-bar.js";
import { ThemeEngine } from "../theme-engine.js";
import type { StatusBarState } from "./status-bar.js";

const BASE_STATE: StatusBarState = {
  modelLabel: "grok/grok-3",
  tokensUsed: 12450,
  sandboxMode: "workspace-write",
};

function makeTTY(isTTY: boolean, rows = 24): void {
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
}

describe("StatusBar", () => {
  beforeEach(() => {
    makeTTY(true, 24);
  });

  afterEach(() => {
    makeTTY(true, 24);
  });

  it("renders with all fields populated", () => {
    const bar = new StatusBar({
      ...BASE_STATE,
      sessionName: "my-session",
      pdseScore: 92,
      tokenBudget: 50000,
      elapsedMs: 12_000,
    });
    const rendered = bar.render();
    expect(rendered).toContain("grok/grok-3");
    expect(rendered).toContain("12,450");
    expect(rendered).toContain("my-session");
    expect(rendered).toContain("workspace-write");
    expect(rendered).toContain("PDSE: 92");
  });

  it("renders with minimal state without crashing", () => {
    const bar = new StatusBar(BASE_STATE);
    const rendered = bar.render();
    expect(rendered).toContain("grok/grok-3");
    expect(rendered).toContain("workspace-write");
    expect(rendered).toBeTruthy();
  });

  it("update() patches only the specified fields", () => {
    const bar = new StatusBar(BASE_STATE);
    bar.update({ tokensUsed: 99999, sessionName: "updated" });
    const rendered = bar.render();
    expect(rendered).toContain("99,999");
    expect(rendered).toContain("updated");
    // model label unchanged
    expect(rendered).toContain("grok/grok-3");
  });

  it("theme affects colors in output", () => {
    const theme = new ThemeEngine({ theme: "matrix", colors: true });
    const bar = new StatusBar(BASE_STATE, theme);
    const rendered = bar.render();
    // matrix theme uses different ANSI codes — just check it renders without error
    expect(typeof rendered).toBe("string");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("returns empty string in non-TTY environment", () => {
    makeTTY(false);
    const bar = new StatusBar(BASE_STATE);
    expect(bar.render()).toBe("");
  });

  it("draw() writes to stdout in TTY mode", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const bar = new StatusBar(BASE_STATE);
    bar.draw();
    expect(writeSpy).toHaveBeenCalled();
    const written = String(writeSpy.mock.calls[0]?.[0]);
    expect(written).toContain("\x1b[s"); // save cursor
    writeSpy.mockRestore();
  });

  it("clear() writes erase-line sequence to stdout", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const bar = new StatusBar(BASE_STATE);
    bar.clear();
    expect(writeSpy).toHaveBeenCalled();
    const written = String(writeSpy.mock.calls[0]?.[0]);
    expect(written).toContain("\x1b[2K"); // erase line
    writeSpy.mockRestore();
  });

  it("setEnabled(false) makes draw() a no-op", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const bar = new StatusBar(BASE_STATE);
    bar.setEnabled(false);
    bar.draw();
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
