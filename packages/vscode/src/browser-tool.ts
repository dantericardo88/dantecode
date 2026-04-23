// ============================================================================
// packages/vscode/src/browser-tool.ts
// Playwright browser automation for DanteCode — Cline-style browser_action tool
// ============================================================================

export interface BrowserAction {
  action: "launch" | "navigate" | "click" | "type" | "screenshot" | "close";
  url?: string;
  coordinate?: [number, number]; // [x, y] in pixels
  text?: string;
}

export interface BrowserActionResult {
  screenshot: string | null; // base64-encoded PNG, null if not available
  logs: string[];            // console.log lines captured since last action
  currentUrl: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function takeScreenshot(page: unknown): Promise<string | null> {
  try {
    const buf = await (
      page as { screenshot: (opts: { type: string }) => Promise<Buffer> }
    ).screenshot({ type: "png" });
    return buf.toString("base64");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BrowserSession
// ---------------------------------------------------------------------------

export class BrowserSession {
  private _browser: unknown = null; // playwright Browser
  private _page: unknown = null;    // playwright Page
  private _consoleLogs: string[] = [];

  get isActive(): boolean {
    return this._page !== null;
  }

  async execute(action: BrowserAction): Promise<BrowserActionResult> {
    // ── playwright not available ────────────────────────────────────────────
    let pw: { chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> } };
    try {
      // @ts-expect-error — playwright is an optional peer dep; graceful fallback if missing
      pw = (await import("playwright")) as typeof pw;
    } catch {
      return {
        screenshot: null,
        logs: [],
        currentUrl: "",
        error:
          "Playwright not installed. Run: npx playwright install chromium",
      };
    }

    // ── page required for non-launch actions ───────────────────────────────
    if (action.action !== "launch" && this._page === null) {
      return {
        screenshot: null,
        logs: [],
        currentUrl: "",
        error: "No active browser session. Call launch first.",
      };
    }

    const page = this._page as {
      goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<void>;
      mouse: { click: (x: number, y: number) => Promise<void> };
      keyboard: { type: (text: string) => Promise<void> };
      screenshot: (opts: { type: string }) => Promise<Buffer>;
      waitForTimeout: (ms: number) => Promise<void>;
      url: () => string;
      setViewportSize: (size: { width: number; height: number }) => void;
      on: (event: string, handler: (msg: { text: () => string }) => void) => void;
    };

    switch (action.action) {
      // ── launch ────────────────────────────────────────────────────────────
      case "launch": {
        const browser = await pw.chromium.launch({ headless: false });
        const newPage = await (
          browser as { newPage: () => Promise<unknown> }
        ).newPage();
        this._browser = browser;
        this._page = newPage;
        this._consoleLogs = [];

        const p = this._page as typeof page;
        p.setViewportSize({ width: 1280, height: 720 });
        p.on("console", (msg) => {
          this._consoleLogs.push(msg.text());
        });

        const screenshot = await takeScreenshot(this._page);
        return {
          screenshot,
          logs: [...this._consoleLogs],
          currentUrl: p.url(),
        };
      }

      // ── navigate ─────────────────────────────────────────────────────────
      case "navigate": {
        await page.goto(action.url ?? "", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        this._consoleLogs = [];
        const screenshot = await takeScreenshot(this._page);
        return {
          screenshot,
          logs: [...this._consoleLogs],
          currentUrl: page.url(),
        };
      }

      // ── click ─────────────────────────────────────────────────────────────
      case "click": {
        const [x, y] = action.coordinate ?? [0, 0];
        await page.mouse.click(x, y);
        await page.waitForTimeout(500);
        const screenshot = await takeScreenshot(this._page);
        return {
          screenshot,
          logs: [...this._consoleLogs],
          currentUrl: page.url(),
        };
      }

      // ── type ──────────────────────────────────────────────────────────────
      case "type": {
        await page.keyboard.type(action.text ?? "");
        const screenshot = await takeScreenshot(this._page);
        return {
          screenshot,
          logs: [...this._consoleLogs],
          currentUrl: page.url(),
        };
      }

      // ── screenshot ───────────────────────────────────────────────────────
      case "screenshot": {
        const screenshot = await takeScreenshot(this._page);
        return {
          screenshot,
          logs: [...this._consoleLogs],
          currentUrl: page.url(),
        };
      }

      // ── close ─────────────────────────────────────────────────────────────
      case "close": {
        await (
          this._browser as { close: () => Promise<void> }
        ).close();
        this._browser = null;
        this._page = null;
        this._consoleLogs = [];
        return { screenshot: null, logs: [], currentUrl: "" };
      }

      default: {
        return {
          screenshot: null,
          logs: [],
          currentUrl: "",
          error: `Unknown action: ${String((action as BrowserAction).action)}`,
        };
      }
    }
  }

  async close(): Promise<void> {
    if (this._browser !== null) {
      await (this._browser as { close: () => Promise<void> }).close();
      this._browser = null;
      this._page = null;
      this._consoleLogs = [];
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton for use across tool invocations
// ---------------------------------------------------------------------------

export const globalBrowserSession = new BrowserSession();
