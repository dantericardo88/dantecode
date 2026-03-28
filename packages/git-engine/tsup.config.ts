import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false, // Skip DTS generation due to circular dependency with @dantecode/core
  // Mark core as external to prevent circular resolution during build
  external: ["@dantecode/core"],
  target: "es2022",
});
