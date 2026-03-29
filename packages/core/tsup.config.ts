import { defineConfig} from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true, // Re-enabled - circular dependency broken by moving automation to separate package
  splitting: true, // Enable code splitting for faster incremental builds
  treeshake: true, // Remove unused exports
  external: ["@dantecode/git-engine"],
  target: "es2022",
});
