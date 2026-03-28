/**
 * test-parsers.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  parseVitestOutput,
  parseJestOutput,
  parsePytestOutput,
  parseGoTestOutput,
  parseTestOutput,
} from "./test-parsers.js";

describe("parseVitestOutput", () => {
  it("should parse single failure", () => {
    const output = `
FAIL src/example.test.ts > suite name > test name
  Error: expected 1 to be 2
    at /path/to/example.test.ts:10:5
    at processTicksAndRejections (node:internal/process/task_queues:96:5)
`;

    const failures = parseVitestOutput(output);

    expect(failures).toHaveLength(1);
    expect(failures[0]!).toMatchObject({
      testFile: "src/example.test.ts",
      testName: "test name",
      error: "expected 1 to be 2",
    });
    expect(failures[0]!.stackTrace).toContain("/path/to/example.test.ts:10:5");
  });

  it("should parse multiple failures", () => {
    const output = `
FAIL src/a.test.ts > suite > test one
  Error: first error
    at /path/to/a.test.ts:5:10

FAIL src/b.test.ts > suite > test two
  AssertionError: second error
    at /path/to/b.test.ts:20:15
`;

    const failures = parseVitestOutput(output);

    expect(failures).toHaveLength(2);
    expect(failures[0]!.testName).toBe("test one");
    expect(failures[1]!.testName).toBe("test two");
  });

  it("should parse failure with ❯ marker", () => {
    const output = `
❯ src/example.test.ts > should work
  TypeError: Cannot read property 'foo' of undefined
    at Object.<anonymous> (/path/to/example.test.ts:15:20)
`;

    const failures = parseVitestOutput(output);

    expect(failures).toHaveLength(1);
    expect(failures[0]!.testName).toBe("should work");
    expect(failures[0]!.error).toBe("Cannot read property 'foo' of undefined");
  });

  it("should handle empty output", () => {
    const failures = parseVitestOutput("");
    expect(failures).toHaveLength(0);
  });
});

describe("parseJestOutput", () => {
  it("should parse single failure", () => {
    const output = `
FAIL src/example.test.ts
  ● suite name › test name

    expect(received).toBe(expected)

    Expected: 2
    Received: 1

      10 | test('should work', () => {
    > 11 |   expect(1).toBe(2);
         |             ^
      12 | });

    at Object.<anonymous> (src/example.test.ts:11:13)
`;

    const failures = parseJestOutput(output);

    expect(failures).toHaveLength(1);
    expect(failures[0]!).toMatchObject({
      testFile: "src/example.test.ts",
      testName: "suite name › test name",
      error: "expect(received).toBe(expected)",
    });
  });

  it("should parse multiple failures in same file", () => {
    const output = `
FAIL src/example.test.ts
  ● test one

    Error: first error

    at src/example.test.ts:5:10

  ● test two

    Error: second error

    at src/example.test.ts:15:10
`;

    const failures = parseJestOutput(output);

    expect(failures).toHaveLength(2);
    expect(failures[0]!.testName).toBe("test one");
    expect(failures[1]!.testName).toBe("test two");
  });

  it("should parse failures across multiple files", () => {
    const output = `
FAIL src/a.test.ts
  ● test in a

    Error: error a

FAIL src/b.test.ts
  ● test in b

    Error: error b
`;

    const failures = parseJestOutput(output);

    expect(failures).toHaveLength(2);
    expect(failures[0]!.testFile).toBe("src/a.test.ts");
    expect(failures[1]!.testFile).toBe("src/b.test.ts");
  });

  it("should handle empty output", () => {
    const failures = parseJestOutput("");
    expect(failures).toHaveLength(0);
  });
});

describe("parsePytestOutput", () => {
  it("should parse single failure", () => {
    const output = `
FAILED tests/test_example.py::test_function - AssertionError: assert 1 == 2
`;

    const failures = parsePytestOutput(output);

    expect(failures).toHaveLength(1);
    expect(failures[0]!).toMatchObject({
      testFile: "tests/test_example.py",
      testName: "test_function",
      error: "AssertionError: assert 1 == 2",
    });
  });

  it("should parse failure with class", () => {
    const output = `
FAILED tests/test_example.py::TestClass::test_method
    File "/path/to/test_example.py", line 10
    AssertionError: expected value
`;

    const failures = parsePytestOutput(output);

    expect(failures).toHaveLength(1);
    expect(failures[0]!).toMatchObject({
      testFile: "tests/test_example.py",
      testName: "TestClass::test_method",
    });
  });

  it("should parse multiple failures", () => {
    const output = `
FAILED tests/test_a.py::test_one - AssertionError: error one
FAILED tests/test_b.py::test_two - ValueError: error two
`;

    const failures = parsePytestOutput(output);

    expect(failures).toHaveLength(2);
    expect(failures[0]!.testName).toBe("test_one");
    expect(failures[1]!.testName).toBe("test_two");
  });

  it("should handle empty output", () => {
    const failures = parsePytestOutput("");
    expect(failures).toHaveLength(0);
  });
});

describe("parseGoTestOutput", () => {
  it("should parse single failure", () => {
    const output = `
--- FAIL: TestFunction (0.00s)
    example_test.go:10: error message here
`;

    const failures = parseGoTestOutput(output);

    expect(failures).toHaveLength(1);
    expect(failures[0]!).toMatchObject({
      testFile: "example_test.go",
      testName: "TestFunction",
      error: "error message here",
    });
    expect(failures[0]!.stackTrace).toContain("example_test.go:10");
  });

  it("should parse multiple failures", () => {
    const output = `
--- FAIL: TestOne (0.00s)
    a_test.go:5: first error
--- FAIL: TestTwo (0.00s)
    b_test.go:10: second error
`;

    const failures = parseGoTestOutput(output);

    expect(failures).toHaveLength(2);
    expect(failures[0]!.testName).toBe("TestOne");
    expect(failures[1]!.testName).toBe("TestTwo");
  });

  it("should parse failure with multiple error lines", () => {
    const output = `
--- FAIL: TestExample (0.00s)
    example_test.go:10: first line
    example_test.go:15: second line
`;

    const failures = parseGoTestOutput(output);

    expect(failures).toHaveLength(1);
    expect(failures[0]!.error).toBe("second line"); // Takes last error
  });

  it("should handle empty output", () => {
    const failures = parseGoTestOutput("");
    expect(failures).toHaveLength(0);
  });
});

describe("parseTestOutput (auto-detect)", () => {
  it("should detect Vitest format", () => {
    const output = `
FAIL src/example.test.ts > suite > test
  Error: test error
`;

    const failures = parseTestOutput(output);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.testFile).toBe("src/example.test.ts");
  });

  it("should detect Jest format", () => {
    const output = `
FAIL src/example.test.ts
  ● test name

    Error: test error
`;

    const failures = parseTestOutput(output);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.testFile).toBe("src/example.test.ts");
  });

  it("should detect Pytest format", () => {
    const output = `
FAILED tests/test_example.py::test_function - Error: test error
`;

    const failures = parseTestOutput(output);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.testFile).toBe("tests/test_example.py");
  });

  it("should detect Go test format", () => {
    const output = `
--- FAIL: TestExample (0.00s)
    example_test.go:10: test error
`;

    const failures = parseTestOutput(output);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.testFile).toBe("example_test.go");
  });

  it("should use specified runner", () => {
    const output = `
FAIL src/test.ts > test
  Error: test error
`;

    const vitestResult = parseTestOutput(output, "vitest");
    expect(vitestResult).toHaveLength(1);

    const jestResult = parseTestOutput(output, "jest");
    expect(jestResult).toHaveLength(0); // Won't match Jest format
  });
});
