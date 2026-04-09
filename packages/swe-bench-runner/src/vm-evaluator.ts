// ============================================================================
// @dantecode/swe-bench-runner — VM Evaluator
//
// Runs a test_patch string against agent-provided code using Node.js vm.
// Supports Jest/Vitest-style assertions: toBe, toEqual, toThrow,
// toBeUndefined, resolves, rejects, toBeNull, toBeTruthy, toBeFalsy,
// toContain, toHaveLength, toBeGreaterThan, toBeLessThan.
//
// Does NOT require Docker or a real test runner — everything runs in-process.
// 5-second hard timeout per instance.
// ============================================================================

import vm from "node:vm";

export interface VmRunResult {
  passed: boolean;
  error?: string;
  durationMs: number;
}

const TIMEOUT_MS = 5_000;

// ─── Assertion Primitives ─────────────────────────────────────────────────────

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    const k = ka[i]!;
    if (k !== kb[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      return false;
  }
  return true;
}

function makeExpect(value: unknown) {
  const self = {
    toBe(expected: unknown) {
      if (value !== expected) {
        throw new AssertionError(
          `Expected ${JSON.stringify(value)} to be ${JSON.stringify(expected)}`,
        );
      }
    },
    toEqual(expected: unknown) {
      if (!deepEqual(value, expected)) {
        throw new AssertionError(
          `Expected ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`,
        );
      }
    },
    toBeUndefined() {
      if (value !== undefined) {
        throw new AssertionError(`Expected ${JSON.stringify(value)} to be undefined`);
      }
    },
    toBeNull() {
      if (value !== null) {
        throw new AssertionError(`Expected ${JSON.stringify(value)} to be null`);
      }
    },
    toBeTruthy() {
      if (!value) {
        throw new AssertionError(`Expected ${JSON.stringify(value)} to be truthy`);
      }
    },
    toBeFalsy() {
      if (value) {
        throw new AssertionError(`Expected ${JSON.stringify(value)} to be falsy`);
      }
    },
    toContain(item: unknown) {
      if (Array.isArray(value)) {
        if (!value.includes(item)) {
          throw new AssertionError(`Expected array to contain ${JSON.stringify(item)}`);
        }
      } else if (typeof value === "string") {
        if (!value.includes(String(item))) {
          throw new AssertionError(`Expected string to contain ${JSON.stringify(item)}`);
        }
      } else {
        throw new AssertionError("toContain requires an array or string");
      }
    },
    toHaveLength(len: number) {
      const actual = (value as { length?: number }).length;
      if (actual !== len) {
        throw new AssertionError(`Expected length ${len} but got ${actual}`);
      }
    },
    toBeGreaterThan(n: number) {
      if ((value as number) <= n) {
        throw new AssertionError(
          `Expected ${JSON.stringify(value)} to be greater than ${n}`,
        );
      }
    },
    toBeLessThan(n: number) {
      if ((value as number) >= n) {
        throw new AssertionError(
          `Expected ${JSON.stringify(value)} to be less than ${n}`,
        );
      }
    },
    toThrow(msgOrClass?: string | RegExp | (new (...args: unknown[]) => Error)) {
      if (typeof value !== "function") {
        throw new AssertionError("toThrow requires the value to be a function");
      }
      let threw = false;
      let thrownError: unknown;
      try {
        (value as () => void)();
      } catch (e) {
        threw = true;
        thrownError = e;
      }
      if (!threw) {
        throw new AssertionError("Expected function to throw but it did not");
      }
      if (msgOrClass !== undefined) {
        const errMsg =
          thrownError instanceof Error ? thrownError.message : String(thrownError);
        if (typeof msgOrClass === "string") {
          if (!errMsg.includes(msgOrClass)) {
            throw new AssertionError(
              `Expected error message to include "${msgOrClass}" but got "${errMsg}"`,
            );
          }
        } else if (msgOrClass instanceof RegExp) {
          if (!msgOrClass.test(errMsg)) {
            throw new AssertionError(
              `Expected error message to match ${msgOrClass} but got "${errMsg}"`,
            );
          }
        }
      }
    },
    not: {
      toBe(expected: unknown) {
        if (value === expected) {
          throw new AssertionError(
            `Expected ${JSON.stringify(value)} not to be ${JSON.stringify(expected)}`,
          );
        }
      },
      toBeUndefined() {
        if (value === undefined) {
          throw new AssertionError(`Expected value not to be undefined`);
        }
      },
      toThrow() {
        if (typeof value !== "function") {
          throw new AssertionError("not.toThrow requires the value to be a function");
        }
        try {
          (value as () => void)();
        } catch {
          throw new AssertionError("Expected function not to throw but it did");
        }
      },
    },
    resolves: null as unknown,
    rejects: null as unknown,
  };

  // Async matchers
  self.resolves = {
    async toBe(expected: unknown) {
      const actual = await (value as Promise<unknown>);
      if (actual !== expected) {
        throw new AssertionError(
          `Expected resolved value ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`,
        );
      }
    },
    async toEqual(expected: unknown) {
      const actual = await (value as Promise<unknown>);
      if (!deepEqual(actual, expected)) {
        throw new AssertionError(
          `Expected resolved value ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
        );
      }
    },
  };

  self.rejects = {
    async toThrow(msgOrClass?: string | RegExp) {
      let rejected = false;
      let reason: unknown;
      try {
        await (value as Promise<unknown>);
      } catch (e) {
        rejected = true;
        reason = e;
      }
      if (!rejected) {
        throw new AssertionError("Expected promise to reject but it resolved");
      }
      if (msgOrClass !== undefined) {
        const errMsg = reason instanceof Error ? reason.message : String(reason);
        if (typeof msgOrClass === "string") {
          if (!errMsg.includes(msgOrClass)) {
            throw new AssertionError(
              `Expected rejection message to include "${msgOrClass}" but got "${errMsg}"`,
            );
          }
        } else if (msgOrClass instanceof RegExp) {
          if (!msgOrClass.test(errMsg)) {
            throw new AssertionError(
              `Expected rejection message to match ${msgOrClass} but got "${errMsg}"`,
            );
          }
        }
      }
    },
  };

  return self;
}

// ─── TypeScript Preprocessor ──────────────────────────────────────────────────

/**
 * Strip common TypeScript type annotations from code so it can run in the
 * Node.js VM (which only understands JavaScript).
 *
 * Handles the patterns present in the built-in SWE-bench instances:
 *   - Function/class generic params: <T>, <K, V>, <T extends X>
 *   - Parameter type annotations:  (x: string, y: number[])
 *   - Return type annotations:      ): string {
 *   - Union return types:            ): number | undefined {
 *   - Type assertions:              obj as object
 *   - Generic function calls:       arr as unknown[]
 */
export function stripTypeAnnotations(code: string): string {
  let s = code;

  // 1. Remove generic type params on function/class declarations
  //    function foo<T>(  ->  function foo(
  //    class LRUCache<K,V>  ->  class LRUCache
  s = s.replace(/\b((?:function|class)\s+\w+)<[^>(){]+>/g, "$1");

  // 2. Remove generic type params on async functions
  //    async function foo<T>(  ->  async function foo(
  s = s.replace(/\b(async\s+function\s+\w+)<[^>(){]+>/g, "$1");

  // 3. Remove complex return type annotations after closing paren
  //    ): Map<K, T[]> {   ->  ) {
  //    ): number | undefined {  ->  ) {
  //    ): Promise<T> {  ->  ) {
  //    ): T[][] {  ->  ) {
  s = s.replace(/\):\s*[^{(=;,\n]+(?=\s*[{])/g, ") ");

  // 4. Remove parameter type annotations (simple: `: word` and `: word[]`)
  //    (str: string, maxLen: number)  ->  (str, maxLen)
  //    Works iteratively to catch all params
  // Match ': TYPE' where TYPE is word chars, arrays, or simple generics
  s = s.replace(/:\s*(?:[A-Za-z_$][\w$]*(?:<[^<>(){}]*>)?(?:\[\])*(?:\s*\|\s*[A-Za-z_$][\w$]*(?:\[\])*)*)/g, "");

  // 5. Remove 'as TYPE' type assertions
  //    obj as object  ->  obj
  s = s.replace(/\s+as\s+(?:[A-Za-z_$][\w$]*(?:\[\])*)/g, "");

  // 6. Clean up any leftover angle brackets from generics that weren't caught
  //    But be careful not to remove comparison operators
  // Only remove standalone `<TYPE>` that look like type casts at start of expression
  s = s.replace(/\s*<([A-Z][a-zA-Z0-9]*)>\s*/g, " ");

  return s;
}

// ─── Test Harness ─────────────────────────────────────────────────────────────

interface TestEntry {
  name: string;
  fn: () => void | Promise<void>;
}

function buildTestHarness(): {
  tests: TestEntry[];
  test: (name: string, fn: () => void | Promise<void>) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: typeof makeExpect;
} {
  const tests: TestEntry[] = [];
  const test = (name: string, fn: () => void | Promise<void>) => {
    tests.push({ name, fn });
  };
  return { tests, test, it: test, expect: makeExpect };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a test_patch string against agent-provided code in a sandboxed vm.
 *
 * The combined script is: `${agentCode}\n${testPatch}`
 * Tests are collected via `test(name, fn)` / `it(name, fn)` shims, then run.
 * Any assertion failure or thrown error causes `passed: false`.
 */
export async function runTestPatch(
  agentCode: string,
  testPatch: string,
  _instanceId: string,
): Promise<VmRunResult> {
  const start = Date.now();
  const harness = buildTestHarness();

  // Strip TypeScript type annotations so agent code runs in plain JS context
  const processedCode = stripTypeAnnotations(agentCode);
  const script = `${processedCode}\n${testPatch}`;

  const sandbox: vm.Context = {
    test: harness.test,
    it: harness.it,
    expect: harness.expect,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Error,
    TypeError,
    RangeError,
    Math,
    Array,
    Object,
    Map,
    Set,
    WeakSet,
    WeakMap,
    JSON,
    Number,
    String,
    Boolean,
    RegExp,
    Date,
    Symbol,
    Infinity,
    NaN,
    undefined,
    // Expose exports object for CommonJS-style functions
    exports: {} as Record<string, unknown>,
  };
  vm.createContext(sandbox);

  // Step 1: evaluate the combined script to collect tests
  try {
    const compiledScript = new vm.Script(script);
    const result = compiledScript.runInContext(sandbox, { timeout: TIMEOUT_MS });
    // If script returns a Promise (top-level await via eval), await it
    if (result instanceof Promise) {
      await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error("Script timeout")), TIMEOUT_MS))]);
    }
  } catch (e) {
    return {
      passed: false,
      error: `Script execution error: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - start,
    };
  }

  // Step 2: if no tests were collected, check if the test_patch uses inline assertions
  if (harness.tests.length === 0) {
    // Nothing to run — treat as passed (agent code ran without error)
    return { passed: true, durationMs: Date.now() - start };
  }

  // Step 3: run each collected test
  for (const entry of harness.tests) {
    try {
      const maybePromise = entry.fn();
      if (maybePromise instanceof Promise) {
        await Promise.race([
          maybePromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Test "${entry.name}" timed out`)), TIMEOUT_MS),
          ),
        ]);
      }
    } catch (e) {
      return {
        passed: false,
        error: `Test "${entry.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
        durationMs: Date.now() - start,
      };
    }
  }

  return { passed: true, durationMs: Date.now() - start };
}
