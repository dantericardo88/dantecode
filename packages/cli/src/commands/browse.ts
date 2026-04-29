// ============================================================================
// packages/cli/src/commands/browse.ts
//
// Sprint 16 — Dim 17: BrowserUseManager wiring.
// Wires BrowserSessionManager from @dantecode/core into a CLI command that
// opens a browser session, navigates to a URL, and optionally interacts.
//
// Usage:
//   dantecode browse <url> [--click <selector>] [--type <selector> <text>] [--json]
// ============================================================================

import {
  BrowserSessionManager,
  BrowserAgent,
  detectBrowserCapabilities,
  buildNavigateAction,
  buildClickAction,
  buildTypeAction,
  buildSuccessResult,
  buildErrorResult,
  formatDomSnapshotForPrompt,
  type BrowserCapabilities,
} from "@dantecode/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrowseCommandOptions {
  url: string;
  /** CSS/XPath selector to click after navigation */
  clickSelector?: string;
  /** { selector, text } to type into an element */
  typeInput?: { selector: string; text: string };
  /** Output as JSON */
  json?: boolean;
  /** Optional session ID to reuse (injected by tests or CLI --session flag) */
  sessionId?: string;
  /** Run browser in headless mode (default: true) */
  headless?: boolean;
}

export interface BrowseCommandResult {
  sessionId: string;
  url: string;
  status: "active" | "paused" | "closed" | "error";
  actionsCount: number;
  lastActionSuccess: boolean;
  promptContext: string;
  /** Browser capability report — includes install instructions if nothing is available. */
  capabilities?: BrowserCapabilities;
  /** Base64-encoded PNG screenshot taken after all actions (Devin pattern). Empty string when unavailable. */
  screenshotB64?: string;
}

// ── Singleton session manager ─────────────────────────────────────────────────

export const globalBrowserManager = new BrowserSessionManager();

// ── Command ───────────────────────────────────────────────────────────────────

/**
 * Run the browse command.
 * Opens a BrowserSession, executes a navigate action via BrowserAgent (Playwright),
 * and optionally executes click/type actions. Returns a structured result with
 * a prompt-ready context.
 *
 * BrowserAgent loads Playwright dynamically — gracefully degrades if not installed.
 */
/** Execute one BrowserAgent action and record success/failure to the session.
 * Common shape across navigate/click/type. The `agentArgs` are passed
 * directly to agent.execute(); `recordedAction` is the BrowserSessionManager
 * action shape (separate type that pairs with the recorder).
 *
 * `successDataExtractor` lets the navigate path optionally surface the
 * resolved URL on success — it's a no-op for click/type. */
async function executeAndRecordBrowserAction(
  agent: BrowserAgent,
  sessionId: string,
  recordedAction: ReturnType<typeof buildNavigateAction>,
  agentArgs: Parameters<BrowserAgent["execute"]>[0],
  errorLabel: string,
  successDataExtractor?: (data: unknown) => string | undefined,
): Promise<void> {
  const start = Date.now();
  try {
    const result = await agent.execute(agentArgs);
    globalBrowserManager.recordAction(
      sessionId,
      result.success
        ? buildSuccessResult(recordedAction, Date.now() - start)
        : buildErrorResult(recordedAction, result.error ?? errorLabel, Date.now() - start),
      result.success && successDataExtractor ? successDataExtractor(result.data) : undefined,
    );
  } catch (err) {
    globalBrowserManager.recordAction(
      sessionId,
      buildErrorResult(recordedAction, String(err), Date.now() - start),
    );
  }
}

/** Compose the prompt-context block returned to the caller (and shown to
 * the model). Pulls a fresh DOM snapshot + accessibility tree + screenshot. */
async function buildBrowsePromptContext(
  agent: BrowserAgent,
  sessionId: string,
  url: string,
): Promise<{ promptContext: string; screenshotB64: string }> {
  const summary = globalBrowserManager.getSessionSummary(sessionId);
  const screenshotB64 = await agent.screenshotBase64().catch(() => "");
  const capturedDom = await agent.captureDomSnapshot().catch(() => null);
  const accessibilityTree = await agent
    .execute({ type: "accessibility_tree" })
    .catch(() => ({ success: false } as const));

  const domSnapshot = formatDomSnapshotForPrompt(
    capturedDom ?? {
      capturedAt: new Date().toISOString(),
      url,
      title: url,
      bodyText: "",
      interactiveElements: [],
      metaTags: {},
    },
    8,
  );

  const promptContext = [
    `## Browser Session: ${sessionId}`,
    `URL: ${url}`,
    summary ? `Actions: ${summary.actionCount} (${summary.successCount} ok, ${summary.failureCount} fail)` : "",
    domSnapshot,
    accessibilityTree.success && accessibilityTree.data
      ? `## Accessibility Tree\n${String(accessibilityTree.data).slice(0, 2000)}`
      : "",
    screenshotB64 ? "Screenshot captured and available as screenshotB64 for visual follow-up." : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { promptContext, screenshotB64 };
}

export async function cmdBrowse(opts: BrowseCommandOptions): Promise<BrowseCommandResult> {
  const { url, clickSelector, typeInput } = opts;
  const capabilities = await detectBrowserCapabilities();
  const session = globalBrowserManager.openSession();
  const sessionId = session.id;

  // No browser driver: return early with install instructions.
  if (capabilities.recommendedMode === "none") {
    const promptContext = [
      `## Browser Session: ${sessionId}`,
      `URL: ${url}`,
      capabilities.installInstructions ?? "",
    ].filter(Boolean).join("\n\n");
    return {
      sessionId, url,
      status: "error",
      actionsCount: 0,
      lastActionSuccess: false,
      promptContext,
      capabilities,
    };
  }

  const agent = new BrowserAgent({ headless: true });

  await executeAndRecordBrowserAction(
    agent, sessionId, buildNavigateAction(url),
    { type: "goto", url }, "Navigation failed",
    (data) => (typeof data === "string" ? data : url),
  );
  if (clickSelector) {
    await executeAndRecordBrowserAction(
      agent, sessionId, buildClickAction(clickSelector),
      { type: "click", selector: clickSelector }, "Click failed",
    );
  }
  if (typeInput) {
    await executeAndRecordBrowserAction(
      agent, sessionId, buildTypeAction(typeInput.selector, typeInput.text),
      { type: "type", selector: typeInput.selector, text: typeInput.text }, "Type failed",
    );
  }

  const { promptContext, screenshotB64 } = await buildBrowsePromptContext(agent, sessionId, url);
  const lastResult = session.actions.at(-1);

  return {
    sessionId, url,
    status: session.status,
    actionsCount: session.actions.length,
    lastActionSuccess: lastResult?.success ?? false,
    promptContext,
    capabilities,
    screenshotB64: screenshotB64 || undefined,
  };
}
