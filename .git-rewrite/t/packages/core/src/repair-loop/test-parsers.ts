/**
 * test-parsers.ts
 *
 * Parse test output from various test runners (Vitest, Jest, Pytest, Go)
 * into a normalized TestFailure format.
 */

export interface TestFailure {
  testFile: string;
  testName: string;
  error: string;
  stackTrace?: string;
}

/**
 * Parse Vitest output
 *
 * Vitest format:
 * FAIL  src/file.test.ts > suite name > test name
 *   Error: expected 1 to be 2
 *     at /path/to/file.test.ts:10:5
 */
export function parseVitestOutput(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  if (!output.trim()) {
    return failures;
  }

  const lines = output.split("\n");
  let currentFailure: Partial<TestFailure> | null = null;
  const stackLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: FAIL src/file.test.ts > suite > test name
    // or ❯ src/file.test.ts > suite > test name
    const failMatch = line?.match(/^(?:FAIL|❯)\s+(.+?)\s+>\s+(.+)/);
    if (failMatch && failMatch[1] && failMatch[2]) {
      // Save previous failure if exists
      if (
        currentFailure &&
        currentFailure.testFile &&
        currentFailure.testName &&
        currentFailure.error
      ) {
        failures.push({
          testFile: currentFailure.testFile,
          testName: currentFailure.testName,
          error: currentFailure.error,
          stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
        });
        stackLines.length = 0;
      }

      const fileWithPath = failMatch[1];
      const testPath = failMatch[2];
      const testParts = testPath.split(">").map((s) => s.trim());
      const testName = testParts[testParts.length - 1] || "";

      currentFailure = {
        testFile: fileWithPath.trim(),
        testName,
      };
      continue;
    }

    // Match error message: Error: expected...
    // or AssertionError: ...
    const errorMatch = line?.match(/^\s*(Error|AssertionError|TypeError|ReferenceError):\s*(.+)/);
    if (errorMatch && errorMatch[2] && currentFailure && !currentFailure.error) {
      currentFailure.error = errorMatch[2].trim();
      continue;
    }

    // Match stack trace line: at /path/to/file.ts:10:5
    // or     at Object.<anonymous> (/path/to/file.ts:10:5)
    const stackMatch = line?.match(/^\s+at\s+(.+)/);
    if (stackMatch && stackMatch[1] && currentFailure) {
      stackLines.push(stackMatch[1].trim());
    }
  }

  // Save last failure
  if (
    currentFailure &&
    currentFailure.testFile &&
    currentFailure.testName &&
    currentFailure.error
  ) {
    failures.push({
      testFile: currentFailure.testFile,
      testName: currentFailure.testName,
      error: currentFailure.error,
      stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
    });
  }

  return failures;
}

/**
 * Parse Jest output
 *
 * Jest format:
 * FAIL src/file.test.ts
 *   ● suite name › test name
 *
 *     expect(received).toBe(expected)
 *
 *       10 | test('should work', () => {
 *     > 11 |   expect(1).toBe(2);
 *          |             ^
 */
export function parseJestOutput(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  if (!output.trim()) {
    return failures;
  }

  const lines = output.split("\n");
  let currentFile = "";
  let currentTest = "";
  let currentError = "";
  const stackLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Match: FAIL src/file.test.ts
    const failMatch = line.match(/^FAIL\s+(.+\.test\.[jt]s)/);
    if (failMatch && failMatch[1]) {
      // Save previous failure
      if (currentFile && currentTest && currentError) {
        failures.push({
          testFile: currentFile,
          testName: currentTest,
          error: currentError,
          stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
        });
      }

      currentFile = failMatch[1];
      currentTest = "";
      currentError = "";
      stackLines.length = 0;
      continue;
    }

    // Match: ● suite › test name
    const testMatch = line.match(/^\s*●\s+(.+)/);
    if (testMatch && testMatch[1]) {
      // Save previous test failure
      if (currentFile && currentTest && currentError) {
        failures.push({
          testFile: currentFile,
          testName: currentTest,
          error: currentError,
          stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
        });
        stackLines.length = 0;
      }

      currentTest = testMatch[1].trim();
      currentError = "";
      continue;
    }

    // Match error message or assertion
    if (currentTest && !currentError && line.trim() && !line.match(/^\s*\d+\s*\|/)) {
      const errorMatch = line.match(/^\s*(.+)/);
      if (errorMatch && errorMatch[1] && !line.includes("at ") && !line.includes("●")) {
        currentError = errorMatch[1].trim();
        continue;
      }
    }

    // Match stack trace
    const stackMatch = line.match(/^\s+at\s+(.+)/);
    if (stackMatch && stackMatch[1]) {
      stackLines.push(stackMatch[1].trim());
    }
  }

  // Save last failure
  if (currentFile && currentTest && currentError) {
    failures.push({
      testFile: currentFile,
      testName: currentTest,
      error: currentError,
      stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
    });
  }

  return failures;
}

/**
 * Parse Pytest output
 *
 * Pytest format:
 * FAILED tests/test_file.py::test_function - AssertionError: assert 1 == 2
 */
