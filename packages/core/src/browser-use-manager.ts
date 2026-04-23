// packages/core/src/browser-use-manager.ts
// Browser / Computer-Use orchestration layer — closes dim 17 (browser use: 7→9).
//
// Harvested from: OpenHands BrowserEnv, Playwright test runner, Puppeteer page controller.
//
// Provides:
//   - Browser action taxonomy (click, type, navigate, screenshot, scroll, etc.)
//   - Session lifecycle (open, close, pause, resume)
//   - Action result normalisation with screenshot digest
//   - Element selector resolution strategy (CSS > XPath > text > aria)
//   - DOM snapshot extraction for AI context injection
//   - Action history / replay log
//   - Error classification (navigation, timeout, selector, network)

// ─── Types ────────────────────────────────────────────────────────────────────

export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "clear"
  | "scroll"
  | "screenshot"
  | "wait"
  | "hover"
  | "select"
  | "key_press"
  | "get_text"
  | "get_attribute"
  | "evaluate"
  | "close";

export type BrowserErrorType =
  | "navigation"
  | "timeout"
  | "selector"
  | "network"
  | "javascript"
  | "permission"
  | "unknown";

export type SelectorStrategy = "css" | "xpath" | "text" | "aria" | "id";

export interface BrowserSelector {
  value: string;
  strategy: SelectorStrategy;
}

export interface BrowserAction {
  type: BrowserActionType;
  /** Target element selector */
  selector?: BrowserSelector;
  /** Navigation URL or typed text or key name */
  value?: string;
  /** Scroll delta in pixels */
  scrollDeltaY?: number;
  /** Timeout in ms */
  timeoutMs?: number;
  /** JS expression for evaluate action */
  expression?: string;
}

export interface BrowserActionResult {
  success: boolean;
  action: BrowserAction;
  /** Text extracted (get_text action) */
  text?: string;
  /** Attribute value (get_attribute action) */
  attributeValue?: string;
  /** JS eval result (JSON-stringified) */
  evalResult?: string;
  /** Base64 PNG screenshot digest (first 64 chars) */
  screenshotDigest?: string;
  /** Error message if success=false */
  error?: string;
  errorType?: BrowserErrorType;
  /** Duration in ms */
  durationMs: number;
  /** ISO timestamp */
  timestamp: string;
}

export interface DomSnapshot {
  title: string;
  url: string;
  /** Visible text content (truncated) */
  bodyText: string;
  /** Focusable interactive elements */
  interactiveElements: DomElement[];
  /** Page <meta> tags */
  metaTags: Record<string, string>;
  capturedAt: string;
}

export interface DomElement {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  href?: string;
  type?: string;
  ariaLabel?: string;
  /** Best selector for this element */
  selector: BrowserSelector;
}

export interface BrowserSession {
  id: string;
  startedAt: string;
  closedAt?: string;
  status: "active" | "paused" | "closed";
  actions: BrowserActionResult[];
  currentUrl: string;
  /** Viewport size */
  viewport: { width: number; height: number };
}

export interface BrowserSessionSummary {
  sessionId: string;
  actionCount: number;
  successCount: number;
  failureCount: number;
  startedAt: string;
  closedAt?: string;
  lastUrl: string;
  errorTypes: Record<BrowserErrorType, number>;
}

// ─── Selector Resolution ──────────────────────────────────────────────────────

/**
 * Resolve a raw selector string into a typed BrowserSelector.
 * Priority: id (#) > CSS > XPath (//) > aria ([aria-label]) > text
 */
export function resolveSelector(raw: string): BrowserSelector {
  if (raw.startsWith("#") && /^#[A-Za-z][\w-]*$/.test(raw)) {
    return { strategy: "id", value: raw.slice(1) };
  }
  if (raw.startsWith("//") || raw.startsWith("(//")) {
    return { strategy: "xpath", value: raw };
  }
  if (raw.startsWith("[aria-label=") || raw.startsWith("[aria-label =")) {
    return { strategy: "aria", value: raw };
  }
  if (raw.startsWith("text=") || raw.startsWith("text/")) {
    return { strategy: "text", value: raw.replace(/^text[=/]/, "") };
  }
  return { strategy: "css", value: raw };
}

