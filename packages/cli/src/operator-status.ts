import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DurableRunStore, PlanStore, getContextUtilization } from "@dantecode/core";
import type { ReplState } from "./slash-commands.js";

export interface DurableRunSnapshot {
  id: string;
  workflow: string;
  status: string;
  updatedAt: string;
  nextAction: string | null;
}

export interface PdseSummarySnapshot {
  fileCount: number;
  passedCount: number;
  failedCount: number;
  worstScore: number | null;
  summary: string;
}

export interface ReadinessSnapshot {
  status: string;
  artifactCommitSha: string | null;
  headCommitSha: string | null;
  sameCommit: boolean | null;
  generatedAt: string | null;
  sourcePath: string | null;
}

export interface OperatorStatusSnapshot {
  approvalMode: string;
  planMode: boolean;
  taskMode: string | null;
  currentPlanId: string | null;
  currentPlanStatus: string | null;
  currentPlanGoal: string | null;
  currentRunId: string | null;
  latestPausedDurableRun: DurableRunSnapshot | null;
  contextUtilization: ReturnType<typeof getContextUtilization>;
  lastRestoreEvent: { restoredAt: string; restoreSummary: string } | null;
  lastPdseSummary: PdseSummarySnapshot | null;
  readiness: ReadinessSnapshot;
}

interface MessageLike {
  role: string;
  content: string;
}

