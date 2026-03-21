// ============================================================================
// @dantecode/cli — Serve: Auth Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { checkAuth, unauthorizedResponse } from "./auth.js";

describe("checkAuth", () => {
  it("returns true when no password is configured (open localhost mode)", () => {
    const result = checkAuth({ authorization: "anything" }, {});
    expect(result).toBe(true);
  });

  it("returns true for correct HTTP Basic credentials", () => {
    const encoded = Buffer.from("dantecode:mysecret").toString("base64");
    const result = checkAuth(
      { authorization: `Basic ${encoded}` },
      { password: "mysecret" },
    );
    expect(result).toBe(true);
  });

  it("returns false for wrong password", () => {
    const encoded = Buffer.from("dantecode:wrongpass").toString("base64");
    const result = checkAuth(
      { authorization: `Basic ${encoded}` },
      { password: "correctpass" },
    );
    expect(result).toBe(false);
  });

  it("returns false when Authorization header is missing", () => {
    const result = checkAuth({}, { password: "mysecret" });
    expect(result).toBe(false);
  });

  it("returns false when Authorization header does not start with Basic", () => {
    const result = checkAuth(
      { authorization: "Bearer sometoken" },
      { password: "mysecret" },
    );
    expect(result).toBe(false);
  });

  it("supports a custom username", () => {
    const encoded = Buffer.from("admin:pass123").toString("base64");
    const result = checkAuth(
      { authorization: `Basic ${encoded}` },
      { password: "pass123", username: "admin" },
    );
    expect(result).toBe(true);
  });

  it("returns false when username is wrong", () => {
    const encoded = Buffer.from("wronguser:pass123").toString("base64");
    const result = checkAuth(
      { authorization: `Basic ${encoded}` },
      { password: "pass123" },
    );
    expect(result).toBe(false);
  });
});

describe("unauthorizedResponse", () => {
  it("returns status 401", () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
  });

  it("includes WWW-Authenticate header", () => {
    const res = unauthorizedResponse();
    expect(res.headers?.["WWW-Authenticate"]).toBe('Basic realm="DanteCode"');
  });

  it("includes an error body", () => {
    const res = unauthorizedResponse();
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });
});
