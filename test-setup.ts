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
  const currentName = execFileSync("git", ["config", "--global", "--get", "user.name"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  }).trim();
  const currentEmail = execFileSync("git", ["config", "--global", "--get", "user.email"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  }).trim();

  if (!currentName) {
    execFileSync("git", ["config", "--global", "user.name", "DanteCode Test Runner"], {
      stdio: "ignore",
    });
  }
  if (!currentEmail) {
    execFileSync("git", ["config", "--global", "user.email", "test@dantecode.dev"], {
      stdio: "ignore",
    });
  }
} catch (error) {
  // Fall back to per-process identity when the global config is unavailable or locked.
  process.env.GIT_AUTHOR_NAME ??= "DanteCode Test Runner";
  process.env.GIT_AUTHOR_EMAIL ??= "test@dantecode.dev";
  process.env.GIT_COMMITTER_NAME ??= process.env.GIT_AUTHOR_NAME;
  process.env.GIT_COMMITTER_EMAIL ??= process.env.GIT_AUTHOR_EMAIL;

  const message = error instanceof Error ? error.message : String(error);
  if (/not a git command|not recognized|enoent/i.test(message)) {
    console.warn("Warning: Git is unavailable in test setup; git-backed tests may fail.");
  }
}
