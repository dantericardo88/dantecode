import { describe, it, expect, beforeEach } from "vitest";
import { CommandPalette } from "./command-palette.js";
import type { PaletteCommand } from "./command-palette.js";

/** Helper: build a minimal PaletteCommand for registration tests */
function makeCmd(
  name: string,
  overrides: Partial<PaletteCommand> = {},
): PaletteCommand {
  return {
    name,
    description: `Description for ${name}`,
    keywords: [],
    category: "system",
    ...overrides,
  };
}

describe("CommandPalette", () => {
  let palette: CommandPalette;

  beforeEach(() => {
    palette = new CommandPalette();
  });

  // 1. constructor seeds 8 built-in commands
  it("constructor seeds 8 built-in commands", () => {
    const all = palette.list();
    const names = all.map((c) => c.name);
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(names).toContain("magic");
    expect(names).toContain("inferno");
    expect(names).toContain("autoforge");
    expect(names).toContain("party");
    expect(names).toContain("commit");
    expect(names).toContain("search");
    expect(names).toContain("verify");
    expect(names).toContain("forge");
  });

  // 2. list() without category returns all commands; categories present
  it("list() returns commands across multiple categories", () => {
    const all = palette.list();
    const categories = [...new Set(all.map((c) => c.category))];
    expect(categories.length).toBeGreaterThanOrEqual(2);
  });

  // 3. register() adds a new command
  it("register() adds a new command", () => {
    palette.register(makeCmd("mycmd", { category: "git" }));
    expect(palette.get("mycmd")).toBeDefined();
    expect(palette.get("mycmd")?.name).toBe("mycmd");
  });

  // 4. register() overwrites an existing command
  it("register() overwrites an existing command with same name", () => {
    palette.register(makeCmd("magic", { description: "Overwritten", category: "system" }));
    expect(palette.get("magic")?.description).toBe("Overwritten");
  });

  // 5. unregister() removes a command and returns false for unknown
  it("unregister() removes known command returning true, returns false for unknown", () => {
    expect(palette.unregister("magic")).toBe(true);
    expect(palette.get("magic")).toBeUndefined();
    expect(palette.unregister("nonexistent_xyz")).toBe(false);
  });

  // 6. get() returns command by name (found)
  it("get() returns the command for a known name", () => {
    const cmd = palette.get("verify");
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("verify");
  });

  // 7. get() returns undefined for unknown name
  it("get() returns undefined for an unknown command name", () => {
    expect(palette.get("does_not_exist_xyz")).toBeUndefined();
  });

  // 8. list() returns all commands when no category given
  it("list() without category returns all registered commands", () => {
    const all = palette.list();
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  // 9. list() filters by category
  it("list() with category returns only commands of that category", () => {
    const gitCmds = palette.list("git");
    expect(gitCmds.length).toBeGreaterThan(0);
    for (const cmd of gitCmds) {
      expect(cmd.category).toBe("git");
    }
    // workflow commands should NOT appear in git category
    const workflowNames = palette.list("workflow").map((c) => c.name);
    for (const cmd of gitCmds) {
      expect(workflowNames).not.toContain(cmd.name);
    }
  });

  // 10. search() exact name match returns score=1
  it("search() exact name match returns score of 1.0", () => {
    const results = palette.search("magic");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBe(1.0);
    expect(results[0]!.command.name).toBe("magic");
  });

  // 11. search() name startsWith returns score=0.8
  it("search() startsWith match returns score of 0.8", () => {
    const results = palette.search("inf"); // inferno starts with "inf"
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBe(0.8);
    expect(results[0]!.command.name).toBe("inferno");
  });

  // 12. search() with keyword overlap returns results
  it("search() with keyword overlap returns matching commands", () => {
    // "parallel" is a keyword for "party"
    const results = palette.search("parallel");
    const names = results.map((r) => r.command.name);
    expect(names).toContain("party");
  });

  // 13. search() returns empty for blank query
  it("search() returns empty array for blank/whitespace query", () => {
    expect(palette.search("")).toHaveLength(0);
    expect(palette.search("   ")).toHaveLength(0);
  });

  // 14. suggest() respects pdseMinScore filter
  it("suggest() excludes commands whose pdseMinScore exceeds current score", () => {
    // Register a command that requires high PDSE score
    palette.register(
      makeCmd("highrequirement", {
        category: "workflow",
        pdseMinScore: 0.9,
      }),
    );
    // With low score, highrequirement should not appear
    const lowSuggestions = palette.suggest(0.3);
    const names = lowSuggestions.map((c) => c.name);
    expect(names).not.toContain("highrequirement");

    // With high score, highrequirement should appear
    const highSuggestions = palette.suggest(0.95);
    const highNames = highSuggestions.map((c) => c.name);
    expect(highNames).toContain("highrequirement");
  });

  // 15. suggest() with context ranks relevant commands higher
  it("suggest() with context ranks keyword-matching commands first", () => {
    // "parallel" overlaps with "party"'s keywords
    const suggestions = palette.suggest(1.0, "parallel multi-agent task");
    expect(suggestions.length).toBeGreaterThan(0);
    // "party" has keywords ["parallel", "multi", "agent", ...] — should rank first or high
    expect(suggestions[0]!.name).toBe("party");
  });
});
