// ============================================================================
// packages/cli/src/debug-protocol.ts
//
// Structured error classification and diagnosis prompt generation.
//
// Design:
//   - classifyError: maps stderr + exit code to a typed error class
//   - buildDebugPrompt: returns a focused diagnosis instruction for each class
//   - shouldEscalateToRepairLoop: detects when the same error repeats 3+ times
//   - Zero imports from agent-loop or slash-commands (no circular deps)
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type ErrorClass =
  | "TypescriptError"
  | "TestFailure"
  | "NetworkError"
  | "PermissionError"
  | "ModuleNotFound"
  | "SyntaxError"
  | "UnknownError";

export interface ErrorRecord {
  command: string;
  stderr: string;
  exitCode: number;
  errorClass: ErrorClass;
  timestamp: number;
}

// ----------------------------------------------------------------------------
// Classification
// ----------------------------------------------------------------------------

/**
 * Classify a Bash command failure into a typed error class.
 * Order matters: more specific patterns are checked first.
 */
export function classifyError(stderr: string, exitCode: number): ErrorClass {
  const s = stderr.toLowerCase();

  // TypeScript compiler errors
  if (
    /\bts\d{4}\b/.test(stderr) ||
    s.includes("type error") ||
    s.includes("typeerror") ||
    s.includes("cannot find name") ||
    s.includes("property does not exist") ||
    s.includes("is not assignable to type") ||
    s.includes("argument of type") ||
    (s.includes("error ts") && /\berror ts\d+/.test(s))
  ) {
    return "TypescriptError";
  }

  // Module resolution failures
  if (
    s.includes("cannot find module") ||
    s.includes("module not found") ||
    s.includes("failed to resolve") ||
    s.includes("could not resolve") ||
    s.includes("no such file or directory") && s.includes("require")
  ) {
    return "ModuleNotFound";
  }

  // Test runner failures
  if (
    s.includes("test failed") ||
    s.includes("assertion") ||
    s.includes("expected") && s.includes("received") ||
    s.includes("assertion error") ||
    s.includes("✗") ||
    s.includes("× ") ||
    (s.includes("fail") && (s.includes("test") || s.includes("spec")))
  ) {
    return "TestFailure";
  }

  // Network / connectivity
  if (
    s.includes("enotfound") ||
    s.includes("econnrefused") ||
    s.includes("etimedout") ||
    s.includes("network error") ||
    s.includes("fetch failed") ||
    s.includes("getaddrinfo") ||
    exitCode === 6 || // curl: couldn't resolve host
    exitCode === 7    // curl: failed to connect
  ) {
    return "NetworkError";
  }

  // Permission errors
  if (
    s.includes("permission denied") ||
    s.includes("eacces") ||
    s.includes("eperm") ||
    s.includes("operation not permitted") ||
    exitCode === 126 || // command not executable
    exitCode === 127    // command not found / permission issue
  ) {
    return "PermissionError";
  }

  // Syntax errors (JS/TS parse errors, JSON parse failures)
  if (
    s.includes("syntaxerror") ||
    s.includes("unexpected token") ||
    s.includes("unexpected end of") ||
    s.includes("json parse error") ||
    s.includes("parse error") ||
    s.includes("invalid syntax")
  ) {
    return "SyntaxError";
  }

  return "UnknownError";
}

// ----------------------------------------------------------------------------
// Diagnosis Prompts
// ----------------------------------------------------------------------------

