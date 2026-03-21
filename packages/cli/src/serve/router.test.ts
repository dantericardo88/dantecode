// ============================================================================
// @dantecode/cli — Serve: Router Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { Router } from "./router.js";
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

describe("Router", () => {
  it("matches an exact GET path", async () => {
    const router = new Router();
    router.get("/api/health", async () => ({ status: 200, body: { ok: true } }));
    const res = await router.handle(makeReq("GET", "/api/health"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("extracts a single :param from the path", async () => {
    const router = new Router();
    router.get("/api/sessions/:id", async (req) => ({
      status: 200,
      body: { id: req.params["id"] },
    }));
    const res = await router.handle(makeReq("GET", "/api/sessions/abc123"));
    expect(res.status).toBe(200);
    expect((res.body as Record<string, string>)["id"]).toBe("abc123");
  });

  it("passes query parameters to the handler", async () => {
    const router = new Router();
    router.get("/api/sessions", async (req) => ({
      status: 200,
      body: { limit: req.query["limit"] },
    }));
    const res = await router.handle(makeReq("GET", "/api/sessions", { query: { limit: "10" } }));
    expect((res.body as Record<string, string>)["limit"]).toBe("10");
  });

  it("differentiates by HTTP method — POST vs GET on same path", async () => {
    const router = new Router();
    router.get("/api/sessions", async () => ({ status: 200, body: { method: "GET" } }));
    router.post("/api/sessions", async () => ({ status: 201, body: { method: "POST" } }));

    const getRes = await router.handle(makeReq("GET", "/api/sessions"));
    expect(getRes.status).toBe(200);

    const postRes = await router.handle(makeReq("POST", "/api/sessions"));
    expect(postRes.status).toBe(201);
  });

  it("returns 404 for an unmatched route", async () => {
    const router = new Router();
    router.get("/api/health", async () => ({ status: 200, body: {} }));
    const res = await router.handle(makeReq("GET", "/api/unknown"));
    expect(res.status).toBe(404);
  });

  it("extracts multiple path parameters", async () => {
    const router = new Router();
    router.get("/api/sessions/:sessionId/messages/:messageId", async (req) => ({
      status: 200,
      body: {
        sessionId: req.params["sessionId"],
        messageId: req.params["messageId"],
      },
    }));
    const res = await router.handle(
      makeReq("GET", "/api/sessions/s1/messages/m2"),
    );
    const body = res.body as Record<string, string>;
    expect(body["sessionId"]).toBe("s1");
    expect(body["messageId"]).toBe("m2");
  });

  it("first matching route wins (registration order matters)", async () => {
    const router = new Router();
    router.get("/api/sessions/:id", async () => ({ status: 200, body: { route: "paramId" } }));
    router.get("/api/sessions/special", async () => ({
      status: 200,
      body: { route: "special" },
    }));
    // paramId was registered first, so it wins
    const res = await router.handle(makeReq("GET", "/api/sessions/special"));
    expect((res.body as Record<string, string>)["route"]).toBe("paramId");
  });

  it("passes the parsed body to POST handler", async () => {
    const router = new Router();
    router.post("/api/sessions/:id/message", async (req) => ({
      status: 200,
      body: { received: req.body },
    }));
    const res = await router.handle(
      makeReq("POST", "/api/sessions/abc/message", {
        body: { content: "hello" },
      }),
    );
    expect((res.body as Record<string, unknown>)["received"]).toEqual({ content: "hello" });
  });

  it("returns 405 when path matches but method does not", async () => {
    const router = new Router();
    router.post("/api/sessions", async () => ({ status: 201, body: {} }));
    const res = await router.handle(makeReq("DELETE", "/api/sessions"));
    expect(res.status).toBe(405);
  });
});
