#!/usr/bin/env node
// ============================================================================
// @dantecode/mcp — Standalone MCP Server CLI
// Run with: npx @dantecode/mcp [projectRoot]
// Starts the DanteCode MCP server on stdio transport so external agents
// (Claude Code, Cursor, etc.) can connect and use DanteForge quality gates.
// ============================================================================

import { startMCPServerStdio } from "./server.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.error("Usage: dantecode-mcp [projectRoot]");
  console.error("");
  console.error("Starts the DanteCode MCP server on stdio transport.");
  console.error("If projectRoot is provided, it is set as the working directory.");
  process.exit(0);
}

const projectRoot = args[0];
if (projectRoot) {
  process.chdir(projectRoot);
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

startMCPServerStdio().catch((err: unknown) => {
  console.error("Failed to start DanteCode MCP server:", err);
  process.exit(1);
});
