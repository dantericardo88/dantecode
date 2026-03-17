import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
  const matrixPath = resolve(process.cwd(), "release-matrix.json");
  const matrix = JSON.parse(await readFile(matrixPath, "utf-8"));

  console.log("DanteCode Release Matrix");
  console.log("");
  console.log("Surfaces:");
  for (const surface of matrix.surfaces) {
    console.log(
      `- ${surface.label}: ${surface.releaseRing} (${surface.role}, ship target: ${surface.shipTarget ? "yes" : "no"})`,
    );
  }

  console.log("");
  console.log("Providers:");
  for (const provider of matrix.providers) {
    console.log(
      `- ${provider.label}: ${provider.supportTier} (onboarding/UI: ${provider.uiSupported ? "yes" : "no"})`,
    );
  }

  console.log("");
  console.log(
    `Coverage gate: ${matrix.coverageGate.scopedPackages.join(", ")} | statements ${matrix.coverageGate.thresholds.statements}% | functions ${matrix.coverageGate.thresholds.functions}% | lines ${matrix.coverageGate.thresholds.lines}%`,
  );
}

void main();
