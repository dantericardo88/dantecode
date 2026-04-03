import * as vscode from "vscode";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile as writeFileFs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { applyDiff, parseDiffHunks, type DiffHunk } from "@dantecode/git-engine";

const execFileAsync = promisify(execFileCallback);

export interface PendingDiffReview {
  filePath: string;
  relativePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
  beforeUri: vscode.Uri;
  afterUri: vscode.Uri;
}

export interface DiffReviewPickItem extends vscode.QuickPickItem {
  index: number;
}

interface DiffReviewProviderOptions {
  generateDiff?: (beforePath: string, afterPath: string) => Promise<string>;
  parseHunks?: (diffOutput: string) => DiffHunk[];
  applyHunk?: (hunk: DiffHunk, projectRoot: string) => void;
  writeFile?: (filePath: string, content: string, encoding: BufferEncoding) => Promise<void>;
}

export class DiffReviewProvider {
  private readonly projectRoot: string;
  private readonly generateDiff: (beforePath: string, afterPath: string) => Promise<string>;
  private readonly parseHunks: (diffOutput: string) => DiffHunk[];
  private readonly applyHunk: (hunk: DiffHunk, projectRoot: string) => void;
  private readonly writeFile: (
    filePath: string,
    content: string,
    encoding: BufferEncoding,
  ) => Promise<void>;

  constructor(projectRoot: string, options: DiffReviewProviderOptions = {}) {
    this.projectRoot = projectRoot;
    this.generateDiff = options.generateDiff ?? defaultGenerateDiff;
    this.parseHunks = options.parseHunks ?? parseDiffHunks;
    this.applyHunk = options.applyHunk ?? applyDiff;
    this.writeFile = options.writeFile ?? writeFileFs;
  }

  async createReview(
    filePath: string,
    oldContent: string,
    newContent: string,
  ): Promise<PendingDiffReview> {
    const extension = extname(filePath) || ".txt";
    const tempDir = await mkdtemp(join(tmpdir(), "dantecode-diff-review-"));
    const beforePath = join(tempDir, `before${extension}`);
    const afterPath = join(tempDir, `after${extension}`);

    await this.writeFile(beforePath, oldContent, "utf-8");
    await this.writeFile(afterPath, newContent, "utf-8");

    const diffOutput = await this.generateDiff(beforePath, afterPath);
    const relativePath = normalizeRelativePath(this.projectRoot, filePath);
    const hunks = this.parseHunks(diffOutput).map((hunk) => ({
      ...hunk,
      file: relativePath,
    }));

    return {
      filePath,
      relativePath,
      oldContent,
      newContent,
      hunks,
      beforeUri: vscode.Uri.file(beforePath),
      afterUri: vscode.Uri.file(filePath),
    };
  }

  async openReview(review: PendingDiffReview): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.diff",
      review.beforeUri,
      review.afterUri,
      `DanteCode Review: ${basename(review.filePath)}`,
      { preview: true, preserveFocus: true },
    );
  }

  buildQuickPickItems(review: PendingDiffReview): DiffReviewPickItem[] {
    return review.hunks.map((hunk, index) => ({
      index,
      label: `Hunk ${index + 1}`,
      description: `${review.relativePath}:${hunk.newStart}`,
      detail: summarizeHunk(hunk),
    }));
  }

  async applySelectedHunks(review: PendingDiffReview, selectedIndexes: number[]): Promise<void> {
    const normalizedIndexes = normalizeIndexes(selectedIndexes, review.hunks.length);

    if (normalizedIndexes.length === review.hunks.length) {
      await this.writeFile(review.filePath, review.newContent, "utf-8");
      return;
    }

    await this.writeFile(review.filePath, review.oldContent, "utf-8");
    for (const index of normalizedIndexes) {
      this.applyHunk(review.hunks[index]!, this.projectRoot);
    }
  }

  async rejectSelectedHunks(review: PendingDiffReview, rejectedIndexes: number[]): Promise<void> {
    const rejected = new Set(normalizeIndexes(rejectedIndexes, review.hunks.length));
    const accepted = review.hunks.map((_, index) => index).filter((index) => !rejected.has(index));
    await this.applySelectedHunks(review, accepted);
  }
}

async function defaultGenerateDiff(beforePath: string, afterPath: string): Promise<string> {
  try {
    const result = await execFileAsync(
      "git",
      ["diff", "--no-index", "--unified=3", "--", beforePath, afterPath],
      {
        encoding: "utf-8",
      },
    );
    return result.stdout;
  } catch (error: unknown) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    if (err.code === 1 && typeof err.stdout === "string") {
      return err.stdout;
    }

    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    throw new Error(stderr || err.message || "Failed to generate diff review");
  }
}

function normalizeRelativePath(projectRoot: string, filePath: string): string {
  const relativePath = relative(projectRoot, filePath).replace(/\\/g, "/");
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    return basename(filePath);
  }
  return relativePath;
}

function normalizeIndexes(indexes: number[], hunkCount: number): number[] {
  return [...new Set(indexes)]
    .filter((index) => index >= 0 && index < hunkCount)
    .sort((a, b) => a - b);
}

function summarizeHunk(hunk: DiffHunk): string {
  const changedLines = hunk.content
    .split("\n")
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .slice(0, 2)
    .map((line) => line.slice(1).trim())
    .filter(Boolean);

  if (changedLines.length === 0) {
    return hunk.content.split("\n")[0] ?? "No changed lines";
  }

  return changedLines.join(" | ");
}
