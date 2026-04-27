import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  dts: true,
  external: ["vscode"],
  noExternal: [
    "@dantecode/config-types",
    "@dantecode/core",
    "@dantecode/danteforge",
    "@dantecode/git-engine",
    "@dantecode/skill-adapter",
  ],
  onSuccess: "node scripts/deploy-local.mjs",
});
