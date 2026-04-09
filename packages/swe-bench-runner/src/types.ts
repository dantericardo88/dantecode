// ============================================================================
// @dantecode/swe-bench-runner — Core Types
// ============================================================================

export interface SWEBenchInstance {
  instance_id: string;
  repo: string;
  problem_statement: string;
  base_commit: string;
  test_patch: string;
  patch: string;
  fail_to_pass: string[];
  pass_to_pass: string[];
  created_at?: string;
}

export interface RunResult {
  instance_id: string;
  resolved: boolean;
  error?: string;
  durationMs: number;
  patchApplied?: string;
}

export interface EvalReport {
  run_id: string;
  timestamp: string;
  total: number;
  resolved: number;
  /** resolved / total */
  pass_rate: number;
  /** same as pass_rate for single run */
  pass_at_1?: number;
  /** resolved at least once in 3 runs */
  pass_at_3?: number;
  per_repo: Record<string, { total: number; resolved: number }>;
  results: RunResult[];
}
