// Copies the built extension.js to all installed dantecode VS Code extension directories.
// Runs automatically via tsup onSuccess after every build.
import { copyFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const distSrc = fileURLToPath(new URL("../dist/extension.js", import.meta.url));

if (!existsSync(distSrc)) {
  console.log("[deploy-local] dist/extension.js not found — skipping");
  process.exit(0);
}

const extensionsDir = join(homedir(), ".vscode", "extensions");
if (!existsSync(extensionsDir)) {
  console.log("[deploy-local] ~/.vscode/extensions not found — skipping");
  process.exit(0);
}

const installed = readdirSync(extensionsDir)
  .filter((d) => d.startsWith("dantecode.dantecode-"))
  .map((d) => join(extensionsDir, d, "dist", "extension.js"))
  .filter((p) => existsSync(p));

if (installed.length === 0) {
  console.log("[deploy-local] No installed dantecode extension found — skipping");
  process.exit(0);
}

for (const dest of installed) {
  copyFileSync(distSrc, dest);
  console.log("[deploy-local] ✅ Deployed →", dest);
}
