import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Count sessions with meaningful interaction (>= 2 messages = at least one exchange).
 * Returns an object with the count and unlocked status (count >= 3).
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
        const content = await readFile(join(sessionsDir, f), "utf-8");
        const session = JSON.parse(content);
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
