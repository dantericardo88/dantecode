// @dantecode/swe-bench-runner — built-in TypeScript benchmark instances
// Deterministic, no-network, Node.js VM execution spine.
import { createContext, runInContext } from "node:vm";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkInstance {
  instance_id: string;
  patch: string;
  test_patch: string;
}

export interface RunResult {
  instance_id: string;
  resolved: boolean;
  error?: string;
  durationMs: number;
}

export interface EvalReport {
  run_id: string;
  timestamp: string;
  total: number;
  resolved: number;
  pass_rate: number;
  results: RunResult[];
}

export interface TestPatchResult {
  passed: boolean;
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Built-in instances: 25 self-contained gold-patch + gold-test pairs.
// Patch/test strings are plain JavaScript executed in a Node.js VM sandbox.
// ---------------------------------------------------------------------------
const BUILTIN_INSTANCES: BenchmarkInstance[] = [
  {
    instance_id: "ts-utils__001",
    patch: "function add(a, b) { return a + b; } globalThis.__exports = { add };",
    test_patch: "const { add } = globalThis.__exports; if (add(1,2) !== 3) throw new Error('add failed'); if (add(-1,1) !== 0) throw new Error('add neg');",
  },
  {
    instance_id: "ts-utils__002",
    patch: "function multiply(a, b) { return a * b; } globalThis.__exports = { multiply };",
    test_patch: "const { multiply } = globalThis.__exports; if (multiply(3,4) !== 12) throw new Error('multiply failed');",
  },
  {
    instance_id: "ts-utils__003",
    patch: "function clamp(val, min, max) { return Math.min(Math.max(val, min), max); } globalThis.__exports = { clamp };",
    test_patch: "const { clamp } = globalThis.__exports; if (clamp(10,0,5) !== 5) throw new Error('clamp max'); if (clamp(-1,0,5) !== 0) throw new Error('clamp min');",
  },
  {
    instance_id: "ts-utils__004",
    patch: "function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); } globalThis.__exports = { capitalize };",
    test_patch: "const { capitalize } = globalThis.__exports; if (capitalize('hello') !== 'Hello') throw new Error('capitalize failed');",
  },
  {
    instance_id: "ts-utils__005",
    patch: "function isPrime(n) { if (n < 2) return false; for (let i=2;i<=Math.sqrt(n);i++) if (n%i===0) return false; return true; } globalThis.__exports = { isPrime };",
    test_patch: "const { isPrime } = globalThis.__exports; if (!isPrime(7)) throw new Error('7 prime'); if (isPrime(4)) throw new Error('4 not prime');",
  },
  {
    instance_id: "ts-utils__006",
    patch: "function flatten(arr) { return arr.flat(Infinity); } globalThis.__exports = { flatten };",
    test_patch: "const { flatten } = globalThis.__exports; const r = flatten([1,[2,[3]]]); if (r.length !== 3 || r[2] !== 3) throw new Error('flatten failed');",
  },
  {
    instance_id: "ts-utils__007",
    patch: "function unique(arr) { return [...new Set(arr)]; } globalThis.__exports = { unique };",
    test_patch: "const { unique } = globalThis.__exports; if (unique([1,1,2,3,2]).length !== 3) throw new Error('unique failed');",
  },
  {
    instance_id: "ts-utils__008",
    patch: "function debounce(fn, ms) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; } globalThis.__exports = { debounce };",
    test_patch: "const { debounce } = globalThis.__exports; if (typeof debounce(()=>{}, 100) !== 'function') throw new Error('debounce type');",
  },
  {
    instance_id: "ts-utils__009",
    patch: "function chunk(arr, size) { const r = []; for(let i=0;i<arr.length;i+=size) r.push(arr.slice(i,i+size)); return r; } globalThis.__exports = { chunk };",
    test_patch: "const { chunk } = globalThis.__exports; const r = chunk([1,2,3,4,5],2); if (r.length !== 3) throw new Error('chunk length'); if (r[0].length !== 2) throw new Error('chunk size');",
  },
  {
    instance_id: "ts-utils__010",
    patch: "function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); } globalThis.__exports = { deepClone };",
    test_patch: "const { deepClone } = globalThis.__exports; const o={a:{b:1}}; const c=deepClone(o); c.a.b=2; if (o.a.b !== 1 || c.a.b !== 2) throw new Error('deepClone failed');",
  },
  {
    instance_id: "ts-utils__011",
    patch: "function pick(obj, keys) { return Object.fromEntries(keys.map(k=>[k,obj[k]])); } globalThis.__exports = { pick };",
    test_patch: "const { pick } = globalThis.__exports; const r=pick({a:1,b:2,c:3},['a','c']); if (r.a!==1||r.c!==3||'b' in r) throw new Error('pick failed');",
  },
  {
    instance_id: "ts-utils__012",
    patch: "function omit(obj, keys) { const r={...obj}; keys.forEach(k=>delete r[k]); return r; } globalThis.__exports = { omit };",
    test_patch: "const { omit } = globalThis.__exports; const r=omit({a:1,b:2,c:3},['b']); if ('b' in r) throw new Error('omit failed'); if (r.a!==1) throw new Error('omit kept a');",
  },
  {
    instance_id: "ts-utils__013",
    patch: "function groupBy(arr, fn) { return arr.reduce((acc,v)=>{const k=fn(v);(acc[k]=acc[k]||[]).push(v);return acc;},{}); } globalThis.__exports = { groupBy };",
    test_patch: "const { groupBy } = globalThis.__exports; const r=groupBy([1,2,3,4],n=>n%2===0?'even':'odd'); if (r.even.length!==2||r.odd.length!==2) throw new Error('groupBy failed');",
  },
  {
    instance_id: "ts-utils__014",
    patch: "function memoize(fn) { const c=new Map(); return function(...a) { const k=JSON.stringify(a); if(c.has(k)) return c.get(k); const r=fn(...a); c.set(k,r); return r; }; } globalThis.__exports = { memoize };",
    test_patch: "const { memoize } = globalThis.__exports; let calls=0; const f=memoize(n=>{calls++;return n*2;}); f(5);f(5);if(calls!==1) throw new Error('memoize cache'); if(f(5)!==10) throw new Error('memoize value');",
  },
  {
    instance_id: "ts-utils__015",
    patch: "function zip(...arrs) { const len=Math.min(...arrs.map(a=>a.length)); return Array.from({length:len},(_,i)=>arrs.map(a=>a[i])); } globalThis.__exports = { zip };",
    test_patch: "const { zip } = globalThis.__exports; const r=zip([1,2],[3,4]); if(r.length!==2||r[0][0]!==1||r[0][1]!==3) throw new Error('zip failed');",
  },
  {
    instance_id: "ts-utils__016",
    patch: "function partition(arr, fn) { const t=[],f=[]; arr.forEach(v=>(fn(v)?t:f).push(v)); return [t,f]; } globalThis.__exports = { partition };",
    test_patch: "const { partition } = globalThis.__exports; const [e,o]=partition([1,2,3,4],n=>n%2===0); if(e.length!==2||o.length!==2) throw new Error('partition failed');",
  },
  {
    instance_id: "ts-utils__017",
    patch: "function sum(arr) { return arr.reduce((a,b)=>a+b, 0); } globalThis.__exports = { sum };",
    test_patch: "const { sum } = globalThis.__exports; if(sum([1,2,3,4])!==10) throw new Error('sum failed'); if(sum([])!==0) throw new Error('sum empty');",
  },
  {
    instance_id: "ts-utils__018",
    patch: "function intersection(a, b) { const s=new Set(b); return a.filter(v=>s.has(v)); } globalThis.__exports = { intersection };",
    test_patch: "const { intersection } = globalThis.__exports; const r=intersection([1,2,3],[2,3,4]); if(r.length!==2||!r.includes(2)||!r.includes(3)) throw new Error('intersection failed');",
  },
  {
    instance_id: "ts-utils__019",
    patch: "function difference(a, b) { const s=new Set(b); return a.filter(v=>!s.has(v)); } globalThis.__exports = { difference };",
    test_patch: "const { difference } = globalThis.__exports; const r=difference([1,2,3],[2,3]); if(r.length!==1||r[0]!==1) throw new Error('difference failed');",
  },
  {
    instance_id: "ts-utils__020",
    patch: "function camelToSnake(s) { return s.replace(/[A-Z]/g,l=>'_'+l.toLowerCase()); } globalThis.__exports = { camelToSnake };",
    test_patch: "const { camelToSnake } = globalThis.__exports; if(camelToSnake('helloWorld')!=='hello_world') throw new Error('camelToSnake failed');",
  },
  {
    instance_id: "ts-utils__021",
    patch: "function snakeToCamel(s) { return s.replace(/_([a-z])/g,(_,l)=>l.toUpperCase()); } globalThis.__exports = { snakeToCamel };",
    test_patch: "const { snakeToCamel } = globalThis.__exports; if(snakeToCamel('hello_world')!=='helloWorld') throw new Error('snakeToCamel failed');",
  },
  {
    instance_id: "ts-utils__022",
    patch: "function trunc(s, len) { return s.length<=len ? s : s.slice(0,len)+'...'; } globalThis.__exports = { trunc };",
    test_patch: "const { trunc } = globalThis.__exports; if(trunc('hello',10)!=='hello') throw new Error('trunc short'); if(trunc('hello world',5)!=='hello...') throw new Error('trunc long');",
  },
  {
    instance_id: "ts-utils__023",
    patch: "function range(start, end, step) { if (step === undefined) step = 1; const r=[]; for(let i=start;i<end;i+=step) r.push(i); return r; } globalThis.__exports = { range };",
    test_patch: "const { range } = globalThis.__exports; const r=range(0,5); if(r.length!==5||r[0]!==0||r[4]!==4) throw new Error('range failed');",
  },
  {
    instance_id: "ts-utils__024",
    patch: "function countBy(arr, fn) { return arr.reduce((acc,v)=>{const k=fn(v);acc[k]=(acc[k]||0)+1;return acc;},{}); } globalThis.__exports = { countBy };",
    test_patch: "const { countBy } = globalThis.__exports; const r=countBy(['a','b','a','c','b','b'],v=>v); if(r.a!==2||r.b!==3||r.c!==1) throw new Error('countBy failed');",
  },
  {
    instance_id: "ts-utils__025",
    patch: "function pipe(...fns) { return v => fns.reduce((acc,f)=>f(acc),v); } globalThis.__exports = { pipe };",
    test_patch: "const { pipe } = globalThis.__exports; const double=n=>n*2; const inc=n=>n+1; const f=pipe(double,inc); if(f(3)!==7) throw new Error('pipe failed');",
  },
];

// ---------------------------------------------------------------------------
// InstanceLoader
// ---------------------------------------------------------------------------
export class InstanceLoader {
  getBuiltinInstances(): BenchmarkInstance[] {
    return BUILTIN_INSTANCES.slice();
  }
}

// ---------------------------------------------------------------------------
// runTestPatch — executes patch + test_patch in isolated VM contexts.
// Patch runs in an IIFE so function declarations don't pollute global scope,
// but sets (globalThis as any).__exports = {...}. Test_patch runs in a second
// context with __exports pre-seeded from the patch output.
// ---------------------------------------------------------------------------
export async function runTestPatch(
  patch: string,
  testPatch: string,
  instanceId: string,
): Promise<TestPatchResult> {
  const start = Date.now();
  try {
    // Phase 1: run patch in an IIFE to keep function declarations scoped
    const patchSandbox = Object.assign(createContext({}), {
      Math, Array, Object, JSON, Set, Map, setTimeout, clearTimeout,
    }) as Record<string, unknown>;
    runInContext(`(function(){ ${patch} })();`, patchSandbox, {
      timeout: 5000,
      filename: `${instanceId}-patch.js`,
    });
    const exported = (patchSandbox.__exports as Record<string, unknown>) ?? {};

    // Phase 2: run test_patch with __exports available as globalThis.__exports
    const testSandbox = Object.assign(createContext({}), {
      Math, Array, Object, JSON, Set, Map, setTimeout, clearTimeout,
      __exports: exported,
    });
    runInContext(testPatch, testSandbox, {
      timeout: 5000,
      filename: `${instanceId}-test.js`,
    });
    return { passed: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// ReportGenerator
// ---------------------------------------------------------------------------
export class ReportGenerator {
  generateReport(results: RunResult[]): EvalReport {
    const resolved = results.filter((r) => r.resolved).length;
    return {
      run_id: randomUUID(),
      timestamp: new Date().toISOString(),
      total: results.length,
      resolved,
      pass_rate: results.length > 0 ? resolved / results.length : 0,
      results,
    };
  }

  async saveReport(report: EvalReport, filePath: string): Promise<void> {
    await writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
  }

  formatMarkdown(report: EvalReport): string {
    const pct = (report.pass_rate * 100).toFixed(1);
    const lines = [
      `## Benchmark Results`,
      ``,
      `- **Pass rate**: ${pct}% (${report.resolved}/${report.total} resolved)`,
      `- **Run ID**: ${report.run_id}`,
      `- **Timestamp**: ${report.timestamp}`,
      ``,
      `### Per-Instance Results`,
      ``,
    ];
    for (const r of report.results) {
      const status = r.resolved ? "✅" : "❌";
      lines.push(
        `- ${status} \`${r.instance_id}\` (${r.durationMs}ms)${r.error ? ": " + r.error : ""}`,
      );
    }
    return lines.join("\n");
  }
}
