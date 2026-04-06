// ============================================================================
// @dantecode/core — Post-Edit Linter
// Runs project-appropriate linting after code edits and returns structured
// results so the agent loop can inject a targeted fix prompt.
//
// Supported toolchains (auto-detected):
//   • ESLint     — eslint / npx eslint
//   • TypeScript — tsc --noEmit
//   • Python     — python -m flake8
//   • Rust       — cargo check
// ============================================================================

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LintError {
  file: string;
  line: number;
  message: string;
  code?: string;
}

export interface LintResult {
  passed: boolean;
  errors: LintError[];
  rawOutput: string;
}

// ─── Tool Detection ──────────────────────────────────────────────────────────

type LintTool = "eslint" | "tsc" | "flake8" | "cargo";

interface DetectedTool {
  tool: LintTool;
  command: string;
}

function detectLintTools(projectRoot: string): DetectedTool[] {
  const tools: DetectedTool[] = [];

  // ESLint: look for config files
  const eslintConfigs = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
  ];
  const hasEslint = eslintConfigs.some((f) => existsSync(join(projectRoot, f)));
  if (hasEslint) {
    // Prefer local binary, fall back to npx
    const localBin = join(projectRoot, "node_modules", ".bin", "eslint");
    const cmd = existsSync(localBin) ? `"${localBin}"` : "npx eslint";
    tools.push({ tool: "eslint", command: `${cmd} --format json .` });
  }

  // TypeScript: look for tsconfig
  const tsconfig = join(projectRoot, "tsconfig.json");
  if (existsSync(tsconfig)) {
    const localTsc = join(projectRoot, "node_modules", ".bin", "tsc");
    const tscBin = existsSync(localTsc) ? `"${localTsc}"` : "npx tsc";
    tools.push({ tool: "tsc", command: `${tscBin} --noEmit` });
  }

  // Python: look for setup.cfg / .flake8 / pyproject.toml
  const pyConfigs = ["setup.cfg", ".flake8", "pyproject.toml", "requirements.txt"];
  const hasPython = pyConfigs.some((f) => existsSync(join(projectRoot, f)));
  if (hasPython) {
    tools.push({ tool: "flake8", command: "python -m flake8 --format=default ." });
  }

  // Rust: look for Cargo.toml
  const cargoToml = join(projectRoot, "Cargo.toml");
  if (existsSync(cargoToml)) {
    tools.push({ tool: "cargo", command: "cargo check --message-format=short 2>&1" });
  }

  return tools;
}

// ─── Output Parsers ──────────────────────────────────────────────────────────

function parseEslintJson(output: string): LintError[] {
  const errors: LintError[] = [];
  try {
    const results = JSON.parse(output);
    if (!Array.isArray(results)) return errors;
    for (const result of results) {
      const filePath: string = result.filePath ?? "";
      const messages: unknown[] = result.messages ?? [];
      for (const msg of messages as Array<Record<string, unknown>>) {
        if ((msg["severity"] as number) >= 2) {
          errors.push({
            file: filePath,
            line: (msg["line"] as number) || 0,
            message: (msg["message"] as string) || "",
            code: (msg["ruleId"] as string | undefined) ?? undefined,
          });
        }
      }
    }
  } catch {
    // Not JSON — ignore (tool produced text output instead)
  }
  return errors;
}

function parseTscOutput(output: string): LintError[] {
  const errors: LintError[] = [];
  // Format: file(line,col): error TS1234: message
  const re = /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    errors.push({
      file: m[1]!.trim(),
      line: parseInt(m[2]!, 10),
      message: m[4]!.trim(),
      code: m[3],
    });
  }
  return errors;
}

function parseFlake8Output(output: string): LintError[] {
  const errors: LintError[] = [];
  // Format: ./path/file.py:10:5: E302 expected 2 blank lines
  const re = /^(.+?):(\d+):\d+:\s+(E\d+|W\d+)\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    errors.push({
      file: m[1]!.trim(),
      line: parseInt(m[2]!, 10),
      message: m[4]!.trim(),
      code: m[3],
    });
  }
  return errors;
}