const DEBUG_PROMPTS: Record<ErrorClass, string> = {
  TypescriptError:
    "## TypeScript Error — Diagnosis Protocol\n\n" +
    "1. Read the file at the exact line number shown in the error message.\n" +
    "2. Use Grep to find the type definition for the symbol that failed: `grep -n 'type\\|interface\\|: ' <file>`\n" +
    "3. Check the function signature at the call site — does the argument type match the parameter?\n" +
    "4. Do NOT guess or cast with `as any`. Fix the root type mismatch.\n" +
    "5. After fixing, run `npm run typecheck` to confirm the error is resolved.",

  ModuleNotFound:
    "## Module Not Found — Diagnosis Protocol\n\n" +
    "1. Run: `node -e \"require.resolve('<module-name>')\"` to find the actual resolution path.\n" +
    "2. Check package.json to confirm the dependency is listed.\n" +
    "3. Check the import path for typos — use Glob to find the actual file.\n" +
    "4. If the module is a local package, check if it has been built: run `npm run build --workspace=packages/<name>`.\n" +
    "5. Do NOT edit import paths until you know the correct path from step 1-3.",

  TestFailure:
    "## Test Failure — Diagnosis Protocol\n\n" +
    "1. Read the failing test file. Find the exact assertion that failed.\n" +
    "2. Read the implementation file being tested.\n" +
    "3. Trace the assertion: what value was expected? What was actually returned?\n" +
    "4. Find where the implementation produces the wrong value — read that function.\n" +
    "5. Fix the implementation (not the test assertion) unless the test expectation is wrong.\n" +
    "6. Re-run only the failing test: `npx vitest run <test-file> --reporter=verbose`",

  NetworkError:
    "## Network Error — Diagnosis Protocol\n\n" +
    "This is a network failure, not a code failure.\n" +
    "1. Retry the command once — transient failures are common.\n" +
    "2. If it fails again, check if the URL/host is correct.\n" +
    "3. Do NOT rewrite networking code to fix transient errors.\n" +
    "4. If in an offline/restricted environment, use a local alternative or skip the step.",

  PermissionError:
    "## Permission Error — Diagnosis Protocol\n\n" +
    "1. Check if the path is inside the project root — paths outside may be blocked.\n" +
    "2. Do NOT use sudo or chmod unless explicitly required by the task.\n" +
    "3. Check file ownership: `ls -la <path>`\n" +
    "4. If a file is locked by another process, identify it: check if a build/test watcher is running.\n" +
    "5. Never escalate privileges silently — report the permission issue instead.",

  SyntaxError:
    "## Syntax Error — Diagnosis Protocol\n\n" +
    "1. Read the exact line shown in the error.\n" +
    "2. Check for: unclosed brackets, missing commas in JSON, template literal issues.\n" +
    "3. For JSON files: validate with `node -e \"JSON.parse(require('fs').readFileSync('<file>', 'utf8'))\"`.\n" +
    "4. For TypeScript: check the surrounding function/class structure for missing braces.\n" +
    "5. Fix only the syntax issue — do NOT rewrite the whole file.",

  UnknownError:
    "## Unknown Error — Diagnosis Protocol\n\n" +
    "1. Read the full error message carefully — the root cause is usually in the last few lines.\n" +
    "2. Search the codebase for the specific error message: use Grep.\n" +
    "3. Check if a dependency is missing or a file path is wrong.\n" +
    "4. If you cannot diagnose from the error alone, add minimal logging and re-run.\n" +
    "5. Do NOT retry the identical command without understanding why it failed.",
};

/**
 * Build a structured diagnosis prompt for a classified error.
 * This prompt is injected into the next LLM round to guide structured debugging.
 */
export function buildDebugPrompt(
  errorClass: ErrorClass,
  command: string,
  output: string,
): string {
  const protocol = DEBUG_PROMPTS[errorClass];
  const truncated = output.length > 800 ? output.slice(0, 800) + "\n...(truncated)" : output;
  return `${protocol}\n\n**Failed command:** \`${command}\`\n\n**Error output:**\n\`\`\`\n${truncated}\n\`\`\``;
}

// ----------------------------------------------------------------------------
// Escalation Detection
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Test Runner Support
// ----------------------------------------------------------------------------

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  failures: Array<{ name: string; message: string; file?: string; line?: number }>;
  duration_ms: number;
  exitCode: number;
  rawOutput: string;
}

