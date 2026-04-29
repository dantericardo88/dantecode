export type SWEBenchSuite = "verified" | "lite" | "pro" | "rebench";

export type SWEFailureClass =
  | "resolved"
  | "env_error"
  | "test_patch_error"
  | "baseline_not_reproduced"
  | "agent_no_patch"
  | "agent_wrong_patch"
  | "timeout"
  | "flaky"
  | "infra";

export interface SWEBenchDatasetProof {
  path: string;
  sha256: string;
  seed: number;
  selectedInstanceIds: string[];
}

export interface SWEBenchCalibrationProof {
  total: number;
  reproducedBaseline: number;
  goldResolved: number;
  passRate: number;
  threshold: number;
  artifactPath?: string;
}

export interface SWEBenchAgentRunProof {
  total: number;
  resolved: number;
  passRate: number;
  requiredPassRate: number;
  attempts: number;
  artifactPath?: string;
}

export interface SWEBenchComparisonProof {
  baselinePassRate: number;
  candidatePassRate: number;
  delta: number;
  requiredDelta: number;
  artifactPath?: string;
}

export interface SWEBenchRepeatedRunProof {
  runId: string;
  passRate: number;
}

export interface SWEBenchArtifactCompletenessProof {
  trajectoryCount: number;
  patchCount: number;
  baselineLogCount: number;
  verificationLogCount: number;
  environmentLogCount: number;
  classifiedFailureCount: number;
  manifestPath?: string;
}

export interface SWEBenchCorrectnessGateInput {
  dimensionId: "swe_bench_correctness";
  generatedAt: string;
  suite: SWEBenchSuite;
  dataset: SWEBenchDatasetProof;
  calibration: SWEBenchCalibrationProof;
  agentRun: SWEBenchAgentRunProof;
  comparison: SWEBenchComparisonProof;
  repeatedRuns: SWEBenchRepeatedRunProof[];
  artifactCompleteness: SWEBenchArtifactCompletenessProof;
  failureTaxonomy: Partial<Record<SWEFailureClass, number>>;
  limitations: string[];
}

export interface SWEBenchCorrectnessProof {
  datasetSelected: boolean;
  calibrationGreen: boolean;
  agentPassRateGreen: boolean;
  abImprovementGreen: boolean;
  repeatedRunStable: boolean;
  artifactsComplete: boolean;
  failureTaxonomyPresent: boolean;
}

export interface SWEBenchCorrectnessGateResult {
  dimensionId: "swe_bench_correctness";
  generatedAt: string;
  suite: SWEBenchSuite;
  pass: boolean;
  score: number;
  threshold: number;
  maxEligibleScore: number;
  blockers: string[];
  warnings: string[];
  input: SWEBenchCorrectnessGateInput;
  proof: SWEBenchCorrectnessProof;
}

export interface SWEBenchFailureLike {
  resolved?: boolean;
  error?: string;
  test_output?: string;
  model_patch?: string;
}

const DEFAULT_THRESHOLD = 90;
const REQUIRED_PASS_RATE = 0.65;
const REQUIRED_AB_DELTA = 0.1;
const REQUIRED_CALIBRATION = 0.95;
const REQUIRED_STABILITY_SPREAD = 0.05;

export function evaluateSWEBenchCorrectnessGate(
  input: SWEBenchCorrectnessGateInput,
  options: { threshold?: number } = {},
): SWEBenchCorrectnessGateResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.dimensionId !== "swe_bench_correctness") {
    blockers.push("dimension id must be swe_bench_correctness");
  }
  if (!input.dataset.path) blockers.push("dataset path is required");
  if (!input.dataset.sha256) blockers.push("dataset sha256 is required");
  if (!Number.isFinite(input.dataset.seed)) blockers.push("dataset seed is required");
  if (input.dataset.selectedInstanceIds.length === 0) blockers.push("selected instance ids are required");

  const calibrationThreshold = Math.max(input.calibration.threshold, REQUIRED_CALIBRATION);
  const calibrationGreen =
    input.calibration.total > 0 &&
    input.calibration.reproducedBaseline === input.calibration.total &&
    input.calibration.passRate >= calibrationThreshold;
  if (!calibrationGreen) blockers.push("gold-patch calibration is below 95%");

  const requiredPassRate = Math.max(input.agentRun.requiredPassRate, REQUIRED_PASS_RATE);
  const agentPassRateGreen =
    input.agentRun.total >= 100 &&
    input.agentRun.passRate >= requiredPassRate &&
    input.agentRun.resolved / Math.max(1, input.agentRun.total) >= requiredPassRate;
  if (!agentPassRateGreen) blockers.push("agent run pass rate is below 65%");

  const requiredDelta = Math.max(input.comparison.requiredDelta, REQUIRED_AB_DELTA);
  const abImprovementGreen = input.comparison.delta >= requiredDelta;
  if (!abImprovementGreen) blockers.push("A/B delta is below 10 percentage points");

  const repeatedRunStable = hasStableRepeatedRuns(input.repeatedRuns);
  if (input.repeatedRuns.length < 2) {
    blockers.push("at least two repeated runs are required");
  } else if (!repeatedRunStable) {
    blockers.push("repeated runs vary by more than 5 percentage points");
  }

  const artifactsComplete = hasCompleteArtifacts(input);
  if (!artifactsComplete) blockers.push("per-instance trajectories, patches, logs, and classifications are incomplete");

  const failureTaxonomyPresent = Object.keys(input.failureTaxonomy).length > 0;
  if (!failureTaxonomyPresent) blockers.push("failure taxonomy is required");
  if (input.limitations.length === 0) blockers.push("limitations are required");

  if (input.suite === "verified") {
    warnings.push("SWE-bench Verified is comparable but no longer sufficient for 9.5+ frontier claims.");
  }

  const maxEligibleScore = computeMaxEligibleScore(input, blockers);
  const score = maxEligibleScore >= 9 && blockers.length === 0 ? 100 : Math.min(89, maxEligibleScore * 10);

  return {
    dimensionId: "swe_bench_correctness",
    generatedAt: new Date().toISOString(),
    suite: input.suite,
    pass: blockers.length === 0 && score >= threshold,
    score,
    threshold,
    maxEligibleScore,
    blockers,
    warnings,
    input,
    proof: {
      datasetSelected: Boolean(input.dataset.path && input.dataset.sha256 && input.dataset.selectedInstanceIds.length > 0),
      calibrationGreen,
      agentPassRateGreen,
      abImprovementGreen,
      repeatedRunStable,
      artifactsComplete,
      failureTaxonomyPresent,
    },
  };
}

