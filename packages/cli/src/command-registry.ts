import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface NativeSlashCommandDefinition {
  name: string;
  description: string;
  usage: string;
  tier?: 1 | 2;
  category?: string;
}

export interface RegisteredSlashCommand extends NativeSlashCommandDefinition {
  source: "native" | "markdown";
  filePath?: string;
}

interface CommandRegistryOptions {
  homeDir?: string;
}

export async function loadSlashCommandRegistry(
  projectRoot: string,
  nativeCommands: NativeSlashCommandDefinition[],
  options: CommandRegistryOptions = {},
): Promise<RegisteredSlashCommand[]> {
  const registry = new Map<string, RegisteredSlashCommand>();

  for (const command of nativeCommands) {
    registry.set(command.name, {
      ...command,
      source: "native",
    });
  }

  const markdownCommands = await loadMarkdownCommands(projectRoot, options.homeDir ?? homedir());
  for (const command of markdownCommands) {
    if (!registry.has(command.name)) {
      registry.set(command.name, command);
    }
  }

  const nativeOrder = nativeCommands.map((command) => command.name);
  const ordered = nativeOrder
    .map((name) => registry.get(name))
    .filter((command): command is RegisteredSlashCommand => Boolean(command));

  const markdownOnly = Array.from(registry.values())
    .filter((command) => command.source === "markdown")
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...ordered, ...markdownOnly];
}

async function loadMarkdownCommands(
  projectRoot: string,
  home: string,
): Promise<RegisteredSlashCommand[]> {
  const commands: RegisteredSlashCommand[] = [];
  const directories = [join(projectRoot, "commands"), join(home, ".codex", "commands")];

  for (const directory of directories) {
    const entries = await safeReadDir(directory);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }

      const filePath = join(directory, entry);
      const parsed = await parseMarkdownCommand(filePath, entry);
      if (parsed) {
        commands.push(parsed);
      }
    }
  }

  return commands;
}

async function parseMarkdownCommand(
  filePath: string,
  fileName: string,
): Promise<RegisteredSlashCommand | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const frontmatter = extractFrontmatter(raw);
    const fallbackName = fileName.replace(/\.md$/i, "").toLowerCase();
    const name = (frontmatter.name ?? fallbackName).trim().toLowerCase();
    if (!name) {
      return null;
    }

    return {
      name,
      description: (frontmatter.description ?? `Markdown-backed ${name} workflow`).trim(),
      usage: (frontmatter.usage ?? `/${name}`).trim(),
      source: "markdown",
      filePath,
    };
  } catch {
    return null;
  }
}

function extractFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

async function safeReadDir(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
