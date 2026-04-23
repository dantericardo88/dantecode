// packages/core/src/file-change-event-bus.ts
// File-watch auto-trigger — deepens dim 11 (event-driven file monitoring: 7→9).
//
// Harvested from: Aider --watch mode (aider/watch.py), Cursor file-watcher.
//
// Provides:
//   - FileChangeEventBus: debounced file-change events with glob filtering
//   - WatchPolicy: per-extension trigger configuration
//   - FileChangeBatch: groups rapid changes into one event to avoid cascade
//   - TriggerRouter: routes change events to registered handlers by pattern
//   - PatternMatcher: glob-to-regex with caching
//   - globalFileChangeBus singleton for extension-level use

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeKind = "created" | "modified" | "deleted" | "renamed";

export interface FileChangeEvent {
  filePath: string;
  kind: ChangeKind;
  /** Old path for rename events */
  oldPath?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Source that originated this event (e.g. 'vscode', 'poll', 'test') */
  source: string;
}

export interface FileChangeBatch {
  events: FileChangeEvent[];
  /** Earliest event timestamp in batch */
  startedAt: string;
  /** Latest event timestamp in batch */
  endedAt: string;
}

export type FileChangeHandler = (batch: FileChangeBatch) => void | Promise<void>;

export interface WatchPolicy {
  /** Glob patterns to watch (e.g. all TypeScript or Python files) */
  include: string[];
  /** Glob patterns to ignore */
  exclude: string[];
  /** Debounce window in ms — changes within window are batched */
  debounceMs: number;
  /** Maximum batch size before forced flush */
  maxBatchSize: number;
}

export interface TriggerRegistration {
  id: string;
  pattern: string;  // glob or exact path
  handler: FileChangeHandler;
  /** Only fire for specific change kinds */
  kinds?: ChangeKind[];
}

// ─── Pattern Matcher ──────────────────────────────────────────────────────────

const _patternCache = new Map<string, RegExp>();

/**
 * Convert a glob pattern to a RegExp.
 * Supports: * (non-slash wildcard), ** (any depth), ? (single char).
 * The globstar pattern followed by slash matches zero or more path segments.
 */
export function globToRegex(pattern: string): RegExp {
  if (_patternCache.has(pattern)) return _patternCache.get(pattern)!;

  // Normalize Windows separators
  const normalized = pattern.replace(/\\/g, "/");

  let escaped = "";
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === "*" && normalized[i + 1] === "*") {
      if (normalized[i + 2] === "/") {
        // globstar-slash: matches zero or more path segments (including none)
        escaped += "(?:.+/)?";
        i += 3;
      } else {
        // globstar at end: matches everything
        escaped += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      escaped += "[^/]*";
      i++;
    } else if (ch === "?") {
      escaped += "[^/]";
      i++;
    } else if (ch !== undefined && /[.+^${}()|[\]\\]/.test(ch)) {
      escaped += "\\" + ch;
      i++;
    } else {
      escaped += ch ?? "";
      i++;
    }
  }

  const re = new RegExp(`^${escaped}$`);
  _patternCache.set(pattern, re);
  return re;
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  // Normalize Windows separators
  const normalized = filePath.replace(/\\/g, "/");
  return globToRegex(pattern).test(normalized);
}

export function matchesPolicy(filePath: string, policy: WatchPolicy): boolean {
  const included = policy.include.some((p) => matchesGlob(filePath, p));
  if (!included) return false;
  const excluded = policy.exclude.some((p) => matchesGlob(filePath, p));
  return !excluded;
}

/** Clear the glob→regex cache (for tests). */
export function clearGlobCache(): void {
  _patternCache.clear();
}

// ─── File Change Event Bus ────────────────────────────────────────────────────

export class FileChangeEventBus {
  private _handlers: TriggerRegistration[] = [];
  private _pending: FileChangeEvent[] = [];
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _policy: WatchPolicy;
  private _registrationCounter = 0;

  constructor(policy: Partial<WatchPolicy> = {}) {
    this._policy = {
      include: policy.include ?? ["**/*"],
      exclude: policy.exclude ?? ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      debounceMs: policy.debounceMs ?? 200,
      maxBatchSize: policy.maxBatchSize ?? 50,
    };
  }

  /**
   * Register a handler for file changes matching `pattern`.
   * Returns the registration ID for later removal.
   */
  register(pattern: string, handler: FileChangeHandler, kinds?: ChangeKind[]): string {
    const id = `reg-${++this._registrationCounter}`;
    this._handlers.push({ id, pattern, handler, kinds });
    return id;
  }

  unregister(id: string): boolean {
    const idx = this._handlers.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this._handlers.splice(idx, 1);
    return true;
  }

