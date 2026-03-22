import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false, // CLI binary doesn't need .d.ts for end users
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
    "dockerode",
    "node-fetch",
    "sql.js",
    "yaml",
    "zod",
  ],
});
