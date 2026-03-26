import { describe, it, expect, vi } from "vitest";
import { Router } from "./router.js";
import { buildRoutes, type ServerContext, type SessionRecord } from "./routes.js";
import { SessionEventEmitter } from "./session-emitter.js";
import type { ParsedRequest } from "./router.js";

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
    expect(body["receiptPaths"]).toEqual([
      "/tmp/dantecode/.dantecode/receipts/skills/run-1.json",
    ]);
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
    expect(session.receiptPaths).toContain(
      "/tmp/dantecode/.dantecode/receipts/skills/run-2.json",
    );
  });
});
