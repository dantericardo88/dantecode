import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DiffHunk } from "@dantecode/git-engine";

const { mockExecuteCommand } = vi.hoisted(() => ({
  mockExecuteCommand: vi.fn(),
}));

vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath, toString: () => fsPath }),
  },
  commands: {
    executeCommand: mockExecuteCommand,
  },
}));

import { DiffReviewProvider } from "./diff-review-provider.js";

function makeUri(fsPath: string) {
  return { fsPath, toString: () => fsPath } as unknown as import("vscode").Uri;
}

describe("DiffReviewProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a review with normalized relative hunk paths", async () => {
    const sampleHunk: DiffHunk = {
      file: "before.ts",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      content: "@@ -1 +1 @@\n-old\n+new",
    };

    const provider = new DiffReviewProvider("/workspace", {
      generateDiff: vi.fn().mockResolvedValue("diff --git a/before.ts b/after.ts"),
      parseHunks: vi.fn().mockReturnValue([sampleHunk]),
      writeFile: vi.fn().mockResolvedValue(undefined),
    });

    const review = await provider.createReview(
      "/workspace/src/app.ts",
      "const oldValue = 1;\n",
      "const newValue = 2;\n",
    );

    expect(review.relativePath).toBe("src/app.ts");
    expect(review.hunks[0]?.file).toBe("src/app.ts");
    expect(review.beforeUri.fsPath).toContain("before.ts");
    expect(review.afterUri.fsPath).toBe("/workspace/src/app.ts");
  });

  it("applies only the selected hunks over the old content baseline", async () => {
    const applyHunk = vi.fn();
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const provider = new DiffReviewProvider("/workspace", {
      generateDiff: vi.fn().mockResolvedValue(""),
      parseHunks: vi.fn().mockReturnValue([]),
      applyHunk,
      writeFile,
    });

    const review = {
      filePath: "/workspace/src/app.ts",
      relativePath: "src/app.ts",
      oldContent: "old",
      newContent: "new",
      beforeUri: makeUri("/tmp/before.ts"),
      afterUri: makeUri("/workspace/src/app.ts"),
      hunks: [
        {
          file: "src/app.ts",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          content: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          file: "src/app.ts",
          oldStart: 5,
          oldLines: 1,
          newStart: 5,
          newLines: 1,
          content: "@@ -5 +5 @@\n-foo\n+bar",
        },
      ],
    };

    await provider.applySelectedHunks(review, [1]);

    expect(writeFile).toHaveBeenCalledWith("/workspace/src/app.ts", "old", "utf-8");
    expect(applyHunk).toHaveBeenCalledTimes(1);
    expect(applyHunk).toHaveBeenCalledWith(review.hunks[1], "/workspace");
  });

  it("rejects selected hunks by applying the complement set", async () => {
    const provider = new DiffReviewProvider("/workspace", {
      generateDiff: vi.fn().mockResolvedValue(""),
      parseHunks: vi.fn().mockReturnValue([]),
      writeFile: vi.fn().mockResolvedValue(undefined),
    });
    const applySelectedHunks = vi
      .spyOn(provider, "applySelectedHunks")
      .mockResolvedValue(undefined);

    const review = {
      filePath: "/workspace/src/app.ts",
      relativePath: "src/app.ts",
      oldContent: "old",
      newContent: "new",
      beforeUri: makeUri("/tmp/before.ts"),
      afterUri: makeUri("/workspace/src/app.ts"),
      hunks: [
        {
          file: "src/app.ts",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          content: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          file: "src/app.ts",
          oldStart: 5,
          oldLines: 1,
          newStart: 5,
          newLines: 1,
          content: "@@ -5 +5 @@\n-foo\n+bar",
        },
      ],
    };

    await provider.rejectSelectedHunks(review, [0]);

    expect(applySelectedHunks).toHaveBeenLastCalledWith(review, [1]);
  });

  it("opens a side-by-side review diff in VS Code", async () => {
    const provider = new DiffReviewProvider("/workspace", {
      generateDiff: vi.fn().mockResolvedValue(""),
      parseHunks: vi.fn().mockReturnValue([]),
      writeFile: vi.fn().mockResolvedValue(undefined),
    });

    await provider.openReview({
      filePath: "/workspace/src/app.ts",
      relativePath: "src/app.ts",
      oldContent: "old",
      newContent: "new",
      beforeUri: makeUri("/tmp/before.ts"),
      afterUri: makeUri("/workspace/src/app.ts"),
      hunks: [],
    });

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.objectContaining({ fsPath: "/tmp/before.ts" }),
      expect.objectContaining({ fsPath: "/workspace/src/app.ts" }),
      "DanteCode Review: app.ts",
      { preview: true, preserveFocus: true },
    );
  });
});
