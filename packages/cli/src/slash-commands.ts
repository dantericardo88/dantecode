// ============================================================================
// @dantecode/cli — Slash Command Router for the REPL
// Each slash command is a function that operates on the REPL state.
// ============================================================================

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  readAuditEvents,
} from "@dantecode/core";
import {
  runLocalPDSEScorer,
  runGStack,
  allGStackPassed,
  summarizeGStackResults,
  queryLessons,
  formatLessonsForPrompt,
} from "@dantecode/danteforge";
import {
  listSkills,
  getSkill,
} from "@dantecode/skill-adapter";
import {
  getStatus,
  getDiff,
  autoCommit,
  revertLastCommit,
  createWorktree,
} from "@dantecode/git-engine";
import type {
  Session,
  DanteCodeState,
  ModelConfig,
} from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The mutable state shared between all slash commands and the REPL. */
export interface ReplState {
  session: Session;
  state: DanteCodeState;
  projectRoot: string;
  verbose: boolean;
  enableGit: boolean;
  enableSandbox: boolean;
  lastEditFile: string | null;
  lastEditContent: string | null;
}

/** A single slash command handler. */
interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  handler: (args: string, state: ReplState) => Promise<string>;
}

// ----------------------------------------------------------------------------
// Command Implementations
// ----------------------------------------------------------------------------

async function helpCommand(_args: string, _state: ReplState): Promise<string> {
  const lines = [
    "",
    `${BOLD}Available Slash Commands${RESET}`,
    "",
  ];

  for (const cmd of SLASH_COMMANDS) {
    lines.push(`  ${YELLOW}${cmd.usage.padEnd(28)}${RESET} ${DIM}${cmd.description}${RESET}`);
  }

  lines.push("");
  lines.push(`${DIM}Type a command with / prefix, or type naturally to chat with the agent.${RESET}`);
  lines.push("");

  return lines.join("\n");
}

async function modelCommand(args: string, state: ReplState): Promise<string> {
  const modelId = args.trim();
  if (!modelId) {
    const current = state.state.model.default;
    return `${DIM}Current model:${RESET} ${BOLD}${current.provider}/${current.modelId}${RESET}\n\n${DIM}Usage: /model <provider/modelId> (e.g. /model grok/grok-3)${RESET}`;
  }

  // Parse provider/modelId format
  const parts = modelId.split("/");
  let provider: string;
  let model: string;

  if (parts.length >= 2) {
    provider = parts[0]!;
    model = parts.slice(1).join("/");
  } else {
    // Infer provider from model name
    if (modelId.startsWith("grok")) {
      provider = "grok";
    } else if (modelId.startsWith("claude")) {
      provider = "anthropic";
    } else if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")) {
      provider = "openai";
    } else if (modelId.startsWith("gemini")) {
      provider = "google";
    } else {
      provider = "grok";
    }
    model = modelId;
  }

  const newModelConfig: ModelConfig = {
    ...state.state.model.default,
    provider: provider as ModelConfig["provider"],
    modelId: model,
  };

  state.state.model.default = newModelConfig;
  state.session.model = newModelConfig;

  return `${GREEN}Model switched to${RESET} ${BOLD}${provider}/${model}${RESET}`;
}

async function addCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /add <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const lineCount = content.split("\n").length;

    if (!state.session.activeFiles.includes(resolved)) {
      state.session.activeFiles.push(resolved);
    }

    // Add as a system message so the agent has the context
    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: `File added to context: ${resolved}\n\n\`\`\`\n${content}\n\`\`\``,
      timestamp: new Date().toISOString(),
    });

    return `${GREEN}Added${RESET} ${resolved} ${DIM}(${lineCount} lines)${RESET}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error reading file: ${message}${RESET}`;
  }
}

async function dropCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /drop <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);
  const index = state.session.activeFiles.indexOf(resolved);

  if (index === -1) {
    // Try matching by relative path
    const relativeMatch = state.session.activeFiles.findIndex(
      (f) => relative(state.projectRoot, f) === filePath || f.endsWith(filePath),
    );
    if (relativeMatch === -1) {
      return `${YELLOW}File not in context: ${filePath}${RESET}`;
    }
    const removed = state.session.activeFiles.splice(relativeMatch, 1)[0];
    return `${GREEN}Removed${RESET} ${removed} from context`;
  }

  state.session.activeFiles.splice(index, 1);
  return `${GREEN}Removed${RESET} ${resolved} from context`;
}

