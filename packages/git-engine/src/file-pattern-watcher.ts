import { watch, type FSWatcher } from "node:fs";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";

export interface FilePatternWatcherOptions {
  pattern: string;
  debounceMs?: number;
  projectRoot: string;
  watcherId?: string;
  ignorePatterns?: string[];
}

export interface FileChangeEvent {
  watcherId: string;
  pattern: string;
  changedFile: string;
  changeType: "create" | "modify" | "delete";
  timestamp: string;
}

const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
];

// Self-contained glob matcher (NO external deps)
// Supports: *, **, ?, character classes [abc]
export function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize to forward slashes
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedPath = filePath.replace(/\\/g, "/");

  const regexStr = globToRegex(normalizedPattern);
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedPath);
}

function globToRegex(pattern: string): string {
  let result = "";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** — matches any path including slashes
        // Handle /**/ and **/ and /**
        i += 2;
        if (pattern[i] === "/") {
          // **/ matches zero or more path segments
          result += "(?:.+/)?";
          i += 1;
        } else {
          result += ".*";
        }
      } else {
        // * — matches any chars except /
        result += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      // ? — matches any single char except /
      result += "[^/]";
      i += 1;
    } else if (ch === "[") {
      // character class [abc] or [a-z]
      const closeIdx = pattern.indexOf("]", i + 1);
      if (closeIdx === -1) {
        // No closing bracket — treat as literal
        result += "\\[";
        i += 1;
      } else {
        const cls = pattern.slice(i + 1, closeIdx);
        result += `[${escapeCharClass(cls)}]`;
        i = closeIdx + 1;
      }
    } else if (ch === ".") {
      result += "\\.";
      i += 1;
    } else if (ch === "\\") {
      // Escape next character
      if (i + 1 < pattern.length) {
        result += escapeRegex(pattern[i + 1]!);
        i += 2;
      } else {
        result += "\\\\";
        i += 1;
      }
    } else {
      result += escapeRegex(ch!);
      i += 1;
    }
  }

  return result;
}

function escapeRegex(ch: string): string {
  return ch.replace(/[$()+^{|}]/g, "\\$&");
}

function escapeCharClass(cls: string): string {
  // Escape ] and \ inside character classes but leave ranges like a-z intact
  return cls.replace(/\\/g, "\\\\");
}

export class FilePatternWatcher extends EventEmitter {
  private readonly watcherId: string;
  private readonly pattern: string;
  private readonly debounceMs: number;
  private readonly projectRoot: string;
  private readonly ignorePatterns: string[];
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: Map<string, "create" | "modify" | "delete"> = new Map();
  private changeCount = 0;
  private startedAt: string | null = null;

  constructor(options: FilePatternWatcherOptions) {
    super();
    this.watcherId = options.watcherId ?? `watcher-${Date.now()}`;
    this.pattern = options.pattern;
    this.debounceMs = options.debounceMs ?? 200;
    this.projectRoot = resolve(options.projectRoot);
    this.ignorePatterns = options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
  }

  start(): void {
    if (this.watcher) {
      return;
    }
    this.startedAt = new Date().toISOString();

    this.watcher = watch(this.projectRoot, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Normalize path to forward slashes
      const normalizedFilename = filename.replace(/\\/g, "/");

      // Build the full relative path for matching
      const fullRelative = normalizedFilename;

      // Check ignore patterns
      if (this.shouldIgnore(fullRelative)) {
        return;
      }

      // Check if matches the user pattern
      if (!matchGlob(this.pattern, fullRelative)) {
        return;
      }

      // Determine change type
      const changeType: "create" | "modify" | "delete" =
        eventType === "rename" ? "create" : "modify";

      this.pendingChanges.set(fullRelative, changeType);

      // Debounce the emission
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.flushPendingChanges();
      }, this.debounceMs);
    });
  }

  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    // Flush any remaining pending changes
    if (this.pendingChanges.size > 0) {
      this.flushPendingChanges();
    }
  }

  snapshot(): {
    watcherId: string;
    pattern: string;
    projectRoot: string;
    changeCount: number;
    active: boolean;
    startedAt: string | null;
  } {
    return {
      watcherId: this.watcherId,
      pattern: this.pattern,
      projectRoot: this.projectRoot,
      changeCount: this.changeCount,
      active: this.watcher !== null,
      startedAt: this.startedAt,
    };
  }

  private shouldIgnore(filePath: string): boolean {
    for (const ignorePattern of this.ignorePatterns) {
      if (matchGlob(ignorePattern, filePath)) {
        return true;
      }
    }
    return false;
  }

  private flushPendingChanges(): void {
    if (this.pendingChanges.size === 0) return;

    const events: FileChangeEvent[] = [];
    const timestamp = new Date().toISOString();

    for (const [changedFile, changeType] of this.pendingChanges) {
      events.push({
        watcherId: this.watcherId,
        pattern: this.pattern,
        changedFile,
        changeType,
        timestamp,
      });
    }

    this.changeCount += events.length;
    this.pendingChanges.clear();
    this.debounceTimer = null;

    this.emit("change", events);
  }
}
