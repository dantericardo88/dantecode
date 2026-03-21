import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSlashCommandRegistry, type NativeSlashCommandDefinition } from "./command-registry.js";

describe("loadSlashCommandRegistry", () => {
  let projectRoot = "";

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = "";
    }
  });

  it("discovers markdown-backed commands and keeps native commands marked as native", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-command-registry-"));
    await mkdir(join(projectRoot, "commands"), { recursive: true });
    await writeFile(
      join(projectRoot, "commands", "inferno.md"),
      "---\nname: inferno\ndescription: Max workflow\n---\n\n# Inferno\n",
      "utf-8",
    );

    const nativeCommands: NativeSlashCommandDefinition[] = [
      { name: "help", description: "Show help", usage: "/help" },
      { name: "autoforge", description: "Run autoforge", usage: "/autoforge" },
    ];

    const registry = await loadSlashCommandRegistry(projectRoot, nativeCommands);

    expect(registry.find((cmd) => cmd.name === "help")?.source).toBe("native");
    expect(registry.find((cmd) => cmd.name === "inferno")?.source).toBe("markdown");
    expect(registry.find((cmd) => cmd.name === "inferno")?.filePath).toContain("commands");
  });

  it("prefers native definitions over markdown files with the same command name", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-command-prefer-native-"));
    await mkdir(join(projectRoot, "commands"), { recursive: true });
    await writeFile(
      join(projectRoot, "commands", "help.md"),
      "---\nname: help\ndescription: Shadow help\n---\n\n# Help\n",
      "utf-8",
    );

    const nativeCommands: NativeSlashCommandDefinition[] = [
      { name: "help", description: "Show help", usage: "/help" },
    ];

    const registry = await loadSlashCommandRegistry(projectRoot, nativeCommands);
    const help = registry.find((cmd) => cmd.name === "help");

    expect(help?.source).toBe("native");
    expect(help?.description).toBe("Show help");
  });
});
