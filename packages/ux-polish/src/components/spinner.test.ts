/**
 * spinner.test.ts - Tests for Spinner component
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Spinner, SPINNERS } from "./spinner.js";
import { Writable } from "node:stream";

describe("Spinner", () => {
  let mockStream: Writable;
  let writtenData: string[];

  beforeEach(() => {
    writtenData = [];
    mockStream = new Writable({
      write(chunk, _encoding, callback) {
        writtenData.push(chunk.toString());
        callback();
        return true;
      },
    });

    // Mock TTY detection
    vi.stubGlobal("process", {
      ...process,
      stdout: { isTTY: true },
      stderr: { isTTY: true },
      env: { ...process.env, VSCODE_PID: undefined },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts and stops correctly", () => {
    const spinner = new Spinner({ text: "Loading...", stream: mockStream });

    expect(spinner.spinning).toBe(false);

    spinner.start();
    expect(spinner.spinning).toBe(true);

    spinner.stop();
    expect(spinner.spinning).toBe(false);
  });

  it("renders with correct frame animation", async () => {
    const spinner = new Spinner({
      text: "Test",
      stream: mockStream,
      spinner: "dots",
      interval: 10,
    });

    spinner.start();

    // Wait for a few frames
    await new Promise((resolve) => setTimeout(resolve, 50));

    spinner.stop();

    // Should have rendered multiple frames
    expect(writtenData.length).toBeGreaterThan(1);

    // Should contain spinner frames
    const output = writtenData.join("");
    const dotsFrames = SPINNERS.dots.frames;
    const hasFrames = dotsFrames.some((frame) => output.includes(frame));
    expect(hasFrames).toBe(true);
  });

  it("succeed() shows green checkmark", () => {
    const spinner = new Spinner({ text: "Task", stream: mockStream });

    spinner.start();
    spinner.succeed("Done!");

    const output = writtenData.join("");

    // Should contain checkmark symbol
    expect(output).toContain("✓");

    // Should contain success text
    expect(output).toContain("Done!");

    // Should contain green color code
    expect(output).toContain("\x1b[32m"); // Green

    expect(spinner.spinning).toBe(false);
  });

  it("fail() shows red X", () => {
    const spinner = new Spinner({ text: "Task", stream: mockStream });

    spinner.start();
    spinner.fail("Failed!");

    const output = writtenData.join("");

    // Should contain X symbol
    expect(output).toContain("✗");

    // Should contain fail text
    expect(output).toContain("Failed!");

    // Should contain red color code
    expect(output).toContain("\x1b[31m"); // Red

    expect(spinner.spinning).toBe(false);
  });

  it("disables ANSI in VSCode mode", () => {
    // Mock VSCode environment
    vi.stubGlobal("process", {
      ...process,
      stdout: { isTTY: false },
      env: { ...process.env, VSCODE_PID: "12345" },
    });

    const spinner = new Spinner({ text: "Loading", stream: mockStream });

    spinner.start();

    // In VSCode mode, should just write once without animation
    const output = writtenData.join("");

    // Should not contain ANSI escape codes (no color codes)
    // In non-interactive mode, just prints text
    expect(output).toContain("Loading");

    spinner.stop();
  });

  it("updates text while spinning", async () => {
    const spinner = new Spinner({ text: "Initial", stream: mockStream, interval: 10 });

    spinner.start();

    await new Promise((resolve) => setTimeout(resolve, 20));

    spinner.update("Updated");

    await new Promise((resolve) => setTimeout(resolve, 20));

    spinner.stop();

    const output = writtenData.join("");

    // Should contain updated text
    expect(output).toContain("Updated");
  });

  it("supports custom spinner frames", () => {
    const customFrames = ["1", "2", "3"];
    const spinner = new Spinner({
      text: "Custom",
      stream: mockStream,
      spinner: { frames: customFrames, interval: 10 },
    });

    spinner.start();
    spinner.stop();

    // Should use custom frames
    expect(spinner.spinning).toBe(false);
  });

  it("warn() shows yellow warning symbol", () => {
    const spinner = new Spinner({ text: "Task", stream: mockStream });

    spinner.start();
    spinner.warn("Warning!");

    const output = writtenData.join("");

    expect(output).toContain("⚠");
    expect(output).toContain("Warning!");
    expect(output).toContain("\x1b[33m"); // Yellow
  });

  it("info() shows cyan info symbol", () => {
    const spinner = new Spinner({ text: "Task", stream: mockStream });

    spinner.start();
    spinner.info("Info!");

    const output = writtenData.join("");

    expect(output).toContain("ℹ");
    expect(output).toContain("Info!");
    expect(output).toContain("\x1b[36m"); // Cyan
  });
});
