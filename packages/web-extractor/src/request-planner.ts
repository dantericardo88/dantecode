import { RenderMode, WebFetchOptions } from "./types.js";

export class RequestPlanner {
  plan(url: string, options: WebFetchOptions): { renderMode: RenderMode } {
    // 1. Explicitly forced browser
    if (options.forceBrowser) {
      return { renderMode: "browser" };
    }

    // 2. Heuristic for JS-heavy sites (SPAs)
    if (this.isJsHeavy(url)) {
      return { renderMode: "browser" };
    }

    // 3. Complex instructions or schema might benefit from browser observation
    if (options.instructions || options.schema) {
      // For Phase 1, we still try HTTP first if not forced
      // In Phase 2, we might default to browser for complex extractions
      return { renderMode: "http" };
    }

    return { renderMode: "http" };
  }

  private isJsHeavy(url: string): boolean {
    const jsHeavyDomains = [
      "twitter.com",
      "x.com",
      "instagram.com",
      "facebook.com",
      "reactjs.org",
      "vuejs.org",
      "nextjs.org",
    ];
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return jsHeavyDomains.some((domain) => hostname.includes(domain));
    } catch {
      return false;
    }
  }
}
