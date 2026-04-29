export interface BrowserLivePreviewProof {
  dimensionId: "browser_live_preview";
  generatedAt: string;
  preview: {
    url: string;
    command?: string;
    port?: number;
    managed: boolean;
    startupMs?: number;
    framework?: string;
  };
  captures: {
    screenshotPath?: string;
    screenshotSha256?: string;
    domTextChars: number;
    accessibilityTreeCaptured: boolean;
    consoleErrorCount: number;
    networkFailureCount: number;
    blockingErrorCount: number;
    viewports: Array<{
      width: number;
      height: number;
      screenshotPath?: string;
    }>;
  };
  hotReload: {
    pass: boolean;
    changedFile?: string;
    beforeHash?: string;
    afterHash?: string;
    observedMs?: number;
  };
  keyboard: {
    pass: boolean;
    reachableControls: number;
    totalControls: number;
    focusOrder: string[];
  };
  repair: {
    failureOverlayAvailable: boolean;
    repairPromptAvailable: boolean;
  };
  artifacts: {
    manifestPath?: string;
    reportPath?: string;
    tracePath?: string;
  };
}

export interface BrowserLivePreviewGateOptions {
  threshold?: number;
}

export interface BrowserLivePreviewCoverage {
  managedPreview: boolean;
  devServerCommand: boolean;
  browserScreenshot: boolean;
  domInspection: boolean;
  accessibilityTree: boolean;
  cleanRuntime: boolean;
  responsiveViewports: boolean;
  hotReload: boolean;
  keyboardTraversal: boolean;
  repairLoop: boolean;
  artifacts: boolean;
}

export interface BrowserLivePreviewGateResult {
  dimensionId: "browser_live_preview";
  generatedAt: string;
  pass: boolean;
  score: number;
  threshold: number;
  maxEligibleScore: number;
  previewUrl: string;
  blockers: string[];
  warnings: string[];
  coverage: BrowserLivePreviewCoverage;
  proof: BrowserLivePreviewProof;
}

const DEFAULT_THRESHOLD = 90;

function isHttpLocalPreview(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname.endsWith(".local"))
    );
  } catch {
    return false;
  }
}

function hasSha256(value: string | undefined): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function buildCoverage(proof: BrowserLivePreviewProof): BrowserLivePreviewCoverage {
  const keyboardReachable =
    proof.keyboard.totalControls > 0 &&
    proof.keyboard.reachableControls === proof.keyboard.totalControls &&
    proof.keyboard.focusOrder.length >= proof.keyboard.totalControls;

  return {
    managedPreview: proof.preview.managed && isHttpLocalPreview(proof.preview.url),
    devServerCommand: Boolean(proof.preview.command && proof.preview.port && proof.preview.startupMs !== undefined),
    browserScreenshot: Boolean(proof.captures.screenshotPath && hasSha256(proof.captures.screenshotSha256)),
    domInspection: proof.captures.domTextChars > 0,
    accessibilityTree: proof.captures.accessibilityTreeCaptured,
    cleanRuntime: proof.captures.blockingErrorCount === 0,
    responsiveViewports:
      proof.captures.viewports.some((v) => v.width <= 480 && Boolean(v.screenshotPath)) &&
      proof.captures.viewports.some((v) => v.width >= 1024 && Boolean(v.screenshotPath)),
    hotReload:
      proof.hotReload.pass &&
      Boolean(proof.hotReload.changedFile) &&
      hasSha256(proof.hotReload.beforeHash) &&
      hasSha256(proof.hotReload.afterHash),
    keyboardTraversal: proof.keyboard.pass && keyboardReachable,
    repairLoop: proof.repair.failureOverlayAvailable && proof.repair.repairPromptAvailable,
    artifacts: Boolean(proof.artifacts.manifestPath && proof.artifacts.reportPath),
  };
}

