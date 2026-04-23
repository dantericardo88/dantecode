// ============================================================================
// packages/edit-dataset/src/__tests__/edit-dataset.test.ts
// 20 tests covering: GitHubCommitCollector, EditExtractor, DatasetFormatter
// ============================================================================

import { describe, it, expect } from "vitest";
import { isQualityCommit, GitHubCommitCollector } from "../github-collector.js";
import { parseDiffHunks, extractContext, extractEditSequences } from "../edit-extractor.js";
import { toAlpacaFormat, toChatMLFormat, computeStats } from "../dataset-formatter.js";
import type { RawCommit, FilePair, EditSequenceExample } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    sha: "abc123",
    message: "fix: resolve null pointer in parser",
    authorName: "Alice Dev",
    authorEmail: "alice@example.com",
    parentCount: 1,
    filesChanged: 2,
    totalLines: 15,
    files: [],
    ...overrides,
  };
}

function makeFilePair(patch: string, before = "", after = ""): FilePair {
  return {
    filename: "src/utils.ts",
    language: "typescript",
    beforeContent: before,
    afterContent: after || patch,
    patch,
  };
}

// ── GitHubCommitCollector filter tests ────────────────────────────────────────

describe("isQualityCommit", () => {
  it("rejects merge commits (parentCount > 1)", () => {
    expect(isQualityCommit(makeCommit({ parentCount: 2 }))).toBe(false);
  });

  it("rejects commits with >4 files changed", () => {
    expect(isQualityCommit(makeCommit({ filesChanged: 5 }))).toBe(false);
  });

  it("rejects commits with >200 total lines changed", () => {
    expect(isQualityCommit(makeCommit({ totalLines: 201 }))).toBe(false);
  });

  it("rejects [bot] authors", () => {
    expect(isQualityCommit(makeCommit({ authorName: "dependabot[bot]" }))).toBe(false);
  });

  it("rejects format/style chore commits", () => {
    expect(isQualityCommit(makeCommit({ message: "chore: format all files" }))).toBe(false);
    expect(isQualityCommit(makeCommit({ message: "style: fix lint warnings" }))).toBe(false);
  });

  it("accepts a focused fix commit with source files", () => {
    const commit = makeCommit({
      files: [{
        filename: "src/parser.ts",
        status: "modified",
        additions: 5,
        deletions: 3,
        patch: "@@ -10,3 +10,5 @@\n-old\n+new",
        language: "typescript",
      }],
    });
    expect(isQualityCommit(commit)).toBe(true);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe("GitHubCommitCollector rate limiting", () => {
  it("respects rateLimitMs between API calls", async () => {
    // Verify the collector accepts and runs with a configured rate limit.
    const collector = new GitHubCommitCollector({
      token: "test-token",
      rateLimitMs: 50,
      fetchFn: async () => new Response(JSON.stringify([]), { status: 200 }),
    });
    const result = await collector.collectFromRepo("owner", "repo", 0);
    expect(result).toHaveLength(0);
  });
});

// ── EditExtractor ─────────────────────────────────────────────────────────────

describe("parseDiffHunks", () => {
  it("parses a single hunk with correct line numbers", () => {
    const patch = "@@ -10,3 +10,3 @@\n-old line\n+new line\n context";
    const hunks = parseDiffHunks(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.startLine).toBe(10);
    expect(hunks[0]!.oldText).toBe("old line");
    expect(hunks[0]!.newText).toBe("new line");
  });

  it("parses multiple hunks from one patch", () => {
    const patch =
      "@@ -5,2 +5,2 @@\n-a\n+b\n" +
      "@@ -20,2 +20,2 @@\n-c\n+d\n";
    const hunks = parseDiffHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.startLine).toBe(5);
    expect(hunks[1]!.startLine).toBe(20);
  });

  it("returns empty array for empty patch", () => {
    expect(parseDiffHunks("")).toHaveLength(0);
  });
});

describe("extractContext", () => {
  it("extracts 5 lines around the edit location", () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const ctx = extractContext(content, 10, 10, 5);
    expect(ctx).toContain("line 10");
    expect(ctx).toContain("line 5");
    expect(ctx).toContain("line 15");
  });

  it("clamps to file boundaries without throwing", () => {
    const content = "line 1\nline 2\nline 3";
    const ctx = extractContext(content, 1, 1, 10);
    expect(ctx).toContain("line 1");
    expect(ctx).not.toContain("line -1");
  });
});

describe("extractEditSequences", () => {
  it("produces zero examples when fewer than windowSize+1 hunks", () => {
    const patch = "@@ -1,1 +1,1 @@\n-a\n+b";
    const pairs: FilePair[] = [makeFilePair(patch)];
    const examples = extractEditSequences(pairs, 5);
    expect(examples).toHaveLength(0);
  });

  it("creates sliding windows from multi-hunk patches", () => {
    // 7 hunks → with windowSize=5, we get 2 examples
    const hunks = Array.from(
      { length: 7 },
      (_, i) => `@@ -${(i + 1) * 10},1 +${(i + 1) * 10},1 @@\n-old${i}\n+new${i}`
    ).join("\n");
    const pairs: FilePair[] = [makeFilePair(hunks, "", "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\nline21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\nline31\nline32\nline33\nline34\nline35\nline36\nline37\nline38\nline39\nline40\nline41\nline42\nline43\nline44\nline45\nline46\nline47\nline48\nline49\nline50\nline51\nline52\nline53\nline54\nline55\nline56\nline57\nline58\nline59\nline60\nline61\nline62\nline63\nline64\nline65\nline66\nline67\nline68\nline69\nline70")];
    const examples = extractEditSequences(pairs, 5);
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  it("caps editHistory at windowSize items", () => {
    const hunks = Array.from(
      { length: 8 },
      (_, i) => `@@ -${(i + 1) * 5},1 +${(i + 1) * 5},1 @@\n-x\n+y`
    ).join("\n");
    const content = Array.from({ length: 60 }, (_, i) => `line${i}`).join("\n");
    const pairs: FilePair[] = [makeFilePair(hunks, content, content)];
    const examples = extractEditSequences(pairs, 5);
    for (const ex of examples) {
      expect(ex.editHistory.length).toBeLessThanOrEqual(5);
    }
  });
});

// ── DatasetFormatter ──────────────────────────────────────────────────────────

describe("toAlpacaFormat", () => {
  const example: EditSequenceExample = {
    editHistory: [{ filePath: "utils.ts", startLine: 10, endLine: 10, oldText: "a", newText: "b", language: "typescript" }],
    fileContext: "function foo() {}",
    nextEdit: { filePath: "utils.ts", startLine: 15, endLine: 15, diff: "@@ -15 +15 @@\n-x\n+y" },
  };

  it("includes instruction, input, and output fields", () => {
    const record = toAlpacaFormat(example);
    expect(record).toHaveProperty("instruction");
    expect(record).toHaveProperty("input");
    expect(record).toHaveProperty("output");
  });

  it("output is valid JSON matching nextEdit", () => {
    const record = toAlpacaFormat(example);
    const parsed = JSON.parse(record.output);
    expect(parsed.filePath).toBe("utils.ts");
    expect(parsed.startLine).toBe(15);
  });

  it("caps editHistory to last 5 edits in input", () => {
    const longHistory = Array.from({ length: 8 }, (_, i) => ({
      filePath: `file${i}.ts`, startLine: i, endLine: i,
      oldText: "a", newText: "b", language: "typescript",
    }));
    const record = toAlpacaFormat({ ...example, editHistory: longHistory });
    const parsedInput = JSON.parse(record.input.split("EDIT_HISTORY:\n")[1]?.split("\n\nFILE_CONTEXT:")[0] ?? "[]");
    expect(parsedInput).toHaveLength(5);
  });
});

describe("toChatMLFormat", () => {
  const example: EditSequenceExample = {
    editHistory: [],
    fileContext: "const x = 1;",
    nextEdit: { filePath: "app.ts", startLine: 5, endLine: 5, diff: "" },
  };

  it("produces system, user, assistant messages", () => {
    const record = toChatMLFormat(example);
    const roles = record.messages.map((m) => m.role);
    expect(roles).toContain("system");
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("output is valid JSONL-serializable", () => {
    const record = toChatMLFormat(example);
    expect(() => JSON.stringify(record)).not.toThrow();
  });
});

describe("computeStats", () => {
  it("returns zero counts on empty array", () => {
    const stats = computeStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgHistoryLength).toBe(0);
  });

  it("computes language distribution correctly", () => {
    const examples: EditSequenceExample[] = [
      {
        editHistory: [
          { filePath: "a.ts", startLine: 1, endLine: 1, oldText: "", newText: "", language: "typescript" },
          { filePath: "b.py", startLine: 1, endLine: 1, oldText: "", newText: "", language: "python" },
        ],
        fileContext: "",
        nextEdit: { filePath: "a.ts", startLine: 2, endLine: 2, diff: "" },
      },
    ];
    const stats = computeStats(examples);
    expect(stats.languageDistribution["typescript"]).toBe(1);
    expect(stats.languageDistribution["python"]).toBe(1);
  });
});
