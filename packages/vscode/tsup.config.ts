import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  dts: false, // Skip DTS - extension doesn't need type declarations
  external: ["vscode"],
  noExternal: [
    "@dantecode/config-types",
    "@dantecode/core",
    "@dantecode/danteforge",
    "@dantecode/git-engine",
    "@dantecode/skill-adapter",
    "@dantecode/ux-polish",
  ],
});
