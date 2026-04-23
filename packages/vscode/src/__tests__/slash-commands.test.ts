import { describe, it, expect } from "vitest";
import {
  parseSlashCommand,
  buildSlashPrompt,
  listSlashCommands,
  SLASH_COMMANDS,
} from "../slash-commands.js";

// ── listSlashCommands ─────────────────────────────────────────────────────

describe("listSlashCommands", () => {
  it("returns all 7 built-in commands", () => {
    const cmds = listSlashCommands();
    expect(cmds).toHaveLength(7);
  });

  it("all commands have name, description, icon", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.description).toBeTruthy();
      expect(cmd.icon).toBeTruthy();
    }
  });

  it("includes fix, test, explain, comment, optimize, review, refactor", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain("fix");
    expect(names).toContain("test");
    expect(names).toContain("explain");
    expect(names).toContain("comment");
    expect(names).toContain("optimize");
    expect(names).toContain("review");
    expect(names).toContain("refactor");
  });
});

// ── parseSlashCommand ─────────────────────────────────────────────────────

describe("parseSlashCommand", () => {
  it("returns null for plain text", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSlashCommand("")).toBeNull();
  });

  it("returns null for unknown command", () => {
    expect(parseSlashCommand("/unknown")).toBeNull();
  });

  it("returns null when slash is not the first character", () => {
    expect(parseSlashCommand("text /fix")).toBeNull();
  });

  it("parses /fix", () => {
    const result = parseSlashCommand("/fix");
    expect(result).not.toBeNull();
    expect(result?.command.name).toBe("fix");
    expect(result?.args).toBe("");
  });

  it("parses /test with args", () => {
    const result = parseSlashCommand("/test auth module");
    expect(result).not.toBeNull();
    expect(result?.command.name).toBe("test");
    expect(result?.args).toBe("auth module");
  });

  it("parses /explain (case-insensitive)", () => {
    const result = parseSlashCommand("/EXPLAIN");
    expect(result?.command.name).toBe("explain");
  });

  it("parses /review", () => {
    expect(parseSlashCommand("/review")?.command.name).toBe("review");
  });

  it("parses /refactor", () => {
    expect(parseSlashCommand("/refactor")?.command.name).toBe("refactor");
  });

  it("parses /comment", () => {
    expect(parseSlashCommand("/comment")?.command.name).toBe("comment");
  });

  it("parses /optimize", () => {
    expect(parseSlashCommand("/optimize")?.command.name).toBe("optimize");
  });
});

// ── buildSlashPrompt ──────────────────────────────────────────────────────

describe("buildSlashPrompt", () => {
  const fixCmd = SLASH_COMMANDS.find((c) => c.name === "fix")!;
  const testCmd = SLASH_COMMANDS.find((c) => c.name === "test")!;
  const explainCmd = SLASH_COMMANDS.find((c) => c.name === "explain")!;

  it("includes the base prompt text for /fix", () => {
    const prompt = buildSlashPrompt(fixCmd, "", "");
    expect(prompt).toMatch(/fix/i);
  });

  it("appends code context when selection is provided", () => {
    const prompt = buildSlashPrompt(fixCmd, "const x = 1;", "src/app.ts");
    expect(prompt).toContain("const x = 1;");
    expect(prompt).toContain("src/app.ts");
  });

  it("does not append code block when selection is empty", () => {
    const prompt = buildSlashPrompt(fixCmd, "", "src/app.ts");
    expect(prompt).not.toContain("```");
  });

  it("/test prompt mentions tests", () => {
    const prompt = buildSlashPrompt(testCmd, "function foo() {}", "foo.ts");
    expect(prompt).toMatch(/test/i);
  });

  it("/explain prompt is concise focused", () => {
    const prompt = buildSlashPrompt(explainCmd, "async function load() {}", "mod.ts");
    expect(prompt).toMatch(/explain/i);
  });
});
