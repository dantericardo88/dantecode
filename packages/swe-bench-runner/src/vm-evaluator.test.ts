// ============================================================================
// @dantecode/swe-bench-runner — VM Evaluator Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { runTestPatch } from "./vm-evaluator.js";

describe("runTestPatch", () => {
  it("passes when reference patch satisfies the test", async () => {
    const agentCode = `
      function truncate(str, maxLen) {
        if (str.length <= maxLen) return str;
        return str.slice(0, maxLen - 3) + '...';
      }
    `;
    const testPatch = `test('truncate adds ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });`;
    const result = await runTestPatch(agentCode, testPatch, "ts-utils__001");
    expect(result.passed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("fails when agent code is wrong", async () => {
    const agentCode = `
      function truncate(str, maxLen) {
        return str; // bug: never truncates
      }
    `;
    const testPatch = `test('truncate adds ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });`;
    const result = await runTestPatch(agentCode, testPatch, "ts-utils__001");
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles toThrow assertions", async () => {
    const agentCode = `
      function clamp(value, min, max) {
        if (min > max) throw new Error('min must be <= max');
        return Math.min(Math.max(value, min), max);
      }
    `;
    const testPatch = `test('clamp throws when min > max', () => {
      expect(() => clamp(5, 10, 2)).toThrow('min must be <= max');
    });`;
    const result = await runTestPatch(agentCode, testPatch, "ts-utils__003");
    expect(result.passed).toBe(true);
  });

  it("handles async test with resolves matcher", async () => {
    const agentCode = `
      async function retry(fn, times, delayMs = 0) {
        for (let i = 0; i < times; i++) {
          try { return await fn(); } catch (e) { if (i === times - 1) throw e; }
        }
      }
    `;
    const testPatch = `test('retry resolves on second attempt', async () => {
      let count = 0;
      const fn = async () => { if (++count < 2) throw new Error('fail'); return 'ok'; };
      await expect(retry(fn, 3)).resolves.toBe('ok');
    });`;
    const result = await runTestPatch(agentCode, testPatch, "ts-utils__005");
    expect(result.passed).toBe(true);
  });

  it("handles toEqual for deep comparison", async () => {
    const agentCode = `
      function chunk(arr, size) {
        if (arr.length === 0) return [];
        const result = [];
        for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
        return result;
      }
    `;
    const testPatch = `test('chunk empty array', () => {
      expect(chunk([], 3)).toEqual([]);
    });`;
    const result = await runTestPatch(agentCode, testPatch, "ts-utils__002");
    expect(result.passed).toBe(true);
  });

  it("handles toBeUndefined matcher", async () => {
    const agentCode = `
      function median(arr) {
        if (arr.length === 0) return undefined;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }
    `;
    const testPatch = `test('median returns undefined for empty array', () => {
      expect(median([])).toBeUndefined();
    });`;
    const result = await runTestPatch(agentCode, testPatch, "ts-utils__010");
    expect(result.passed).toBe(true);
  });

  it("returns error when script has syntax error", async () => {
    const agentCode = `function broken( { // syntax error`;
    const testPatch = `test('broken', () => { expect(true).toBe(true); });`;
    const result = await runTestPatch(agentCode, testPatch, "syntax-error");
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles LRUCache get-updates-recency test", async () => {
    const agentCode = `
      class LRUCache {
        constructor(capacity) { this.capacity = capacity; this.map = new Map(); }
        get(key) {
          if (!this.map.has(key)) return undefined;
          const val = this.map.get(key);
          this.map.delete(key);
          this.map.set(key, val);
          return val;
        }
        set(key, value) {
          if (this.map.has(key)) this.map.delete(key);
          else if (this.map.size >= this.capacity) this.map.delete(this.map.keys().next().value);
          this.map.set(key, value);
        }
      }
    `;
    const testPatch = `test('LRUCache.get updates recency', () => {
      const cache = new LRUCache(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a');
      cache.set('c', 3);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
    });`;
    const result = await runTestPatch(agentCode, testPatch, "ts-utils__012");
    expect(result.passed).toBe(true);
  });

  it("runs all 20 built-in instances against reference patches", async () => {
    const { InstanceLoader } = await import("./instance-loader.js");
    const loader = new InstanceLoader();
    const instances = loader.getBuiltinInstances();

    let passCount = 0;
    for (const inst of instances) {
      const result = await runTestPatch(inst.patch, inst.test_patch, inst.instance_id);
      if (result.passed) passCount++;
    }

    // All 20 reference patches must pass their own tests
    expect(passCount).toBe(instances.length);
  });
});
