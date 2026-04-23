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
export async function cmdBrowse(opts: BrowseCommandOptions): Promise<BrowseCommandResult> {
  const { url, clickSelector, typeInput } = opts;

  // Probe available browser drivers before attempting any action (Sprint 35)
  const capabilities = await detectBrowserCapabilities();

  const session = globalBrowserManager.openSession();
  const sessionId = session.id;

  // If no browser driver is available, skip agent execution and return early with instructions
  if (capabilities.recommendedMode === "none") {
    const promptContext = [
      `## Browser Session: ${sessionId}`,
      `URL: ${url}`,
      capabilities.installInstructions ?? "",
    ].filter(Boolean).join("\n\n");

    return {
      sessionId,
      url,
      status: "error",
      actionsCount: 0,
      lastActionSuccess: false,
      promptContext,
      capabilities,
    };
  }

  const agent = new BrowserAgent({ headless: true });

  // Execute navigate action via BrowserAgent
  const navigateAction = buildNavigateAction(url);
  const navigateStart = Date.now();
  try {
    const result = await agent.execute({ type: "goto", url });
    globalBrowserManager.recordAction(
      sessionId,
      result.success
        ? buildSuccessResult(navigateAction, Date.now() - navigateStart)
        : buildErrorResult(navigateAction, result.error ?? "Navigation failed", Date.now() - navigateStart),
      result.success ? (result.data ?? url) : undefined,
    );
  } catch (err) {
    globalBrowserManager.recordAction(
      sessionId,
      buildErrorResult(navigateAction, String(err), Date.now() - navigateStart),
    );
  }

  // Execute optional click action
  if (clickSelector) {
    const clickAction = buildClickAction(clickSelector);
    const clickStart = Date.now();
    try {
      const result = await agent.execute({ type: "click", selector: clickSelector });
      globalBrowserManager.recordAction(
        sessionId,
        result.success
          ? buildSuccessResult(clickAction, Date.now() - clickStart)
          : buildErrorResult(clickAction, result.error ?? "Click failed", Date.now() - clickStart),
      );
    } catch (err) {
      globalBrowserManager.recordAction(
        sessionId,
        buildErrorResult(clickAction, String(err), Date.now() - clickStart),
      );
    }
  }

  // Execute optional type action
  if (typeInput) {
    const typeAction = buildTypeAction(typeInput.selector, typeInput.text);
    const typeStart = Date.now();
    try {
      const result = await agent.execute({ type: "type", selector: typeInput.selector, text: typeInput.text });
      globalBrowserManager.recordAction(
        sessionId,
        result.success
          ? buildSuccessResult(typeAction, Date.now() - typeStart)
          : buildErrorResult(typeAction, result.error ?? "Type failed", Date.now() - typeStart),
      );
    } catch (err) {
      globalBrowserManager.recordAction(
        sessionId,
        buildErrorResult(typeAction, String(err), Date.now() - typeStart),
      );
    }
  }

  const summary = globalBrowserManager.getSessionSummary(sessionId);
  const lastResult = session.actions.at(-1);

  // Capture page screenshot after all actions and extract prompt-usable page state.
  const screenshotB64 = await agent.screenshotBase64().catch(() => "");
  const capturedDom = await agent.captureDomSnapshot().catch(() => null);
  const accessibilityTree = await agent.execute({ type: "accessibility_tree" }).catch(() => ({ success: false } as const));

  const domSnapshot = formatDomSnapshotForPrompt(capturedDom ?? {
    capturedAt: new Date().toISOString(),
    url,
    title: url,
    bodyText: "",
    interactiveElements: [],
    metaTags: {},
  }, 8);

  const promptContext = [
    `## Browser Session: ${sessionId}`,
    `URL: ${url}`,
    summary ? `Actions: ${summary.actionCount} (${summary.successCount} ok, ${summary.failureCount} fail)` : "",
    domSnapshot,
    accessibilityTree.success && accessibilityTree.data
      ? `## Accessibility Tree\n${String(accessibilityTree.data).slice(0, 2000)}`
      : "",
    screenshotB64 ? "Screenshot captured and available as screenshotB64 for visual follow-up." : "",
  ].filter(Boolean).join("\n");

  return {
    sessionId,
    url,
    status: session.status,
    actionsCount: session.actions.length,
    lastActionSuccess: lastResult?.success ?? false,
    promptContext,
    capabilities,
    screenshotB64: screenshotB64 || undefined,
  };
}
