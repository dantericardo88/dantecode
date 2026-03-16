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
    "@dantecode/skill-adapter",
  ],
});
