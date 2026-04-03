import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebExtractor } from "./web-extractor.js";
import type { FetchProvider, RenderMode, WebFetchResult } from "./types.js";
import * as webExtractorExports from "./index.js";

function makeTempProjectRoot() {
  return mkdtempSync(join(tmpdir(), "dantecode-web-extractor-test-"));
}

function makeHtml(title: string, bodyText: string) {
  return `<html><head><title>${title}</title></head><body>${bodyText}</body></html>`;
}

function makeProvider(name: string, html: string): FetchProvider {
  const renderMode: RenderMode = name === "stagehand" ? "browser" : "http";

  return {
    name,
    fetch: vi.fn(
      async (url: string): Promise<Partial<WebFetchResult>> => ({
        url,
        markdown: html,
        metadata: {
          provider: name,
          finalUrl: url,
          status: 200,
          renderMode,
          cacheHit: false,
          extractedAt: new Date().toISOString(),
          preActionsApplied: name === "stagehand",
        },
        sources: [{ url, title: name }],
      }),
    ),
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("WebExtractor", () => {
  it("registers GA default providers", () => {
    const projectRoot = makeTempProjectRoot();
    tempDirs.push(projectRoot);
    const extractor = new WebExtractor({ projectRoot });

    expect(extractor.listProviders()).toEqual(["basic-fetch", "crawlee"]);
  });

  it("uses basic-fetch for standard HTTP requests", async () => {
    const projectRoot = makeTempProjectRoot();
    tempDirs.push(projectRoot);
    const extractor = new WebExtractor({ projectRoot, enableCrawlee: false });
    const basicFetch = makeProvider("basic-fetch", makeHtml("Example", "A".repeat(250)));

    extractor.registerProvider(basicFetch);

    const result = await extractor.fetch("https://example.com", { useCache: false });

    expect(basicFetch.fetch).toHaveBeenCalledOnce();
    expect(result.metadata.provider).toBe("basic-fetch");
    expect(result.metadata.requestedRenderMode).toBe("http");
  });

  it("uses stagehand for browser requests when available", async () => {
    const projectRoot = makeTempProjectRoot();
    tempDirs.push(projectRoot);
    const extractor = new WebExtractor({ projectRoot, enableCrawlee: false });
    const basicFetch = makeProvider("basic-fetch", makeHtml("Basic", "A".repeat(250)));
    const stagehand = makeProvider("stagehand", makeHtml("Browser", "B".repeat(250)));

    extractor.registerProvider(basicFetch);
    extractor.registerProvider(stagehand);

    const result = await extractor.fetch("https://x.com/example", { useCache: false });

    expect(stagehand.fetch).toHaveBeenCalledOnce();
    expect(basicFetch.fetch).not.toHaveBeenCalled();
    expect(result.metadata.provider).toBe("stagehand");
    expect(result.metadata.requestedRenderMode).toBe("browser");
  });

  it("falls back to crawlee with a warning when preActions need a browser", async () => {
    const projectRoot = makeTempProjectRoot();
    tempDirs.push(projectRoot);
    const extractor = new WebExtractor({ projectRoot });
    const crawlee = makeProvider("crawlee", makeHtml("Fallback", "C".repeat(250)));

    extractor.registerProvider(crawlee);

    const result = await extractor.fetch("https://example.com/app", {
      useCache: false,
      preActions: [{ type: "click", selector: "#submit" }],
    });

    expect(crawlee.fetch).toHaveBeenCalledOnce();
    expect(result.metadata.provider).toBe("crawlee");
    expect(result.metadata.requestedRenderMode).toBe("browser-actions");
    expect(result.verificationWarnings).toContain(
      "Browser actions were requested, but Stagehand is unavailable. Crawlee fetched HTML without executing preActions.",
    );
  });

  it("surfaces verification warnings from the verification bridge", async () => {
    const projectRoot = makeTempProjectRoot();
    tempDirs.push(projectRoot);
    const extractor = new WebExtractor({ projectRoot, enableCrawlee: false });
    const basicFetch = makeProvider("basic-fetch", "<html><body>short</body></html>");

    extractor.registerProvider(basicFetch);

    const result = await extractor.fetch("https://example.com", { useCache: false });

    expect(result.verificationWarnings).toContain("Verification depth: Content length: 5 chars");
    expect(result.verificationWarnings).toContain("Verification specificity: Missing title");
  });

  it("exports CrawleeProvider from the package entrypoint", () => {
    expect(webExtractorExports.WebExtractor).toBeDefined();
    expect(webExtractorExports.CrawleeProvider).toBeDefined();
  });
});
