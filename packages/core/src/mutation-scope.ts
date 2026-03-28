export interface MutationScopeInput {
  actualFiles: string[];
  claimedFiles?: string[];
  expectedFiles?: string[];
}

export interface MutationScopeAssessment {
  actualFiles: string[];
  claimedFiles: string[];
  expectedFiles: string[];
  unverifiedClaims: string[];
  unexpectedWrites: string[];
  missingExpected: string[];
  hasDrift: boolean;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function uniqueNormalized(paths: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawPath of paths ?? []) {
    const normalized = normalizePath(rawPath);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function assessMutationScope(input: MutationScopeInput): MutationScopeAssessment {
  const actualFiles = uniqueNormalized(input.actualFiles);
  const claimedFiles = uniqueNormalized(input.claimedFiles);
  const expectedFiles = uniqueNormalized(input.expectedFiles);

  const actualSet = new Set(actualFiles);
  const expectedSet = new Set(expectedFiles);

  const unverifiedClaims = claimedFiles.filter((filePath) => !actualSet.has(filePath));
  const unexpectedWrites =
    expectedFiles.length > 0
      ? actualFiles.filter((filePath) => !expectedSet.has(filePath))
      : [];
  const missingExpected =
    expectedFiles.length > 0
      ? expectedFiles.filter((filePath) => !actualSet.has(filePath))
      : [];

  return {
    actualFiles,
    claimedFiles,
    expectedFiles,
    unverifiedClaims,
    unexpectedWrites,
    missingExpected,
    hasDrift:
      unverifiedClaims.length > 0 ||
      unexpectedWrites.length > 0 ||
      missingExpected.length > 0,
  };
}

export function summarizeMutationScope(result: MutationScopeAssessment): string | null {
  const parts: string[] = [];

  if (result.unverifiedClaims.length > 0) {
    parts.push(
      `${result.unverifiedClaims.length} claimed but not written (${result.unverifiedClaims.join(", ")})`,
    );
  }

  if (result.unexpectedWrites.length > 0) {
    parts.push(
      `${result.unexpectedWrites.length} written outside expected scope (${result.unexpectedWrites.join(", ")})`,
    );
  }

  if (result.missingExpected.length > 0) {
    parts.push(
      `${result.missingExpected.length} expected but missing (${result.missingExpected.join(", ")})`,
    );
  }

  return parts.length > 0 ? parts.join("; ") : null;
}
