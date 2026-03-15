// ============================================================================
// @dantecode/cli — Agent Command
// Sub-commands for managing agents: list, run, create
// ============================================================================

import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";
import { readOrInitializeState } from "@dantecode/core";
import type { AgentDefinition, Session } from "@dantecode/config-types";
import { runAgentLoop } from "../agent-loop.js";
import type { AgentLoopConfig } from "../agent-loop.js";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const AGENTS_DIR = ".dantecode/agents";

// ----------------------------------------------------------------------------
// Agent Template
// ----------------------------------------------------------------------------

const AGENT_TEMPLATE = (name: string): string => `---
name: ${name}
description: A custom DanteCode agent
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
nomaLane: worker
---

# ${name}

## Description

This is a custom agent for specialized tasks. Customize the instructions
below to define the agent's behavior and capabilities.

## Instructions

- Focus on the specific task defined by the user
- Use the available tools to complete the task
- Write complete, production-ready code
- Report progress and results clearly

## Constraints

- Do not modify files outside the defined scope
- Ask for clarification when the task is ambiguous
- Follow the project's coding conventions
`;

// ----------------------------------------------------------------------------
// Agent Command Router
// ----------------------------------------------------------------------------

/**
 * Runs the `dantecode agent` command with the given sub-command and arguments.
 *
 * @param args - Arguments after "agent" (e.g., ["list"], ["run", "my-agent"]).
 * @param projectRoot - Absolute path to the project root.
 */
export async function runAgentCommand(args: string[], projectRoot: string): Promise<void> {
  const subCommand = args[0] || "list";

  switch (subCommand) {
    case "list":
      await agentList(projectRoot);
      break;
    case "run":
      await agentRun(args.slice(1), projectRoot);
      break;
    case "create":
      await agentCreate(args.slice(1), projectRoot);
      break;
    default:
      process.stdout.write(`${RED}Unknown agent sub-command: ${subCommand}${RESET}\n`);
      process.stdout.write(`\n${BOLD}Usage:${RESET}\n`);
      process.stdout.write(`  dantecode agent list              List available agents\n`);
      process.stdout.write(`  dantecode agent run <name>        Run a named agent\n`);
      process.stdout.write(`  dantecode agent create <name>     Create a new agent definition\n`);
      break;
  }
}

// ----------------------------------------------------------------------------
// Helper: Load Agent Definition
// ----------------------------------------------------------------------------

/**
 * Loads an agent definition from a YAML/MD file in the agents directory.
 * Parses the frontmatter to extract the AgentDefinition fields.
 */
async function loadAgentDefinition(
  name: string,
  projectRoot: string,
): Promise<{ definition: AgentDefinition; instructions: string; filePath: string } | null> {
  const agentsDir = join(projectRoot, AGENTS_DIR);

  // Try various file extensions
  const extensions = [".yaml", ".yml", ".md"];

  for (const ext of extensions) {
    const filePath = join(agentsDir, `${name}${ext}`);
    try {
      const content = await readFile(filePath, "utf-8");
      return parseAgentFile(content, filePath, name);
    } catch {
      // File doesn't exist with this extension, try next
    }
  }

  // Also try matching by frontmatter name in all files
  try {
    const entries = await readdir(agentsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".yaml") && !entry.endsWith(".yml") && !entry.endsWith(".md")) {
        continue;
      }
      const filePath = join(agentsDir, entry);
      try {
        const content = await readFile(filePath, "utf-8");
        const parsed = parseAgentFile(content, filePath, entry.replace(/\.\w+$/, ""));
        if (parsed && parsed.definition.name.toLowerCase() === name.toLowerCase()) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // agents directory doesn't exist
  }

  return null;
}

/**
 * Parses an agent file (YAML frontmatter + markdown body).
 */
