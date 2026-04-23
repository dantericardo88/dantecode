import { describe, it, expect } from "vitest";
import { skillsManager } from "../skills-manager.js";

describe("Skills System", () => {
  it("registers a plugin manually", () => {
    const plugin = {
      name: "test-plugin",
      description: "Test plugin",
      version: "1.0.0",
      commands: [
        {
          name: "test-cmd",
          description: "Test command",
          usage: "/test-cmd",
          handler: async () => "test",
        },
      ],
      agents: [],
    };

    skillsManager.registerPlugin(plugin);
    const plugins = skillsManager.listPlugins();
    expect(plugins).toContain("test-plugin");
  });

  it("provides registered commands", () => {
    const command = skillsManager.getCommand("test-cmd");
    expect(command).toBeDefined();
    expect(command?.description).toBe("Test command");
  });

  it("executes the command", async () => {
    const command = skillsManager.getCommand("test-cmd");
    const result = await command?.handler("", { projectRoot: "/test" });
    expect(result).toBe("test");
  });
});
