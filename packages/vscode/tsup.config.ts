import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  dts: false,
  external: ["vscode"],
  noExternal: [/^(?!vscode$).*/],
  esbuildOptions(options) {
    options.banner = {
      js: "const __importMetaUrl = typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : '';"
    };
    options.define = {
      ...options.define,
      "import.meta.url": "__importMetaUrl",
    };
  },
});
