/**
 * session-store.ts
 *
 * GaslightSession persistence.
 * Sessions are stored under .dantecode/gaslight/sessions/{sessionId}.json
 *
 * Sessions are NOT git-tracked (they are ephemeral audit data).
 * Use GitSkillbookStore for persistent skillbook state.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { GaslightSession } from "./types.js";

export interface SessionStoreOptions {
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** Sessions directory relative to cwd. Default: ".dantecode/gaslight/sessions" */
  gaslightDir?: string;
}

const DEFAULT_GASLIGHT_DIR = ".dantecode/gaslight/sessions";

export class GaslightSessionStore {
  private cwd: string;
  private gaslightDir: string;

  constructor(opts: SessionStoreOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.gaslightDir = opts.gaslightDir ?? DEFAULT_GASLIGHT_DIR;
  }

  /** Absolute path to the sessions directory. */
  get sessionsDir(): string {
    return join(this.cwd, this.gaslightDir);
  }

  /** Absolute path to a specific session file. */
  sessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  /** Save a session to disk. Creates the directory if absent. */
  save(session: GaslightSession): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
    writeFileSync(this.sessionPath(session.sessionId), JSON.stringify(session, null, 2), "utf-8");
  }

  /** Load a session by ID. Returns null if not found or corrupt. */
  load(sessionId: string): GaslightSession | null {
    const path = this.sessionPath(sessionId);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as GaslightSession;
    } catch {
      return null;
    }
  }

  /** Check whether a session exists on disk. */
  has(sessionId: string): boolean {
    return existsSync(this.sessionPath(sessionId));
  }

  /**
   * List all sessions, newest-first by file mtime.
   * Skips corrupt files silently.
   */
  list(): GaslightSession[] {
    if (!existsSync(this.sessionsDir)) return [];

    const files = readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const fullPath = join(this.sessionsDir, f);
        return { name: f, mtime: statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const sessions: GaslightSession[] = [];
    for (const { name } of files) {
      try {
        const raw = readFileSync(join(this.sessionsDir, name), "utf-8");
        sessions.push(JSON.parse(raw) as GaslightSession);
      } catch {
        // corrupt file — skip
      }
    }
    return sessions;
  }

  /**
   * Mark a session as distilled by setting `distilledAt` timestamp.
   * No-op if the session is not found on disk.
   */
  markDistilled(sessionId: string): void {
    const session = this.load(sessionId);
    if (!session) return;
    const updated = { ...session, distilledAt: new Date().toISOString() };
    writeFileSync(this.sessionPath(sessionId), JSON.stringify(updated, null, 2), "utf-8");
  }

  /**
   * Delete oldest sessions, keeping at most `maxSessions`.
   * Returns the number of sessions deleted.
   */
  cleanup(maxSessions: number): number {
    if (!existsSync(this.sessionsDir)) return 0;

    const files = readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const fullPath = join(this.sessionsDir, f);
        return { name: f, mtime: statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    const toDelete = files.slice(maxSessions);
    for (const { name } of toDelete) {
      try {
        unlinkSync(join(this.sessionsDir, name));
      } catch {
        // ignore deletion errors
      }
    }
    return toDelete.length;
  }
}
