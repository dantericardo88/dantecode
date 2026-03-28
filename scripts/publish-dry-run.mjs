import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";
import { ensureBuildArtifacts, getCatalogPackagesForPurpose } from "./release/catalog.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const publishablePackages = getCatalogPackagesForPurpose(repoRoot, "publishDryRun");

const packDestination = mkdtempSync(join(tmpdir(), "dantecode-pack-dry-run-"));

try {
  ensureBuildArtifacts(repoRoot, publishablePackages);

  for (const packageEntry of publishablePackages) {
    const packageDir = join(repoRoot, packageEntry.workspace);
    const result = spawnNpm(["pack", "--json", "--pack-destination", packDestination], packageDir);

    const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(`\n=== ${packageEntry.workspace} ===\n`);
    process.stdout.write(combinedOutput);

    if (result.error) {
      throw new Error(`npm pack failed for ${packageEntry.workspace}: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(`npm pack failed for ${packageEntry.workspace}`);
    }

    let manifest;
    try {
      manifest = JSON.parse(result.stdout ?? "[]");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `npm pack did not return valid JSON for ${packageEntry.workspace}: ${message}`,
      );
    }

    const packedFile = manifest[0]?.filename;
    if (!packedFile) {
      throw new Error(`npm pack did not report an output tarball for ${packageEntry.workspace}`);
    }

    const tarballPath = join(packDestination, packedFile);
    if (!existsSync(tarballPath)) {
      throw new Error(
        `npm pack reported ${packedFile}, but it was not created for ${packageEntry.workspace}`,
      );
    }

    const unexpectedWarnings = combinedOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("npm warn "));

    if (unexpectedWarnings.length > 0) {
      throw new Error(
        `npm pack emitted unexpected warnings for ${packageEntry.workspace}:\n${unexpectedWarnings.join("\n")}`,
      );
    }
  }
} finally {
  rmSync(packDestination, { recursive: true, force: true });
}

console.log("\nPublish pack checks passed.");
