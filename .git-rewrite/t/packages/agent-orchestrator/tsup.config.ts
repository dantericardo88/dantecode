import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false, // Skip DTS generation due to circular dependencies
  external: ["@dantecode/core", "@dantecode/git-engine"],
  target: "es2022",
});