export function classifySWEFailure(result: SWEBenchFailureLike): SWEFailureClass {
  if (result.resolved) return "resolved";
  const haystack = `${result.error ?? ""}\n${result.test_output ?? ""}`.toLowerCase();
  if (/test patch.*failed|patch failed to apply/.test(haystack)) return "test_patch_error";
  if (/baseline.*not.*reproduc|already pass/.test(haystack)) return "baseline_not_reproduced";
  if (/no patch|empty patch|agent produced no patch/.test(haystack) || result.model_patch === "") return "agent_no_patch";
  if (/timed out|timeout/.test(haystack)) return "timeout";
  if (/flaky|intermittent/.test(haystack)) return "flaky";
  if (/environment|setup failed|env_error|module not found|importerror|pip install/.test(haystack)) return "env_error";
  if (/infra|docker|git clone|network|econn/.test(haystack)) return "infra";
  if (/failed|assertion|traceback|error/.test(haystack)) return "agent_wrong_patch";
  return "agent_wrong_patch";
}

export function formatSWEBenchCorrectnessMarkdown(result: SWEBenchCorrectnessGateResult): string {
  const input = result.input;
  const lines = [
    "# SWE-bench Correctness Gate",
    "",
    `- Dimension: ${result.dimensionId}`,
    `- Suite: ${result.suite}`,
    `- Pass: ${result.pass ? "yes" : "no"}`,
    `- Score: ${result.score}/${result.threshold}`,
    `- Max eligible matrix score: ${result.maxEligibleScore.toFixed(1)}`,
    `- Dataset: ${input.dataset.path}`,
    `- Dataset hash: ${input.dataset.sha256 || "-"}`,
    `- Selected instances: ${input.dataset.selectedInstanceIds.length}`,
    `- Gold calibration: ${(input.calibration.passRate * 100).toFixed(1)}% (${input.calibration.goldResolved}/${input.calibration.total})`,
    `- Agent pass rate: ${(input.agentRun.passRate * 100).toFixed(1)}% (${input.agentRun.resolved}/${input.agentRun.total})`,
    `- A/B delta: ${(input.comparison.delta * 100).toFixed(1)} percentage points`,
    "",
    "## Blockers",
    "",
  ];

  if (result.blockers.length === 0) {
    lines.push("- none");
  } else {
    for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  }

  lines.push("", "## Failure Taxonomy", "");
  for (const [name, count] of Object.entries(input.failureTaxonomy)) {
    lines.push(`- ${name}: ${count}`);
  }

  lines.push("", "## Limitations", "");
  for (const limitation of input.limitations) lines.push(`- ${limitation}`);

  return `${lines.join("\n")}\n`;
}

export function formatSWEBenchCorrectnessText(result: SWEBenchCorrectnessGateResult): string {
  return [
    `SWE-bench correctness gate: ${result.pass ? "PASS" : "FAIL"}`,
    `Suite: ${result.suite}`,
    `Score: ${result.score}/${result.threshold}`,
    `Max eligible matrix score: ${result.maxEligibleScore.toFixed(1)}`,
    `Agent pass rate: ${(result.input.agentRun.passRate * 100).toFixed(1)}%`,
    `A/B delta: ${(result.input.comparison.delta * 100).toFixed(1)}pp`,
    `Blockers: ${result.blockers.length === 0 ? "none" : result.blockers.join("; ")}`,
  ].join("\n");
}

function hasStableRepeatedRuns(runs: SWEBenchRepeatedRunProof[]): boolean {
  if (runs.length < 2) return false;
  const rates = runs.map((run) => run.passRate);
  return Math.max(...rates) - Math.min(...rates) <= REQUIRED_STABILITY_SPREAD;
}

function hasCompleteArtifacts(input: SWEBenchCorrectnessGateInput): boolean {
  const expected = input.agentRun.total;
  if (expected <= 0) return false;
  return input.artifactCompleteness.trajectoryCount >= expected &&
    input.artifactCompleteness.patchCount >= expected &&
    input.artifactCompleteness.baselineLogCount >= expected &&
    input.artifactCompleteness.verificationLogCount >= expected &&
    input.artifactCompleteness.environmentLogCount >= expected &&
    input.artifactCompleteness.classifiedFailureCount >= expected &&
    Boolean(input.artifactCompleteness.manifestPath);
}

function computeMaxEligibleScore(input: SWEBenchCorrectnessGateInput, blockers: string[]): number {
  if (blockers.length === 0) return 9;
  if (input.calibration.passRate < REQUIRED_CALIBRATION) return 7;
  if (input.agentRun.total >= 50 && input.repeatedRuns.length >= 1 && input.comparison.delta >= REQUIRED_AB_DELTA) return 7;
  if (input.calibration.passRate >= REQUIRED_CALIBRATION && input.agentRun.total >= 10) return 5;
  return 3.5;
}
