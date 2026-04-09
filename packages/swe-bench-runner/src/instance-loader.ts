// ============================================================================
// @dantecode/swe-bench-runner — Instance Loader
// Loads SWE-bench instances from local cache or built-in mini dataset.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SWEBenchInstance } from "./types.js";

export interface LoadOptions {
  /** Return at most this many instances */
  subset?: number;
  /** Filter to specific instance IDs */
  instanceIds?: string[];
}

export class InstanceLoader {
  private cacheDir: string;

  constructor(cacheDir = ".dantecode/swe-bench-cache") {
    this.cacheDir = cacheDir;
  }

  /**
   * Load instances from local cache if available, otherwise return builtin instances.
   */
  async loadInstances(options?: LoadOptions): Promise<SWEBenchInstance[]> {
    const cachePath = join(this.cacheDir, "instances.json");
    let instances: SWEBenchInstance[];

    if (existsSync(cachePath)) {
      try {
        const raw = await readFile(cachePath, "utf-8");
        instances = JSON.parse(raw) as SWEBenchInstance[];
      } catch {
        instances = this.getBuiltinInstances();
      }
    } else {
      instances = this.getBuiltinInstances();
    }

    // Filter by instanceIds if specified
    if (options?.instanceIds && options.instanceIds.length > 0) {
      const ids = new Set(options.instanceIds);
      instances = instances.filter((inst) => ids.has(inst.instance_id));
    }

    // Apply subset limit
    if (options?.subset != null && options.subset > 0) {
      instances = instances.slice(0, options.subset);
    }

    return instances;
  }