function parseAgentFile(
  content: string,
  filePath: string,
  fallbackName: string,
): { definition: AgentDefinition; instructions: string; filePath: string } | null {
  const trimmed = content.trimStart();

  // Extract frontmatter
  if (!trimmed.startsWith("---")) {
    // No frontmatter, treat entire content as instructions
    return {
      definition: {
        name: fallbackName,
        description: "",
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        nomaLane: "worker",
      },
      instructions: content,
      filePath,
    };
  }

  const afterOpener = trimmed.slice(3);
  const closingIndex = afterOpener.indexOf("\n---");
  if (closingIndex === -1) {
    return null;
  }

  const yamlBlock = afterOpener.slice(0, closingIndex).trim();
  const instructions = afterOpener.slice(closingIndex + 4).trim();

  try {
    const parsed = YAML.parse(yamlBlock) as Record<string, unknown>;

    const definition: AgentDefinition = {
      name: typeof parsed["name"] === "string" ? parsed["name"] : fallbackName,
      description: typeof parsed["description"] === "string" ? parsed["description"] : "",
      model: typeof parsed["model"] === "string" ? parsed["model"] : undefined,
      tools: Array.isArray(parsed["tools"])
        ? (parsed["tools"] as unknown[]).filter((t): t is string => typeof t === "string")
        : ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      subagents: Array.isArray(parsed["subagents"])
        ? (parsed["subagents"] as unknown[]).filter((s): s is string => typeof s === "string")
        : undefined,
      nomaLane:
        typeof parsed["nomaLane"] === "string"
          ? (parsed["nomaLane"] as AgentDefinition["nomaLane"])
          : "worker",
      fileLocks: Array.isArray(parsed["fileLocks"])
        ? (parsed["fileLocks"] as unknown[]).filter((f): f is string => typeof f === "string")
        : undefined,
      skillRefs: Array.isArray(parsed["skillRefs"])
        ? (parsed["skillRefs"] as unknown[]).filter((s): s is string => typeof s === "string")
        : undefined,
    };

    return { definition, instructions, filePath };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Sub-Commands
// ----------------------------------------------------------------------------

/**
 * Lists all agent definitions found in .dantecode/agents/.
 */
async function agentList(projectRoot: string): Promise<void> {
  const agentsDir = join(projectRoot, AGENTS_DIR);

  let entries: string[];
  try {
    entries = await readdir(agentsDir);
  } catch {
    process.stdout.write(
      `\n${DIM}No agents directory found.${RESET}\n` +
        `${DIM}Run 'dantecode init' to create the project structure,${RESET}\n` +
        `${DIM}then 'dantecode agent create <name>' to create an agent.${RESET}\n\n`,
    );
    return;
  }

  const agentFiles = entries.filter(
    (e) => e.endsWith(".yaml") || e.endsWith(".yml") || e.endsWith(".md"),
  );

  if (agentFiles.length === 0) {
    process.stdout.write(
      `\n${DIM}No agent definitions found in ${agentsDir}${RESET}\n` +
        `${DIM}Use 'dantecode agent create <name>' to create one.${RESET}\n\n`,
    );
    return;
  }

  process.stdout.write(`\n${BOLD}Available Agents (${agentFiles.length}):${RESET}\n\n`);

  for (const file of agentFiles) {
    const filePath = join(agentsDir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseAgentFile(content, filePath, file.replace(/\.\w+$/, ""));
      if (parsed) {
        const { definition } = parsed;
        process.stdout.write(
          `  ${YELLOW}${definition.name.padEnd(24)}${RESET} ` +
            `${DIM}[${definition.nomaLane}]${RESET} ` +
            `${definition.description || "(no description)"}\n`,
        );
      } else {
        process.stdout.write(`  ${DIM}${file} (parse error)${RESET}\n`);
      }
    } catch {
      process.stdout.write(`  ${DIM}${file} (read error)${RESET}\n`);
    }
  }

  process.stdout.write("\n");
}

/**
 * Runs a named agent by loading its definition and executing it.
 */
async function agentRun(args: string[], projectRoot: string): Promise<void> {
  const agentName = args[0];
  if (!agentName) {
    process.stdout.write(`${RED}Usage: dantecode agent run <name> [prompt]${RESET}\n`);
    return;
  }

  // Remaining args form the prompt
  const prompt = args.slice(1).join(" ") || `Execute the ${agentName} agent's default task.`;

  const agentData = await loadAgentDefinition(agentName, projectRoot);
  if (!agentData) {
    process.stdout.write(`${RED}Agent not found: ${agentName}${RESET}\n`);
    return;
  }

  const { definition, instructions } = agentData;

  process.stdout.write(
    `\n${CYAN}${BOLD}Running agent: ${definition.name}${RESET}\n` +
      `${DIM}${definition.description}${RESET}\n` +
      `${DIM}Lane: ${definition.nomaLane} | Tools: ${definition.tools.join(", ")}${RESET}\n\n`,
  );

  // Load state
  let state;
  try {
    state = await readOrInitializeState(projectRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${RED}Error loading state: ${message}${RESET}\n`);
    return;
  }

  // Create a session for this agent run
  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID(),
    projectRoot,
    messages: [],
    activeFiles: [],
    model: state.model.default,
    createdAt: now,
    updatedAt: now,
    agentStack: [
      {
        agentId: definition.name,
        agentType: definition.nomaLane,
        startedAt: now,
        touchedFiles: [],
        status: "running",
        subAgentIds: definition.subagents ?? [],
      },
    ],
    todoList: [],
  };

  // Inject agent instructions as a system message
  session.messages.push({
    id: randomUUID(),
    role: "system",
    content: `You are running as the "${definition.name}" agent.\n\n${instructions}`,
    timestamp: now,
  });

  const agentConfig: AgentLoopConfig = {
    state,
    verbose: false,
    enableGit: true,
    enableSandbox: false,
  };

  // Run the agent loop
  try {
    await runAgentLoop(prompt, session, agentConfig);

    // Mark agent as completed
    const agentFrame = session.agentStack[0];
    if (agentFrame) {
      agentFrame.status = "completed";
    }

    process.stdout.write(`\n${GREEN}${BOLD}Agent "${definition.name}" completed.${RESET}\n\n`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n${RED}Agent error: ${message}${RESET}\n`);

    const agentFrame = session.agentStack[0];
    if (agentFrame) {
      agentFrame.status = "failed";
    }
  }
}

/**
 * Creates a new agent definition file from a template.
 */
async function agentCreate(args: string[], projectRoot: string): Promise<void> {
  const agentName = args[0];
  if (!agentName) {
    process.stdout.write(`${RED}Usage: dantecode agent create <name>${RESET}\n`);
    return;
  }

  const agentsDir = join(projectRoot, AGENTS_DIR);
  await mkdir(agentsDir, { recursive: true });

  const sanitizedName = agentName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  const filePath = join(agentsDir, `${sanitizedName}.md`);

  // Check if file already exists
  try {
    await stat(filePath);
    process.stdout.write(`${YELLOW}Agent definition already exists: ${filePath}${RESET}\n`);
    return;
  } catch {
    // File doesn't exist, proceed with creation
  }

  const template = AGENT_TEMPLATE(agentName);
  await writeFile(filePath, template, "utf-8");

  process.stdout.write(
    `\n${GREEN}Created agent definition:${RESET} ${BOLD}${agentName}${RESET}\n` +
      `  ${DIM}File: ${filePath}${RESET}\n` +
      `\n${DIM}Edit the file to customize the agent's behavior, then run it with:${RESET}\n` +
      `  ${CYAN}dantecode agent run ${sanitizedName}${RESET}\n\n`,
  );
}
