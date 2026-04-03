import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readinessDir = join(repoRoot, "artifacts", "readiness");
const readinessJsonPath = join(readinessDir, "current-readiness.json");
const readinessMdPath = join(readinessDir, "current-readiness.md");
const localGatesPath = join(readinessDir, "local-gates.json");
const releaseDoctorPath = join(readinessDir, "release-doctor.json");
const quickstartProofPath = join(readinessDir, "quickstart-proof.json");
const quickstartProofMdPath = join(readinessDir, "quickstart-proof.md");
const externalReadinessDir = join(readinessDir, "external");
const externalReceiptPaths = {
  windowsSmoke: join(externalReadinessDir, "windows-smoke.json"),
  liveProvider: join(externalReadinessDir, "live-provider.json"),
  publishDryRun: join(externalReadinessDir, "publish-dry-run.json"),
};
const FIXTURE_COMMIT_SHA = "1111111111111111111111111111111111111111";
const gateEnvKeys = [
  "GATE_TYPECHECK",
  "GATE_LINT",
  "GATE_TEST",
  "GATE_BUILD",
  "GATE_WINDOWS_SMOKE",
  "GATE_ANTI_STUB",
  "GATE_LIVE_PROVIDER",
  "GATE_PUBLISH_DRY_RUN",
];

type FileSnapshot = {
  exists: boolean;
  content?: string;
};

function snapshotFile(filePath: string): FileSnapshot {
  if (!existsSync(filePath)) {
    return { exists: false };
  }

  return {
    exists: true,
    content: readFileSync(filePath, "utf8"),
  };
}

function restoreFile(filePath: string, snapshot: FileSnapshot): void {
  if (!snapshot.exists) {
    rmSync(filePath, { force: true });
    return;
  }

  writeFileSync(filePath, snapshot.content ?? "", "utf8");
}

function envWithoutReadinessGates(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of gateEnvKeys) {
    delete env[key];
  }
  env.GITHUB_SHA = FIXTURE_COMMIT_SHA;
  return env;
}