  /**
   * Returns 20 representative built-in TypeScript-style coding tasks.
   * These are self-contained mini-instances that don't require Docker.
   */
  getBuiltinInstances(): SWEBenchInstance[] {
    return [
      {
        instance_id: "ts-utils__001",
        repo: "ts-utils/string-helpers",
        problem_statement:
          "The `truncate(str, maxLen)` function does not add an ellipsis when the string exceeds maxLen. " +
          "It should return `str.slice(0, maxLen - 3) + '...'` when str.length > maxLen.",
        base_commit: "abc0001",
        test_patch:
          "test('truncate adds ellipsis', () => { expect(truncate('hello world', 8)).toBe('hello...'); });",
        patch:
          "function truncate(str: string, maxLen: number): string {\n  if (str.length <= maxLen) return str;\n  return str.slice(0, maxLen - 3) + '...';\n}",
        fail_to_pass: ["truncate adds ellipsis"],
        pass_to_pass: ["truncate short string"],
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        instance_id: "ts-utils__002",
        repo: "ts-utils/array-helpers",
        problem_statement:
          "The `chunk(arr, size)` function throws when given an empty array. " +
          "It should return an empty array `[]` instead of throwing.",
        base_commit: "abc0002",
        test_patch:
          "test('chunk empty array', () => { expect(chunk([], 3)).toEqual([]); });",
        patch:
          "function chunk<T>(arr: T[], size: number): T[][] {\n  if (arr.length === 0) return [];\n  const result: T[][] = [];\n  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));\n  return result;\n}",
        fail_to_pass: ["chunk empty array"],
        pass_to_pass: ["chunk normal array"],
        created_at: "2026-01-02T00:00:00Z",
      },
      {
        instance_id: "ts-utils__003",
        repo: "ts-utils/number-helpers",
        problem_statement:
          "The `clamp(value, min, max)` function does not handle the case where min > max. " +
          "It should throw an Error with message 'min must be <= max' in that case.",
        base_commit: "abc0003",
        test_patch:
          "test('clamp throws when min > max', () => { expect(() => clamp(5, 10, 2)).toThrow('min must be <= max'); });",
        patch:
          "function clamp(value: number, min: number, max: number): number {\n  if (min > max) throw new Error('min must be <= max');\n  return Math.min(Math.max(value, min), max);\n}",
        fail_to_pass: ["clamp throws when min > max"],
        pass_to_pass: ["clamp normal value"],
        created_at: "2026-01-03T00:00:00Z",
      },
      {
        instance_id: "ts-utils__004",
        repo: "ts-utils/object-helpers",
        problem_statement:
          "The `deepClone(obj)` function does not handle circular references and causes a stack overflow. " +
          "It should throw a TypeError with message 'Circular reference detected' when circular refs are found.",
        base_commit: "abc0004",
        test_patch:
          "test('deepClone detects circular reference', () => { const obj = {}; obj['self'] = obj; expect(() => deepClone(obj)).toThrow('Circular reference detected'); });",
        patch:
          "function deepClone(obj, seen = new WeakSet()) {\n  if (typeof obj !== 'object' || obj === null) return obj;\n  if (seen.has(obj)) throw new TypeError('Circular reference detected');\n  seen.add(obj);\n  if (Array.isArray(obj)) return obj.map((v) => deepClone(v, seen));\n  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deepClone(v, seen)]));\n}",
        fail_to_pass: ["deepClone detects circular reference"],
        pass_to_pass: ["deepClone simple object"],
        created_at: "2026-01-04T00:00:00Z",
      },
      {
        instance_id: "ts-utils__005",
        repo: "ts-utils/async-helpers",
        problem_statement:
          "The `retry(fn, times)` function retries immediately without any delay, causing test flakiness. " +
          "Add an optional `delayMs` parameter that defaults to 0 but waits between retries when set.",
        base_commit: "abc0005",
        test_patch:
          "test('retry resolves on second attempt', async () => { let count = 0; const fn = async () => { if (++count < 2) throw new Error('fail'); return 'ok'; }; await expect(retry(fn, 3)).resolves.toBe('ok'); });",
        patch:
          "async function retry(fn, times, delayMs = 0) {\n  for (let i = 0; i < times; i++) {\n    try { return await fn(); } catch (e) { if (i === times - 1) throw e; if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs)); }\n  }\n  throw new Error('unreachable');\n}",
        fail_to_pass: ["retry resolves on second attempt"],
        pass_to_pass: ["retry rejects after max attempts"],
        created_at: "2026-01-05T00:00:00Z",
      },
      {
        instance_id: "ts-utils__006",
        repo: "ts-utils/date-helpers",
        problem_statement:
          "The `formatDate(date, format)` function returns an incorrect day-of-week for dates in January. " +
          "The bug is in the weekday index calculation — it should use `date.getDay()` not `date.getDate() % 7`.",
        base_commit: "abc0006",
        test_patch:
          "test('formatDate returns correct weekday', () => { const d = new Date('2026-01-05T12:00:00Z'); expect(formatDate(d, 'DDD')).toBe('Mon'); });",
        patch:
          "const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];\nfunction formatDate(date, format) {\n  if (format === 'DDD') return DAYS[date.getUTCDay()] ?? 'Unknown';\n  return date.toISOString().slice(0, 10);\n}",
        fail_to_pass: ["formatDate returns correct weekday"],
        pass_to_pass: ["formatDate ISO format"],
        created_at: "2026-01-06T00:00:00Z",
      },
      {
        instance_id: "ts-utils__007",
        repo: "ts-utils/validation",
        problem_statement:
          "The `isEmail(str)` function accepts strings with no TLD (e.g. 'user@localhost'). " +
          "It should require at least one dot in the domain portion.",
        base_commit: "abc0007",
        test_patch:
          "test('isEmail rejects no-TLD address', () => { expect(isEmail('user@localhost')).toBe(false); });",
        patch:
          "function isEmail(str: string): boolean {\n  return /^[^@]+@[^@]+\\.[^@]+$/.test(str);\n}",
        fail_to_pass: ["isEmail rejects no-TLD address"],
        pass_to_pass: ["isEmail accepts valid address"],
        created_at: "2026-01-07T00:00:00Z",
      },
      {
        instance_id: "ts-utils__008",
        repo: "ts-utils/collections",
        problem_statement:
          "The `groupBy(arr, keyFn)` function mutates the original array. " +
          "It should not mutate the input and should return a new Map.",
        base_commit: "abc0008",
        test_patch:
          "test('groupBy does not mutate input', () => { const arr = [{n:1},{n:2},{n:1}]; const copy = [...arr]; groupBy(arr, (x) => x.n); expect(arr).toEqual(copy); });",
        patch:
          "function groupBy(arr, keyFn) {\n  const map = new Map();\n  for (const item of arr) {\n    const key = keyFn(item);\n    const group = map.get(key) ?? [];\n    group.push(item);\n    map.set(key, group);\n  }\n  return map;\n}",
        fail_to_pass: ["groupBy does not mutate input"],
        pass_to_pass: ["groupBy groups correctly"],
        created_at: "2026-01-08T00:00:00Z",
      },
      {
        instance_id: "ts-utils__009",
        repo: "ts-utils/string-helpers",
        problem_statement:
          "The `camelToSnake(str)` function does not handle consecutive uppercase letters correctly. " +
          "'HTMLParser' should become 'html_parser' but currently produces 'h_t_m_l_parser'.",
        base_commit: "abc0009",
        test_patch:
          "test('camelToSnake handles consecutive caps', () => { expect(camelToSnake('HTMLParser')).toBe('html_parser'); });",
        patch:
          "function camelToSnake(str: string): string {\n  return str\n    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')\n    .replace(/([a-z])([A-Z])/g, '$1_$2')\n    .toLowerCase();\n}",
        fail_to_pass: ["camelToSnake handles consecutive caps"],
        pass_to_pass: ["camelToSnake simple camel"],
        created_at: "2026-01-09T00:00:00Z",
      },
      {
        instance_id: "ts-utils__010",
        repo: "ts-utils/math",
        problem_statement:
          "The `median(arr)` function crashes when given an empty array. " +
          "It should return `undefined` for an empty array instead of throwing.",
        base_commit: "abc0010",
        test_patch:
          "test('median returns undefined for empty array', () => { expect(median([])).toBeUndefined(); });",
        patch:
          "function median(arr: number[]): number | undefined {\n  if (arr.length === 0) return undefined;\n  const sorted = [...arr].sort((a, b) => a - b);\n  const mid = Math.floor(sorted.length / 2);\n  return sorted.length % 2 !== 0 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;\n}",
        fail_to_pass: ["median returns undefined for empty array"],
        pass_to_pass: ["median odd array", "median even array"],
        created_at: "2026-01-10T00:00:00Z",
      },
      {
        instance_id: "ts-utils__011",
        repo: "ts-utils/async-helpers",
        problem_statement:
          "The `timeout(promise, ms)` function resolves with `undefined` instead of rejecting when the timeout fires. " +
          "It should reject with a TimeoutError when the promise takes longer than `ms` milliseconds.",
        base_commit: "abc0011",
        test_patch:
          "test('timeout rejects on slow promise', async () => { const slow = new Promise(r => setTimeout(r, 1000)); await expect(timeout(slow, 10)).rejects.toThrow('Timeout'); });",
        patch:
          "class TimeoutError extends Error { constructor(ms) { super(`Timeout after ${ms}ms`); this.name = 'TimeoutError'; } }\nasync function timeout(promise, ms) {\n  let timer;\n  const race = new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(ms)), ms); });\n  try { return await Promise.race([promise, race]); } finally { clearTimeout(timer); }\n}",
        fail_to_pass: ["timeout rejects on slow promise"],
        pass_to_pass: ["timeout resolves fast promise"],
        created_at: "2026-01-11T00:00:00Z",
      },
      {
        instance_id: "ts-utils__012",
        repo: "ts-utils/collections",
        problem_statement:
          "The `LRUCache.get(key)` method does not update the recency of the accessed item. " +
          "After `get`, the accessed item should be moved to the most-recently-used position.",
        base_commit: "abc0012",
        test_patch:
          "test('LRUCache.get updates recency', () => { const cache = new LRUCache(2); cache.set('a',1); cache.set('b',2); cache.get('a'); cache.set('c',3); expect(cache.get('a')).toBe(1); expect(cache.get('b')).toBeUndefined(); });",
        patch:
          "class LRUCache {\n  constructor(capacity) { this.capacity = capacity; this.map = new Map(); }\n  get(key) {\n    if (!this.map.has(key)) return undefined;\n    const val = this.map.get(key);\n    this.map.delete(key);\n    this.map.set(key, val);\n    return val;\n  }\n  set(key, value) {\n    if (this.map.has(key)) this.map.delete(key);\n    else if (this.map.size >= this.capacity) this.map.delete(this.map.keys().next().value);\n    this.map.set(key, value);\n  }\n}",
        fail_to_pass: ["LRUCache.get updates recency"],
        pass_to_pass: ["LRUCache basic set/get"],
        created_at: "2026-01-12T00:00:00Z",
      },
      {
        instance_id: "ts-utils__013",
        repo: "ts-utils/string-helpers",
        problem_statement:
          "The `parseQueryString(qs)` function does not decode percent-encoded characters. " +
          "'name=hello%20world' should parse to `{ name: 'hello world' }` but currently returns `{ name: 'hello%20world' }`.",
        base_commit: "abc0013",
        test_patch:
          "test('parseQueryString decodes percent encoding', () => { expect(parseQueryString('name=hello%20world')).toEqual({ name: 'hello world' }); });",
        patch:
          "function parseQueryString(qs: string): Record<string, string> {\n  return Object.fromEntries(qs.split('&').map(pair => { const [k, v = ''] = pair.split('='); return [decodeURIComponent(k ?? ''), decodeURIComponent(v)]; }));\n}",
        fail_to_pass: ["parseQueryString decodes percent encoding"],
        pass_to_pass: ["parseQueryString basic pairs"],
        created_at: "2026-01-13T00:00:00Z",
      },
      {
        instance_id: "ts-utils__014",
        repo: "ts-utils/number-helpers",
        problem_statement:
          "The `formatBytes(bytes)` function uses 1000 as the divisor instead of 1024. " +
          "1024 bytes should show as '1.00 KB' but currently shows '1.02 KB'.",
        base_commit: "abc0014",
        test_patch:
          "test('formatBytes uses 1024 divisor', () => { expect(formatBytes(1024)).toBe('1.00 KB'); });",
        patch:
          "function formatBytes(bytes: number): string {\n  const units = ['B','KB','MB','GB','TB'];\n  let i = 0;\n  let val = bytes;\n  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }\n  return `${val.toFixed(2)} ${units[i]}`;\n}",
        fail_to_pass: ["formatBytes uses 1024 divisor"],
        pass_to_pass: ["formatBytes bytes range"],
        created_at: "2026-01-14T00:00:00Z",
      },
      {
        instance_id: "ts-utils__015",
        repo: "ts-utils/collections",
        problem_statement:
          "The `uniqueBy(arr, keyFn)` function keeps the last occurrence of duplicate keys instead of the first. " +
          "It should preserve the first occurrence and discard later duplicates.",
        base_commit: "abc0015",
        test_patch:
          "test('uniqueBy keeps first occurrence', () => { const arr = [{id:1,v:'a'},{id:2,v:'b'},{id:1,v:'c'}]; expect(uniqueBy(arr, x => x.id)).toEqual([{id:1,v:'a'},{id:2,v:'b'}]); });",
        patch:
          "function uniqueBy(arr, keyFn) {\n  const seen = new Set();\n  return arr.filter(item => { const k = keyFn(item); if (seen.has(k)) return false; seen.add(k); return true; });\n}",
        fail_to_pass: ["uniqueBy keeps first occurrence"],
        pass_to_pass: ["uniqueBy no duplicates"],
        created_at: "2026-01-15T00:00:00Z",
      },
      {
        instance_id: "ts-utils__016",
        repo: "ts-utils/async-helpers",
        problem_statement:
          "The `debounce(fn, wait)` function calls the function immediately on first invocation instead of waiting. " +
          "It should delay all calls by `wait` ms and only invoke after the last call in the window.",
        base_commit: "abc0016",
        test_patch:
          "test('debounce delays invocation', async () => { let count = 0; const dFn = debounce(() => { count++; }, 50); dFn(); dFn(); dFn(); expect(count).toBe(0); await new Promise(r => setTimeout(r, 100)); expect(count).toBe(1); });",
        patch:
          "function debounce(fn, wait) {\n  let timer;\n  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };\n}",
        fail_to_pass: ["debounce delays invocation"],
        pass_to_pass: ["debounce eventually calls"],
        created_at: "2026-01-16T00:00:00Z",
      },
      {
        instance_id: "ts-utils__017",
        repo: "ts-utils/object-helpers",
        problem_statement:
          "The `omit(obj, keys)` function returns a shallow copy but does not omit nested keys. " +
          "It should omit top-level keys listed in the `keys` array from the returned object.",
        base_commit: "abc0017",
        test_patch:
          "test('omit removes specified keys', () => { const obj = { a: 1, b: 2, c: 3 }; expect(omit(obj, ['b', 'c'])).toEqual({ a: 1 }); });",
        patch:
          "function omit(obj, keys) {\n  const keySet = new Set(keys);\n  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keySet.has(k)));\n}",
        fail_to_pass: ["omit removes specified keys"],
        pass_to_pass: ["omit empty keys array"],
        created_at: "2026-01-17T00:00:00Z",
      },
      {
        instance_id: "ts-utils__018",
        repo: "ts-utils/string-helpers",
        problem_statement:
          "The `pluralize(word, count)` function always appends 's' but does not handle words ending in 'y'. " +
          "'category' with count 2 should return 'categories' but returns 'categorys'.",
        base_commit: "abc0018",
        test_patch:
          "test('pluralize handles -y words', () => { expect(pluralize('category', 2)).toBe('categories'); });",
        patch:
          "function pluralize(word: string, count: number): string {\n  if (count === 1) return word;\n  if (word.endsWith('y') && !word.match(/[aeiou]y$/i)) return word.slice(0, -1) + 'ies';\n  return word + 's';\n}",
        fail_to_pass: ["pluralize handles -y words"],
        pass_to_pass: ["pluralize singular", "pluralize regular plural"],
        created_at: "2026-01-18T00:00:00Z",
      },
      {
        instance_id: "ts-utils__019",
        repo: "ts-utils/collections",
        problem_statement:
          "The `flatten(arr, depth)` function does not respect the depth parameter and always fully flattens. " +
          "With depth=1, `[[1,[2]],3]` should become `[1,[2],3]` not `[1,2,3]`.",
        base_commit: "abc0019",
        test_patch:
          "test('flatten respects depth=1', () => { expect(flatten([[1,[2]],3], 1)).toEqual([1,[2],3]); });",
        patch:
          "function flatten(arr, depth) {\n  if (depth <= 0) return arr.slice();\n  return arr.reduce((acc, val) => {\n    if (Array.isArray(val)) acc.push(...flatten(val, depth - 1));\n    else acc.push(val);\n    return acc;\n  }, []);\n}",
        fail_to_pass: ["flatten respects depth=1"],
        pass_to_pass: ["flatten depth=0", "flatten full"],
        created_at: "2026-01-19T00:00:00Z",
      },
      {
        instance_id: "ts-utils__020",
        repo: "ts-utils/math",
        problem_statement:
          "The `isPrime(n)` function incorrectly returns true for n=1. " +
          "By definition, 1 is not a prime number — the function should return false for n <= 1.",
        base_commit: "abc0020",
        test_patch:
          "test('isPrime returns false for 1', () => { expect(isPrime(1)).toBe(false); expect(isPrime(0)).toBe(false); expect(isPrime(-5)).toBe(false); });",
        patch:
          "function isPrime(n) {\n  if (n <= 1) return false;\n  if (n <= 3) return true;\n  if (n % 2 === 0 || n % 3 === 0) return false;\n  for (let i = 5; i * i <= n; i += 6) { if (n % i === 0 || n % (i + 2) === 0) return false; }\n  return true;\n}",
        fail_to_pass: ["isPrime returns false for 1"],
        pass_to_pass: ["isPrime known primes", "isPrime known composites"],
        created_at: "2026-01-20T00:00:00Z",
      },
      // ── New instances 021-025: real agent evaluation targets ─────────────
      {
        instance_id: "ts-utils__021",
        repo: "ts-utils",
        base_commit: "abc021",
        problem_statement:
          "Implement a `debounce(fn, delayMs)` function in JavaScript. " +
          "It should return a new function that delays calling `fn` until " +
          "after `delayMs` milliseconds have passed since the last call. " +
          "Multiple rapid calls should only result in one invocation. " +
          "Provide the implementation as a plain JavaScript function (no TypeScript).",
        test_patch:
          "test('debounce delays execution', async () => { " +
          "let count = 0; " +
          "const fn = debounce(() => { count++; }, 50); " +
          "fn(); fn(); fn(); " +
          "expect(count).toBe(0); " +
          "await new Promise(r => setTimeout(r, 80)); " +
          "expect(count).toBe(1); " +
          "});",
        patch:
          "function debounce(fn, delayMs) {\n  let timer;\n  return function(...args) {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delayMs);\n  };\n}",
        fail_to_pass: ["debounce delays execution"],
        pass_to_pass: [],
        created_at: "2026-01-21T00:00:00Z",
      },
      {
        instance_id: "ts-utils__022",
        repo: "ts-utils",
        base_commit: "abc022",
        problem_statement:
          "Implement a `memoize(fn)` function in JavaScript. " +
          "It takes a function and returns a memoized version that caches results. " +
          "Subsequent calls with the same arguments should return the cached value " +
          "without calling the original function again. " +
          "Provide the implementation as a plain JavaScript function (no TypeScript).",
        test_patch:
          "test('memoize caches results', () => { " +
          "let callCount = 0; " +
          "const expensive = memoize((n) => { callCount++; return n * 2; }); " +
          "expect(expensive(5)).toBe(10); " +
          "expect(expensive(5)).toBe(10); " +
          "expect(callCount).toBe(1); " +
          "expect(expensive(6)).toBe(12); " +
          "expect(callCount).toBe(2); " +
          "});",
        patch:
          "function memoize(fn) {\n  const cache = new Map();\n  return function(...args) {\n    const key = JSON.stringify(args);\n    if (cache.has(key)) return cache.get(key);\n    const result = fn(...args);\n    cache.set(key, result);\n    return result;\n  };\n}",
        fail_to_pass: ["memoize caches results"],
        pass_to_pass: [],
        created_at: "2026-01-22T00:00:00Z",
      },
      {
        instance_id: "ts-utils__023",
        repo: "ts-utils",
        base_commit: "abc023",
        problem_statement:
          "Implement a `deepEqual(a, b)` function in JavaScript that performs " +
          "a deep equality check between two values. It should handle primitives, " +
          "arrays, and plain objects. Returns true if deeply equal, false otherwise. " +
          "Provide the implementation as a plain JavaScript function (no TypeScript).",
        test_patch:
          "test('deepEqual compares correctly', () => { " +
          "expect(deepEqual(1, 1)).toBe(true); " +
          "expect(deepEqual([1,2,3], [1,2,3])).toBe(true); " +
          "expect(deepEqual({a:1, b:{c:2}}, {a:1, b:{c:2}})).toBe(true); " +
          "expect(deepEqual({a:1}, {a:2})).toBe(false); " +
          "expect(deepEqual([1,2], [1,2,3])).toBe(false); " +
          "});",
        patch:
          "function deepEqual(a, b) {\n  if (a === b) return true;\n  if (typeof a !== typeof b) return false;\n  if (Array.isArray(a) && Array.isArray(b)) {\n    if (a.length !== b.length) return false;\n    return a.every((v, i) => deepEqual(v, b[i]));\n  }\n  if (typeof a === 'object' && a !== null && b !== null) {\n    const ka = Object.keys(a), kb = Object.keys(b);\n    if (ka.length !== kb.length) return false;\n    return ka.every(k => deepEqual(a[k], b[k]));\n  }\n  return false;\n}",
        fail_to_pass: ["deepEqual compares correctly"],
        pass_to_pass: [],
        created_at: "2026-01-23T00:00:00Z",
      },
      {
        instance_id: "ts-utils__024",
        repo: "ts-utils",
        base_commit: "abc024",
        problem_statement:
          "Implement a `groupBy(arr, keyFn)` function in JavaScript. " +
          "Given an array and a key function, return an object where each key " +
          "maps to an array of items that produced that key. " +
          "Provide the implementation as a plain JavaScript function (no TypeScript).",
        test_patch:
          "test('groupBy groups correctly', () => { " +
          "const people = [{name:'Alice',age:25},{name:'Bob',age:30},{name:'Carol',age:25}]; " +
          "const grouped = groupBy(people, p => p.age); " +
          "expect(grouped[25].length).toBe(2); " +
          "expect(grouped[30].length).toBe(1); " +
          "expect(grouped[25][0].name).toBe('Alice'); " +
          "});",
        patch:
          "function groupBy(arr, keyFn) {\n  return arr.reduce((acc, item) => {\n    const key = keyFn(item);\n    if (!acc[key]) acc[key] = [];\n    acc[key].push(item);\n    return acc;\n  }, {});\n}",
        fail_to_pass: ["groupBy groups correctly"],
        pass_to_pass: [],
        created_at: "2026-01-24T00:00:00Z",
      },
      {
        instance_id: "ts-utils__025",
        repo: "ts-utils",
        base_commit: "abc025",
        problem_statement:
          "Implement a `pipe(...fns)` function in JavaScript that takes a list of " +
          "functions and returns a new function that applies them left-to-right. " +
          "The first function receives the initial value; each subsequent function " +
          "receives the result of the previous one. " +
          "Provide the implementation as a plain JavaScript function (no TypeScript).",
        test_patch:
          "test('pipe chains functions left-to-right', () => { " +
          "const double = x => x * 2; " +
          "const addOne = x => x + 1; " +
          "const square = x => x * x; " +
          "const transform = pipe(double, addOne, square); " +
          "expect(transform(3)).toBe(49); " +
          "expect(pipe(addOne)(5)).toBe(6); " +
          "});",
        patch:
          "function pipe(...fns) {\n  return function(value) {\n    return fns.reduce((acc, fn) => fn(acc), value);\n  };\n}",
        fail_to_pass: ["pipe chains functions left-to-right"],
        pass_to_pass: [],
        created_at: "2026-01-25T00:00:00Z",
      },
    ];
  }

  /**
   * Save instances to the local cache directory.
   */
  async saveToCache(instances: SWEBenchInstance[]): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const cachePath = join(this.cacheDir, "instances.json");
    await writeFile(cachePath, JSON.stringify(instances, null, 2), "utf-8");
  }
}
