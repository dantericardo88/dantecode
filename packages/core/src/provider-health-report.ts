// ============================================================================
// @dantecode/core — Provider Health Report (dim 24)
// Builds latency/availability snapshots and health reports per provider.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ProviderHealthSnapshot {
  providerId: string;
  timestamp: string;
  latencyP50Ms: number;
  latencyP95Ms: number;
  errorRate: number;
  availabilityRate: number;
  requestCount: number;
  healthScore: number;
}

export interface ProviderHealthReport {
  generatedAt: string;
  providers: ProviderHealthSnapshot[];
  bestProvider: string;
  worstProvider: string;
  overallHealthScore: number;
}

const HEALTH_REPORT_FILE = ".danteforge/provider-health-report.json";

export function buildProviderHealthSnapshot(
  providerId: string,
  latencies: number[],
  errors: number,
  total: number,
): ProviderHealthSnapshot {
  const latencyP50Ms = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const latencyP95Ms = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const availabilityRate = total > 0 ? (total - errors) / total : 1;
  const errorRate = total > 0 ? errors / total : 0;
  const healthScore =
    availabilityRate *
    (1 - errorRate) *
    Math.max(0, 1 - latencyP95Ms / 10000);

  return {
    providerId,
    timestamp: new Date().toISOString(),
    latencyP50Ms,
    latencyP95Ms,
    errorRate,
    availabilityRate,
    requestCount: total,
    healthScore,
  };
}

export function buildProviderHealthReport(
  snapshots: ProviderHealthSnapshot[],
): ProviderHealthReport {
  if (snapshots.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      providers: [],
      bestProvider: "",
      worstProvider: "",
      overallHealthScore: 0,
    };
  }

  const sorted = [...snapshots].sort((a, b) => b.healthScore - a.healthScore);
  const bestProvider = sorted[0]!.providerId;
  const worstProvider = sorted[sorted.length - 1]!.providerId;
  const overallHealthScore =
    snapshots.reduce((sum, s) => sum + s.healthScore, 0) / snapshots.length;

  return {
    generatedAt: new Date().toISOString(),
    providers: snapshots,
    bestProvider,
    worstProvider,
    overallHealthScore,
  };
}

export function recordProviderHealthReport(
  report: ProviderHealthReport,
  projectRoot?: string,
): void {
  const root = resolve(projectRoot ?? process.cwd());
  const dir = join(root, ".danteforge");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(root, HEALTH_REPORT_FILE), JSON.stringify(report) + "\n", "utf-8");
}

export function loadProviderHealthReports(projectRoot?: string): ProviderHealthReport[] {
  const root = resolve(projectRoot ?? process.cwd());
  const filePath = join(root, HEALTH_REPORT_FILE);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ProviderHealthReport);
}
