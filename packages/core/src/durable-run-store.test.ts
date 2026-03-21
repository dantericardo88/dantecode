import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionEvidence, Session } from "@dantecode/config-types";
import { DurableRunStore } from "./durable-run-store.js";
import type { ArtifactRecord, ToolCallRecord } from "./tool-runtime/tool-call-types.js";

function makeSession(projectRoot: string): Session {
  const now = new Date().toISOString();
  return {
    id: "sess-1",
    projectRoot,
    messages: [],
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "grok",
      modelId: "grok-3",
      maxTokens: 4096,
      temperature: 0.1,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: true,
    },
    createdAt: now,
    updatedAt: now,
    agentStack: [],
    todoList: [],
  };
}

describe("DurableRunStore", () => {
  let projectRoot = "";

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = "";
    }
  });

  it("persists run state, resume hints, evidence, and runtime session snapshots", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-durable-run-"));
    const store = new DurableRunStore(projectRoot);
    const session = makeSession(projectRoot);

    const evidence: ExecutionEvidence = {
      id: "ev-1",
      kind: "file_write",
      success: true,
      label: "Edited src/app.ts",
      filePath: "src/app.ts",
      timestamp: new Date().toISOString(),
    };

    const run = await store.initializeRun({
      runId: "run-1",
      session,
      prompt: "/autoforge improve reliability",
      workflow: "autoforge",
    });

    await store.checkpoint(run.id, {
      session,
      touchedFiles: ["src/app.ts"],
      lastConfirmedStep: "Edited src/app.ts",
      nextAction: "Run verification",
      evidence: [evidence],
    });

    await store.pauseRun(run.id, {
      reason: "model_timeout",
      session,
      touchedFiles: ["src/app.ts"],
      lastConfirmedStep: "Edited src/app.ts",
      nextAction: "Run verification",
      message: "Paused after repeated model timeout.",
    });

    const loaded = await store.loadRun(run.id);
    const hint = await store.getResumeHint(run.id);
    const snapshot = await store.loadSessionSnapshot(run.id);
    const savedEvidence = await store.loadEvidence(run.id);

    expect(loaded?.status).toBe("waiting_user");
    expect(loaded?.pauseReason).toBe("model_timeout");
    expect(loaded?.workflow).toBe("autoforge");
    expect(loaded?.touchedFiles).toContain("src/app.ts");
    expect(hint?.nextAction).toBe("Run verification");
    expect(hint?.continueCommand).toBe("continue");
    expect(snapshot?.id).toBe(session.id);
    expect(savedEvidence).toHaveLength(1);
    expect(savedEvidence[0]?.kind).toBe("file_write");

    const runPath = join(projectRoot, ".danteforge", "runs", run.id, "run.json");
    const resumePath = join(projectRoot, ".danteforge", "runs", run.id, "resume.json");
    const evidencePath = join(projectRoot, ".danteforge", "runs", run.id, "evidence.json");
    const eventBaseState = join(
      projectRoot,
      ".danteforge",
      "runs",
      run.id,
      "event-log",
      "run",
      "base_state.json",
    );

    expect(JSON.parse(await readFile(runPath, "utf-8")).id).toBe(run.id);
    expect(JSON.parse(await readFile(resumePath, "utf-8")).runId).toBe(run.id);
    expect(JSON.parse(await readFile(evidencePath, "utf-8"))).toHaveLength(1);
    expect(
      JSON.parse(await readFile(eventBaseState, "utf-8")).checkpoint.channelValues.status,
    ).toBe("waiting_user");
  });

  it("lists durable runs alongside legacy autoforge checkpoints and paused background tasks", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-durable-legacy-"));
    const store = new DurableRunStore(projectRoot);
    const session = makeSession(projectRoot);

    await store.initializeRun({
      runId: "run-native",
      session,
      prompt: "Fix the resume flow",
      workflow: "agent-loop",
    });

    await mkdir(join(projectRoot, ".dantecode", "autoforge-checkpoints"), { recursive: true });
    await writeFile(
      join(projectRoot, ".dantecode", "autoforge-checkpoints", "af-legacy.json"),
      JSON.stringify({
        version: 2,
        sessionId: "af-legacy",
        startedAt: new Date().toISOString(),
        checkpoints: [
          {
            id: "chk-1",
            createdAt: new Date().toISOString(),
            label: "timed-out",
            triggerCommand: "/autoforge --resume=af-legacy",
            currentStep: 4,
            elapsedMs: 1200,
            pdseScores: [],
            worktreeBranches: [],
            lessonsDelta: [],
            metadata: { error: "timeout" },
          },
        ],
      }),
      "utf-8",
    );

    await mkdir(join(projectRoot, ".dantecode", "bg-tasks"), { recursive: true });
    await writeFile(
      join(projectRoot, ".dantecode", "bg-tasks", "task-legacy.json"),
      JSON.stringify({
        id: "task-legacy",
        prompt: "Long running review",
        status: "paused",
        createdAt: new Date().toISOString(),
        progress: "Paused waiting for resume",
        touchedFiles: [],
      }),
      "utf-8",
    );

    const runs = await store.listRuns();
    const ids = runs.map((run) => run.id);

    expect(ids).toContain("run-native");
    expect(ids).toContain("af-legacy");
    expect(ids).toContain("task-legacy");
    expect(runs.find((run) => run.id === "af-legacy")?.legacySource).toBe("autoforge_checkpoint");
    expect(runs.find((run) => run.id === "task-legacy")?.legacySource).toBe("background_task");
  });

  it("persists and restores tool-runtime artifacts for resume flows", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-durable-artifacts-"));
    const store = new DurableRunStore(projectRoot);
    const session = makeSession(projectRoot);

    const run = await store.initializeRun({
      runId: "run-artifacts",
      session,
      prompt: "/magic acquire a spec",
      workflow: "magic",
    });

    const artifacts: ArtifactRecord[] = [
      {
        id: "art-download-1",
        kind: "download",
        path: join(projectRoot, "external", "spec.txt"),
        toolCallId: "acquire-call",
        createdAt: Date.now(),
        verified: true,
        verifiedAt: Date.now(),
        sourceUrl: "https://example.com/spec.txt",
        sizeBytes: 512,
      },
    ];

    await store.persistArtifacts(run.id, artifacts);

    const loaded = await store.loadArtifacts(run.id);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("art-download-1");
    expect(loaded[0]?.verified).toBe(true);
    expect(loaded[0]?.sourceUrl).toBe("https://example.com/spec.txt");
  });

  it("persists and clears pending tool calls for background resume flows", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-durable-pending-tools-"));
    const store = new DurableRunStore(projectRoot);
    const session = makeSession(projectRoot);

    const run = await store.initializeRun({
      runId: "run-pending-tools",
      session,
      prompt: "/magic continue background work",
      workflow: "magic",
    });

    await store.persistPendingToolCalls(run.id, [
      {
        id: "tool-write-1",
        name: "Write",
        input: {
          file_path: "src/app.ts",
          content: "export const resumed = true;\n",
        },
        dependsOn: ["tool-read-1"],
      },
    ]);

    expect(await store.loadPendingToolCalls(run.id)).toEqual([
      {
        id: "tool-write-1",
        name: "Write",
        input: {
          file_path: "src/app.ts",
          content: "export const resumed = true;\n",
        },
        dependsOn: ["tool-read-1"],
      },
    ]);

    await store.clearPendingToolCalls(run.id);

    expect(await store.loadPendingToolCalls(run.id)).toEqual([]);
  });

  it("persists exact tool-call records for resume-safe scheduler state", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-durable-tool-calls-"));
    const store = new DurableRunStore(projectRoot);
    const session = makeSession(projectRoot);

    const run = await store.initializeRun({
      runId: "run-tool-calls",
      session,
      prompt: "/magic resume approval state",
      workflow: "magic",
    });

    const toolCalls: ToolCallRecord[] = [
      {
        id: "call-approval-1",
        toolName: "Bash",
        input: { command: "git push origin main" },
        requestId: "round-1",
        dependsOn: ["call-read-1"],
        status: "awaiting_approval",
        statusHistory: [
          { status: "created", ts: Date.now() - 1000 },
          { status: "validating", ts: Date.now() - 900 },
          { status: "awaiting_approval", ts: Date.now() - 800, reason: "Push requires approval" },
        ],
        createdAt: Date.now() - 1000,
      },
    ];

    await store.persistToolCallRecords(run.id, toolCalls);

    expect(await store.loadToolCallRecords(run.id)).toEqual(toolCalls);
  });
});
