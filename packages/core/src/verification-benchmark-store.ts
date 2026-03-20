import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const VERIFICATION_BENCHMARK_RELATIVE_PATH = ".danteforge/reports/verification-benchmarks.jsonl";

export type VerificationBenchmarkSource = "cli" | "mcp" | "agent" | "graph";

export interface VerificationBenchmarkRun {
  id: string;
  benchmarkId: string;
  planId: string;
  source: VerificationBenchmarkSource;
  recordedAt: string;
  passed: boolean;
  averagePdseScore: number;
  outputCount: number;
  failingOutputIds: string[];
  generatedCaseCount?: number;
  traceId?: string;
  payload: Record<string, unknown>;
}

export interface VerificationBenchmarkRunInput
  extends Omit<VerificationBenchmarkRun, "id" | "recordedAt"> {
  recordedAt?: string;
}

export interface VerificationBenchmarkSummary {
  benchmarkId: string;
  totalRuns: number;
  passRate: number;
  averagePdseScore: number;
  averageOutputCount: number;
  latestRunAt?: string;
  latestFailingOutputIds: string[];
  lastPassed?: boolean;
}

export interface VerificationBenchmarkFilter {
  benchmarkId?: string;
  limit?: number;
}

export class VerificationBenchmarkStore {
  constructor(private readonly projectRoot: string) {}

  async append(input: VerificationBenchmarkRunInput): Promise<VerificationBenchmarkRun> {
    const run: VerificationBenchmarkRun = {
      id: randomUUID(),
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      ...input,
    };

    const benchmarksPath = this.getBenchmarksPath();
    await mkdir(dirname(benchmarksPath), { recursive: true });
    await appendFile(benchmarksPath, `${JSON.stringify(run)}\n`, "utf-8");
    return run;
  }

  async list(filter: VerificationBenchmarkFilter = {}): Promise<VerificationBenchmarkRun[]> {
    const runs = await this.readRuns();
    let filtered = runs;

    if (filter.benchmarkId) {
      filtered = filtered.filter((run) => run.benchmarkId === filter.benchmarkId);
    }

    filtered.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

    if (typeof filter.limit === "number" && filter.limit > 0) {
      return filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  async summarize(benchmarkId: string): Promise<VerificationBenchmarkSummary | null> {
    const runs = await this.list({ benchmarkId });
    if (runs.length === 0) {
      return null;
    }

    return summarizeRuns(benchmarkId, runs);
  }

  async summarizeAll(limit?: number): Promise<VerificationBenchmarkSummary[]> {
    const runs = await this.readRuns();
    const grouped = new Map<string, VerificationBenchmarkRun[]>();

    for (const run of runs) {
      const existing = grouped.get(run.benchmarkId) ?? [];
      existing.push(run);
      grouped.set(run.benchmarkId, existing);
    }

    const summaries = Array.from(grouped.entries()).map(([benchmarkId, benchmarkRuns]) =>
      summarizeRuns(benchmarkId, benchmarkRuns),
    );

    summaries.sort(
      (a, b) =>
        new Date(b.latestRunAt ?? 0).getTime() - new Date(a.latestRunAt ?? 0).getTime(),
    );

    if (typeof limit === "number" && limit > 0) {
      return summaries.slice(0, limit);
    }

    return summaries;
  }

  private async readRuns(): Promise<VerificationBenchmarkRun[]> {
    try {
      const raw = await readFile(this.getBenchmarksPath(), "utf-8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as VerificationBenchmarkRun];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  private getBenchmarksPath(): string {
    return join(this.projectRoot, VERIFICATION_BENCHMARK_RELATIVE_PATH);
  }
}

function summarizeRuns(
  benchmarkId: string,
  runs: VerificationBenchmarkRun[],
): VerificationBenchmarkSummary {
  const sortedRuns = [...runs].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
  const latestRun = sortedRuns[0];
  const passedRuns = runs.filter((run) => run.passed).length;
  const averagePdseScore =
    runs.reduce((sum, run) => sum + run.averagePdseScore, 0) / Math.max(runs.length, 1);
  const averageOutputCount =
    runs.reduce((sum, run) => sum + run.outputCount, 0) / Math.max(runs.length, 1);

  return {
    benchmarkId,
    totalRuns: runs.length,
    passRate: passedRuns / Math.max(runs.length, 1),
    averagePdseScore,
    averageOutputCount,
    latestRunAt: latestRun?.recordedAt,
    latestFailingOutputIds: latestRun?.failingOutputIds ?? [],
    lastPassed: latestRun?.passed,
  };
}
