import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Count sessions with meaningful interaction (>= 2 messages = at least one exchange).
 * Returns 0 if sessions directory doesn't exist.
 */
export async function countSuccessfulSessions(projectRoot: string): Promise<number> {
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
      } catch { /* skip corrupt files */ }
    }
    return count;
  } catch {
    return 0;
  }
}