/**
 * Detect the appropriate test command for the given directory.
 */
export async function detectTestCommand(cwd: string): Promise<string> {
  const { access } = await import("node:fs/promises");
  const checks: Array<[string, string]> = [
    ["vitest.config.ts", "npx vitest run"],
    ["vitest.config.js", "npx vitest run"],
    ["jest.config.ts", "npx jest --passWithNoTests"],
    ["jest.config.js", "npx jest --passWithNoTests"],
    ["pyproject.toml", "python -m pytest"],
    ["pytest.ini", "python -m pytest"],
    ["Cargo.toml", "cargo test"],
    ["go.mod", "go test ./..."],
  ];
  for (const [file, cmd] of checks) {
    try {
      await access(`${cwd}/${file}`);
      return cmd;
    } catch {
      /* next */
    }
  }
  return "npx vitest run";
}

/**
 * Parse test runner output into structured TestResult.
 * Handles vitest, jest, pytest, cargo test output formats.
 */
export function parseTestOutput(output: string, exitCode: number): TestResult {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;
  const failures: TestResult["failures"] = [];

  // Vitest format: "Tests  5 passed | 2 failed (7)" or "Tests 5 passed (7)"
  const vitestMatch = output.match(
    /Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/,
  );
  if (vitestMatch) {
    passed = parseInt(vitestMatch[1]!);
    failed = parseInt(vitestMatch[2] ?? "0");
    skipped = parseInt(vitestMatch[3] ?? "0");
    total = parseInt(vitestMatch[4]!);
  }

  // Jest format: "Tests: 1 failed, 5 passed, 6 total"
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed.*?(\d+)\s+total/);
  if (jestMatch && !vitestMatch) {
    failed = parseInt(jestMatch[1] ?? "0");
    passed = parseInt(jestMatch[2]!);
    total = parseInt(jestMatch[3]!);
    skipped = total - passed - failed;
  }

  // Pytest format: "3 passed, 1 failed"
  const pytestMatch = output.match(/(\d+)\s+passed(?:,\s+(\d+)\s+(?:failed|error))?/);
  if (pytestMatch && !vitestMatch && !jestMatch) {
    passed = parseInt(pytestMatch[1]!);
    failed = parseInt(pytestMatch[2] ?? "0");
    total = passed + failed;
  }

  // Cargo format: "test result: FAILED. 4 passed; 1 failed"
  const cargoMatch = output.match(
    /test result: (?:ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed/,
  );
  if (cargoMatch && !vitestMatch && !jestMatch && !pytestMatch) {
    passed = parseInt(cargoMatch[1]!);
    failed = parseInt(cargoMatch[2]!);
    total = passed + failed;
  }

  // Extract failure names
  for (const line of output.split("\n")) {
    const failLine = line.match(/^\s*(?:FAIL|FAILED|×|✗)\s+(.+)/);
    if (failLine) failures.push({ name: failLine[1]!.trim(), message: "" });
  }

  return { passed, failed, skipped, total, failures, duration_ms: 0, exitCode, rawOutput: output };
}

// ----------------------------------------------------------------------------
// Escalation Detection
// ----------------------------------------------------------------------------

/**
 * Returns true when the same error class has appeared 3+ times in the recent
 * error history — a signal to break out of the current approach and escalate
 * to a full repair loop (pivot instruction).
 */
export function shouldEscalateToRepairLoop(errorHistory: ErrorRecord[]): boolean {
  if (errorHistory.length < 3) return false;

  const recent = errorHistory.slice(-5);
  const classCounts = new Map<ErrorClass, number>();
  for (const rec of recent) {
    classCounts.set(rec.errorClass, (classCounts.get(rec.errorClass) ?? 0) + 1);
  }

  for (const count of classCounts.values()) {
    if (count >= 3) return true;
  }
  return false;
}
