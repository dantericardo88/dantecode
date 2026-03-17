// ============================================================================
// @dantecode/core — Session Store
// File-based chat session persistence in .dantecode/sessions/.
// Replaces VS Code globalState for portable, cross-tool session storage.
// ============================================================================

import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ChatSessionFile } from "@dantecode/config-types";

/**
 * File-based session store that persists chat sessions to disk.
 * Sessions are stored as JSON files in .dantecode/sessions/.
 */
export class SessionStore {
  private readonly sessionsDir: string;

  constructor(projectRoot: string) {
    this.sessionsDir = join(projectRoot, ".dantecode", "sessions");
  }

  /** Ensure the sessions directory exists. */
  private async ensureDir(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  /** Save a chat session to disk. */
  async save(session: ChatSessionFile): Promise<void> {
    await this.ensureDir();
    const filePath = join(this.sessionsDir, `${session.id}.json`);
    await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  /** Load a chat session by ID. Returns null if not found. */
  async load(id: string): Promise<ChatSessionFile | null> {
    const filePath = join(this.sessionsDir, `${id}.json`);
    try {
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as ChatSessionFile;
    } catch {
      return null;
    }
  }

  /**
   * List all saved sessions, sorted by updatedAt descending.
   * Returns lightweight summaries without full message content.
   */
  async list(): Promise<
    Array<{ id: string; title: string; createdAt: string; updatedAt: string; messageCount: number }>
  > {
    try {
      const files = await readdir(this.sessionsDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      const entries = await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const raw = await readFile(join(this.sessionsDir, file), "utf-8");
            const session = JSON.parse(raw) as ChatSessionFile;
            return {
              id: session.id,
              title: session.title,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              messageCount: session.messages.length,
            };
          } catch {
            return null;
          }
        }),
      );

      return entries
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch {
      return [];
    }
  }

  /** Delete a chat session by ID. */
  async delete(id: string): Promise<boolean> {
    const filePath = join(this.sessionsDir, `${id}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Check if a session exists. */
  async exists(id: string): Promise<boolean> {
    const filePath = join(this.sessionsDir, `${id}.json`);
    try {
      await readFile(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Get the path to the sessions directory. */
  getSessionsDir(): string {
    return this.sessionsDir;
  }
}
