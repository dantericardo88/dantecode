import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export type BenchmarkTransparencySuite = "builtin" | "swe-bench";

export type BenchmarkArtifactKind =
  | "raw_report"
  | "markdown_report"
  | "command"
  | "selected_instances"
  | "per_instance_logs"
  | "trace_refs"
  | "limitations"
  | "manifest";

export interface BenchmarkArtifactRef {
  kind: BenchmarkArtifactKind;
  path: string;
  sha256: string;
  bytes: number;
}

export interface BenchmarkTransparencyManifest {
  schemaVersion: "1.0";
  dimensionId: "benchmark_transparency";
  benchmarkId: string;
  suite: BenchmarkTransparencySuite;
  runId: string;
  generatedAt: string;
  git: {
    commit: string;
    dirty: boolean;
  };
  environment: {
    platform: string;
    arch: string;
    node: string;
    npm: string;
  };
  command: {
    text: string;
    argv: string[];
    cwd: string;
  };
  model: string;
  dataset: {
    name: string;
    path: string;
    sha256: string;
    selectedInstanceIds: string[];
    seed: number;
  };
  config: {
    timeoutMs: number;
    parallel: number;
  };
  result: {
    total: number;
    resolved: number;
    passRate: number;
  };
  artifacts: BenchmarkArtifactRef[];
  limitations: string[];
  rerunCommand: string;
  scoreHistoryUpdated: boolean;
}

export interface BenchmarkTransparencyProof {
  commandRecorded: boolean;
  seedRecorded: boolean;
  datasetHashRecorded: boolean;
  scoreHistoryUpdated: boolean;
  artifactCount: number;
  checksumCount: number;
  limitationsCount: number;
}

export interface BenchmarkTransparencyGateResult {
  dimensionId: "benchmark_transparency";
  generatedAt: string;
  pass: boolean;
  score: number;
  threshold: number;
  blockers: string[];
  manifest: BenchmarkTransparencyManifest;
  proof: BenchmarkTransparencyProof;
}

export interface RunBenchmarkTransparencyGateOptions {
  manifest: BenchmarkTransparencyManifest;
  projectRoot: string;
  threshold?: number;
  now?: () => Date;
}

export interface BenchmarkScoreHistoryEntry {
  generatedAt: string;
  dimensionId: "benchmark_transparency";
  runId: string;
  suite: BenchmarkTransparencySuite;
  score: number;
  pass: boolean;
  passRate: number;
  manifestPath: string;
}

export interface BenchmarkTransparencyClaimGateInput {
  pass: boolean;
  score: number;
  threshold: number;
  dimensionId?: string;
}

export interface BenchmarkTransparencyClaimGateResult {
  ok: boolean;
  reason?: string;
}

const DEFAULT_THRESHOLD = 90;
const REQUIRED_ARTIFACTS: BenchmarkArtifactKind[] = [
  "raw_report",
  "markdown_report",
  "command",
  "selected_instances",
  "per_instance_logs",
  "trace_refs",
  "limitations",
];

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function createBenchmarkArtifactRef(
  kind: BenchmarkArtifactKind,
  filePath: string,
  projectRoot?: string,
): BenchmarkArtifactRef {
  const resolved = projectRoot && !isAbsolute(filePath) ? join(projectRoot, filePath) : filePath;
  const stat = statSync(resolved);
  return {
    kind,
    path: projectRoot ? normalizeArtifactPath(relative(projectRoot, resolved)) : normalizeArtifactPath(filePath),
    sha256: sha256File(resolved),
    bytes: stat.size,
  };
}

export function validateBenchmarkTransparencyManifest(
  manifest: BenchmarkTransparencyManifest,
  projectRoot: string,
): { pass: boolean; blockers: string[]; proof: BenchmarkTransparencyProof } {
  const blockers: string[] = [];

  if (manifest.schemaVersion !== "1.0") blockers.push("schema version must be 1.0");
  if (manifest.dimensionId !== "benchmark_transparency") blockers.push("dimension id must be benchmark_transparency");
  if (!manifest.benchmarkId) blockers.push("benchmark id is required");
  if (!manifest.runId) blockers.push("run id is required");
  if (!manifest.generatedAt) blockers.push("generated timestamp is required");
  if (!manifest.git.commit) blockers.push("git commit is required");
  if (!manifest.environment.node) blockers.push("node version is required");
  if (!manifest.environment.npm) blockers.push("npm version is required");
  if (!manifest.command.text) blockers.push("command text is required");
  if (manifest.command.argv.length === 0) blockers.push("command argv is required");
  if (!manifest.command.cwd) blockers.push("command cwd is required");
  if (!manifest.model) blockers.push("model is required");
  if (!manifest.dataset.path) blockers.push("dataset path is required");
  if (!manifest.dataset.sha256) blockers.push("dataset sha256 is required");
  if (manifest.dataset.selectedInstanceIds.length === 0) blockers.push("selected instance ids are required");
  if (!Number.isFinite(manifest.dataset.seed)) blockers.push("seed is required");
  if (manifest.result.total <= 0) blockers.push("result summary total must be greater than zero");
  if (manifest.result.resolved < 0) blockers.push("result summary resolved must be non-negative");
  if (manifest.result.passRate < 0 || manifest.result.passRate > 1) blockers.push("pass rate must be between 0 and 1");
  if (manifest.limitations.length === 0) blockers.push("limitations are required");
  if (!manifest.rerunCommand) blockers.push("rerun command is required");
  if (!manifest.scoreHistoryUpdated) blockers.push("score history must be updated");

  for (const kind of REQUIRED_ARTIFACTS) {
    if (!manifest.artifacts.some((artifact) => artifact.kind === kind)) {
      blockers.push(`missing required artifact: ${kind}`);
    }
  }

  for (const artifact of manifest.artifacts) {
    const artifactPath = resolveArtifactPath(projectRoot, artifact.path);
    if (!existsSync(artifactPath)) {
      blockers.push(`missing artifact file: ${artifact.path}`);
      continue;
    }
    const actualHash = sha256File(artifactPath);
    if (actualHash !== artifact.sha256) {
      blockers.push(`checksum mismatch for ${artifact.path}`);
    }
    const actualBytes = statSync(artifactPath).size;
    if (actualBytes !== artifact.bytes) {
      blockers.push(`byte size mismatch for ${artifact.path}`);
    }
  }

  const proof: BenchmarkTransparencyProof = {
    commandRecorded: Boolean(manifest.command.text && manifest.command.argv.length > 0),
    seedRecorded: Number.isFinite(manifest.dataset.seed),
    datasetHashRecorded: Boolean(manifest.dataset.sha256),
    scoreHistoryUpdated: manifest.scoreHistoryUpdated,
    artifactCount: manifest.artifacts.length,
    checksumCount: manifest.artifacts.filter((artifact) => Boolean(artifact.sha256)).length,
    limitationsCount: manifest.limitations.length,
  };

  return {
    pass: blockers.length === 0,
    blockers,
    proof,
  };
}

