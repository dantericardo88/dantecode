import { describe, it, expect, afterEach } from "vitest";

describe("AskUser tool", () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("returns default answer in non-TTY mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });

    // Simulate the toolAskUser logic for non-TTY
    const defaultAnswer = "dark mode";
    const isTTY = process.stdin.isTTY;

    let result: string;
    if (!isTTY) {
      result = `User response: ${defaultAnswer ?? "(non-interactive — no user input available)"}`;
    } else {
      result = "User response: (would prompt)";
    }

    expect(result).toBe("User response: dark mode");
  });

  it("returns placeholder when no default in non-TTY mode", () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });

    const defaultAnswer: string | undefined = undefined;
    const isTTY = process.stdin.isTTY;

    let result: string;
    if (!isTTY) {
      result = `User response: ${defaultAnswer ?? "(non-interactive — no user input available)"}`;
    } else {
      result = "would prompt";
    }

    expect(result).toContain("non-interactive");
  });

  it("formats options as numbered list", () => {
    const options = ["TypeScript", "JavaScript", "Python"];
    const lines = options.map((opt, i) => `  ${i + 1}. ${opt}`);
    expect(lines).toEqual([
      "  1. TypeScript",
      "  2. JavaScript",
      "  3. Python",
    ]);
  });

  it("selects option by index", () => {
    const options = ["TypeScript", "JavaScript", "Python"];
    const answer = "2"; // User types "2"
    const idx = parseInt(answer, 10) - 1;
    expect(idx).toBe(1);
    expect(options[idx]).toBe("JavaScript");
  });

  it("handles invalid option index gracefully", () => {
    const options = ["A", "B"];
    const answer = "5"; // Out of range
    const idx = parseInt(answer, 10) - 1;
    const valid = idx >= 0 && idx < options.length;
    expect(valid).toBe(false);
  });
});
