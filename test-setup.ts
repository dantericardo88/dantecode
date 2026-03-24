/**
 * test-setup.ts
 *
 * Global vitest setup. Runs before each test file.
 * Polyfills Web APIs that are not globally available in Node 18 but are
 * required by transitive dependencies (e.g., cheerio → undici uses File).
 */

// Polyfill File global for Node 18 (available globally since Node 20).
// node:buffer exports File since Node 18.13+.
if (typeof globalThis.File === "undefined") {
  const { File } = await import("node:buffer");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).File = File;
}
