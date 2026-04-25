export interface BenchmarkInstance {
  instance_id: string;
  patch: string;
  test_patch: string;
  difficulty?: string;
}
export interface RunResult {
  instance_id: string;
  resolved: boolean;
  error?: string;
  durationMs: number;
  output?: string;
}
export interface EvalReport {
  total: number;
  run_id: string;
  timestamp: string;
  pass_rate: number;
  results: RunResult[];
}
export declare class InstanceLoader {
  getBuiltinInstances(): BenchmarkInstance[];
  loadAll(): Promise<BenchmarkInstance[]>;
  loadByDifficulty(difficulty?: string): Promise<BenchmarkInstance[]>;
}
export declare function runTestPatch(
  patch: string,
  testPatch: string,
  instanceId: string,
): Promise<{ passed: boolean; error?: string; durationMs: number; output?: string }>;
export declare class ReportGenerator {
  generate(results?: RunResult[]): { summary: Record<string, unknown>; results: RunResult[] };
}
