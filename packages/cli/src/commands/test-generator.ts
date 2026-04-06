// ============================================================================
// @dantecode/cli — /test command
// Generates comprehensive tests for a source file, runs them, fixes failures.
// Based on Aider's test-then-fix loop pattern.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, dirname, extname } from "node:path";
import { execSync } from "node:child_process";
import type { ModelRouterImpl } from "@dantecode/core";

export type TestFramework = "vitest" | "jest" | "pytest" | "go-test" | "unknown";

export function detectTestFramework(projectRoot: string): TestFramework {
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
      const deps = { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) };
      if ("vitest" in deps) return "vitest";
      if ("jest" in deps) return "jest";
    }
  } catch { /* ignore */ }
  if (existsSync(join(projectRoot, "pyproject.toml"))) return "pytest";
  if (existsSync(join(projectRoot, "go.mod"))) return "go-test";
  return "unknown";
}

function getTestFilePath(sourceFile: string, framework: TestFramework): string {
  const ext = extname(sourceFile);
  const base = basename(sourceFile, ext);
  const dir = dirname(sourceFile);
  if (framework === "pytest") return join(dir, `test_${base}.py`);
  if (framework === "go-test") return join(dir, `${base}_test.go`);
  return join(dir, `${base}.test${ext}`);
}

function getRunCommand(framework: TestFramework, testFile: string): string | null {
  switch (framework) {
    case "vitest": return `npx vitest run "${testFile}" --reporter=verbose`;
    case "jest": return `npx jest "${testFile}" --no-coverage`;
    case "pytest": return `python -m pytest "${testFile}" -v`;
    case "go-test": return `go test ./...`;
    default: return null;
  }
}

const TEST_SYSTEM_PROMPT = `You are an expert test engineer. Generate comprehensive tests for the provided source code.
Requirements:
- Cover: happy path, edge cases, error cases, type/boundary conditions
- Use the exact import paths from the source file
- Tests must be self-contained and runnable without modification
- Use ONLY the detected test framework's API and syntax
- Do NOT add any TODO, placeholder, or skipped tests
- Every test must have at least one concrete assertion`;

export async function generateTests(
  sourceFilePath: string,
  projectRoot: string,
  router: ModelRouterImpl,
  framework?: TestFramework,
): Promise<{ testFilePath: string; testsRun: boolean; passed: boolean; output: string }> {
  const resolvedFramework = framework ?? detectTestFramework(projectRoot);
  const absSource = join(projectRoot, sourceFilePath);
  const sourceContent = readFileSync(absSource, "utf-8");
  const testFilePath = getTestFilePath(absSource, resolvedFramework);

  const response = await router.generate(
    [{ role: "user", content: `Generate ${resolvedFramework} tests for this file. Output ONLY the complete test file, no explanation:\n\n\`\`\`\n${sourceContent}\n\`\`\`` }],
    { system: TEST_SYSTEM_PROMPT, maxTokens: 4096 },
  );

  writeFileSync(testFilePath, response, "utf-8");

  const runCmd = getRunCommand(resolvedFramework, testFilePath);
  if (!runCmd) {
    return { testFilePath, testsRun: false, passed: false, output: `Unknown framework '${resolvedFramework}' — test file written but not executed` };
  }

  try {
    const output = execSync(runCmd, { cwd: projectRoot, timeout: 60_000, encoding: "utf-8" });
    return { testFilePath, testsRun: true, passed: true, output };
  } catch (err: unknown) {
    const output = (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? String(err);
    return { testFilePath, testsRun: true, passed: false, output };
  }
}