  /**
   * Emit a file change event. Queues it for debounced batch delivery.
   */
  emit(event: FileChangeEvent): void {
    if (!matchesPolicy(event.filePath, this._policy)) return;

    this._pending.push(event);

    if (this._pending.length >= this._policy.maxBatchSize) {
      this._flush();
      return;
    }

    if (this._debounceTimer !== undefined) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flush(), this._policy.debounceMs);
  }

  /**
   * Immediately flush pending events to handlers (bypasses debounce).
   */
  flush(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    this._flush();
  }

  private _flush(): void {
    if (this._pending.length === 0) return;
    this._debounceTimer = undefined;

    const events = this._pending.splice(0);
    const batch: FileChangeBatch = {
      events,
      startedAt: events[0]!.timestamp,
      endedAt: events[events.length - 1]!.timestamp,
    };

    for (const reg of this._handlers) {
      // Filter by kind if specified
      const relevant = batch.events.filter((e) =>
        (!reg.kinds || reg.kinds.includes(e.kind)) &&
        matchesGlob(e.filePath, reg.pattern)
      );
      if (relevant.length === 0) continue;

      const filteredBatch: FileChangeBatch = {
        events: relevant,
        startedAt: relevant[0]!.timestamp,
        endedAt: relevant[relevant.length - 1]!.timestamp,
      };

      try {
        void reg.handler(filteredBatch);
      } catch {
        // Handlers must not crash the bus
      }
    }
  }

  /** Number of registered handlers */
  get handlerCount(): number { return this._handlers.length; }

  /** Number of pending (not yet flushed) events */
  get pendingCount(): number { return this._pending.length; }

  /** Current watch policy */
  get policy(): WatchPolicy { return { ...this._policy }; }

  /**
   * Dispose the bus — clears all handlers, cancels debounce timer.
   */
  dispose(): void {
    if (this._debounceTimer !== undefined) clearTimeout(this._debounceTimer);
    this._handlers = [];
    this._pending = [];
  }
}

// ─── Trigger Router ───────────────────────────────────────────────────────────

export type TriggerAction =
  | "completion"    // Trigger inline completion
  | "lint"          // Trigger linting
  | "test"          // Trigger test run
  | "format"        // Trigger formatter
  | "index"         // Re-index file for search
  | "custom";       // User-defined action

export interface TriggerRule {
  pattern: string;
  kinds: ChangeKind[];
  action: TriggerAction;
  /** Debounce override for this rule (ms) */
  debounceMs?: number;
  /** Optional label for logging */
  label?: string;
}

export interface RoutedTrigger {
  rule: TriggerRule;
  events: FileChangeEvent[];
}

export function buildTriggerRule(
  pattern: string,
  action: TriggerAction,
  kinds: ChangeKind[] = ["created", "modified"],
  opts: { debounceMs?: number; label?: string } = {},
): TriggerRule {
  return { pattern, kinds, action, debounceMs: opts.debounceMs, label: opts.label };
}

export class TriggerRouter {
  private _rules: TriggerRule[] = [];

  addRule(rule: TriggerRule): void {
    this._rules.push(rule);
  }

  removeRule(pattern: string): boolean {
    const idx = this._rules.findIndex((r) => r.pattern === pattern);
    if (idx === -1) return false;
    this._rules.splice(idx, 1);
    return true;
  }

  /**
   * Route a batch to matching trigger rules.
   * Returns one RoutedTrigger per matching rule (de-duplicated by action type).
   */
  route(batch: FileChangeBatch): RoutedTrigger[] {
    const matched: RoutedTrigger[] = [];

    for (const rule of this._rules) {
      const relevant = batch.events.filter(
        (e) => rule.kinds.includes(e.kind) && matchesGlob(e.filePath, rule.pattern)
      );
      if (relevant.length > 0) {
        matched.push({ rule, events: relevant });
      }
    }

    return matched;
  }

  /**
   * Format a routed trigger summary for logging.
   */
  formatTriggerSummary(triggers: RoutedTrigger[]): string {
    if (triggers.length === 0) return "No triggers fired.";
    return triggers
      .map((t) => `[${t.rule.action}] ${t.rule.label ?? t.rule.pattern} — ${t.events.length} file(s)`)
      .join("\n");
  }

  get ruleCount(): number { return this._rules.length; }
}

// ─── Default Trigger Rules ────────────────────────────────────────────────────

export const DEFAULT_TRIGGER_RULES: TriggerRule[] = [
  buildTriggerRule("**/*.{ts,tsx,js,jsx}", "completion", ["modified"], { label: "TS/JS → completion" }),
  buildTriggerRule("**/*.{ts,tsx,js,jsx}", "lint", ["modified", "created"], { label: "TS/JS → lint" }),
  buildTriggerRule("**/*.{test,spec}.{ts,tsx,js,jsx}", "test", ["modified", "created"], { label: "test file → test run" }),
  buildTriggerRule("**/*.py", "completion", ["modified"], { label: "Python → completion" }),
  buildTriggerRule("**/*.{ts,tsx,js,jsx,py,go,rs}", "index", ["created", "modified", "deleted"], { label: "source → re-index" }),
];

// ─── Singleton ────────────────────────────────────────────────────────────────

export const globalFileChangeBus = new FileChangeEventBus();
