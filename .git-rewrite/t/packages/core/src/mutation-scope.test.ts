import { describe, expect, it } from "vitest";
import { assessMutationScope, summarizeMutationScope } from "./mutation-scope.js";

describe("mutation scope assessment", () => {
  it("detects claimed files that were never actually written", () => {
    const result = assessMutationScope({
      actualFiles: ["src/actual.ts"],
      claimedFiles: ["src/actual.ts", "src/claimed.ts"],
    });

    expect(result.unverifiedClaims).toEqual(["src/claimed.ts"]);
    expect(result.unexpectedWrites).toEqual([]);
    expect(result.hasDrift).toBe(true);
  });

  it("detects writes outside the declared expected scope", () => {
    const result = assessMutationScope({
      actualFiles: ["src/actual.ts", "src/out-of-scope.ts"],
      expectedFiles: ["src/actual.ts"],
    });

    expect(result.unexpectedWrites).toEqual(["src/out-of-scope.ts"]);
    expect(result.missingExpected).toEqual([]);
    expect(result.hasDrift).toBe(true);
  });

  it("produces a concise summary when drift exists", () => {
    const result = assessMutationScope({
      actualFiles: ["src/actual.ts"],
      claimedFiles: ["src/claimed.ts"],
      expectedFiles: ["src/actual.ts", "src/missing.ts"],
    });

    expect(summarizeMutationScope(result)).toContain("claimed but not written");
    expect(summarizeMutationScope(result)).toContain("expected but missing");
  });
});
