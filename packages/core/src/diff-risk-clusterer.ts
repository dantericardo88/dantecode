// ============================================================================
// packages/core/src/diff-risk-clusterer.ts
//
// Dim 18 — PR review sharpness: cluster changed files by risk surface so
// the reviewer prioritizes the right hunks first.
//
// Decision-changing: high-risk clusters get dedicated review depth; low-risk
// clusters can be approved with lighter scrutiny.
// ============================================================================

export type RiskSurface =
  | "security"
  | "api"
  | "data-model"
  | "logic"
  | "test"
  | "config"
  | "style";

export interface DiffRiskCluster {
  surface: RiskSurface;
  files: string[];
  riskScore: number;      // 0-1, higher = needs deeper review
  hunkCount: number;      // estimated hunks in this cluster
  reviewPriority: number; // 1 = highest, ascending
}

export interface DiffRiskReport {
  clusters: DiffRiskCluster[];
  overallRisk: number;        // weighted mean of cluster riskScores
  highRiskFileCount: number;  // files in security/api/data-model clusters
  computedAt: string;
}

// ── Surface detection ─────────────────────────────────────────────────────────

const SURFACE_PATTERNS: Record<RiskSurface, RegExp[]> = {
  security: [
    /auth/i, /password/i, /token/i, /secret/i, /crypto/i,
    /encrypt/i, /permission/i, /acl/i, /cors/i, /csp/i, /sanitize/i, /oauth/i,
  ],
  api: [
    /routes?\//i, /controllers?\//i, /openapi/i, /swagger/i,
    /graphql/i, /resolver/i, /\/api\//i, /\.api\./i,
    /^packages\/[^/]+\/src\/index\./,
  ],
  "data-model": [
    /migration/i, /schema/i, /\.sql$/i, /orm/i, /model/i,
    /repository/i, /entity/i, /prisma/i, /typeorm/i, /knex/i,
  ],
  logic: [
    /service/i, /business/i, /domain/i, /use.?case/i, /handler/i,
    /processor/i, /calculator/i, /engine/i, /algorithm/i,
  ],
  test: [
    /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /test_.*\.py$/, /_test\.go$/,
    /__tests__\//i,
  ],
  config: [
    /\.env/i, /\.config\./i, /tsconfig/i, /webpack/i, /vite/i,
    /rollup/i, /babel/i, /eslint/i, /\.yml$/i, /\.yaml$/i, /ci\//i,
    /docker/i, /makefile/i,
  ],
  style: [
    /\.css$/i, /\.scss$/i, /\.less$/i, /\.styled\./i, /\.module\.css/i,
  ],
};

const SURFACE_RISK_SCORES: Record<RiskSurface, number> = {
  security: 0.95,
  api: 0.80,
  "data-model": 0.75,
  logic: 0.60,
  config: 0.50,
  test: 0.30,
  style: 0.15,
};

function detectSurface(filePath: string): RiskSurface {
  for (const [surface, patterns] of Object.entries(SURFACE_PATTERNS) as [RiskSurface, RegExp[]][]) {
    if (patterns.some((p) => p.test(filePath))) return surface;
  }
  return "logic"; // default fallback
}

// ── clusterDiffByRisk ─────────────────────────────────────────────────────────

/**
 * Cluster a list of changed file paths by their risk surface.
 * Returns clusters sorted by riskScore descending (highest risk first).
 * When a security cluster is present, logic files get a +0.1 risk boost
 * (cross-file risk propagation: core lib changes elevate callers).
 */
export function clusterDiffByRisk(
  filePaths: string[],
  hunkCountByFile?: Record<string, number>,
): DiffRiskCluster[] {
  const surfaceMap = new Map<RiskSurface, string[]>();

  for (const f of filePaths) {
    const surface = detectSurface(f);
    if (!surfaceMap.has(surface)) surfaceMap.set(surface, []);
    surfaceMap.get(surface)!.push(f);
  }

  const hasSecurityCluster = surfaceMap.has("security");

  const clusters: DiffRiskCluster[] = [];
  let priority = 1;

  // Sort surfaces by base risk score
  const sortedSurfaces = ([...surfaceMap.entries()] as [RiskSurface, string[]][])
    .sort(([a], [b]) => SURFACE_RISK_SCORES[b] - SURFACE_RISK_SCORES[a]);

  for (const [surface, files] of sortedSurfaces) {
    let riskScore = SURFACE_RISK_SCORES[surface];
    // Cross-file propagation: when security files changed, logic files become riskier
    if (hasSecurityCluster && surface === "logic") {
      riskScore = Math.min(1, riskScore + 0.1);
    }
    const hunkCount = files.reduce((sum, f) => sum + (hunkCountByFile?.[f] ?? 1), 0);
    clusters.push({ surface, files, riskScore, hunkCount, reviewPriority: priority++ });
  }

  return clusters;
}

// ── buildDiffRiskReport ───────────────────────────────────────────────────────

export function buildDiffRiskReport(
  filePaths: string[],
  hunkCountByFile?: Record<string, number>,
): DiffRiskReport {
  const clusters = clusterDiffByRisk(filePaths, hunkCountByFile);
  const highRiskSurfaces: RiskSurface[] = ["security", "api", "data-model"];
  const highRiskFiles = clusters
    .filter((c) => highRiskSurfaces.includes(c.surface))
    .flatMap((c) => c.files);

  const totalFiles = filePaths.length;
  const overallRisk =
    totalFiles === 0
      ? 0
      : clusters.reduce((sum, c) => sum + c.riskScore * c.files.length, 0) / totalFiles;

  return {
    clusters,
    overallRisk: Math.round(overallRisk * 1000) / 1000,
    highRiskFileCount: highRiskFiles.length,
    computedAt: new Date().toISOString(),
  };
}

// ── getHighRiskFiles ──────────────────────────────────────────────────────────

/** Return files from clusters with riskScore >= threshold (default 0.7). */
export function getHighRiskFiles(report: DiffRiskReport, threshold = 0.7): string[] {
  return report.clusters
    .filter((c) => c.riskScore >= threshold)
    .flatMap((c) => c.files);
}

/** Format cluster summary for prompt injection — shows what to review first. */
export function formatRiskClustersForPrompt(report: DiffRiskReport): string {
  if (report.clusters.length === 0) return "No changed files.";
  const lines: string[] = [`[Diff Risk Clusters — overall risk: ${report.overallRisk.toFixed(2)}]`];
  for (const cluster of report.clusters) {
    const flag = cluster.riskScore >= 0.75 ? "⚠️ " : cluster.riskScore >= 0.50 ? "→ " : "  ";
    lines.push(`${flag}${cluster.surface} (risk: ${cluster.riskScore.toFixed(2)}): ${cluster.files.join(", ")}`);
  }
  return lines.join("\n");
}
