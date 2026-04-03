import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { DurableRunStore, PlanStore } from "@dantecode/core";
import { Router } from "./router.js";
import { buildRoutes, type ServerContext, type SessionRecord } from "./routes.js";
import { SessionEventEmitter } from "./session-emitter.js";
import type { ParsedRequest } from "./router.js";
import type { ModelProvider } from "@dantecode/config-types";

function makeReq(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  overrides: Partial<ParsedRequest> = {},
): ParsedRequest {
  return {
    method,
    path,
    params: {},
    query: {},
    body: undefined,
    headers: {},
    ...overrides,
  };
}

function makeContext(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    projectRoot: "/tmp/dantecode",
    version: "1.0.0",
    startTime: Date.now(),
    sessions: new Map<string, SessionRecord>(),
    sessionEmitter: new SessionEventEmitter(),
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "sess-1",
    name: "Session 1",
    createdAt: "2026-03-26T10:00:00.000Z",
    messageCount: 1,
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Hello", ts: "2026-03-26T10:00:01.000Z" }],
    ...overrides,
  };
}

describe("serve routes truth surface", () => {
  it("GET /api/status returns operator dashboard data for plan, paused run, and readiness", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dantecode-routes-status-"));
    await mkdir(join(projectRoot, "artifacts", "readiness"), { recursive: true });
    await writeFile(
      join(projectRoot, "artifacts", "readiness", "current-readiness.json"),
      JSON.stringify(
        {
          status: "private-ready",
          commitSha: "unknown",
          generatedAt: "2026-03-26T12:00:00.000Z",
          gates: {},
          blockers: [],
          openRequirements: { privateReady: [], publicReady: [] },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const planStore = new PlanStore(projectRoot);
    await planStore.save({
      id: "plan-route-1",
      status: "draft",
      createdAt: "2026-03-26T12:01:00.000Z",
      sessionId: "sess-1",
      plan: {
        goal: "Improve operator visibility",
        steps: [],
        createdAt: "2026-03-26T12:01:00.000Z",
        estimatedComplexity: 0.42,
      },
    });

    const runtimeSession = {
      id: "sess-1",
      projectRoot,
      messages: [],
      activeFiles: [],
      readOnlyFiles: [],
      model: {
        provider: "grok" as ModelProvider,
        modelId: "grok-3",
        maxTokens: 4096,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: true,
      },
      createdAt: "2026-03-26T12:01:00.000Z",
      updatedAt: "2026-03-26T12:01:00.000Z",
      agentStack: [],
      todoList: [],
    };
    const runStore = new DurableRunStore(projectRoot);
    const run = await runStore.initializeRun({
      runId: "run-route-1",
      session: runtimeSession,
      prompt: "Repair operator truth surface",
      workflow: "inferno",
    });
    await runStore.pauseRun(run.id, {
      reason: "user_input_required",
      session: runtimeSession,
      nextAction: "Approve the pending change.",
      message: "Waiting for approval.",
    });

    const router = new Router();
    const context = makeContext({
      projectRoot,
      sessions: new Map<string, SessionRecord>([
        [
          "sess-1",
          makeSession({
            mode: "apply",
            messages: [
              {
                role: "user",
                content: "Show me the operator state",
                ts: "2026-03-26T12:02:00.000Z",
              },
            ],
          }),
        ],
      ]),
    });
    buildRoutes(router, context);

    const res = await router.handle(makeReq("GET", "/api/status"));
    const body = res.body as Record<string, unknown>;
    const operator = body["operator"] as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(operator["approvalMode"]).toBe("apply");
    expect(operator["planMode"]).toBe(true);
    expect(operator["currentPlanId"]).toBe("plan-route-1");
    expect(operator["latestPausedDurableRun"]).toMatchObject({
      id: "run-route-1",
      workflow: "inferno",
    });
    expect(operator["readiness"]).toMatchObject({
      status: "private-ready",
    });
  });

  it("GET /api/sessions/:id returns operator-visible status, approvals, commands, and artifacts", async () => {
    const router = new Router();
    const context = makeContext();
    buildRoutes(router, context);

    context.sessions.set(
      "sess-1",
      makeSession({
        status: "awaiting_approval",
        mode: "review",
        pendingApproval: {
          toolName: "Write",
          command: "write src/app.ts",
          riskLevel: "high",
          resolve: vi.fn(),
        },
        approvalEvents: [
          {
            action: "needed",
            toolName: "Write",
            command: "write src/app.ts",
            riskLevel: "high",
            at: "2026-03-26T10:00:02.000Z",
          },
        ],
        commandHistory: [
          {
            id: "cmd-1",
            command: "/mode review",
            status: "completed",
            startedAt: "2026-03-26T10:00:03.000Z",
            finishedAt: "2026-03-26T10:00:04.000Z",
            output: "Current approval mode: review",
          },
        ],
        timeline: [
          {
            kind: "approval",
            label: "Write requires approval",
            at: "2026-03-26T10:00:02.000Z",
            detail: "review mode",
          },
        ],
        artifactPaths: ["/tmp/dantecode/.dantecode/reports/run-1.md"],
        receiptPaths: ["/tmp/dantecode/.dantecode/receipts/skills/run-1.json"],
      }),
    );

    const res = await router.handle(makeReq("GET", "/api/sessions/sess-1"));
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body["status"]).toBe("awaiting_approval");
    expect(body["mode"]).toBe("review");
    expect(body["pendingApproval"]).toMatchObject({
      toolName: "Write",
      riskLevel: "high",
    });
    expect(body["approvalEvents"]).toHaveLength(1);
    expect(body["commandHistory"]).toHaveLength(1);
    expect(body["timeline"]).toHaveLength(1);
    expect(body["artifactPaths"]).toEqual(["/tmp/dantecode/.dantecode/reports/run-1.md"]);
    expect(body["receiptPaths"]).toEqual(["/tmp/dantecode/.dantecode/receipts/skills/run-1.json"]);
  });

  it("POST /api/sessions/:id/command records truthful unavailable status when no command runner is wired", async () => {
    const router = new Router();
    const context = makeContext();
    buildRoutes(router, context);
    context.sessions.set("sess-1", makeSession());

    const res = await router.handle(
      makeReq("POST", "/api/sessions/sess-1/command", {
        body: { command: "/status" },
      }),
    );

    const body = res.body as Record<string, unknown>;
    const session = context.sessions.get("sess-1")!;

    expect(res.status).toBe(200);
    expect(body["status"]).toBe("unavailable");
    expect(body["output"]).toMatch(/not wired/i);
    expect(session.commandHistory).toHaveLength(1);
    expect(session.commandHistory?.[0]?.status).toBe("unavailable");
  });

  it("POST /api/sessions/:id/command records real runner output when command execution is available", async () => {
    const router = new Router();
    const context = makeContext({
      commandRunner: vi.fn().mockResolvedValue({
        status: "completed",
        output: "Current approval mode: review",
        artifacts: ["/tmp/dantecode/.dantecode/reports/run-2.md"],
        receipts: ["/tmp/dantecode/.dantecode/receipts/skills/run-2.json"],
      }),
    });
    buildRoutes(router, context);
    context.sessions.set("sess-1", makeSession());

    const res = await router.handle(
      makeReq("POST", "/api/sessions/sess-1/command", {
        body: { command: "/mode" },
      }),
    );

    const body = res.body as Record<string, unknown>;
    const session = context.sessions.get("sess-1")!;

    expect(res.status).toBe(200);
    expect(body["status"]).toBe("completed");
    expect(body["output"]).toBe("Current approval mode: review");
    expect(session.commandHistory?.[0]?.status).toBe("completed");
    expect(session.artifactPaths).toContain("/tmp/dantecode/.dantecode/reports/run-2.md");
    expect(session.receiptPaths).toContain("/tmp/dantecode/.dantecode/receipts/skills/run-2.json");
  });
});