interface ServeSessionLike {
  id: string;
  createdAt: string;
  mode?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function readGitHead(projectRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

async function readReadinessSnapshot(projectRoot: string): Promise<ReadinessSnapshot> {
  const sourcePath = resolve(projectRoot, "artifacts", "readiness", "current-readiness.json");
  try {
    const raw = await readFile(sourcePath, "utf8");
    const artifact = JSON.parse(raw) as Record<string, unknown>;
    const artifactCommitSha = normalizeOptionalString(artifact["commitSha"]);
    const headCommitSha = readGitHead(projectRoot);
    return {
      status: normalizeOptionalString(artifact["status"]) ?? "unknown",
      artifactCommitSha,
      headCommitSha,
      sameCommit: headCommitSha ? artifactCommitSha === headCommitSha : null,
      generatedAt: normalizeOptionalString(artifact["generatedAt"]),
      sourcePath,
    };
  } catch {
    return {
      status: "missing",
      artifactCommitSha: null,
      headCommitSha: readGitHead(projectRoot),
      sameCommit: null,
      generatedAt: null,
      sourcePath: null,
    };
  }
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function createDefaultContextUtilization(): ReturnType<typeof getContextUtilization> {
  return getContextUtilization([], 131072);
}

function summarizePdseResults(
  results: Array<{ file: string; pdseScore: number; passed: boolean }>,
): PdseSummarySnapshot | null {
  if (results.length === 0) {
    return null;
  }

  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;
  const worstScore = Math.min(...results.map((result) => result.pdseScore));
  return {
    fileCount: results.length,
    passedCount,
    failedCount,
    worstScore,
    summary:
      failedCount > 0
        ? `${failedCount}/${results.length} PDSE checks are below threshold. Lowest score: ${worstScore}.`
        : `All ${results.length} PDSE checks passed. Lowest score: ${worstScore}.`,
  };
}

async function readCurrentPlan(projectRoot: string) {
  const store = new PlanStore(projectRoot);
  const plans = await store.list({ limit: 20 });
  return (
    plans.find((plan) => ["draft", "approved", "executing"].includes(plan.status)) ??
    plans[0] ??
    null
  );
}

function toDurableRunSnapshot(run: Record<string, unknown> | null): DurableRunSnapshot | null {
  if (!run) {
    return null;
  }

  return {
    id: String(run["id"] ?? ""),
    workflow: String(run["workflow"] ?? "unknown"),
    status: String(run["status"] ?? "unknown"),
    updatedAt: String(run["updatedAt"] ?? ""),
    nextAction: normalizeOptionalString(run["nextAction"]),
  };
}

async function listDurableRuns(projectRoot: string) {
  try {
    return await new DurableRunStore(projectRoot).listRuns();
  } catch {
    return [];
  }
}

export async function readSessionDurableRunSnapshot(
  projectRoot: string,
  sessionId: string,
): Promise<DurableRunSnapshot | null> {
  const runs = await listDurableRuns(projectRoot);
  const run = runs.find((candidate) => candidate.sessionId === sessionId) ?? null;
  return toDurableRunSnapshot(run as unknown as Record<string, unknown> | null);
}

export async function buildCliOperatorStatus(state: ReplState): Promise<OperatorStatusSnapshot> {
  const runs = await listDurableRuns(state.projectRoot);
  const latestPausedRun =
    runs.find((run) => run.status === "waiting_user" && run.sessionId === state.session.id) ??
    runs.find((run) => run.status === "waiting_user") ??
    null;
  const currentPlan = state.currentPlanId ? null : await readCurrentPlan(state.projectRoot);

  return {
    approvalMode: String(state.approvalMode),
    planMode: state.planMode,
    taskMode: state.taskMode ?? null,
    currentPlanId: state.currentPlanId ?? currentPlan?.id ?? null,
    currentPlanStatus:
      state.currentPlan != null
        ? state.planApproved
          ? "approved"
          : "draft"
        : (currentPlan?.status ?? null),
    currentPlanGoal: state.currentPlan?.goal ?? currentPlan?.plan.goal ?? null,
    currentRunId: state.pendingResumeRunId ?? latestPausedRun?.id ?? null,
    latestPausedDurableRun: toDurableRunSnapshot(
      latestPausedRun as unknown as Record<string, unknown> | null,
    ),
    contextUtilization: getContextUtilization(
      state.session.messages.map((message) => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content : "",
      })),
      state.session.model.contextWindow,
    ),
    lastRestoreEvent: state.lastRestoreEvent ?? null,
    lastPdseSummary: summarizePdseResults(state.lastSessionPdseResults),
    readiness: await readReadinessSnapshot(state.projectRoot),
  };
}

function selectLatestSession(sessions: Iterable<ServeSessionLike>): ServeSessionLike | null {
  const sorted = Array.from(sessions).sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  return sorted[0] ?? null;
}

export async function buildServeOperatorStatus(options: {
  projectRoot: string;
  sessions: Iterable<ServeSessionLike>;
}): Promise<OperatorStatusSnapshot> {
  const latestSession = selectLatestSession(options.sessions);
  const runs = await listDurableRuns(options.projectRoot);
  const latestPausedRun =
    runs.find((run) => run.status === "waiting_user" && run.sessionId === latestSession?.id) ??
    runs.find((run) => run.status === "waiting_user") ??
    null;
  const currentPlan = await readCurrentPlan(options.projectRoot);
  const messages: MessageLike[] = latestSession
    ? latestSession.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }))
    : [];

  return {
    approvalMode: latestSession?.mode ?? "review",
    planMode: Boolean(
      currentPlan && ["draft", "approved", "executing"].includes(currentPlan.status),
    ),
    taskMode: null,
    currentPlanId: currentPlan?.id ?? null,
    currentPlanStatus: currentPlan?.status ?? null,
    currentPlanGoal: currentPlan?.plan.goal ?? null,
    currentRunId: latestPausedRun?.id ?? null,
    latestPausedDurableRun: toDurableRunSnapshot(
      latestPausedRun as unknown as Record<string, unknown> | null,
    ),
    contextUtilization:
      messages.length > 0
        ? getContextUtilization(messages, 131072)
        : createDefaultContextUtilization(),
    lastRestoreEvent: null,
    lastPdseSummary: null,
    readiness: await readReadinessSnapshot(options.projectRoot),
  };
}