function writeBaseReadyEvidence(
  commitSha: string,
  options: { includeLiveProvider?: boolean } = {},
): void {
  mkdirSync(externalReadinessDir, { recursive: true });
  writeFileSync(
    localGatesPath,
    JSON.stringify(
      {
        source: "release-check",
        commitSha,
        generatedAt: "2026-03-26T00:00:00.000Z",
        gates: {
          typecheck: "pass",
          lint: "pass",
          test: "pass",
          build: "pass",
          windowsSmoke: "unknown",
          antiStub: "pass",
          liveProvider: "unknown",
          publishDryRun: "unknown",
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(
    externalReceiptPaths.windowsSmoke,
    JSON.stringify(
      {
        gateName: "windowsSmoke",
        status: "pass",
        source: "external-gate-runner",
        command: "npm run smoke:external",
        detail: "External project smoke check passed.",
        commitSha,
        generatedAt: "2026-03-26T00:10:00.000Z",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(
    externalReceiptPaths.publishDryRun,
    JSON.stringify(
      {
        gateName: "publishDryRun",
        status: "pass",
        source: "external-gate-runner",
        command: "npm run publish:dry-run",
        detail: "Publish dry-run passed.",
        commitSha,
        generatedAt: "2026-03-26T00:11:00.000Z",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  if (options.includeLiveProvider) {
    writeFileSync(
      externalReceiptPaths.liveProvider,
      JSON.stringify(
        {
          gateName: "liveProvider",
          status: "pass",
          source: "external-gate-runner",
          command: "npm run smoke:provider -- --require-provider",
          detail: "Live provider smoke check passed.",
          commitSha,
          generatedAt: "2026-03-26T00:12:00.000Z",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } else {
    rmSync(externalReceiptPaths.liveProvider, { force: true });
  }
}

function writeQuickstartReceipt(
  commitSha: string,
  options: { canClaimQuickstart: boolean; blockers?: string[] } = {
    canClaimQuickstart: true,
    blockers: [],
  },
): void {
  writeFileSync(
    quickstartProofPath,
    JSON.stringify(
      {
        source: "quickstart-proof",
        commitSha,
        generatedAt: "2026-03-26T00:14:00.000Z",
        status: options.canClaimQuickstart ? "pass" : "fail",
        readmeQuickstart: {
          sourcePath: join(repoRoot, "README.md"),
          commands: [
            "npm install -g @dantecode/cli",
            "export ANTHROPIC_API_KEY=sk-ant-...",
            'dantecode "build me a todo app"',
          ],
        },
        summary: {
          canClaimQuickstart: options.canClaimQuickstart,
          blockerCount: options.blockers?.length ?? 0,
          actionCount: 0,
          blockers: options.blockers ?? [],
          actions: [],
        },
        steps: [
          {
            name: "README quickstart block",
            status: options.canClaimQuickstart ? "pass" : "fail",
            detail: "Generated by release-readiness test fixture.",
            command: null,
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function writeReleaseDoctorReceiptFixture(
  commitSha: string,
  summary: {
    readyCount?: number;
    actionCount?: number;
    blockerCount?: number;
    blockers?: string[];
    actions?: string[];
  } = {},
): void {
  writeFileSync(
    releaseDoctorPath,
    JSON.stringify(
      {
        source: "release-doctor",
        commitSha,
        generatedAt: "2026-03-26T00:09:00.000Z",
        summary: {
          readyCount: summary.readyCount ?? 12,
          actionCount: summary.actionCount ?? 0,
          blockerCount: summary.blockerCount ?? 0,
          blockers: summary.blockers ?? [],
          actions: summary.actions ?? [],
        },
        checks: [
          {
            section: "Repo",
            status: "READY",
            label: "Fixture release doctor proof",
            detail: "Generated by release-readiness test fixture.",
            action: "",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

describe("release readiness generation", () => {
  let readinessJsonSnapshot: FileSnapshot;
  let readinessMdSnapshot: FileSnapshot;
  let localGatesSnapshot: FileSnapshot;
  let releaseDoctorSnapshot: FileSnapshot;
  let quickstartProofSnapshot: FileSnapshot;
  let quickstartProofMdSnapshot: FileSnapshot;
  let externalReceiptSnapshots: Record<string, FileSnapshot>;

  beforeAll(() => {
    readinessJsonSnapshot = snapshotFile(readinessJsonPath);
    readinessMdSnapshot = snapshotFile(readinessMdPath);
    localGatesSnapshot = snapshotFile(localGatesPath);
    releaseDoctorSnapshot = snapshotFile(releaseDoctorPath);
    quickstartProofSnapshot = snapshotFile(quickstartProofPath);
    quickstartProofMdSnapshot = snapshotFile(quickstartProofMdPath);
    externalReceiptSnapshots = Object.fromEntries(
      Object.entries(externalReceiptPaths).map(([gateName, filePath]) => [
        gateName,
        snapshotFile(filePath),
      ]),
    );
  });

  afterAll(() => {
    restoreFile(readinessJsonPath, readinessJsonSnapshot);
    restoreFile(readinessMdPath, readinessMdSnapshot);
    restoreFile(localGatesPath, localGatesSnapshot);
    restoreFile(releaseDoctorPath, releaseDoctorSnapshot);
    restoreFile(quickstartProofPath, quickstartProofSnapshot);
    restoreFile(quickstartProofMdPath, quickstartProofMdSnapshot);
    for (const [gateName, filePath] of Object.entries(externalReceiptPaths)) {
      restoreFile(filePath, externalReceiptSnapshots[gateName]!);
    }
  });

  it("writes a durable release doctor receipt with summary counts", () => {
    const result = spawnSync(process.execPath, ["scripts/release-doctor.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(existsSync(releaseDoctorPath)).toBe(true);

    const receipt = JSON.parse(readFileSync(releaseDoctorPath, "utf8"));
    expect(receipt).toMatchObject({
      source: "release-doctor",
      commitSha: FIXTURE_COMMIT_SHA,
    });
    expect(receipt.summary.readyCount + receipt.summary.actionCount + receipt.summary.blockerCount).toBeGreaterThan(0);
    expect(Array.isArray(receipt.checks)).toBe(true);
  });

  it("writes a durable quickstart proof receipt in dry mode", () => {
    rmSync(quickstartProofPath, { force: true });
    rmSync(quickstartProofMdPath, { force: true });

    const result = spawnSync(process.execPath, ["scripts/release/verify-quickstart.mjs", "--dry"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(existsSync(quickstartProofPath)).toBe(true);

    const receipt = JSON.parse(readFileSync(quickstartProofPath, "utf8"));
    expect(receipt).toMatchObject({
      source: "quickstart-proof",
      commitSha: FIXTURE_COMMIT_SHA,
      status: "unknown",
    });
    expect(Array.isArray(receipt.steps)).toBe(true);
    expect(receipt.summary.actionCount).toBeGreaterThan(0);
  });

  it("preserves proven local gates when CI env vars are absent", () => {
    rmSync(localGatesPath, { force: true });
    rmSync(releaseDoctorPath, { force: true });
    for (const filePath of Object.values(externalReceiptPaths)) {
      rmSync(filePath, { force: true });
    }

    writeFileSync(
      readinessJsonPath,
      JSON.stringify(
        {
          status: "local-green-external-pending",
          commitSha: FIXTURE_COMMIT_SHA,
          generatedAt: "2026-03-26T00:00:00.000Z",
          gates: {
            typecheck: "pass",
            lint: "pass",
            test: "pass",
            build: "pass",
            windowsSmoke: "unknown",
            antiStub: "pass",
            liveProvider: "unknown",
            publishDryRun: "unknown",
          },
          blockers: [],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("local-green-external-pending");
    expect(artifact.gates).toMatchObject({
      typecheck: "pass",
      lint: "pass",
      test: "pass",
      build: "pass",
      antiStub: "pass",
      windowsSmoke: "unknown",
      liveProvider: "unknown",
      publishDryRun: "unknown",
    });
    expect(artifact.blockers).toEqual([]);
  });

  it("rebuilds readiness from a same-commit local receipt when the main artifact is missing", () => {
    rmSync(readinessJsonPath, { force: true });
    rmSync(readinessMdPath, { force: true });
    rmSync(releaseDoctorPath, { force: true });
    for (const filePath of Object.values(externalReceiptPaths)) {
      rmSync(filePath, { force: true });
    }

    writeFileSync(
      localGatesPath,
      JSON.stringify(
        {
          source: "release-check",
          commitSha: FIXTURE_COMMIT_SHA,
          generatedAt: "2026-03-26T00:00:00.000Z",
          gates: {
            typecheck: "pass",
            lint: "pass",
            test: "pass",
            build: "pass",
            windowsSmoke: "unknown",
            antiStub: "pass",
            liveProvider: "unknown",
            publishDryRun: "unknown",
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("local-green-external-pending");
    expect(artifact.gates).toMatchObject({
      typecheck: "pass",
      lint: "pass",
      test: "pass",
      build: "pass",
      antiStub: "pass",
    });
  });

  it("promotes readiness to private-ready when same-commit external receipts prove windows smoke and publish dry run", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha);

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("private-ready");
    expect(artifact.gates).toMatchObject({
      windowsSmoke: "pass",
      publishDryRun: "pass",
      liveProvider: "unknown",
    });
  });

  it("does not promote readiness to private-ready when publish dry run proof is still missing", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha);
    rmSync(externalReceiptPaths.publishDryRun, { force: true });

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("blocked");
    expect(artifact.openRequirements.privateReady).toContain(
      'Gate "publishDryRun" must pass. Current status: unknown.',
    );
  });

  it("promotes readiness to public-ready when the live provider receipt also passes", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha, { includeLiveProvider: true });
    writeQuickstartReceipt(commitSha);
    writeReleaseDoctorReceiptFixture(commitSha);

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("public-ready");
    expect(artifact.gates).toMatchObject({
      windowsSmoke: "pass",
      publishDryRun: "pass",
      liveProvider: "pass",
    });
    expect(artifact.releaseDoctor).toMatchObject({
      checked: true,
      canPublish: true,
      blockerCount: 0,
    });
    expect(artifact.quickstartProof).toMatchObject({
      checked: true,
      canClaimQuickstart: true,
      blockerCount: 0,
    });
  });

  it("keeps public-ready when release doctor has only preview-extension follow-up actions", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha, { includeLiveProvider: true });
    writeQuickstartReceipt(commitSha);

    writeReleaseDoctorReceiptFixture(commitSha, {
      readyCount: 11,
      actionCount: 1,
      blockerCount: 0,
      blockers: [],
      actions: ["VSCE_PAT is not set locally or in GitHub Actions secrets."],
    });

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("public-ready");
    expect(artifact.releaseDoctor).toMatchObject({
      checked: true,
      canPublish: true,
      blockerCount: 0,
      actionCount: 1,
    });
    expect(artifact.openRequirements.publicReady).toEqual([]);
  });

  it("keeps readiness at private-ready when live provider passes but release doctor proof is missing", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha, { includeLiveProvider: true });
    writeQuickstartReceipt(commitSha);
    rmSync(releaseDoctorPath, { force: true });

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("private-ready");
    expect(artifact.gates).toMatchObject({
      windowsSmoke: "pass",
      publishDryRun: "pass",
      liveProvider: "pass",
    });
    expect(artifact.openRequirements.publicReady).toContain(
      "Release doctor receipt is missing for the current commit. Run `npm run release:doctor` to validate publish blockers.",
    );
  });

  it("keeps readiness at private-ready when release doctor still reports publish blockers", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha, { includeLiveProvider: true });
    writeQuickstartReceipt(commitSha);
    writeReleaseDoctorReceiptFixture(commitSha, {
      readyCount: 10,
      actionCount: 1,
      blockerCount: 2,
      blockers: ["No provider credentials detected.", "No npm publish auth token detected locally."],
      actions: ["Working tree has 3 uncommitted path(s)."],
    });

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("private-ready");
    expect(artifact.releaseDoctor).toMatchObject({
      checked: true,
      canPublish: false,
      blockerCount: 2,
    });
    expect(artifact.openRequirements.publicReady).toContain(
      "Release doctor blocker: No provider credentials detected.",
    );
  });

  it("keeps readiness at private-ready when quickstart proof is missing for the current commit", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha, { includeLiveProvider: true });
    rmSync(quickstartProofPath, { force: true });
    writeReleaseDoctorReceiptFixture(commitSha);

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("private-ready");
    expect(artifact.quickstartProof).toMatchObject({
      checked: false,
      canClaimQuickstart: false,
    });
    expect(artifact.openRequirements.publicReady).toContain(
      "Quickstart proof receipt is missing for the current commit. Run `npm run release:prove-quickstart` to validate the README quickstart path.",
    );
  });

  it("keeps readiness at private-ready when quickstart proof still has blockers", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha, { includeLiveProvider: true });
    writeQuickstartReceipt(commitSha, {
      canClaimQuickstart: false,
      blockers: ["Exact README quickstart smoke is not proven for the current commit."],
    });
    writeReleaseDoctorReceiptFixture(commitSha);

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("private-ready");
    expect(artifact.quickstartProof).toMatchObject({
      checked: true,
      canClaimQuickstart: false,
      blockerCount: 1,
    });
    expect(artifact.openRequirements.publicReady).toContain(
      "Quickstart proof blocker: Exact README quickstart smoke is not proven for the current commit.",
    );
  });

  it("ignores stale release doctor and quickstart receipts from a different commit", () => {
    const commitSha = FIXTURE_COMMIT_SHA;
    writeBaseReadyEvidence(commitSha, { includeLiveProvider: true });
    writeQuickstartReceipt("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    writeReleaseDoctorReceiptFixture("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const result = spawnSync(process.execPath, ["scripts/release/generate-readiness.mjs"], {
      cwd: repoRoot,
      env: envWithoutReadinessGates(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const artifact = JSON.parse(readFileSync(readinessJsonPath, "utf8"));
    expect(artifact.status).toBe("private-ready");
    expect(artifact.releaseDoctor).toMatchObject({
      checked: false,
      canPublish: false,
    });
    expect(artifact.quickstartProof).toMatchObject({
      checked: false,
      canClaimQuickstart: false,
    });
  });

  it("release:sync exits non-zero when generated commit proof does not match git HEAD", () => {
    const result = spawnSync(process.execPath, ["scripts/release/sync-readiness.mjs"], {
      cwd: repoRoot,
      env: {
        ...envWithoutReadinessGates(),
        DANTECODE_RELEASE_SYNC_DRY: "1",
        GITHUB_SHA: FIXTURE_COMMIT_SHA,
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("git HEAD");
  });
});
