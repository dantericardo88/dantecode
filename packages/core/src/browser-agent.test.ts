// ============================================================================
// @dantecode/core — Browser Agent Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserAgent } from "./browser-agent.js";
import type { BrowserAction, BrowserActionResult, VisionRouter } from "./browser-agent.js";

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot")),
    evaluate: vi.fn().mockResolvedValue(undefined),
    accessibility: {
      snapshot: vi.fn().mockResolvedValue({
        role: "WebArea",
        name: "Test Page",
        children: [
          {
            role: "heading",
            name: "Hello World",
            level: 1,
            children: [],
          },
          {
            role: "textbox",
            name: "Search",
            value: "",
            focused: true,
            children: [],
          },
        ],
      }),
    },
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
    },
    close: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("https://example.com"),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BrowserAgent", () => {
  let agent: BrowserAgent;
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    agent = new BrowserAgent();
    mockPage = createMockPage();
    // Inject the mock page so tests don't need real Playwright
    agent._injectPage(mockPage as Parameters<typeof agent._injectPage>[0]);
  });

  // ─── Constructor & Options ─────────────────────────────────────────

  describe("constructor", () => {
    it("applies default options when none are provided", () => {
      const defaultAgent = new BrowserAgent();
      expect(defaultAgent.options.headless).toBe(true);
      expect(defaultAgent.options.timeout).toBe(30_000);
      expect(defaultAgent.options.viewport).toEqual({ width: 1280, height: 720 });
    });

    it("stores custom viewport options correctly", () => {
      const customAgent = new BrowserAgent({
        headless: false,
        timeout: 10_000,
        viewport: { width: 1920, height: 1080 },
      });
      expect(customAgent.options.headless).toBe(false);
      expect(customAgent.options.timeout).toBe(10_000);
      expect(customAgent.options.viewport).toEqual({ width: 1920, height: 1080 });
    });

    it("merges partial options with defaults", () => {
      const partialAgent = new BrowserAgent({ timeout: 5000 });
      expect(partialAgent.options.headless).toBe(true);
      expect(partialAgent.options.timeout).toBe(5000);
      expect(partialAgent.options.viewport).toEqual({ width: 1280, height: 720 });
    });
  });

  // ─── execute() Dispatcher ──────────────────────────────────────────

  describe("execute", () => {
    it("dispatches goto correctly", async () => {
      const result = await agent.execute({
        type: "goto",
        url: "https://example.com",
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe("https://example.com");
      expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", expect.any(Object));
    });

    it("dispatches click correctly", async () => {
      const result = await agent.execute({
        type: "click",
        selector: "#submit-btn",
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe("#submit-btn");
      expect(mockPage.click).toHaveBeenCalledWith("#submit-btn", expect.any(Object));
    });

    it("dispatches type correctly", async () => {
      const result = await agent.execute({
        type: "type",
        selector: "#search",
        text: "hello world",
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe("hello world");
      expect(mockPage.fill).toHaveBeenCalledWith("#search", "hello world", expect.any(Object));
    });

    it("dispatches screenshot correctly", async () => {
      const result = await agent.execute({ type: "screenshot" });
      expect(result.success).toBe(true);
      expect(result.data).toBe(Buffer.from("fake-screenshot").toString("base64"));
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        fullPage: false,
        type: "png",
      });
    });

    it("dispatches accessibility_tree correctly", async () => {
      const result = await agent.execute({ type: "accessibility_tree" });
      expect(result.success).toBe(true);
      expect(result.data).toContain("WebArea");
      expect(result.data).toContain("heading");
      expect(result.data).toContain("Hello World");
      expect(mockPage.accessibility.snapshot).toHaveBeenCalledTimes(1);
    });

    it("dispatches scroll correctly", async () => {
      const result = await agent.execute({
        type: "scroll",
        direction: "down",
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe("down");
      expect(mockPage.evaluate).toHaveBeenCalledWith("window.scrollBy(0, 500)");
    });

    it("returns error for unknown action type", async () => {
      const result = await agent.execute({
        type: "hover" as BrowserAction["type"],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action type: hover");
    });
  });

  // ─── Individual Actions ────────────────────────────────────────────

  describe("goto", () => {
    it("validates URL format — rejects non-http URLs", async () => {
      const result = await agent.goto("ftp://example.com/file");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid URL");
    });

    it("validates URL format — rejects empty URL", async () => {
      const result = await agent.goto("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("URL is required");
    });

    it("validates URL format — rejects garbage strings", async () => {
      const result = await agent.goto("not a url at all");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid URL");
    });

    it("returns page URL on success", async () => {
      mockPage.url.mockReturnValue("https://example.com/redirected");
      const result = await agent.goto("https://example.com");
      expect(result.success).toBe(true);
      expect(result.data).toBe("https://example.com/redirected");
    });

    it("handles navigation errors", async () => {
      mockPage.goto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
      const result = await agent.goto("https://unreachable.example.com");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Navigation failed");
      expect(result.error).toContain("ERR_CONNECTION_REFUSED");
    });
  });

  describe("click", () => {
    it("validates selector is non-empty", async () => {
      const result = await agent.click("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Selector is required");
    });

    it("validates selector with whitespace-only string", async () => {
      const result = await agent.click("   ");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Selector is required");
    });

    it("handles click errors", async () => {
      mockPage.click.mockRejectedValue(new Error("Element not found"));
      const result = await agent.click("#nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Click failed");
      expect(result.error).toContain("#nonexistent");
    });
  });

  describe("type", () => {
    it("validates both selector and text — empty selector", async () => {
      const result = await agent.type("", "some text");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Selector is required");
    });

    it("allows empty string as text (clearing a field)", async () => {
      const result = await agent.type("#input", "");
      expect(result.success).toBe(true);
      expect(mockPage.fill).toHaveBeenCalledWith("#input", "", expect.any(Object));
    });

    it("handles type errors", async () => {
      mockPage.fill.mockRejectedValue(new Error("Element not editable"));
      const result = await agent.type("#readonly-field", "text");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Type failed");
      expect(result.error).toContain("#readonly-field");
    });
  });

  describe("screenshot", () => {
    it("returns base64-encoded screenshot", async () => {
      const fakeData = Buffer.from("png-binary-data");
      mockPage.screenshot.mockResolvedValue(fakeData);
      const result = await agent.screenshot();
      expect(result.success).toBe(true);
      expect(result.data).toBe(fakeData.toString("base64"));
    });

    it("handles screenshot errors", async () => {
      mockPage.screenshot.mockRejectedValue(new Error("Page crashed"));
      const result = await agent.screenshot();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Screenshot failed");
    });
  });

  describe("getAccessibilityTree", () => {
    it("returns flattened accessibility tree as indented text", async () => {
      const result = await agent.getAccessibilityTree();
      expect(result.success).toBe(true);

      const lines = result.data!.split("\n");
      // Root node
      expect(lines[0]).toMatch(/^WebArea "Test Page"$/);
      // First child — indented heading
      expect(lines[1]).toMatch(/^\s+heading "Hello World" level=1$/);
      // Second child — indented textbox
      expect(lines[2]).toMatch(/^\s+textbox "Search" value="" focused$/);
    });

    it("returns placeholder when tree is empty", async () => {
      mockPage.accessibility.snapshot.mockResolvedValue(null);
      const result = await agent.getAccessibilityTree();
      expect(result.success).toBe(true);
      expect(result.data).toBe("(empty accessibility tree)");
    });

    it("handles accessibility tree errors", async () => {
      mockPage.accessibility.snapshot.mockRejectedValue(new Error("Not supported"));
      const result = await agent.getAccessibilityTree();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Accessibility tree capture failed");
    });
  });

  describe("scroll", () => {
    it("scrolls down with positive offset", async () => {
      const result = await agent.scroll("down");
      expect(result.success).toBe(true);
      expect(result.data).toBe("down");
      expect(mockPage.evaluate).toHaveBeenCalledWith("window.scrollBy(0, 500)");
    });

    it("scrolls up with negative offset", async () => {
      const result = await agent.scroll("up");
      expect(result.success).toBe(true);
      expect(result.data).toBe("up");
      expect(mockPage.evaluate).toHaveBeenCalledWith("window.scrollBy(0, -500)");
    });

    it("validates direction parameter", async () => {
      const result = await agent.scroll("left" as "up" | "down");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid scroll direction");
    });

    it("handles scroll errors", async () => {
      mockPage.evaluate.mockRejectedValue(new Error("Page context destroyed"));
      const result = await agent.scroll("down");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Scroll failed");
    });
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────

  describe("close", () => {
    it("does not throw when browser is null", async () => {
      const freshAgent = new BrowserAgent();
      // No page/browser injected — close should be safe
      await expect(freshAgent.close()).resolves.toBeUndefined();
    });

    it("calls close on page, context, and browser when injected", async () => {
      // We only inject a page — context and browser are null, should still be safe
      await agent.close();
      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it("swallows errors from page.close()", async () => {
      mockPage.close.mockRejectedValue(new Error("Already closed"));
      await expect(agent.close()).resolves.toBeUndefined();
    });
  });

  // ─── Graceful Fallback (no Playwright) ─────────────────────────────

  describe("graceful fallback when playwright is not available", () => {
    it("returns error for all actions when playwright is not installed", async () => {
      // Create a fresh agent without injecting a page — playwright won't be
      // available in the test environment, so ensurePage() will fail.
      const noPlaywrightAgent = new BrowserAgent();

      const actions: BrowserAction[] = [
        { type: "goto", url: "https://example.com" },
        { type: "click", selector: "#btn" },
        { type: "type", selector: "#input", text: "test" },
        { type: "screenshot" },
        { type: "accessibility_tree" },
        { type: "scroll", direction: "down" },
      ];

      const results: BrowserActionResult[] = [];
      for (const action of actions) {
        results.push(await noPlaywrightAgent.execute(action));
      }

      for (const result of results) {
        expect(result.success).toBe(false);
        expect(result.error).toContain("Playwright is not installed");
      }
    });

    it("caches the playwright-unavailable check and does not retry", async () => {
      const noPlaywrightAgent = new BrowserAgent();

      // First call — triggers dynamic import attempt
      await noPlaywrightAgent.goto("https://example.com");
      // Second call — should use cached result
      const result = await noPlaywrightAgent.goto("https://example.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Playwright is not installed");
    });
  });

  // ─── Accessibility Tree Formatting ─────────────────────────────────

  describe("accessibility tree formatting", () => {
    it("includes all node attributes in output", async () => {
      mockPage.accessibility.snapshot.mockResolvedValue({
        role: "WebArea",
        name: "Complex Page",
        children: [
          {
            role: "checkbox",
            name: "Accept Terms",
            checked: true,
            disabled: false,
            children: [],
          },
          {
            role: "button",
            name: "Submit",
            pressed: false,
            description: "Submit the form",
            children: [],
          },
          {
            role: "treeitem",
            name: "Folder",
            expanded: true,
            selected: true,
            children: [],
          },
        ],
      });

      const result = await agent.getAccessibilityTree();
      expect(result.success).toBe(true);
      expect(result.data).toContain('checkbox "Accept Terms" checked=true');
      expect(result.data).toContain('button "Submit" description="Submit the form" pressed=false');
      expect(result.data).toContain('treeitem "Folder" expanded=true selected');
    });

    it("handles deeply nested trees", async () => {
      mockPage.accessibility.snapshot.mockResolvedValue({
        role: "WebArea",
        name: "Root",
        children: [
          {
            role: "navigation",
            name: "Nav",
            children: [
              {
                role: "list",
                name: "Menu",
                children: [
                  {
                    role: "listitem",
                    name: "Item 1",
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = await agent.getAccessibilityTree();
      const lines = result.data!.split("\n");
      // Root: 0 indent
      expect(lines[0]).toBe('WebArea "Root"');
      // navigation: 2 spaces
      expect(lines[1]).toBe('  navigation "Nav"');
      // list: 4 spaces
      expect(lines[2]).toBe('    list "Menu"');
      // listitem: 6 spaces
      expect(lines[3]).toBe('      listitem "Item 1"');
    });
  });

  // ─── Vision Fallback ────────────────────────────────────────────────

  describe("vision fallback", () => {
    it("should use vision when selector click fails and router is available", async () => {
      const mockRouter: VisionRouter = {
        call: vi.fn().mockResolvedValue('{"x": 150, "y": 200}'),
      };
      const visionAgent = new BrowserAgent({ visionRouter: mockRouter });
      const visionPage = createMockPage();
      // Selector click fails
      visionPage.click.mockRejectedValue(new Error("Element not found"));
      visionAgent._injectPage(visionPage as Parameters<typeof visionAgent._injectPage>[0]);

      const result = await visionAgent.click("#missing-btn");

      expect(result.success).toBe(true);
      expect(result.data).toBe("#missing-btn");
      // Selector was tried first
      expect(visionPage.click).toHaveBeenCalledWith("#missing-btn", { timeout: 5000 });
      // Screenshot was taken
      expect(visionPage.screenshot).toHaveBeenCalledWith({ type: "png" });
      // Vision router was called with base64 image
      expect(mockRouter.call).toHaveBeenCalledTimes(1);
      expect(mockRouter.call).toHaveBeenCalledWith(expect.stringContaining("#missing-btn"), expect.any(String));
      // Mouse click at the coordinates
      expect(visionPage.mouse.click).toHaveBeenCalledWith(150, 200);
    });

    it("should throw when selector fails and no vision router", async () => {
      // Default agent has no vision router
      mockPage.click.mockRejectedValue(new Error("Element not found"));
      const result = await agent.click("#nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Click failed");
    });

    it("should use selector when click succeeds (no vision needed)", async () => {
      const mockRouter: VisionRouter = {
        call: vi.fn(),
      };
      const visionAgent = new BrowserAgent({ visionRouter: mockRouter });
      const visionPage = createMockPage();
      visionAgent._injectPage(visionPage as Parameters<typeof visionAgent._injectPage>[0]);

      const result = await visionAgent.click("#exists");

      expect(result.success).toBe(true);
      expect(mockRouter.call).not.toHaveBeenCalled();
      expect(visionPage.mouse.click).not.toHaveBeenCalled();
    });

    it("should handle unparseable LLM response gracefully", async () => {
      const mockRouter: VisionRouter = {
        call: vi.fn().mockResolvedValue("I cannot find that element"),
      };
      const visionAgent = new BrowserAgent({ visionRouter: mockRouter });
      const visionPage = createMockPage();
      visionPage.click.mockRejectedValue(new Error("Element not found"));
      visionAgent._injectPage(visionPage as Parameters<typeof visionAgent._injectPage>[0]);

      const result = await visionAgent.click("#ghost");

      expect(result.success).toBe(false);
      expect(result.error).toContain("could not parse LLM response");
    });

    it("should handle LLM returning negative coordinates (element not found)", async () => {
      const mockRouter: VisionRouter = {
        call: vi.fn().mockResolvedValue('{"x": -1, "y": -1}'),
      };
      const visionAgent = new BrowserAgent({ visionRouter: mockRouter });
      const visionPage = createMockPage();
      visionPage.click.mockRejectedValue(new Error("Element not found"));
      visionAgent._injectPage(visionPage as Parameters<typeof visionAgent._injectPage>[0]);

      const result = await visionAgent.click("#invisible");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found in screenshot");
    });

    it("should fall back to vision for type action when selector fails", async () => {
      const mockRouter: VisionRouter = {
        call: vi.fn().mockResolvedValue('{"x": 300, "y": 100}'),
      };
      const visionAgent = new BrowserAgent({ visionRouter: mockRouter });
      const visionPage = createMockPage();
      // First fill call fails (selector), second succeeds (:focus)
      visionPage.fill
        .mockRejectedValueOnce(new Error("Element not found"))
        .mockResolvedValueOnce(undefined);
      visionAgent._injectPage(visionPage as Parameters<typeof visionAgent._injectPage>[0]);

      const result = await visionAgent.type("#missing-input", "hello");

      expect(result.success).toBe(true);
      expect(result.data).toBe("hello");
      // Vision router called
      expect(mockRouter.call).toHaveBeenCalledTimes(1);
      // Mouse click to focus the element
      expect(visionPage.mouse.click).toHaveBeenCalledWith(300, 100);
      // Fill called on :focus
      expect(visionPage.fill).toHaveBeenCalledWith(":focus", "hello", { timeout: 5000 });
    });

    it("should use selector for type when fill succeeds (no vision needed)", async () => {
      const mockRouter: VisionRouter = {
        call: vi.fn(),
      };
      const visionAgent = new BrowserAgent({ visionRouter: mockRouter });
      const visionPage = createMockPage();
      visionAgent._injectPage(visionPage as Parameters<typeof visionAgent._injectPage>[0]);

      const result = await visionAgent.type("#exists", "text");

      expect(result.success).toBe(true);
      expect(mockRouter.call).not.toHaveBeenCalled();
    });

    it("should handle vision router throwing an error", async () => {
      const mockRouter: VisionRouter = {
        call: vi.fn().mockRejectedValue(new Error("LLM service unavailable")),
      };
      const visionAgent = new BrowserAgent({ visionRouter: mockRouter });
      const visionPage = createMockPage();
      visionPage.click.mockRejectedValue(new Error("Element not found"));
      visionAgent._injectPage(visionPage as Parameters<typeof visionAgent._injectPage>[0]);

      const result = await visionAgent.click("#broken");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Click failed");
    });
  });
});
