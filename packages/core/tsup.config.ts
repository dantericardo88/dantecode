import { defineConfig} from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true, // Re-enabled - circular dependency broken by moving automation to separate package
  external: ["@dantecode/git-engine"],
  target: "es2022",
});
