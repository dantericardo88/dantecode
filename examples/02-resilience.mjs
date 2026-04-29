// 02-resilience.mjs — Retry, timeout, and bounded parallelism.
//
// Flaky external calls (provider APIs, tool spawns, network requests) need
// retry-with-backoff. Long-running operations need timeout wrapping. Fan-out
// work needs concurrency caps so we don't overwhelm downstream rate limits.
// Run: node examples/02-resilience.mjs

import {
  retry,
  withTimeout,
  retryWithTimeout,
  parallelWithLimit,
  DanteCodeError,
  ProviderRateLimitError,
} from "../packages/core/dist/index.js";

console.log("=== retry: succeed on third try ===");
let attempts = 0;
const result = await retry(
  async () => {
    attempts++;
    if (attempts < 3) throw new Error(`transient #${attempts}`);
    return "got it";
  },
  { maxAttempts: 5, baseDelayMs: 10, jitterRatio: 0 },
);
console.log(`  result=${result}, attempts=${attempts}`);

console.log("\n=== retry: abort hint short-circuits the loop ===");
const protectedErr = new DanteCodeError("PROTECTED_FILE", "won't retry me", {
  recovery: "abort",
});
let abortAttempts = 0;
try {
  await retry(async () => {
    abortAttempts++;
    throw protectedErr;
  }, { maxAttempts: 5, baseDelayMs: 1 });
} catch (err) {
  console.log(`  caught: ${err.message}, attempts=${abortAttempts} (no retries)`);
}

console.log("\n=== retry: rate-limit error retries ===");
let rateAttempts = 0;
try {
  await retry(
    async () => {
      rateAttempts++;
      if (rateAttempts < 2) throw new ProviderRateLimitError("anthropic", 50);
      return "ok";
    },
    { maxAttempts: 3, baseDelayMs: 1 },
  );
  console.log(`  ok after ${rateAttempts} attempts`);
} catch (err) {
  console.log(`  failed: ${err.message}`);
}

console.log("\n=== withTimeout: aborts a slow operation ===");
try {
  await withTimeout(
    (signal) => new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error("never")), 1000);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
    }),
    50,
    "demo-op",
  );
} catch (err) {
  console.log(`  timed out as expected: ${err.message}`);
}

console.log("\n=== parallelWithLimit: 10 items, max 3 concurrent ===");
let active = 0;
let peak = 0;
const items = Array.from({ length: 10 }, (_, i) => async () => {
  active++; peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, 20));
  active--;
  return i;
});
const results = await parallelWithLimit(items, 3);
console.log(`  finished ${results.length} items, peak concurrency=${peak}`);
console.log(`  values: ${results.map((r) => (r.ok ? r.value : "X")).join(",")}`);

console.log("\n=== retryWithTimeout: combine both for boundary calls ===");
let combined = 0;
const final = await retryWithTimeout(
  async () => {
    combined++;
    if (combined < 2) throw new Error("first try slow");
    return "stable";
  },
  100,
  { maxAttempts: 3, baseDelayMs: 5 },
  "external-api",
);
console.log(`  result=${final}, attempts=${combined}`);
