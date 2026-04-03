import { CheerioCrawler } from "crawlee";
import { FetchProvider, WebFetchOptions, WebFetchResult } from "../types.js";

export class CrawleeProvider implements FetchProvider {
  readonly name = "crawlee";

  async fetch(url: string, options: WebFetchOptions): Promise<Partial<WebFetchResult>> {
    const timeoutMs = options.maxWaitMs ?? 15_000;
    const timeoutSecs = Math.max(5, Math.ceil(timeoutMs / 1000));

    let capturedResult: Partial<WebFetchResult> | null = null;
    let capturedError: Error | null = null;

    const crawler = new CheerioCrawler({
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 0,
      requestHandlerTimeoutSecs: timeoutSecs,
      async requestHandler({ request, response, body, $ }) {
        const finalUrl = request.loadedUrl ?? request.url;
        const html =
          typeof body === "string"
            ? body
            : Buffer.isBuffer(body)
              ? body.toString("utf8")
              : $.html();
        const title = $("title").first().text().trim() || undefined;

        capturedResult = {
          url: finalUrl,
          markdown: html,
          metadata: {
            provider: "crawlee",
            finalUrl,
            status: response?.statusCode ?? 200,
            renderMode: "http",
            cacheHit: false,
            preActionsApplied: false,
            extractedAt: new Date().toISOString(),
            title,
          },
          sources: [{ url: finalUrl, title }],
        };
      },
      failedRequestHandler({ request, error }) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "unknown error";
        capturedError = new Error(`Crawlee failed for ${request.url}: ${errorMessage}`);
      },
    });

    await crawler.run([url]);

    if (capturedError) {
      throw capturedError;
    }

    if (!capturedResult) {
      throw new Error(`Crawlee did not return content for ${url}`);
    }

    return capturedResult;
  }
}
