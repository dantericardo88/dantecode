import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSessionDurableRunSnapshot } from "./operator-status.js";

/**
 * Count sessions with durable truths (completed durable runs or meaningful interaction).
 * Considers sessions successful if they have a completed durable run.
 * Returns { count: 0, unlocked: false } if sessions directory doesn't exist.
 */
export async function countSuccessfulSessions(
  projectRoot: string,
): Promise<{ count: number; unlocked: boolean }> {
  try {
    const sessionsDir = join(projectRoot, ".dantecode", "sessions");
    const files = await readdir(sessionsDir);
    let count = 0;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const sessionId = f.replace(".json", "");
        const content = await readFile(join(sessionsDir, f), "utf-8");
        const session = JSON.parse(content);

        // First check durable truths (durable runs indicate meaningful work)
        const durableRun = await readSessionDurableRunSnapshot(projectRoot, sessionId);
        if (durableRun) {
          count++;
          continue;
        }

        // Fall back to message count for legacy sessions without durable runs
        if (Array.isArray(session.messages) && session.messages.length >= 2) {
          count++;
        }
      } catch {
        /* skip corrupt files */
      }
    }
    return { count, unlocked: count >= 3 };
  } catch {
    return { count: 0, unlocked: false };
  }
}