export function parsePytestOutput(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  if (!output.trim()) {
    return failures;
  }

  const lines = output.split("\n");
  let currentFailure: Partial<TestFailure> | null = null;
  const stackLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Match: FAILED tests/test_file.py::test_function - Error: message
    const failMatch = line.match(/^FAILED\s+(.+?)::(.+?)\s+-\s+(.+)/);
    if (failMatch && failMatch[1] && failMatch[2] && failMatch[3]) {
      // Save previous failure
      if (
        currentFailure &&
        currentFailure.testFile &&
        currentFailure.testName &&
        currentFailure.error
      ) {
        failures.push({
          testFile: currentFailure.testFile,
          testName: currentFailure.testName,
          error: currentFailure.error,
          stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
        });
        stackLines.length = 0;
      }

      currentFailure = {
        testFile: failMatch[1].trim(),
        testName: failMatch[2].trim(),
        error: failMatch[3].trim(),
      };
      continue;
    }

    // Match: FAILED tests/test_file.py::TestClass::test_method
    const failMatchClass = line.match(/^FAILED\s+(.+?)::(.+?)::(.+)/);
    if (failMatchClass && failMatchClass[1] && failMatchClass[2] && failMatchClass[3]) {
      // Save previous failure
      if (
        currentFailure &&
        currentFailure.testFile &&
        currentFailure.testName &&
        currentFailure.error
      ) {
        failures.push({
          testFile: currentFailure.testFile,
          testName: currentFailure.testName,
          error: currentFailure.error,
          stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
        });
        stackLines.length = 0;
      }

      currentFailure = {
        testFile: failMatchClass[1].trim(),
        testName: `${failMatchClass[2]}::${failMatchClass[3]}`.trim(),
        error: "", // Will be filled by next lines
      };
      continue;
    }

    // Match stack trace or error details
    if (currentFailure && line.trim()) {
      const stackMatch = line.match(/^\s+File\s+"(.+)",\s+line\s+(\d+)/);
      if (stackMatch && stackMatch[1] && stackMatch[2]) {
        stackLines.push(`${stackMatch[1]}:${stackMatch[2]}`);
        continue;
      }

      // Capture assertion errors
      if (line.includes("AssertionError:") || line.includes("assert ")) {
        if (!currentFailure.error) {
          currentFailure.error = line.trim();
        }
      }
    }
  }

  // Save last failure
  if (
    currentFailure &&
    currentFailure.testFile &&
    currentFailure.testName &&
    currentFailure.error
  ) {
    failures.push({
      testFile: currentFailure.testFile,
      testName: currentFailure.testName,
      error: currentFailure.error,
      stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
    });
  }

  return failures;
}

/**
 * Parse Go test output
 *
 * Go test format:
 * --- FAIL: TestFunction (0.00s)
 *     file_test.go:10: error message
 */
export function parseGoTestOutput(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  if (!output.trim()) {
    return failures;
  }

  const lines = output.split("\n");
  let currentTest = "";
  let currentFile = "";
  let currentError = "";
  const stackLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Match: --- FAIL: TestFunction (0.00s)
    const failMatch = line.match(/^---\s+FAIL:\s+(\S+)/);
    if (failMatch && failMatch[1]) {
      // Save previous failure
      if (currentTest && currentError) {
        failures.push({
          testFile: currentFile || "unknown",
          testName: currentTest,
          error: currentError,
          stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
        });
      }

      currentTest = failMatch[1];
      currentFile = "";
      currentError = "";
      stackLines.length = 0;
      continue;
    }

    // Match: file_test.go:10: error message
    const errorMatch = line.match(/^\s+(.+?\.go):(\d+):\s+(.+)/);
    if (errorMatch && errorMatch[1] && errorMatch[2] && errorMatch[3] && currentTest) {
      currentFile = errorMatch[1];
      currentError = errorMatch[3].trim();
      stackLines.push(`${errorMatch[1]}:${errorMatch[2]}`);
    }
  }

  // Save last failure
  if (currentTest && currentError) {
    failures.push({
      testFile: currentFile || "unknown",
      testName: currentTest,
      error: currentError,
      stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
    });
  }

  return failures;
}

/**
 * Auto-detect test runner from output and parse accordingly
 */
export function parseTestOutput(
  output: string,
  runner?: "vitest" | "jest" | "pytest" | "go",
): TestFailure[] {
  if (!output.trim()) {
    return [];
  }

  // If runner specified, use that parser
  if (runner === "vitest") return parseVitestOutput(output);
  if (runner === "jest") return parseJestOutput(output);
  if (runner === "pytest") return parsePytestOutput(output);
  if (runner === "go") return parseGoTestOutput(output);

  // Auto-detect from output format
  if (output.includes("--- FAIL:") || output.match(/\.go:\d+:/)) {
    return parseGoTestOutput(output);
  }

  if (output.includes("FAILED") && output.includes("::")) {
    return parsePytestOutput(output);
  }

  if (output.includes("●") && output.match(/FAIL\s+\S+\.test\.[jt]s/)) {
    return parseJestOutput(output);
  }

  // Default to Vitest (most common in this codebase)
  return parseVitestOutput(output);
}
