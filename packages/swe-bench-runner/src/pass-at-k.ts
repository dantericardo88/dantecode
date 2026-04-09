// ============================================================================
// @dantecode/swe-bench-runner — pass@k Scoring
//
// Implements the HumanEval / OpenAI pass@k formula:
//   pass@k = E[ 1 - C(n-c, k) / C(n, k) ]
// where n = total runs, c = correct runs, k = k
// ============================================================================

/**
 * Compute C(n, k) — binomial coefficient using a numerically stable method
 * to avoid overflow for large n.
 */
function binomialCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  // Use the smaller of k and n-k for efficiency
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * Compute pass@k for a single problem instance.
 *
 * @param n - Total number of samples generated
 * @param c - Number of correct samples
 * @param k - k in pass@k
 * @returns Probability that at least one of k samples is correct
 */
export function passAtK(n: number, c: number, k: number): number {
  if (n <= 0) return 0;
  if (c <= 0) return 0;
  if (k >= n) return c > 0 ? 1.0 : 0.0;
  // 1 - C(n-c, k) / C(n, k)
  const numerator = binomialCoeff(n - c, k);
  const denominator = binomialCoeff(n, k);
  if (denominator === 0) return 0;
  return 1 - numerator / denominator;
}

/**
 * Compute pass@k across all problems, returning the mean.
 *
 * @param results - Map of instance_id → array of boolean outcomes (true=correct)
 * @param k - k in pass@k
 * @returns Mean pass@k across all instances
 */
export function computePassAtK(results: Map<string, boolean[]>, k: number): number {
  if (results.size === 0) return 0;
  let total = 0;
  for (const outcomes of results.values()) {
    const n = outcomes.length;
    const c = outcomes.filter(Boolean).length;
    total += passAtK(n, c, k);
  }
  return total / results.size;
}