function blockersFor(coverage: BrowserLivePreviewCoverage, proof: BrowserLivePreviewProof): string[] {
  const blockers: string[] = [];
  if (!coverage.managedPreview) blockers.push("managed localhost preview is required");
  if (!coverage.devServerCommand) blockers.push("dev server command, port, and startup proof are required");
  if (!coverage.browserScreenshot) blockers.push("browser screenshot proof is required");
  if (!coverage.domInspection) blockers.push("DOM inspection proof is required");
  if (!coverage.accessibilityTree) blockers.push("accessibility tree capture is required");
  if (!coverage.cleanRuntime) blockers.push("blocking runtime errors must be zero");
  if (!coverage.responsiveViewports) blockers.push("mobile and desktop viewport screenshots are required");
  if (!coverage.hotReload) blockers.push("hot reload proof is required");
  if (!coverage.keyboardTraversal) blockers.push("keyboard traversal proof is required");
  if (!coverage.repairLoop) blockers.push("preview repair overlay and prompt proof are required");
  if (!coverage.artifacts) blockers.push("manifest and report artifact paths are required");
  if (proof.captures.networkFailureCount > 0) {
    blockers.push("network failures must be investigated before a 9-grade preview claim");
  }
  return blockers;
}

function maxEligibleScore(coverage: BrowserLivePreviewCoverage): number {
  if (!coverage.managedPreview || !coverage.devServerCommand) return 5;
  if (!coverage.browserScreenshot || !coverage.domInspection || !coverage.accessibilityTree) return 7;
  if (!coverage.hotReload || !coverage.responsiveViewports || !coverage.keyboardTraversal) return 8;
  if (!coverage.cleanRuntime || !coverage.repairLoop || !coverage.artifacts) return 8.5;
  return 9;
}

export function evaluateBrowserLivePreviewGate(
  proof: BrowserLivePreviewProof,
  options: BrowserLivePreviewGateOptions = {},
): BrowserLivePreviewGateResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const coverage = buildCoverage(proof);
  const blockers = blockersFor(coverage, proof);
  const covered = Object.values(coverage).filter(Boolean).length;
  const score = Math.round((covered / Object.keys(coverage).length) * 100);
  const eligible = maxEligibleScore(coverage);

  const warnings: string[] = [];
  if (proof.captures.consoleErrorCount > 0 && proof.captures.blockingErrorCount === 0) {
    warnings.push("non-blocking console errors are present");
  }
  if (!proof.artifacts.tracePath) {
    warnings.push("trace artifact is absent; 9.5+ requires repeatable trace publication");
  }

  return {
    dimensionId: "browser_live_preview",
    generatedAt: new Date().toISOString(),
    pass: blockers.length === 0 && score >= threshold,
    score,
    threshold,
    maxEligibleScore: eligible,
    previewUrl: proof.preview.url,
    blockers,
    warnings,
    coverage,
    proof,
  };
}

export function generateBrowserLivePreviewReport(result: BrowserLivePreviewGateResult): string {
  const coverageRows = Object.entries(result.coverage)
    .map(([key, value]) => `| ${key} | ${value ? "yes" : "no"} |`)
    .join("\n");

  const blockers = result.blockers.length > 0
    ? result.blockers.map((blocker) => `- ${blocker}`).join("\n")
    : "- none";

  const warnings = result.warnings.length > 0
    ? result.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- none";

  return [
    "# Browser Live Preview Gate Report",
    "",
    `Status: ${result.pass ? "PASSED" : "FAILED"}`,
    `Score: ${result.score}/100`,
    `Threshold: ${result.threshold}`,
    `Max eligible matrix score: ${result.maxEligibleScore}`,
    `Preview URL: ${result.previewUrl}`,
    "",
    "## Coverage",
    "",
    "| Check | Covered |",
    "| --- | --- |",
    coverageRows,
    "",
    "## Blockers",
    "",
    blockers,
    "",
    "## Warnings",
    "",
    warnings,
    "",
  ].join("\n");
}