function parseCargoOutput(output: string): LintError[] {
  const errors: LintError[] = [];
  // Format: error[E0308]: mismatched types
  //         --> src/main.rs:10:5
  const re = /error(?:\[([^\]]+)\])?:\s+(.+)\n\s+-->\s+(.+?):(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    errors.push({
      file: m[3]!.trim(),
      line: parseInt(m[4]!, 10),
      message: m[2]!.trim(),
      code: m[1] ?? undefined,
    });
  }
  return errors;
}

function parseToolOutput(tool: LintTool, output: string): LintError[] {
  switch (tool) {
    case "eslint":
      return parseEslintJson(output);
    case "tsc":
      return parseTscOutput(output);
    case "flake8":
      return parseFlake8Output(output);
    case "cargo":
      return parseCargoOutput(output);
  }
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * Detects and runs appropriate lint tools for the project, then returns a
 * structured result. Modified files are used as a hint but currently all
 * discovered tools run project-wide (file-scoped filtering is tool-specific).
 *
 * @param projectRoot   Absolute path to the project root.
 * @param modifiedFiles List of recently modified file paths (for context).
 */
export async function runPostEditLint(
  projectRoot: string,
  modifiedFiles: string[],
): Promise<LintResult> {
  const tools = detectLintTools(projectRoot);

  if (tools.length === 0) {
    return { passed: true, errors: [], rawOutput: "" };
  }

  const allErrors: LintError[] = [];
  const rawParts: string[] = [];

  for (const { tool, command } of tools) {
    let rawOutput = "";
    try {
      rawOutput = execSync(command, {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        // Give lint tools up to 60 s
        timeout: 60_000,
      });
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
      rawOutput =
        (typeof e.stdout === "string"
          ? e.stdout
          : e.stdout?.toString("utf-8") ?? "") +
        (typeof e.stderr === "string"
          ? e.stderr
          : e.stderr?.toString("utf-8") ?? "");
    }

    if (rawOutput.trim()) {
      rawParts.push(`[${tool}]\n${rawOutput}`);
    }

    const toolErrors = parseToolOutput(tool, rawOutput);

    // If we have modified files, filter errors to only those files when possible
    if (modifiedFiles.length > 0 && toolErrors.length > 0) {
      const modSet = new Set(modifiedFiles.map((f) => f.replace(/\\/g, "/")));
      const filtered = toolErrors.filter((e) => {
        const normalized = e.file.replace(/\\/g, "/");
        return modSet.has(normalized) || modifiedFiles.some((mf) => normalized.endsWith(mf));
      });
      // Fall back to all errors if none match (tool may report absolute vs relative paths)
      allErrors.push(...(filtered.length > 0 ? filtered : toolErrors));
    } else {
      allErrors.push(...toolErrors);
    }
  }

  return {
    passed: allErrors.length === 0,
    errors: allErrors,
    rawOutput: rawParts.join("\n\n"),
  };
}

/**
 * Builds a targeted fix prompt from a LintResult for injection into the
 * conversation as a user message.
 *
 * @param lintResult   The result from runPostEditLint.
 * @param maxErrors    Cap on how many errors to include (default 20).
 */
export async function buildLintFixPrompt(
  lintResult: LintResult,
  maxErrors = 20,
): Promise<string> {
  if (lintResult.passed || lintResult.errors.length === 0) {
    return "";
  }

  const errors = lintResult.errors.slice(0, maxErrors);
  const total = lintResult.errors.length;
  const shown = errors.length;

  const lines: string[] = [
    `Linting found ${total} error${total === 1 ? "" : "s"} after your edits. Fix these:`,
    "",
  ];

  for (const err of errors) {
    const loc = `${err.file}:${err.line}`;
    const code = err.code ? ` [${err.code}]` : "";
    lines.push(`[${loc}]${code} ${err.message}`);
  }

  if (shown < total) {
    lines.push(`... and ${total - shown} more error(s) not shown.`);
  }

  lines.push("");
  lines.push("Use Edit/Write tools to fix these issues.");

  return lines.join("\n");
}