async function filesCommand(_args: string, state: ReplState): Promise<string> {
  if (state.session.activeFiles.length === 0) {
    return `${DIM}No files in context. Use /add <file> to add files.${RESET}`;
  }

  const lines = [`${BOLD}Files in context:${RESET}`, ""];
  for (const file of state.session.activeFiles) {
    const rel = relative(state.projectRoot, file);
    lines.push(`  ${DIM}-${RESET} ${rel}`);
  }
  lines.push("");
  lines.push(`${DIM}${state.session.activeFiles.length} file(s) total${RESET}`);
  return lines.join("\n");
}

async function diffCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const diff = getDiff(state.projectRoot);
    if (!diff || diff.trim().length === 0) {
      return `${DIM}No unstaged changes.${RESET}`;
    }
    return `${BOLD}Unstaged changes:${RESET}\n\n${diff}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error getting diff: ${message}${RESET}`;
  }
}

async function commitCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const status = getStatus(state.projectRoot);
    const filesToCommit = [
      ...status.staged.map((s: { path: string }) => s.path),
      ...status.unstaged.map((s: { path: string }) => s.path),
      ...status.untracked.map((s: { path: string }) => s.path),
    ];

    if (filesToCommit.length === 0) {
      return `${DIM}Nothing to commit. Working tree is clean.${RESET}`;
    }

    const commitResult = autoCommit(
      {
        message: `${state.state.git.commitPrefix} update ${filesToCommit.length} file(s)`,
        footer: "Generated with DanteCode (https://dantecode.dev)\n\nCo-Authored-By: DanteCode <noreply@dantecode.dev>",
        files: filesToCommit,
        allowEmpty: false,
      },
      state.projectRoot,
    );

    return `${GREEN}Committed${RESET} ${commitResult.commitHash.slice(0, 8)}: ${commitResult.message.split("\n")[0]}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Commit error: ${message}${RESET}`;
  }
}

async function revertCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const result = revertLastCommit(state.projectRoot);
    return `${GREEN}Reverted last commit.${RESET} New HEAD: ${result.slice(0, 8)}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Revert error: ${message}${RESET}`;
  }
}

async function undoCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.lastEditFile || !state.lastEditContent) {
    return `${DIM}Nothing to undo. No previous edit recorded.${RESET}`;
  }

  try {
    await writeFile(state.lastEditFile, state.lastEditContent, "utf-8");
    const filePath = state.lastEditFile;
    state.lastEditFile = null;
    state.lastEditContent = null;
    return `${GREEN}Undone${RESET} last edit to ${filePath}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Undo error: ${message}${RESET}`;
  }
}

async function lessonsCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const lessons = await queryLessons({
      projectRoot: state.projectRoot,
      limit: 20,
    });

    if (lessons.length === 0) {
      return `${DIM}No lessons recorded for this project yet.${RESET}`;
    }

    const formatted = formatLessonsForPrompt(lessons);
    return formatted;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error loading lessons: ${message}${RESET}`;
  }
}

async function pdseCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /pdse <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const score = runLocalPDSEScorer(content, state.projectRoot);

    const lines = [
      `${BOLD}PDSE Score for ${relative(state.projectRoot, resolved)}${RESET}`,
      "",
      `  Overall:       ${score.passedGate ? GREEN : RED}${score.overall}/100${RESET} ${score.passedGate ? "(PASSED)" : "(FAILED)"}`,
      `  Completeness:  ${score.completeness}/100`,
      `  Correctness:   ${score.correctness}/100`,
      `  Clarity:       ${score.clarity}/100`,
      `  Consistency:   ${score.consistency}/100`,
    ];

    if (score.violations.length > 0) {
      lines.push("");
      lines.push(`  ${BOLD}Violations (${score.violations.length}):${RESET}`);
      for (const v of score.violations.slice(0, 10)) {
        const lineRef = v.line ? `line ${v.line}` : "?";
        const severity = v.severity === "hard" ? RED : YELLOW;
        lines.push(`    ${severity}[${v.severity}]${RESET} ${DIM}${lineRef}:${RESET} ${v.message}`);
      }
      if (score.violations.length > 10) {
        lines.push(`    ${DIM}... and ${score.violations.length - 10} more${RESET}`);
      }
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error scoring file: ${message}${RESET}`;
  }
}