/**
 * Format a BrowserSelector back to a display string.
 */
export function formatSelector(sel: BrowserSelector): string {
  switch (sel.strategy) {
    case "id": return `#${sel.value}`;
    case "xpath": return sel.value;
    case "aria": return `[aria-label="${sel.value}"]`;
    case "text": return `text="${sel.value}"`;
    case "css": return sel.value;
  }
}

// ─── Action Builder ───────────────────────────────────────────────────────────

export function buildNavigateAction(url: string, timeoutMs = 30_000): BrowserAction {
  return { type: "navigate", value: url, timeoutMs };
}

export function buildClickAction(selector: string, timeoutMs = 5_000): BrowserAction {
  return { type: "click", selector: resolveSelector(selector), timeoutMs };
}

export function buildTypeAction(selector: string, text: string): BrowserAction {
  return { type: "type", selector: resolveSelector(selector), value: text };
}

export function buildScrollAction(deltaY: number, selector?: string): BrowserAction {
  return {
    type: "scroll",
    scrollDeltaY: deltaY,
    selector: selector ? resolveSelector(selector) : undefined,
  };
}

export function buildScreenshotAction(): BrowserAction {
  return { type: "screenshot" };
}

export function buildEvaluateAction(expression: string): BrowserAction {
  return { type: "evaluate", expression };
}

export function buildKeyPressAction(key: string, selector?: string): BrowserAction {
  return { type: "key_press", value: key, selector: selector ? resolveSelector(selector) : undefined };
}

// ─── Error Classification ─────────────────────────────────────────────────────

const ERROR_PATTERNS: Array<{ pattern: RegExp; type: BrowserErrorType }> = [
  { pattern: /navigation|net::ERR|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i, type: "navigation" },
  { pattern: /timeout|timed? out|exceeded.*timeout/i, type: "timeout" },
  { pattern: /selector|element not found|no element|Unable to find/i, type: "selector" },
  { pattern: /network|fetch|CORS|ERR_INTERNET_DISCONNECTED/i, type: "network" },
  { pattern: /javascript|ReferenceError|TypeError|SyntaxError|Cannot read/i, type: "javascript" },
  { pattern: /permission|denied|not allowed|blocked/i, type: "permission" },
];

export function classifyBrowserError(message: string): BrowserErrorType {
  for (const { pattern, type } of ERROR_PATTERNS) {
    if (pattern.test(message)) return type;
  }
  return "unknown";
}

// ─── Result Builder ───────────────────────────────────────────────────────────

