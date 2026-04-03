// ============================================================================
// @dantecode/core - Runtime update helper tests
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { PathLike } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectInstallContext, resolvePreferredShell } from "./runtime-update.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function touch(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "", "utf-8");
}

describe("detectInstallContext", () => {
  it("detects a repo checkout from the DanteCode monorepo layout", () => {
    const repoRoot = makeTempRoot("dantecode-runtime-repo-");
    writeJson(join(repoRoot, "package.json"), {
      name: "dantecode",
      workspaces: ["packages/*"],
    });
    writeJson(join(repoRoot, "packages", "cli", "package.json"), { name: "@dantecode/cli" });
    touch(join(repoRoot, "packages", "cli", "dist", "index.js"));

    const detected = detectInstallContext({
      runtimePath: join(repoRoot, "packages", "cli", "dist", "index.js"),
      cwd: repoRoot,
    });

    expect(detected.kind).toBe("repo_checkout");
    expect(detected.repoRoot).toBe(repoRoot);
  });

  it("detects a project-local npm dependency install", () => {
    const projectRoot = makeTempRoot("dantecode-runtime-local-");
    writeJson(join(projectRoot, "package.json"), { name: "demo-project" });
    writeJson(join(projectRoot, "node_modules", "@dantecode", "cli", "package.json"), {
      name: "@dantecode/cli",
    });
    touch(join(projectRoot, "node_modules", "@dantecode", "cli", "dist", "index.js"));

    const detected = detectInstallContext({
      runtimePath: join(projectRoot, "node_modules", "@dantecode", "cli", "dist", "index.js"),
      cwd: projectRoot,
    });

    expect(detected.kind).toBe("npm_local_dependency");
  });

  it("detects an npx-style ephemeral install path", () => {
    const tempRoot = makeTempRoot("dantecode-runtime-npx-");
    const runtimeRoot = join(tempRoot, "_npx", "ab12cd", "node_modules", "@dantecode", "cli");
    writeJson(join(runtimeRoot, "package.json"), { name: "@dantecode/cli" });
    touch(join(runtimeRoot, "dist", "index.js"));

    const detected = detectInstallContext({
      runtimePath: join(runtimeRoot, "dist", "index.js"),
      cwd: join(tempRoot, "workspace"),
    });

    expect(detected.kind).toBe("npx_ephemeral");
  });

  it("detects a globally installed CLI when the runtime is outside the workspace", () => {
    const tempRoot = makeTempRoot("dantecode-runtime-global-");
    const workspaceRoot = join(tempRoot, "workspace");
    const runtimeRoot = join(tempRoot, "global", "node_modules", "@dantecode", "cli");
    writeJson(join(workspaceRoot, "package.json"), { name: "demo-project" });
    writeJson(join(runtimeRoot, "package.json"), { name: "@dantecode/cli" });
    touch(join(runtimeRoot, "dist", "index.js"));

    const detected = detectInstallContext({
      runtimePath: join(runtimeRoot, "dist", "index.js"),
      cwd: workspaceRoot,
    });

    expect(detected.kind).toBe("npm_global_cli");
  });

  it("detects the VS Code extension host and tracks whether the workspace is the repo root", () => {
    const repoRoot = makeTempRoot("dantecode-runtime-vscode-");
    const extensionRoot = join(repoRoot, "packages", "vscode");
    writeJson(join(repoRoot, "package.json"), {
      name: "dantecode",
      workspaces: ["packages/*"],
    });
    writeJson(join(extensionRoot, "package.json"), { name: "dantecode" });
    touch(join(extensionRoot, "dist", "extension.js"));

    const detected = detectInstallContext({
      runtimePath: join(extensionRoot, "dist", "extension.js"),
      workspaceRoot: repoRoot,
      extensionPath: extensionRoot,
    });

    expect(detected.kind).toBe("vscode_extension_host");
    expect(detected.workspaceIsRepoRoot).toBe(true);
    expect(detected.repoRoot).toBe(repoRoot);
  });
});

describe("resolvePreferredShell", () => {
  it("uses bash on non-Windows platforms", () => {
    expect(resolvePreferredShell({ platform: "linux" })).toBe("/bin/bash");
  });

  it("prefers Git Bash on Windows when a known path exists", () => {
    const accessSyncFn = vi.fn((shellPath: PathLike) => {
      if (String(shellPath).includes("(x86)")) {
        return;
      }
      throw new Error("ENOENT");
    });

    const shellPath = resolvePreferredShell({
      platform: "win32",
      accessSyncFn,
      gitBashPaths: [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      ],
    });

    expect(shellPath).toBe("C:\\Program Files (x86)\\Git\\bin\\bash.exe");
  });

  it("falls back to the OS default shell on Windows when Git Bash is unavailable", () => {
    const shellPath = resolvePreferredShell({
      platform: "win32",
      accessSyncFn: () => {
        throw new Error("ENOENT");
      },
    });

    expect(shellPath).toBeUndefined();
  });
});