export function runBenchmarkTransparencyGate(
  options: RunBenchmarkTransparencyGateOptions,
): BenchmarkTransparencyGateResult {
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const validation = validateBenchmarkTransparencyManifest(options.manifest, options.projectRoot);
  const score = computeBenchmarkTransparencyScore(validation.blockers);

  return {
    dimensionId: "benchmark_transparency",
    generatedAt,
    pass: validation.pass && score >= threshold,
    score,
    threshold,
    blockers: validation.blockers,
    manifest: options.manifest,
    proof: validation.proof,
  };
}

export function appendBenchmarkScoreHistory(
  projectRoot: string,
  entry: BenchmarkScoreHistoryEntry,
): string {
  const historyPath = join(projectRoot, ".danteforge", "benchmark-score-history.jsonl");
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, "utf-8");
  return historyPath;
}

export function evaluateBenchmarkTransparencyClaimGate(
  gate: BenchmarkTransparencyClaimGateInput | null | undefined,
): BenchmarkTransparencyClaimGateResult {
  if (!gate) {
    return { ok: false, reason: "missing benchmark transparency proof" };
  }
  if (gate.dimensionId && gate.dimensionId !== "benchmark_transparency") {
    return { ok: false, reason: "benchmark transparency proof used the wrong dimension" };
  }
  if (!gate.pass) {
    return { ok: false, reason: "failing benchmark transparency gate" };
  }
  if (gate.score < gate.threshold) {
    return { ok: false, reason: "benchmark transparency score below threshold" };
  }
  return { ok: true };
}

export function formatBenchmarkTransparencyMarkdown(result: BenchmarkTransparencyGateResult): string {
  const manifest = result.manifest;
  const lines = [
    "# Benchmark Transparency Gate",
    "",
    `- Dimension: ${result.dimensionId}`,
    `- Suite: ${manifest.suite}`,
    `- Run ID: ${manifest.runId}`,
    `- Pass: ${result.pass ? "yes" : "no"}`,
    `- Score: ${result.score}/${result.threshold}`,
    `- Generated: ${result.generatedAt}`,
    `- Command: \`${manifest.command.text}\``,
    `- Seed: ${manifest.dataset.seed}`,
    `- Dataset hash: ${manifest.dataset.sha256}`,
    `- Pass rate: ${(manifest.result.passRate * 100).toFixed(1)}% (${manifest.result.resolved}/${manifest.result.total})`,
    "",
    "## Artifacts",
    "",
    "| Kind | Path | SHA-256 |",
    "|---|---|---|",
  ];

  for (const artifact of manifest.artifacts) {
    lines.push(`| ${artifact.kind} | ${artifact.path} | ${artifact.sha256} |`);
  }

  lines.push("", "## Limitations", "");
  for (const limitation of manifest.limitations) {
    lines.push(`- ${limitation}`);
  }

  lines.push("", "## Rerun", "", `\`${manifest.rerunCommand}\``, "", "## Blockers", "");
  if (result.blockers.length === 0) {
    lines.push("- none");
  } else {
    for (const blocker of result.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatBenchmarkTransparencyText(result: BenchmarkTransparencyGateResult): string {
  return [
    `Benchmark transparency gate: ${result.pass ? "PASS" : "FAIL"}`,
    `Suite: ${result.manifest.suite}`,
    `Run ID: ${result.manifest.runId}`,
    `Score: ${result.score}/${result.threshold}`,
    `Artifacts: ${result.proof.artifactCount}`,
    `Blockers: ${result.blockers.length === 0 ? "none" : result.blockers.join("; ")}`,
    `Rerun: ${result.manifest.rerunCommand}`,
  ].join("\n");
}

function computeBenchmarkTransparencyScore(blockers: string[]): number {
  return Math.max(0, Math.min(100, 100 - blockers.length * 15));
}

function resolveArtifactPath(projectRoot: string, artifactPath: string): string {
  return isAbsolute(artifactPath) ? artifactPath : join(projectRoot, artifactPath);
}

function normalizeArtifactPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
