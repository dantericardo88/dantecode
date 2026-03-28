import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true, // Re-enabled - circular dependency broken
  external: ["@dantecode/core"],
  target: "es2022",
});
