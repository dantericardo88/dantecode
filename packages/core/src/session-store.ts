// ============================================================================
// @dantecode/core — Session Store
// File-based chat session persistence in .dantecode/sessions/.
// Replaces VS Code globalState for portable, cross-tool session storage.
// ============================================================================

import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ChatSessionFile, Session } from "@dantecode/config-types";

/** A lightweight session summary entry returned by getRecentSummaries(). */
export interface SessionSummaryEntry {
  id: string;
  date: string;
  summary: string;
}

/** A session list entry with optional summary. */
export interface SessionListEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary?: string;
}

/**
 * File-based session store that persists chat sessions to disk.
 * Sessions are stored as JSON files in .dantecode/sessions/.
 */
export class SessionStore {
  private readonly sessionsDir: string;
  private readonly runtimeSessionsDir: string;

  constructor(projectRoot: string) {
    this.sessionsDir = join(projectRoot, ".dantecode", "sessions");
    this.runtimeSessionsDir = join(this.sessionsDir, "runtime");
  }

  /** Ensure the sessions directory exists. */
  private async ensureDir(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  /** Ensure the runtime session directory exists. */
  private async ensureRuntimeDir(): Promise<void> {
    await mkdir(this.runtimeSessionsDir, { recursive: true });
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

  /** Save a full runtime session snapshot for durable resume. */
  async saveRuntimeSession(id: string, session: Session): Promise<void> {
    await this.ensureRuntimeDir();
    const filePath = join(this.runtimeSessionsDir, `${id}.json`);
    await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  /** Load a full runtime session snapshot by durable run ID. */
  async loadRuntimeSession(id: string): Promise<Session | null> {
    const filePath = join(this.runtimeSessionsDir, `${id}.json`);
    try {
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  }

  /**
   * List all saved sessions, sorted by updatedAt descending.
   * Returns lightweight summaries without full message content.
   */
  async list(): Promise<SessionListEntry[]> {
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
              summary: session.summary,
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

  /** Delete all saved sessions. Returns the count of deleted sessions. */
  async deleteAll(): Promise<number> {
    try {
      const files = await readdir(this.sessionsDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      let count = 0;
      for (const file of jsonFiles) {
        try {
          await unlink(join(this.sessionsDir, file));
          count++;
        } catch {
          // Skip files that fail to delete
        }
      }
      return count;
    } catch {
      return 0;
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

  /**
   * Generate a 2-3 sentence summary of a session.
   * Extracts: what was the task, what files were changed, was it successful.
   * Stores the summary in session metadata for quick listing.
   */
  async summarize(session: ChatSessionFile): Promise<string> {
    // Extract the first user message as the task description
    const firstUserMsg = session.messages.find((m) => m.role === "user");
    const task = firstUserMsg
      ? firstUserMsg.content.slice(0, 120) + (firstUserMsg.content.length > 120 ? "..." : "")
      : "Unknown task";

    // Extract files touched from context files and tool messages
    const filesFromContext = session.contextFiles ?? [];
    const filesFromMessages = session.messages
      .filter((m) => m.role === "assistant" || m.role === "tool")
      .flatMap((m) => {
        const fileRefs: string[] = [];
        // Match file paths mentioned in tool results (e.g., Write/Edit tool calls)
        const pathMatches = m.content.match(/(?:file_path|path)["\s:]+["']?([^\s"',}]+)/g);
        if (pathMatches) {
          for (const match of pathMatches) {
            const cleaned = match.replace(/.*["':]\s*["']?/, "").replace(/["'}].*/, "");
            if (cleaned.length > 0 && cleaned.includes("/")) {
              fileRefs.push(cleaned);
            }
          }
        }
        return fileRefs;
      });

    const allFiles = [...new Set([...filesFromContext, ...filesFromMessages])];
    const filesSummary =
      allFiles.length > 0
        ? `Files touched: ${allFiles.slice(0, 5).join(", ")}${allFiles.length > 5 ? ` (+${allFiles.length - 5} more)` : ""}.`
        : "No files were directly modified.";

    // Determine success from the last assistant message
    const lastAssistant = [...session.messages].reverse().find((m) => m.role === "assistant");
    const hasError = session.messages.some(
      (m) =>
        m.content.toLowerCase().includes("error") ||
        m.content.toLowerCase().includes("failed") ||
        m.content.toLowerCase().includes("blocked"),
    );
    const outcome =
      lastAssistant && !hasError
        ? "Session completed successfully."
        : hasError
          ? "Session encountered errors during execution."
          : "Session outcome unclear.";

    const summary = `Task: ${task}. ${filesSummary} ${outcome}`;

    // Persist the summary into the session file
    session.summary = summary;
    await this.save(session);

    return summary;
  }

  /**
   * Get summaries for the most recent N sessions.
   * Generates summaries on-the-fly for sessions that don't have one cached.
   */
  async getRecentSummaries(limit = 3): Promise<SessionSummaryEntry[]> {
    const entries = await this.list();
    const recent = entries.slice(0, limit);
    const results: SessionSummaryEntry[] = [];

    for (const entry of recent) {
      const session = await this.load(entry.id);
      if (!session) continue;

      let summary = session.summary;
      if (!summary) {
        summary = await this.summarize(session);
      }

      results.push({
        id: entry.id,
        date: entry.updatedAt,
        summary,
      });
    }

    return results;
  }
}
