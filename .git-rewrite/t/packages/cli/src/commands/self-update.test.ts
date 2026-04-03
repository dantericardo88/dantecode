import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: (...args: unknown[]) => mockExecSync(...args),
  };
});

vi.mock("@dantecode/core", async () => {
  const runtimeUpdate = await vi.importActual<object>("../../../core/src/runtime-update.ts");
  return {
    ...runtimeUpdate,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    },
  };
});

import { runSelfUpdateCommand } from "./self-update.js";

const tempRoots: string[] = [];

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

describe("runSelfUpdateCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to update a dirty repo checkout", async () => {
    const repoRoot = makeTempRoot("dantecode-self-update-repo-");
    const runtimePath = join(repoRoot, "packages", "cli", "dist", "index.js");

    writeJson(join(repoRoot, "package.json"), { name: "dantecode", workspaces: ["packages/*"] });
    writeJson(join(repoRoot, "packages", "cli", "package.json"), { name: "@dantecode/cli" });
    touch(runtimePath);

    mockExecSync.mockImplementation((command: string) => {
      if (command === "git status --porcelain") {
        return " M packages/cli/src/index.ts\n";
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await runSelfUpdateCommand(repoRoot, {
      verbose: false,
      dryRun: false,
      runtimePath,
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "[self-update] Refusing to update a dirty repo checkout. Commit or stash your changes first.",
    );
    expect(process.exitCode).toBe(1);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it("updates the globally installed CLI via npm", async () => {
    const tempRoot = makeTempRoot("dantecode-self-update-global-");
    const runtimePath = join(
      tempRoot,
      "global",
      "node_modules",
      "@dantecode",
      "cli",
      "dist",
      "index.js",
    );
    const workspaceRoot = join(tempRoot, "workspace");

    writeJson(join(workspaceRoot, "package.json"), { name: "demo-project" });
    writeJson(join(tempRoot, "global", "node_modules", "@dantecode", "cli", "package.json"), {
      name: "@dantecode/cli",
    });
    touch(runtimePath);
    mockExecSync.mockReturnValue("");

    await runSelfUpdateCommand(workspaceRoot, {
      verbose: false,
      dryRun: false,
      runtimePath,
    });

    expect(mockExecSync).toHaveBeenCalledWith(
      "npm install -g @dantecode/cli@latest",
      expect.objectContaining({ timeout: 300000 }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "[self-update] Global CLI update complete. Run `dantecode --version` to verify the new install.",
    );
  });

  it("prints manual guidance for a project-local dependency install", async () => {
    const projectRoot = makeTempRoot("dantecode-self-update-local-");
    const runtimePath = join(projectRoot, "node_modules", "@dantecode", "cli", "dist", "index.js");

    writeJson(join(projectRoot, "package.json"), { name: "demo-project" });
    writeJson(join(projectRoot, "node_modules", "@dantecode", "cli", "package.json"), {
      name: "@dantecode/cli",
    });
    touch(runtimePath);

    await runSelfUpdateCommand(projectRoot, {
      verbose: false,
      dryRun: false,
      runtimePath,
    });

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(
      logSpy.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes("npm install @dantecode/cli@latest") &&
          !message.includes("packages/vscode"),
      ),
    ).toBe(true);
  });

  it("prints manual guidance for an npx ephemeral install", async () => {
    const tempRoot = makeTempRoot("dantecode-self-update-npx-");
    const runtimePath = join(
      tempRoot,
      "_npx",
      "ab12cd",
      "node_modules",
      "@dantecode",
      "cli",
      "dist",
      "index.js",
    );

    writeJson(
      join(tempRoot, "_npx", "ab12cd", "node_modules", "@dantecode", "cli", "package.json"),
      { name: "@dantecode/cli" },
    );
    touch(runtimePath);

    await runSelfUpdateCommand(join(tempRoot, "workspace"), {
      verbose: false,
      dryRun: false,
      runtimePath,
    });

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(
      logSpy.mock.calls.some(
        ([message]) => typeof message === "string" && message.includes("npx @dantecode/cli@latest"),
      ),
    ).toBe(true);
  });
});
