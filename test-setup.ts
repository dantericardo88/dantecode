/**
 * test-setup.ts
 *
 * Global vitest setup. Runs before each test file.
 * Polyfills Web APIs that are not globally available in Node 18 but are
 * required by transitive dependencies (e.g., cheerio → undici uses File).
 * Sets up git config for tests that use git commands.
 */

import { execFileSync } from "node:child_process";

// Polyfill File global for Node 18 (available globally since Node 20).
// node:buffer exports File since Node 18.13+.
if (typeof globalThis.File === "undefined") {
  const { File } = await import("node:buffer");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).File = File;
}

// Configure git for tests (many tests use git commands and fail without config)
try {
  execFileSync("git", ["config", "--global", "user.name", "DanteCode Test Runner"], { stdio: "ignore" });
  execFileSync("git", ["config", "--global", "user.email", "test@dantecode.dev"], { stdio: "ignore" });
} catch (error) {
  // Git might not be available in some CI environments - that's okay
  console.warn("Warning: Could not configure git (tests using git may fail):", error);
}
