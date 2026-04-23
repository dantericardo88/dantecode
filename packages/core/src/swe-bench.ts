// ============================================================================
// @dantecode/core — SWE-bench shared types
//
// Defines shared types used by the SWE-bench evaluation infrastructure.
// The full runner lives in @dantecode/cli (swe-bench-runner.ts).
// ============================================================================

/** A single SWE-bench Verified instance (leaderboard format). */
export interface SWEInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  test_patch: string;
  patch?: string;
  PASS_TO_PASS?: string[];
  FAIL_TO_PASS?: string[];
  pass_to_pass?: string[];
  fail_to_pass?: string[];
}

/** Result for a single SWE-bench instance run. */
export interface SWERunResult {
  instance_id: string;
  resolved: boolean;
  model_patch: string;
  test_output: string;
  duration_ms: number;
  error?: string;
}

/** Aggregate evaluation report (leaderboard-compatible). */
export interface SWEReport {
  run_id: string;
  model: string;
  total: number;
  resolved: number;
  pass_rate: number;
  results: SWERunResult[];
  generated_at: string;
}
