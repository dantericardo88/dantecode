// ============================================================================
// packages/vscode/src/test-framework-detector.ts
// Test Generation Phase 1: framework detection, test file finder, signature
// extractor. Harvest: Aider --test-cmd pattern + Copilot framework detection.
// ============================================================================

import * as path from "node:path";
import { createRequire } from "node:module";
import { readFile as fsReadFile } from "node:fs/promises";

type GlobFunction = (
  pattern: string,
  opts: { cwd?: string; absolute?: boolean; nodir?: boolean },
) => Promise<string[]>;

// CRITICAL: glob must be loaded lazily, NOT at module-eval time.
// A previous fix (per project memory: "Two activation blockers fixed: lazy glob")
// solved this. It regressed. Eager `requireGlob("glob")` at the top level throws
// when the package isn't resolvable from the bundled extension's __filename,
// which kills extension activation BEFORE activate() runs — manifesting to the
// user as a permanently blank chat panel that no reload can fix.
let _legacyGlob: GlobFunction | undefined;
function getLegacyGlob(): GlobFunction {
  if (!_legacyGlob) {
    const requireGlob = createRequire(__filename);
    const mod = requireGlob("glob") as { glob: GlobFunction };
    _legacyGlob = mod.glob;
  }
  return _legacyGlob;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TestFramework =
  | "vitest"
  | "jest"
  | "mocha"
  | "jasmine"
  | "pytest"
  | "unittest"
  | "go-testing"
  | "unknown";

export interface DetectedFramework {
  name: TestFramework;
  /** Semver string from package.json, or "unknown" */
  version: string;
  /** Config file name found, e.g. "vitest.config.ts", or "" */
  configFile: string;
  /** Shell command to run tests, e.g. "npx vitest run" */
  runCommand: string;
}

export interface TestContext {
  framework: DetectedFramework;
  /** Absolute path to existing test file for this source, or null */
  existingTestFile: string | null;
  /** Where a new test file should go if none exists */
  inferredTestFilePath: string;
  /** First 60 lines of existing test file (shows import/describe style) */
  existingTestHead: string;
  /** Function/class names from the selected code (max 10) */
  functionSignatures: string[];
}

// ── Default I/O helpers (injectable for tests) ────────────────────────────────

async function defaultReadFile(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function defaultGlob(pattern: string, cwd: string): Promise<string[]> {
  const results = await getLegacyGlob()(pattern, { cwd, absolute: true, nodir: true });
  return results;
}

// ── Framework detection table ─────────────────────────────────────────────────

interface FrameworkEntry {
  name: TestFramework;
  packageKeys: string[];          // keys to look for in package.json deps
  configPatterns: string[];       // config file names at workspace root
  runCommand: string;
}

const FRAMEWORK_TABLE: FrameworkEntry[] = [
  {
    name: "vitest",
    packageKeys: ["vitest"],
    configPatterns: ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"],
    runCommand: "npx vitest run",
  },
  {
    name: "jest",
    packageKeys: ["jest", "@jest/core"],
    configPatterns: ["jest.config.ts", "jest.config.js", "jest.config.cjs"],
    runCommand: "npx jest",
  },
  {
    name: "mocha",
    packageKeys: ["mocha"],
    configPatterns: [".mocharc.ts", ".mocharc.js", ".mocharc.yml", ".mocharc.json"],
    runCommand: "npx mocha",
  },
  {
    name: "jasmine",
    packageKeys: ["jasmine"],
    configPatterns: ["jasmine.json"],
    runCommand: "npx jasmine",
  },
];

// ── TestFrameworkDetector ─────────────────────────────────────────────────────

export class TestFrameworkDetector {
  constructor(
    private readonly _readFileFn: (p: string) => Promise<string> = defaultReadFile,
    private readonly _globFn: (pattern: string, cwd: string) => Promise<string[]> = defaultGlob,
  ) {}

  /**
   * Detect test framework from package.json / go.mod / requirements.txt.
   * Priority: explicit package.json keys → config files → file extension → fallback.
   */
  async detectFramework(workspaceRoot: string): Promise<DetectedFramework> {
    // ── Go ──
    try {
      await this._readFileFn(path.join(workspaceRoot, "go.mod"));
      return { name: "go-testing", version: "unknown", configFile: "go.mod", runCommand: "go test ./..." };
    } catch { /* not Go */ }

    // ── Python (pytest / unittest) ──
    try {
      const reqTxt = await this._readFileFn(path.join(workspaceRoot, "requirements.txt")).catch(() => "");
      const pyproject = await this._readFileFn(path.join(workspaceRoot, "pyproject.toml")).catch(() => "");
      const combined = reqTxt + pyproject;
      if (/\bpytest\b/i.test(combined)) {
        return { name: "pytest", version: "unknown", configFile: "", runCommand: "pytest" };
      }
      if (combined.length > 0) {
        return { name: "unittest", version: "unknown", configFile: "", runCommand: "python -m pytest" };
      }
    } catch { /* not Python */ }

    // ── JS/TS: package.json ──
    let pkgJson: Record<string, unknown> = {};
    try {
      const raw = await this._readFileFn(path.join(workspaceRoot, "package.json"));
      pkgJson = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* no package.json */ }

    const allDeps: Record<string, string> = {
      ...((pkgJson["dependencies"] as Record<string, string>) ?? {}),
      ...((pkgJson["devDependencies"] as Record<string, string>) ?? {}),
    };

    for (const entry of FRAMEWORK_TABLE) {
      const found = entry.packageKeys.find((key) => key in allDeps);
      if (found) {
        const version = (allDeps[found] ?? "unknown").replace(/^[\^~>=]/, "");
        // Find config file
        let configFile = "";
        for (const cfgName of entry.configPatterns) {
          try {
            await this._readFileFn(path.join(workspaceRoot, cfgName));
            configFile = cfgName;
            break;
          } catch { /* not found */ }
        }
        return { name: entry.name, version, configFile, runCommand: entry.runCommand };
      }
    }

    return { name: "unknown", version: "unknown", configFile: "", runCommand: "npm test" };
  }

  /**
   * Find the existing test file for a given source file.
   * Tries multiple naming conventions in priority order.
   */
  async findTestFile(sourceFilePath: string, workspaceRoot: string): Promise<string | null> {
    const dir = path.dirname(sourceFilePath);
    const base = path.basename(sourceFilePath);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);

    const candidates: string[] = [
      path.join(dir, "__tests__", `${stem}.test${ext}`),
      path.join(dir, `${stem}.test${ext}`),
      path.join(dir, `${stem}.spec${ext}`),
      path.join(dir, "__tests__", `${stem}.spec${ext}`),
      // Python
      path.join(dir, `test_${stem}.py`),
      path.join(dir, `${stem}_test.py`),
      path.join(workspaceRoot, "tests", `test_${stem}.py`),
      // Go
      path.join(dir, `${stem}_test.go`),
    ];

    for (const candidate of candidates) {
      try {
        await this._readFileFn(candidate);
        return candidate;
      } catch { /* not found */ }
    }

    // Broader glob search (last resort)
    try {
      const globResults = await this._globFn(`**/${stem}.test${ext}`, workspaceRoot);
      if (globResults.length > 0) return globResults[0]!;
    } catch { /* glob failed */ }

    return null;
  }

  /**
   * Infer where a new test file should go if no existing one is found.
   * Follows DanteCode's own convention: __tests__/{stem}.test.{ext}
   */
  inferTestFilePath(sourceFilePath: string): string {
    const dir = path.dirname(sourceFilePath);
    const base = path.basename(sourceFilePath);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);

    // Python
    if (ext === ".py") return path.join(dir, `test_${stem}.py`);
    // Go
    if (ext === ".go") return path.join(dir, `${stem}_test.go`);
    // JS/TS (and everything else)
    return path.join(dir, "__tests__", `${stem}.test${ext}`);
  }

  /**
   * Read the first N lines of an existing test file.
   * Returns empty string on any error (file not found, permission denied, etc).
   */
  async readTestFileHead(testFilePath: string, lines = 60): Promise<string> {
    try {
      const content = await this._readFileFn(testFilePath);
      return content.split("\n").slice(0, lines).join("\n");
    } catch {
      return "";
    }
  }

  /**
   * Extract function/class names from code using language-agnostic regexes.
   * Returns unique names, capped at 10.
   */
  extractFunctionSignatures(code: string, language: string): string[] {
    const names = new Set<string>();
    let pattern: RegExp;

    if (language === "python") {
      pattern = /\bdef\s+(\w+)\s*\(/g;
    } else if (language === "go") {
      pattern = /\bfunc\s+(\w+)\s*\(/g;
    } else {
      // TypeScript / JavaScript / default
      pattern =
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    }

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1] ?? match[2];
      if (name && name !== "function" && !name.startsWith("_anon")) {
        names.add(name);
        if (names.size >= 10) break;
      }
    }

    return [...names];
  }

  /**
   * Build the full TestContext object used to enrich the /test and /testfile prompts.
   */
  async buildTestContext(
    sourceFilePath: string,
    workspaceRoot: string,
    selectedCode: string,
    language: string,
  ): Promise<TestContext> {
    const [framework, existingTestFile] = await Promise.all([
      this.detectFramework(workspaceRoot),
      this.findTestFile(sourceFilePath, workspaceRoot),
    ]);

    const inferredTestFilePath = this.inferTestFilePath(sourceFilePath);

    const existingTestHead = existingTestFile
      ? await this.readTestFileHead(existingTestFile, 60)
      : "";

    const functionSignatures = selectedCode.trim()
      ? this.extractFunctionSignatures(selectedCode, language)
      : [];

    return {
      framework,
      existingTestFile,
      inferredTestFilePath,
      existingTestHead,
      functionSignatures,
    };
  }
}