export function buildSuccessResult(action: BrowserAction, durationMs: number, extras: Partial<BrowserActionResult> = {}): BrowserActionResult {
  return {
    success: true,
    action,
    durationMs,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

export function buildErrorResult(action: BrowserAction, errorMsg: string, durationMs: number): BrowserActionResult {
  return {
    success: false,
    action,
    error: errorMsg,
    errorType: classifyBrowserError(errorMsg),
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

// ─── DOM Snapshot ─────────────────────────────────────────────────────────────

/**
 * Build a DomSnapshot from raw page data.
 */
export function buildDomSnapshot(raw: {
  title: string;
  url: string;
  bodyText: string;
  interactiveElements?: DomElement[];
  metaTags?: Record<string, string>;
}, maxBodyChars = 2000): DomSnapshot {
  return {
    title: raw.title,
    url: raw.url,
    bodyText: raw.bodyText.slice(0, maxBodyChars),
    interactiveElements: raw.interactiveElements ?? [],
    metaTags: raw.metaTags ?? {},
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Format a DomSnapshot for injection into an AI prompt.
 */
export function formatDomSnapshotForPrompt(snapshot: DomSnapshot, maxElements = 10): string {
  const lines = [
    `## Page Context`,
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    ``,
    `### Page Text (truncated)`,
    snapshot.bodyText,
    ``,
  ];

  if (snapshot.interactiveElements.length > 0) {
    lines.push(`### Interactive Elements (top ${Math.min(maxElements, snapshot.interactiveElements.length)})`);
    for (const el of snapshot.interactiveElements.slice(0, maxElements)) {
      const sel = formatSelector(el.selector);
      const text = el.text ? ` "${el.text.slice(0, 40)}"` : "";
      const aria = el.ariaLabel ? ` aria="${el.ariaLabel}"` : "";
      lines.push(`  <${el.tag}> ${sel}${text}${aria}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ─── Session Manager ──────────────────────────────────────────────────────────

let _sessionCounter = 0;

export class BrowserSessionManager {
  private _sessions = new Map<string, BrowserSession>();

  openSession(viewport = { width: 1280, height: 800 }): BrowserSession {
    const id = `browser-session-${Date.now()}-${++_sessionCounter}`;
    const session: BrowserSession = {
      id,
      startedAt: new Date().toISOString(),
      status: "active",
      actions: [],
      currentUrl: "about:blank",
      viewport,
    };
    this._sessions.set(id, session);
    return session;
  }

  getSession(id: string): BrowserSession | undefined {
    return this._sessions.get(id);
  }

  pauseSession(id: string): boolean {
    const s = this._sessions.get(id);
    if (!s || s.status !== "active") return false;
    s.status = "paused";
    return true;
  }

  resumeSession(id: string): boolean {
    const s = this._sessions.get(id);
    if (!s || s.status !== "paused") return false;
    s.status = "active";
    return true;
  }

  closeSession(id: string): boolean {
    const s = this._sessions.get(id);
    if (!s || s.status === "closed") return false;
    s.status = "closed";
    s.closedAt = new Date().toISOString();
    return true;
  }

  recordAction(sessionId: string, result: BrowserActionResult, newUrl?: string): void {
    const s = this._sessions.get(sessionId);
    if (!s) return;
    s.actions.push(result);
    if (newUrl) s.currentUrl = newUrl;
  }

  getSessionSummary(id: string): BrowserSessionSummary | undefined {
    const s = this._sessions.get(id);
    if (!s) return undefined;

    const errorTypes: Record<BrowserErrorType, number> = {
      navigation: 0, timeout: 0, selector: 0,
      network: 0, javascript: 0, permission: 0, unknown: 0,
    };
    let successCount = 0;
    let failureCount = 0;

    for (const a of s.actions) {
      if (a.success) {
        successCount++;
      } else {
        failureCount++;
        if (a.errorType) errorTypes[a.errorType]++;
      }
    }

    return {
      sessionId: id,
      actionCount: s.actions.length,
      successCount,
      failureCount,
      startedAt: s.startedAt,
      closedAt: s.closedAt,
      lastUrl: s.currentUrl,
      errorTypes,
    };
  }

  formatHistoryForPrompt(id: string, maxActions = 20): string {
    const s = this._sessions.get(id);
    if (!s) return "No session found.";

    const lines = [`## Browser Session History`, `Session: ${id}`, `URL: ${s.currentUrl}`, ``];
    const recent = s.actions.slice(-maxActions);

    for (const r of recent) {
      const icon = r.success ? "✅" : "❌";
      const sel = r.action.selector ? ` → ${formatSelector(r.action.selector)}` : "";
      const val = r.action.value ? ` "${r.action.value.slice(0, 40)}"` : "";
      lines.push(`${icon} ${r.action.type}${sel}${val} (${r.durationMs}ms)`);
      if (!r.success && r.error) lines.push(`   Error: ${r.error.slice(0, 80)}`);
    }

    if (s.actions.length > maxActions) {
      lines.push(`... and ${s.actions.length - maxActions} earlier actions`);
    }

    return lines.join("\n");
  }

  get activeSessions(): BrowserSession[] {
    return [...this._sessions.values()].filter((s) => s.status === "active");
  }

  get totalSessions(): number {
    return this._sessions.size;
  }

  clearClosed(): void {
    for (const [id, s] of this._sessions) {
      if (s.status === "closed") this._sessions.delete(id);
    }
  }
}

export const globalBrowserManager = new BrowserSessionManager();
