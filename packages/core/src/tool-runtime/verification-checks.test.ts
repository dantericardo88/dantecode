import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import {
  buildEditChecks,
  runVerificationChecks,
} from "./verification-checks.js";

// Mock fs
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockStatSync = vi.mocked(fs.statSync);

describe("buildEditChecks", () => {
  it("returns file_exists and edit_applied checks", () => {
    const checks = buildEditChecks("/path/to/file.txt", "old text", "new text");

    expect(checks).toHaveLength(2);
    expect(checks[0]).toEqual({
      kind: "file_exists",
      path: "/path/to/file.txt",
    });
    expect(checks[1]).toEqual({
      kind: "edit_applied",
      path: "/path/to/file.txt",
      before: "old text",
      after: "new text",
    });
  });
});

describe("runVerificationChecks for edit_applied", () => {
  it("passes when after text is present and before text is absent", async () => {
    mockStatSync.mockReturnValue({ isFile: () => true } as any);
    mockReadFileSync.mockReturnValue("some content with new text in it");

    const checks = buildEditChecks("/file.txt", "old", "new text");
    const result = await runVerificationChecks(checks, "/project/root");

    expect(result.passed).toBe(true);
    expect(result.failedChecks).toHaveLength(0);
  });

  it("fails when after text is missing", async () => {
    mockStatSync.mockReturnValue({ isFile: () => true } as any);
    mockReadFileSync.mockReturnValue("some content without replacement text");

    const checks = buildEditChecks("/file.txt", "old", "new text");
    const result = await runVerificationChecks(checks, "/project/root");

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toHaveLength(1);
    expect(result.failedChecks[0].errorMessage).toContain("Expected text \"new text\" not found");
  });

  it("fails when before text is still present", async () => {
    mockStatSync.mockReturnValue({ isFile: () => true } as any);
    mockReadFileSync.mockReturnValue("some content with old and new text");

    const checks = buildEditChecks("/file.txt", "old", "new text");
    const result = await runVerificationChecks(checks, "/project/root");

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toHaveLength(1);
    expect(result.failedChecks[0].errorMessage).toContain("Old text \"old\" still present");
  });

  it("passes when before and after are empty", async () => {
    mockStatSync.mockReturnValue({ isFile: () => true } as any);
    mockReadFileSync.mockReturnValue("some content");

    const checks = buildEditChecks("/file.txt", "", "");
    const result = await runVerificationChecks(checks, "/project/root");

    expect(result.passed).toBe(true);
  });

  it("fails when file cannot be read", async () => {
    mockStatSync.mockReturnValue({ isFile: () => true } as any);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("File not found");
    });

    const checks = buildEditChecks("/file.txt", "old", "new");
    const result = await runVerificationChecks(checks, "/project/root");

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toHaveLength(1);
    expect(result.failedChecks[0].errorMessage).toContain("File not readable");
  });
});