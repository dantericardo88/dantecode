import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildInstallPlan, findLatestVsix, parseInstallArgs } from "../commands/install.js";

describe("install command", () => {
  it("parses IDE target and dry run flag", () => {
    const parsed = parseInstallArgs(["antigravity", "--dry-run"]);
    expect(parsed).toEqual({
      ide: "antigravity",
      dryRun: true,
      vsixPath: undefined,
      ideExecutable: undefined,
    });
  });

  it("parses explicit VSIX and custom CLI path", () => {
    const parsed = parseInstallArgs([
      "vscode",
      "--vsix",
      "packages/vscode/dantecode.vsix",
      "--ide-path",
      "code-insiders",
    ]);
    expect(parsed).toEqual({
      ide: "vscode",
      dryRun: false,
      vsixPath: "packages/vscode/dantecode.vsix",
      ideExecutable: "code-insiders",
    });
  });

  it("returns null when IDE target is missing", () => {
    expect(parseInstallArgs(["--dry-run"])).toBeNull();
  });

  it("builds a packaging install plan when no VSIX is provided", () => {
    const plan = buildInstallPlan({
      projectRoot: "/repo",
      vscodeRoot: "/repo/packages/vscode",
      ide: "antigravity",
      ideExecutable: "antigravity",
      dryRun: true,
    });

    expect(plan.summary).toContain("Antigravity");
    expect(plan.commands.some((command) => command.includes("vsce package"))).toBe(true);
    expect(
      plan.commands.some((command) => command.includes('antigravity --install-extension')),
    ).toBe(true);
  });

  it("builds a direct install plan when a VSIX is provided", () => {
    const plan = buildInstallPlan({
      projectRoot: "/repo",
      vscodeRoot: "/repo/packages/vscode",
      ide: "vscode",
      ideExecutable: "code",
      dryRun: true,
      explicitVsixPath: "/tmp/dantecode.vsix",
    });

    expect(plan.commands).toEqual(['code --install-extension "/tmp/dantecode.vsix" --force']);
  });

  it("finds the newest VSIX artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dantecode-vsix-"));
    try {
      const older = join(dir, "dantecode-older.vsix");
      const newer = join(dir, "dantecode-newer.vsix");
      writeFileSync(older, "old");
      await new Promise((resolve) => setTimeout(resolve, 20));
      writeFileSync(newer, "new");

      expect(await findLatestVsix(dir)).toBe(newer);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
