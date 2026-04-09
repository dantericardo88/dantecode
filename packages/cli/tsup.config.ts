import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/slash-commands.ts", "src/commands/benchmark-cli.ts"],
  format: ["esm"],
  dts: false, // CLI binary doesn't need .d.ts for end users
  splitting: true, // Enable code splitting for faster startup - commands loaded on demand
  treeshake: true, // Remove unused code
  minify: false, // Keep readable for debugging (minify in production build)
  banner: {
    js: "#!/usr/bin/env node",
  },
  noExternal: [
    "@dantecode/config-types",
    "@dantecode/core",
    "@dantecode/dante-gaslight",
    "@dantecode/dante-sandbox",
    "@dantecode/dante-skillbook",
    "@dantecode/danteforge",
    "@dantecode/debug-trail",
    "@dantecode/git-engine",
    "@dantecode/memory-engine",
    "@dantecode/runtime-spine",
    "@dantecode/sandbox",
    "@dantecode/skill-adapter",
    "@dantecode/ux-polish",
    "@dantecode/web-extractor",
    "@dantecode/web-research",
  ],
  external: [
    "ai",
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@modelcontextprotocol/sdk",
    "@octokit/rest",
    "cheerio",
    "crawlee",
    "dockerode",
    "node-fetch",
    "sql.js",
    "yaml",
    "zod",
    // tree-sitter has native bindings that can't be bundled in ESM
    "tree-sitter",
    "tree-sitter-typescript",
    "tree-sitter-python",
    "tree-sitter-javascript",
    "tree-sitter-go",
    "tree-sitter-rust",
  ],
});