async function qaCommand(_args: string, state: ReplState): Promise<string> {
  const gstackCommands = state.state.autoforge.gstackCommands;

  if (gstackCommands.length === 0) {
    return `${DIM}No GStack commands configured. Configure them in STATE.yaml.${RESET}`;
  }

  process.stdout.write(`${DIM}Running GStack QA pipeline (${gstackCommands.length} commands)...${RESET}\n`);

  try {
    const results = await runGStack("", gstackCommands, state.projectRoot);
    const allPassed = allGStackPassed(results);
    const summary = summarizeGStackResults(results);

    const header = allPassed
      ? `${GREEN}${BOLD}GStack QA: ALL PASSED${RESET}`
      : `${RED}${BOLD}GStack QA: SOME FAILED${RESET}`;

    return `${header}\n\n${summary}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}GStack error: ${message}${RESET}`;
  }
}

async function auditCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const events = await readAuditEvents(state.projectRoot, {
      limit: 20,
    });

    if (events.length === 0) {
      return `${DIM}No audit events recorded yet.${RESET}`;
    }

    const lines = [`${BOLD}Recent Audit Events (${events.length}):${RESET}`, ""];
    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      lines.push(`  ${DIM}${time}${RESET} ${YELLOW}[${event.type}]${RESET} ${event.modelId}`);
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Audit error: ${message}${RESET}`;
  }
}

async function clearCommand(_args: string, state: ReplState): Promise<string> {
  const count = state.session.messages.length;
  state.session.messages = [];
  state.session.activeFiles = [];
  return `${GREEN}Cleared${RESET} ${count} messages and all context files.`;
}

async function tokensCommand(_args: string, state: ReplState): Promise<string> {
  let totalTokens = 0;
  let messageCount = 0;

  for (const msg of state.session.messages) {
    messageCount++;
    if (msg.tokensUsed) {
      totalTokens += msg.tokensUsed;
    } else if (typeof msg.content === "string") {
      // Rough estimate: 1 token per 4 characters
      totalTokens += Math.ceil(msg.content.length / 4);
    }
  }

  const lines = [
    `${BOLD}Token Usage${RESET}`,
    "",
    `  Messages:       ${messageCount}`,
    `  Est. tokens:    ${totalTokens.toLocaleString()}`,
    `  Context window: ${state.state.model.default.contextWindow.toLocaleString()}`,
    `  Utilization:    ${((totalTokens / state.state.model.default.contextWindow) * 100).toFixed(1)}%`,
  ];

  return lines.join("\n");
}

async function webCommand(args: string, _state: ReplState): Promise<string> {
  const url = args.trim();
  if (!url) {
    return `${RED}Usage: /web <url>${RESET}`;
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return `${RED}Invalid URL: ${url}${RESET}`;
  }

  try {
    // Use a simple fetch to get the URL content
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DanteCode/1.0.0",
        "Accept": "text/html,text/plain,application/json",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return `${RED}HTTP ${response.status}: ${response.statusText}${RESET}`;
    }

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    // Truncate to a reasonable size for context
    const maxChars = 50000;
    const truncated = text.length > maxChars
      ? text.slice(0, maxChars) + `\n\n... (truncated, ${text.length} chars total)`
      : text;

    return `${GREEN}Fetched${RESET} ${url} ${DIM}(${text.length} chars, ${contentType})${RESET}\n\n${truncated}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Fetch error: ${message}${RESET}`;
  }
}

async function skillCommand(args: string, state: ReplState): Promise<string> {
  const skillName = args.trim();
  if (!skillName) {
    // List skills
    const skills = await listSkills(state.projectRoot);
    if (skills.length === 0) {
      return `${DIM}No skills imported. Use 'dantecode skills import' to import skills.${RESET}`;
    }

    const lines = [`${BOLD}Available Skills:${RESET}`, ""];
    for (const skill of skills) {
      lines.push(`  ${YELLOW}${skill.name.padEnd(24)}${RESET} ${DIM}${skill.description}${RESET}`);
    }
    return lines.join("\n");
  }

  // Activate a specific skill
  const skill = await getSkill(skillName, state.projectRoot);
  if (!skill) {
    return `${RED}Skill not found: ${skillName}${RESET}`;
  }

  // Inject the skill instructions into the session as a system message
  state.session.messages.push({
    id: randomUUID(),
    role: "system",
    content: `Activated skill "${skill.frontmatter.name}": ${skill.frontmatter.description}\n\n${skill.instructions}`,
    timestamp: new Date().toISOString(),
  });

  return `${GREEN}Activated skill:${RESET} ${BOLD}${skill.frontmatter.name}${RESET}\n${DIM}${skill.frontmatter.description}${RESET}`;
}

async function agentsCommand(_args: string, state: ReplState): Promise<string> {
  const agentsDir = join(state.projectRoot, ".dantecode", "agents");

  try {
    const entries = await readdir(agentsDir);
    const agentFiles = entries.filter(
      (e) => e.endsWith(".yaml") || e.endsWith(".yml") || e.endsWith(".md"),
    );

    if (agentFiles.length === 0) {
      return `${DIM}No agent definitions found in ${agentsDir}${RESET}`;
    }

    const lines = [`${BOLD}Available Agents:${RESET}`, ""];
    for (const file of agentFiles) {
      const name = file.replace(/\.(yaml|yml|md)$/, "");
      lines.push(`  ${YELLOW}${name}${RESET}`);
    }
    return lines.join("\n");
  } catch {
    return `${DIM}No agent definitions directory found. Run 'dantecode init' to create one.${RESET}`;
  }
}

async function worktreeCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const branchName = `dantecode/${state.session.id.slice(0, 8)}`;
    let baseBranch: string;

    try {
      baseBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: state.projectRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      baseBranch = "main";
    }

    const result = createWorktree({
      branch: branchName,
      baseBranch,
      sessionId: state.session.id,
      directory: state.projectRoot,
    });

    state.session.worktreeRef = result.branch;

    return `${GREEN}Created worktree${RESET}\n  Branch: ${BOLD}${result.branch}${RESET}\n  Directory: ${result.directory}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Worktree error: ${message}${RESET}`;
  }
}

async function sandboxCommand(_args: string, state: ReplState): Promise<string> {
  state.enableSandbox = !state.enableSandbox;
  const statusText = state.enableSandbox ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  return `${BOLD}Sandbox mode:${RESET} ${statusText}`;
}

// ----------------------------------------------------------------------------
// Slash Command Registry
// ----------------------------------------------------------------------------

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show all slash commands", usage: "/help", handler: helpCommand },
  { name: "model", description: "Switch model mid-session", usage: "/model <id>", handler: modelCommand },
  { name: "add", description: "Add file to conversation context", usage: "/add <file>", handler: addCommand },
  { name: "drop", description: "Remove file from context", usage: "/drop <file>", handler: dropCommand },
  { name: "files", description: "List files currently in context", usage: "/files", handler: filesCommand },
  { name: "diff", description: "Show pending changes (unstaged diff)", usage: "/diff", handler: diffCommand },
  { name: "commit", description: "Trigger auto-commit", usage: "/commit", handler: commitCommand },
  { name: "revert", description: "Revert last commit", usage: "/revert", handler: revertCommand },
  { name: "undo", description: "Undo last file edit", usage: "/undo", handler: undoCommand },
  { name: "lessons", description: "Show project lessons", usage: "/lessons", handler: lessonsCommand },
  { name: "pdse", description: "Run PDSE scorer on a file", usage: "/pdse <file>", handler: pdseCommand },
  { name: "qa", description: "Run GStack QA pipeline", usage: "/qa", handler: qaCommand },
  { name: "audit", description: "Show recent audit log entries", usage: "/audit", handler: auditCommand },
  { name: "clear", description: "Clear conversation history", usage: "/clear", handler: clearCommand },
  { name: "tokens", description: "Show token usage", usage: "/tokens", handler: tokensCommand },
  { name: "web", description: "Fetch URL content into context", usage: "/web <url>", handler: webCommand },
  { name: "skill", description: "List or activate a skill", usage: "/skill [name]", handler: skillCommand },
  { name: "agents", description: "List available agents", usage: "/agents", handler: agentsCommand },
  { name: "worktree", description: "Create git worktree for isolation", usage: "/worktree", handler: worktreeCommand },
  { name: "sandbox", description: "Toggle sandbox mode on/off", usage: "/sandbox", handler: sandboxCommand },
];

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Routes a slash command string to its handler and executes it.
 *
 * @param input - The full slash command string including the leading `/`.
 * @param state - The current REPL state.
 * @returns The output string from the command handler, or an error message.
 */
export async function routeSlashCommand(
  input: string,
  state: ReplState,
): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return `${RED}Not a slash command: ${trimmed}${RESET}`;
  }

  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");
  const commandName = spaceIndex === -1
    ? withoutSlash.toLowerCase()
    : withoutSlash.slice(0, spaceIndex).toLowerCase();
  const args = spaceIndex === -1
    ? ""
    : withoutSlash.slice(spaceIndex + 1);

  const command = SLASH_COMMANDS.find((c) => c.name === commandName);
  if (!command) {
    return `${RED}Unknown command: /${commandName}${RESET}\n${DIM}Type /help to see available commands.${RESET}`;
  }

  return command.handler(args, state);
}

/**
 * Returns true if the input string looks like a slash command.
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/");
}
