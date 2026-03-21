/**
 * research.ts
 *
 * CLI command: dantecode research [--depth=quick|standard|deep] <topic>
 * Also used as the slash command handler for /research.
 */
import { executeResearch, type ResearchOptions } from "../lib/research-engine.js";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export async function runResearchCommand(subArgs: string[], projectRoot: string): Promise<void> {
  // Strip flags from topic so `--depth=deep` doesn't end up in the search query
  const topicArgs = subArgs.filter(a => !a.startsWith("--"));
  const topic = topicArgs.join(" ").trim();

  if (!topic) {
    console.log(`${BOLD}Usage:${RESET} dantecode research [--depth=quick|standard|deep] <topic>`);
    console.log(`${DIM}Example: dantecode research "TypeScript monorepo best practices" --depth=deep${RESET}`);
    return;
  }

  const depthFlag = subArgs.find((a) => a.startsWith("--depth="));
  const depth = (depthFlag?.split("=")[1] as ResearchOptions["depth"]) ?? "standard";

  console.log(`${BOLD}Researching:${RESET} ${topic} ${DIM}[${depth}]${RESET}\n`);

  try {
    const output = await executeResearch(topic, projectRoot, { depth });
    console.log(output);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Research failed: ${msg}`);
    process.exit(1);
  }
}

/** Handler for the /research slash command inside the REPL. */
export async function researchSlashHandler(args: string, state: { projectRoot: string }): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const depthFlag = parts.find(p => p.startsWith("--depth="));
  const depth = (depthFlag?.split("=")[1] as ResearchOptions["depth"]) ?? "standard";
  const topic = parts.filter(p => !p.startsWith("--")).join(" ");

  if (!topic) {
    return "Usage: /research [--depth=quick|standard|deep] <topic or question>";
  }

  try {
    return await executeResearch(topic, state.projectRoot, { depth });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Research error: ${msg}`;
  }
}
