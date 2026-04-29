import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPreviewCommand } from "../preview-command.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dantecode-preview-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeProofFile(overrides: Record<string, unknown> = {}): string {
  const proof = {
    dimensionId: "browser_live_preview",
    generatedAt: "2026-04-29T00:00:00.000Z",
    preview: {
      url: "http://localhost:4173",
      command: "npm run preview",
      port: 4173,
      managed: true,
      startupMs: 500,
      framework: "vite",
    },
    captures: {
      screenshotPath: "artifacts/preview.png",
      screenshotSha256: "a".repeat(64),
      domTextChars: 900,
      accessibilityTreeCaptured: true,
      consoleErrorCount: 0,
      networkFailureCount: 0,
      blockingErrorCount: 0,
      viewports: [
        { width: 390, height: 844, screenshotPath: "artifacts/mobile.png" },
        { width: 1440, height: 900, screenshotPath: "artifacts/desktop.png" },
      ],
    },
    hotReload: {
      pass: true,
      changedFile: "src/App.tsx",
      beforeHash: "b".repeat(64),
      afterHash: "c".repeat(64),
      observedMs: 260,
    },
    keyboard: {
      pass: true,
      reachableControls: 4,
      totalControls: 4,
      focusOrder: ["Run", "Refresh", "Inspect", "Fix"],
    },
    repair: {
      failureOverlayAvailable: true,
      repairPromptAvailable: true,
    },
    artifacts: {
      manifestPath: ".danteforge/evidence/browser-live-preview-dim14.json",
      reportPath: ".danteforge/evidence/browser-live-preview-dim14.md",
      tracePath: "artifacts/trace.zip",
    },
    ...overrides,
  };
  const file = join(tmpDir, "preview-proof.json");
  writeFileSync(file, JSON.stringify(proof, null, 2));
  return file;
}

describe("preview command", () => {
  it("writes Dim14 evidence and exits zero for complete preview proof", async () => {
    const output: string[] = [];
    const proofFile = writeProofFile();

    const code = await runPreviewCommand(
      ["gate", "--proof", proofFile, "--format", "json", "--evidence", "--threshold", "90"],
      {
        cwd: tmpDir,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      },
    );

    expect(code).toBe(0);
    const payload = JSON.parse(output.join(""));
    expect(payload.pass).toBe(true);
    expect(payload.score).toBe(100);
    expect(existsSync(join(tmpDir, ".danteforge", "evidence", "browser-live-preview-dim14.json"))).toBe(true);
    expect(readFileSync(join(tmpDir, ".danteforge", "evidence", "browser-live-preview-dim14.md"), "utf-8"))
      .toContain("Browser Live Preview Gate Report");
  });

  it("exits non-zero when hot reload proof is missing", async () => {
    const output: string[] = [];
    const proofFile = writeProofFile({ hotReload: { pass: false } });

    const code = await runPreviewCommand(
      ["gate", "--proof", proofFile, "--format", "json", "--threshold", "90"],
      {
        cwd: tmpDir,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      },
    );

    expect(code).toBe(1);
    const payload = JSON.parse(output.join(""));
    expect(payload.pass).toBe(false);
    expect(payload.blockers).toContain("hot reload proof is required");
  });

  it("canary writes honest local preview evidence capped below 9 without browser capture", async () => {
    const output: string[] = [];

    const code = await runPreviewCommand(
      ["canary", "--format", "json", "--evidence", "--threshold", "90"],
      {
        cwd: tmpDir,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      },
    );

    expect(code).toBe(1);
    const payload = JSON.parse(output.join(""));
    expect(payload.coverage.managedPreview).toBe(true);
    expect(payload.coverage.hotReload).toBe(true);
    expect(payload.coverage.browserScreenshot).toBe(false);
    expect(payload.maxEligibleScore).toBe(7);
    expect(existsSync(join(tmpDir, ".danteforge", "evidence", "browser-live-preview-dim14.json"))).toBe(true);
  });
});
