import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Microagent {
  name: string;
  content: string;
  triggers: string[];
}

/**
 * Parse YAML frontmatter from a markdown file using simple regex — no yaml library needed.
 * Returns { triggers, content } where content is everything after the closing ---.
 */
function parseFrontmatter(
  filename: string,
  raw: string
): { triggers: string[]; content: string } {
  const stem = filename.replace(/\.md$/i, "");

  // Check if file starts with ---
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    // No frontmatter — use entire file as content, filename as trigger
    return { triggers: [stem.toLowerCase()], content: raw.trim() };
  }

  const frontmatter = fmMatch[1]!;
  const body = fmMatch[2]!.trim();

  // Extract triggers block from frontmatter
  // Matches: "triggers:" followed by one or more "  - keyword" lines
  const triggersBlockMatch = frontmatter.match(
    /^triggers:\s*\r?\n((?:[ \t]+-[ \t]+.+\r?\n?)+)/m
  );

  if (!triggersBlockMatch) {
    // triggers key missing or empty → fall back to filename
    return { triggers: [stem.toLowerCase()], content: body };
  }

  const triggersBlock = triggersBlockMatch[1]!;
  const triggers: string[] = [];

  for (const line of triggersBlock.split(/\r?\n/)) {
    // Match "  - value" or "  - "quoted value""
    const itemMatch = line.match(/^[ \t]+-[ \t]+["']?(.+?)["']?\s*$/);
    if (itemMatch) {
      const trigger = itemMatch[1]!.trim().toLowerCase();
      if (trigger.length > 0) {
        triggers.push(trigger);
      }
    }
  }

  if (triggers.length === 0) {
    // Empty triggers list → fall back to filename
    return { triggers: [stem.toLowerCase()], content: body };
  }

  return { triggers, content: body };
}

/**
 * Load a single .md file and return a Microagent.
 */
function loadMdFile(filePath: string, filename: string): Microagent {
  const raw = readFileSync(filePath, "utf8");
  const name = filename.replace(/\.md$/i, "");
  const { triggers, content } = parseFrontmatter(filename, raw);
  return { name, triggers, content };
}

/**
 * Load bundled microagents from the `microagents/` directory that lives alongside
 * this compiled module. At runtime (dist/), the .md files are expected to be
 * copied into `dist/microagents/` following the same directory layout.
 */
export function loadBundledMicroagents(): Microagent[] {
  let dir: string;
  try {
    // import.meta.url is the file URL of THIS module
    const selfUrl = new URL("./microagents/", import.meta.url);
    dir = fileURLToPath(selfUrl);
  } catch {
    // Fallback for environments where import.meta.url is unavailable
    return [];
  }

  if (!existsSync(dir)) {
    return [];
  }

  const microagents: Microagent[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    try {
      const agent = loadMdFile(join(dir, entry), entry);
      microagents.push(agent);
    } catch {
      // Skip unreadable files
    }
  }

  return microagents;
}

/**
 * Load microagents from `{projectRoot}/.openhands/microagents/*.md` and merge
 * with bundled defaults. Project-local agents take precedence over bundled
 * agents with the same name.
 */
export function loadMicroagents(projectRoot: string): Microagent[] {
  const bundled = loadBundledMicroagents();

  const localDir = join(projectRoot, ".openhands", "microagents");
  const localAgents: Microagent[] = [];

  if (existsSync(localDir)) {
    let entries: string[];
    try {
      entries = readdirSync(localDir);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      try {
        const agent = loadMdFile(join(localDir, entry), entry);
        localAgents.push(agent);
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Merge: project-local takes precedence over bundled with the same name
  const byName = new Map<string, Microagent>();
  for (const agent of bundled) {
    byName.set(agent.name, agent);
  }
  for (const agent of localAgents) {
    byName.set(agent.name, agent);
  }

  return Array.from(byName.values());
}

/**
 * Given a list of microagents and a user prompt string, return all microagents
 * whose triggers appear in the prompt (case-insensitive substring match).
 */
export function findActiveMicroagents(
  microagents: Microagent[],
  userPrompt: string
): Microagent[] {
  if (!userPrompt || microagents.length === 0) return [];

  const lower = userPrompt.toLowerCase();
  return microagents.filter((agent) =>
    agent.triggers.some((trigger) => lower.includes(trigger))
  );
}

/**
 * Format a list of active microagents into an injectable context string.
 * Returns "" if the list is empty.
 */
export function formatMicroagentContext(microagents: Microagent[]): string {
  if (microagents.length === 0) return "";

  const parts: string[] = ["## Domain Knowledge (Microagents)", ""];

  for (const agent of microagents) {
    parts.push(`<!-- microagent: ${agent.name} -->`);
    parts.push(agent.content);
    parts.push(`<!-- /microagent -->`);
    parts.push("");
  }

  return parts.join("\n").trimEnd();
}
