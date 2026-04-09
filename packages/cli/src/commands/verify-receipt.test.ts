// ============================================================================
// @dantecode/cli — verify-receipt command tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyReceiptCommand } from "./verify-receipt.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("@dantecode/evidence-chain", () => ({
  verifyBundle: vi.fn(),
  hashDict: vi.fn(),
}));

import { readFile, readdir } from "node:fs/promises";
import { verifyBundle, hashDict } from "@dantecode/evidence-chain";

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockVerifyBundle = vi.mocked(verifyBundle);
const mockHashDict = vi.mocked(hashDict);

const VALID_BUNDLE = {
  bundleId: "ev_abc123def456",
  runId: "run-001",
  timestamp: "2026-04-03T10:00:00.000Z",
  hash: "a".repeat(64),
  evidence: {
    taskDescription: "Fix authentication bug",
    sessionId: "sess-xyz999",
    filesChanged: 3,
  },
};

describe("verifyReceiptCommand", () => {
  let stdoutOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutOutput = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutOutput += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    });
  });

  it("prints usage hint when no receipt ID is provided", async () => {
    await verifyReceiptCommand([], "/project");
    expect(stdoutOutput).toContain("Usage:");
    expect(stdoutOutput).toContain("verify-receipt");
  });

  it("verifies a valid receipt and shows task details", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(VALID_BUNDLE) as never);
    mockVerifyBundle.mockReturnValue(true);

    await verifyReceiptCommand(["ev_abc123def456"], "/project");

    expect(stdoutOutput).toContain("valid");
    expect(stdoutOutput).toContain("Fix authentication bug");
    expect(stdoutOutput).toContain("sess-xyz999");
  });

  it("shows Merkle hash prefix in verified output", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(VALID_BUNDLE) as never);
    mockVerifyBundle.mockReturnValue(true);

    await verifyReceiptCommand(["ev_abc123def456"], "/project");

    // Merkle root should appear as first 16 chars of hash
    expect(stdoutOutput).toContain("aaaaaaaaaaaaaaaa");
    expect(stdoutOutput).toContain("Merkle:");
  });

  it("reports FAILED with hash mismatch when bundle is tampered", async () => {
    const tamperedBundle = {
      ...VALID_BUNDLE,
      evidence: { ...VALID_BUNDLE.evidence, filesChanged: 999 },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(tamperedBundle) as never);
    mockVerifyBundle.mockReturnValue(false);
    mockHashDict.mockReturnValue("b".repeat(64));

    await verifyReceiptCommand(["ev_abc123def456"], "/project");

    expect(stdoutOutput).toContain("FAILED");
    expect(stdoutOutput).toContain("mismatch");
    // Shows recomputed hash prefix
    expect(stdoutOutput).toContain("bbbbbbbbbbbbbbbb");
  });

  it("prints not-found message when receipt file does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    await verifyReceiptCommand(["ev_nonexistent"], "/project");

    expect(stdoutOutput).toContain("not found");
    expect(stdoutOutput).toContain("ev_nonexistent");
  });
});
