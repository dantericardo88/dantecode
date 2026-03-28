import { defineConfig} from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false, // Skip DTS generation due to circular dependency with @dantecode/git-engine
  // Mark own package as external to prevent circular resolution during build
  external: ["@dantecode/core", "@dantecode/git-engine"],
  target: "es2022",
});
