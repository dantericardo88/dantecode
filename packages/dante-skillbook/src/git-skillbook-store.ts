/**
 * git-skillbook-store.ts
 *
 * Git-backed persistence layer for the DanteSkillbook.
 * Canonical path: .dantecode/skillbook/skillbook.json
 * All writes are staged for Git tracking.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import type { SkillbookData } from "./skillbook.js";

const DEFAULT_SKILLBOOK_PATH = ".dantecode/skillbook/skillbook.json";

export interface StoreOptions {
  /** Path to skillbook.json, relative to cwd. Default: .dantecode/skillbook/skillbook.json */
  skillbookPath?: string;
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** If true, attempt to git-stage the file after writing. Default: true */
  gitStage?: boolean;
}

export class GitSkillbookStore {
  private skillbookPath: string;
  private cwd: string;
  private gitStage: boolean;

  constructor(options: StoreOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.skillbookPath = options.skillbookPath ?? DEFAULT_SKILLBOOK_PATH;
    this.gitStage = options.gitStage ?? true;
  }

  /** Absolute path to the skillbook file. */
  get fullPath(): string {
    return join(this.cwd, this.skillbookPath);
  }

  /** Load skillbook data from disk. Returns null if file does not exist. */
  load(): SkillbookData | null {
    if (!existsSync(this.fullPath)) return null;
    try {
      const raw = readFileSync(this.fullPath, "utf-8");
      return JSON.parse(raw) as SkillbookData;
    } catch {
      return null;
    }
  }

  /** Save skillbook data to disk and optionally git-stage it. */
  save(data: SkillbookData): void {
    const dir = dirname(this.fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.fullPath, JSON.stringify(data, null, 2), "utf-8");
    if (this.gitStage) {
      this.tryGitAdd();
    }
  }

  /** Attempt to `git add` the skillbook file. Silently ignores errors (not in git repo, etc.). */
  private tryGitAdd(): void {
    try {
      execFileSync("git", ["add", this.skillbookPath], { cwd: this.cwd, stdio: "ignore" });
    } catch {
      // Not a git repo, or git not available — non-fatal
    }
  }

  /** Check if a skillbook file exists. */
  exists(): boolean {
    return existsSync(this.fullPath);
  }
}
