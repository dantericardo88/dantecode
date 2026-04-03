import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnNpm } from "../npm-runner.mjs";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function inferArtifactPaths(packageJson) {
  const artifactPaths = new Set();

  if (typeof packageJson.main === "string" && packageJson.main.length > 0) {
    artifactPaths.add(packageJson.main.replace(/^\.\//, ""));
  }

  if (typeof packageJson.types === "string" && packageJson.types.length > 0) {
    artifactPaths.add(packageJson.types.replace(/^\.\//, ""));
  }

  if (typeof packageJson.bin === "string" && packageJson.bin.length > 0) {
    artifactPaths.add(packageJson.bin.replace(/^\.\//, ""));
  } else if (packageJson.bin && typeof packageJson.bin === "object") {
    for (const value of Object.values(packageJson.bin)) {
      if (typeof value === "string" && value.length > 0) {
        artifactPaths.add(value.replace(/^\.\//, ""));
      }
    }
  }

  if (artifactPaths.size === 0 && packageJson.scripts?.build) {
    artifactPaths.add("dist");
  }

  return [...artifactPaths];
}

function collectInternalDependencies(packageJson, knownPackageNames) {
  const dependencyBuckets = [
    packageJson.dependencies ?? {},
    packageJson.optionalDependencies ?? {},
    packageJson.peerDependencies ?? {},
  ];

  return dependencyBuckets
    .flatMap((bucket) => Object.keys(bucket))
    .filter((dependencyName) => knownPackageNames.has(dependencyName));
}

function topologicalSortPackages(packages) {
  const byName = new Map(packages.map((entry) => [entry.packageName, entry]));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  function visit(packageEntry) {
    if (visited.has(packageEntry.packageName)) {
      return;
    }

    if (visiting.has(packageEntry.packageName)) {
      throw new Error(
        `Release catalog contains a package dependency cycle at ${packageEntry.packageName}.`,
      );
    }

    visiting.add(packageEntry.packageName);
    for (const dependencyName of packageEntry.internalDependencies) {
      const dependency = byName.get(dependencyName);
      if (dependency) {
        visit(dependency);
      }
    }
    visiting.delete(packageEntry.packageName);
    visited.add(packageEntry.packageName);
    ordered.push(packageEntry);
  }

  for (const packageEntry of packages) {
    visit(packageEntry);
  }

  return ordered;
}

export function readReleaseMatrix(repoRoot) {
  return readJson(resolve(repoRoot, "release-matrix.json"));
}

export function getReleaseCatalog(repoRoot) {
  const matrix = readReleaseMatrix(repoRoot);
  const workspaceEntries = new Map();
  const packageConfigs = Array.isArray(matrix.packages) ? matrix.packages : [];

  for (const packageConfig of packageConfigs) {
    const packageJsonPath = resolve(repoRoot, packageConfig.workspace, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error(`Release catalog references missing workspace: ${packageConfig.workspace}`);
    }

    const packageJson = readJson(packageJsonPath);
    workspaceEntries.set(packageConfig.workspace, {
      ...packageConfig,
      packageJson,
    });
  }

  const knownPackageNames = new Set(
    [...workspaceEntries.values()].map((entry) =>
      String(entry.packageJson.name ?? entry.packageName),
    ),
  );

  const packages = topologicalSortPackages(
    [...workspaceEntries.values()].map((entry) => {
      const packageName = String(entry.packageJson.name ?? entry.packageName ?? "");
      if (!packageName) {
        throw new Error(`Workspace ${entry.workspace} is missing a package name.`);
      }

      if (entry.packageName && entry.packageName !== packageName) {
        throw new Error(
          `Release catalog packageName mismatch for ${entry.workspace}: ${entry.packageName} != ${packageName}`,
        );
      }

      return {
        ...entry,
        packageName,
        build: {
          required: entry.build?.required !== false,
          artifactPaths:
            Array.isArray(entry.build?.artifactPaths) && entry.build.artifactPaths.length > 0
              ? entry.build.artifactPaths
              : inferArtifactPaths(entry.packageJson),
        },
        internalDependencies: collectInternalDependencies(entry.packageJson, knownPackageNames),
      };
    }),
  );

  return {
    ...matrix,
    packages,
  };
}

export function getCatalogPackageById(repoRoot, packageId) {
  return getReleaseCatalog(repoRoot).packages.find((entry) => entry.id === packageId) ?? null;
}

export function getCatalogPackagesForPurpose(repoRoot, purpose) {
  const packages = getReleaseCatalog(repoRoot).packages;

  return packages.filter((entry) => {
    switch (purpose) {
      case "npmPublish":
        return entry.publish?.npm === true;
      case "publishDryRun":
        return entry.publish?.dryRun === true;
      case "installSmoke":
        return entry.publish?.installSmoke === true;
      case "versionAlignment":
        return entry.releaseChecks?.versionAlignment === true;
      case "dependencyCycles":
        return entry.releaseChecks?.dependencyCycles === true;
      case "exportShape":
        return entry.releaseChecks?.exportShape === true;
      case "docsAndLicense":
        return entry.releaseChecks?.docsAndLicense === true;
      case "shipTarget":
        return entry.shipTarget === true;
      default:
        throw new Error(`Unknown release catalog purpose: ${purpose}`);
    }
  });
}

export function getCiConfig(repoRoot) {
  return getReleaseCatalog(repoRoot).ci ?? {};
}

export function getScoringEvidenceConfig(repoRoot) {
  return getReleaseCatalog(repoRoot).scoringEvidence ?? {};
}

export function ensureBuildArtifacts(repoRoot, packages, options = {}) {
  const built = [];
  const alreadyReady = [];

  for (const packageEntry of packages.filter(Boolean)) {
    if (!packageEntry.build?.required) {
      continue;
    }

    const packageRoot = join(repoRoot, packageEntry.workspace);
    const artifactPaths = packageEntry.build.artifactPaths ?? [];
    const missingArtifacts = artifactPaths.filter(
      (artifactPath) => !existsSync(join(packageRoot, artifactPath)),
    );

    if (artifactPaths.length > 0 && missingArtifacts.length === 0) {
      alreadyReady.push(packageEntry.workspace);
      continue;
    }

    const result = spawnNpm(["run", "build"], packageRoot);
    const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

    if (result.error) {
      throw new Error(
        [`Build failed for ${packageEntry.workspace}`, result.error.message, combinedOutput]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    if (result.status !== 0) {
      throw new Error(
        [`Build failed for ${packageEntry.workspace}`, combinedOutput].filter(Boolean).join("\n\n"),
      );
    }

    built.push(packageEntry.workspace);
  }

  if (packages.some((packageEntry) => !packageEntry)) {
    throw new Error(
      "Release catalog lookup returned an unknown package while ensuring build artifacts.",
    );
  }

  if (options.log !== false && built.length > 0) {
    console.log(`Ensured build artifacts for: ${built.join(", ")}`);
  }

  return { built, alreadyReady };
}
