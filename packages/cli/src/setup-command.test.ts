/**
 * setup-command.test.ts
 *
 * Tests for the /setup command wizard functionality.
 */

import { describe, it, expect } from "vitest";
import { getSlashCommandsMeta } from "./slash-commands.js";

describe("/setup command", () => {
  it("should be registered as a slash command", () => {
    // The setup command should be available in the registry
    const commands = getSlashCommandsMeta();
    const setupCommand = commands.find((c) => c.name === "setup");
    expect(setupCommand).toBeDefined();
    expect(setupCommand?.tier).toBe(1); // Tier 1 = core command
  });
});

describe("setup command integration", () => {
  it("should validate required imports are available", async () => {
    // Verify that all required functions are importable
    const {
      readStateYaml,
      writeStateYaml,
      initializeState,
      stateYamlExists,
      getProviderCatalogEntry,
    } = await import("@dantecode/core");

    expect(readStateYaml).toBeDefined();
    expect(writeStateYaml).toBeDefined();
    expect(initializeState).toBeDefined();
    expect(stateYamlExists).toBeDefined();
    expect(getProviderCatalogEntry).toBeDefined();
  });

  it("should have required node modules available", () => {
    const { createInterface } = require("node:readline");
    const { execSync } = require("node:child_process");
    const { readFile, writeFile } = require("node:fs/promises");

    expect(createInterface).toBeDefined();
    expect(execSync).toBeDefined();
    expect(readFile).toBeDefined();
    expect(writeFile).toBeDefined();
  });
});
