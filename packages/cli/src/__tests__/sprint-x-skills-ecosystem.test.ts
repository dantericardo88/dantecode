// ============================================================================
// Sprint X — Dims 22+13: Built-in skill ecosystem + diff quality in UX
// Tests that:
//  - registerBuiltinPlugins registers dante-review and dante-test plugins
//  - dante-review:run command executes and returns review output
//  - dante-review:list command executes and returns history info
//  - dante-test:run command executes and returns test output
//  - dante-test:coverage command executes and returns coverage info
//  - skillsManager.listPlugins() includes built-in plugins after init
//  - skillsManager.listCommands() includes all 4 built-in commands
//  - activateSkill dispatches dante-review:run without policy block
//  - scoreDiff quality score is between 0 and 1 for realistic diff
//  - scoreDiff hasTests=true for spec files (quality label accuracy)
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  skillsManager,
  registerBuiltinPlugins,
  activateSkill,
} from "../skills-manager.js";
import { scoreDiff } from "@dantecode/core";

describe("Built-in skill ecosystem — Sprint X (dim 22)", () => {
  beforeEach(() => {
    // Re-register to ensure state is fresh
    registerBuiltinPlugins(skillsManager);
  });

  // 1. dante-review plugin registered
  it("registerBuiltinPlugins registers dante-review plugin", () => {
    const plugins = skillsManager.listPlugins();
    expect(plugins).toContain("dante-review");
  });

  // 2. dante-test plugin registered
  it("registerBuiltinPlugins registers dante-test plugin", () => {
    const plugins = skillsManager.listPlugins();
    expect(plugins).toContain("dante-test");
  });

  // 3. dante-review:run executes
  it("dante-review:run command returns review output", async () => {
    const cmd = skillsManager.getCommand("dante-review:run");
    expect(cmd).toBeDefined();
    const result = await cmd!.handler("--file src/index.ts", {});
    expect(result).toContain("dante-review");
  });

  // 4. dante-review:list executes
  it("dante-review:list command returns history info", async () => {
    const cmd = skillsManager.getCommand("dante-review:list");
    expect(cmd).toBeDefined();
    const result = await cmd!.handler("", {});
    expect(typeof result).toBe("string");
  });

  // 5. dante-test:run executes
  it("dante-test:run command returns test output", async () => {
    const cmd = skillsManager.getCommand("dante-test:run");
    expect(cmd).toBeDefined();
    const result = await cmd!.handler("--pattern *.test.ts", {});
    expect(result).toContain("dante-test");
  });

  // 6. dante-test:coverage executes
  it("dante-test:coverage command returns coverage info", async () => {
    const cmd = skillsManager.getCommand("dante-test:coverage");
    expect(cmd).toBeDefined();
    const result = await cmd!.handler("", {});
    expect(result).toContain("coverage");
  });

  // 7. listCommands includes all 4 built-in commands
  it("listCommands includes all 4 built-in commands", () => {
    const names = skillsManager.listCommands().map((c) => c.name);
    expect(names).toContain("dante-review:run");
    expect(names).toContain("dante-review:list");
    expect(names).toContain("dante-test:run");
    expect(names).toContain("dante-test:coverage");
  });

  // 8. activateSkill dispatches dante-review:run
  it("activateSkill dispatches dante-review:run end-to-end", async () => {
    const result = await activateSkill("dante-review:run", "--file utils.ts", {}, []);
    expect(result.allowed).toBe(true);
    expect(result.output).toContain("dante-review");
    expect(result.error).toBeUndefined();
  });
});

describe("scoreDiff quality label — Sprint X (dim 13)", () => {
  // 9. qualityScore is between 0 and 1 for realistic diff
  it("scoreDiff returns qualityScore in [0, 1] for a real-world diff", () => {
    const old = "import React from 'react';\n\nfunction App() {\n  return <div>Hello</div>;\n}\n";
    const newC = "import React from 'react';\n\nfunction App() {\n  return <div>Hello World</div>;\n}\n\nexport default App;\n";
    const score = scoreDiff(old, newC, "src/App.tsx");
    expect(score.qualityScore).toBeGreaterThanOrEqual(0);
    expect(score.qualityScore).toBeLessThanOrEqual(1);
  });

  // 10. hasTests=true for spec file paths
  it("scoreDiff identifies spec.ts files as test files", () => {
    const score = scoreDiff("old content", "new content", "src/utils.spec.ts");
    expect(score.hasTests).toBe(true);
  });
});
