// ============================================================================
// Sprint Dim 28: Enterprise (SSO, RBAC, audit, admin policy) tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateSsoConfig,
  buildSsoAuthUrl,
  parseSsoCallback,
  type SsoConfig,
} from "@dantecode/core";
import {
  checkPermission,
  evaluatePolicy,
  getPrincipalRoles,
  generateRbacPolicyReport as generateRbacReport,
  registerPolicy,
  addRelationTuple,
  clearPolicies,
  type Principal,
  type Resource,
} from "@dantecode/core";
import {
  recordEnterpriseAuditEvent as recordAuditEvent,
  loadEnterpriseAuditLog as loadAuditLog,
  queryEnterpriseAuditLog as queryAuditLog,
  exportEnterpriseAuditLog as exportAuditLog,
} from "@dantecode/core";
import {
  loadAdminPolicy,
  saveAdminPolicy,
  validateAdminPolicy,
  generatePolicyReport,
  type AdminPolicy,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim28-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
  clearPolicies();
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EPERM */ }
});

// ── SSO Config Validation ─────────────────────────────────────────────────────

describe("validateSsoConfig", () => {
  const baseOidcConfig: SsoConfig = {
    protocol: "oidc",
    provider: {
      issuerUrl: "https://sso.acme.com",
      clientId: "client-abc",
      clientSecret: "secret-xyz",
      scopes: ["openid", "email"],
      redirectUri: "https://app.dantecode.ai/callback",
    },
    minimumAal: "aal1",
    sessionTtlSeconds: 3600,
    allowedDomains: ["acme.com"],
    enforceEmailVerification: true,
  };

  it("returns valid=true for well-formed OIDC config", () => {
    expect(validateSsoConfig(baseOidcConfig).valid).toBe(true);
  });

  it("returns errors when clientId missing", () => {
    const bad = { ...baseOidcConfig, provider: { ...baseOidcConfig.provider as object, clientId: "" } } as SsoConfig;
    const r = validateSsoConfig(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("clientId"))).toBe(true);
  });

  it("returns errors for unknown protocol", () => {
    const bad = { ...baseOidcConfig, protocol: "kerberos" } as unknown as SsoConfig;
    const r = validateSsoConfig(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("protocol"))).toBe(true);
  });

  it("warns when sessionTtlSeconds exceeds 30 days", () => {
    const long = { ...baseOidcConfig, sessionTtlSeconds: 86400 * 31 };
    const r = validateSsoConfig(long);
    expect(r.warnings.some((w) => w.includes("30 days"))).toBe(true);
  });

  it("validates SAML config requires entityId and ssoUrl", () => {
    const saml: SsoConfig = {
      protocol: "saml",
      provider: { entityId: "", ssoUrl: "", x509Certificate: "CERT", nameIdFormat: "emailAddress" },
      minimumAal: "aal1",
      sessionTtlSeconds: 3600,
      allowedDomains: [],
      enforceEmailVerification: false,
    };
    const r = validateSsoConfig(saml);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("entityId"))).toBe(true);
  });
});

// ── SSO buildSsoAuthUrl ───────────────────────────────────────────────────────

describe("buildSsoAuthUrl", () => {
  it("builds OIDC auth URL with required params", () => {
    const config: SsoConfig = {
      protocol: "oidc",
      provider: {
        issuerUrl: "https://sso.acme.com",
        clientId: "cid",
        clientSecret: "secret",
        scopes: ["openid"],
        redirectUri: "https://app/cb",
      },
      minimumAal: "aal1",
      sessionTtlSeconds: 3600,
      allowedDomains: [],
      enforceEmailVerification: false,
    };
    const result = buildSsoAuthUrl(config, "test-state");
    expect(result.url).toContain("response_type=code");
    expect(result.url).toContain("client_id=cid");
    expect(result.state).toBe("test-state");
    expect(result.nonce).toBeTruthy();
  });
});

// ── parseSsoCallback ──────────────────────────────────────────────────────────

describe("parseSsoCallback", () => {
  const config: SsoConfig = {
    protocol: "oidc",
    provider: { issuerUrl: "https://sso.acme.com", clientId: "cid", clientSecret: "s", scopes: ["openid"], redirectUri: "https://app/cb" },
    minimumAal: "aal1", sessionTtlSeconds: 3600,
    allowedDomains: ["acme.com"], enforceEmailVerification: false,
  };

  it("parses valid callback and returns userId/email", () => {
    const r = parseSsoCallback({ sub: "u-001", email: "alice@acme.com", state: "s1" }, config, "s1");
    expect(r.userId).toBe("u-001");
    expect(r.email).toBe("alice@acme.com");
  });

  it("throws on state mismatch", () => {
    expect(() => parseSsoCallback({ state: "wrong" }, config, "expected")).toThrow("CSRF");
  });

  it("throws when domain not in allowedDomains", () => {
    expect(() => parseSsoCallback({ sub: "u", email: "x@evil.com", state: "s" }, config, "s")).toThrow("allowedDomains");
  });
});

// ── RBAC checkPermission ──────────────────────────────────────────────────────

describe("checkPermission", () => {
  beforeEach(() => {
    registerPolicy({
      kind: "document",
      rules: [
        { id: "rule-admin-all", actions: ["*"], effect: "ALLOW", condition: { type: "role_has", value: "admin" } },
        { id: "rule-read", actions: ["read"], effect: "ALLOW" },
        { id: "rule-deny-delete", actions: ["delete"], effect: "DENY" },
      ],
    });
  });

  it("allows read for any principal", () => {
    const p: Principal = { id: "u1", roles: ["viewer"], attributes: {} };
    const r: Resource = { id: "doc-1", kind: "document", attributes: {} };
    expect(checkPermission(p, r, "read").effect).toBe("ALLOW");
  });

  it("denies delete via explicit deny rule", () => {
    const p: Principal = { id: "u1", roles: ["editor"], attributes: {} };
    const r: Resource = { id: "doc-1", kind: "document", attributes: {} };
    expect(checkPermission(p, r, "delete").effect).toBe("DENY");
  });

  it("allows admin to perform any action via role condition", () => {
    const p: Principal = { id: "u2", roles: ["admin"], attributes: {} };
    const r: Resource = { id: "doc-1", kind: "document", attributes: {} };
    expect(checkPermission(p, r, "delete").effect).toBe("ALLOW");
  });

  it("denies unknown resource kind (no policy registered)", () => {
    const p: Principal = { id: "u1", roles: [], attributes: {} };
    const r: Resource = { id: "x", kind: "unknown-kind", attributes: {} };
    expect(checkPermission(p, r, "read").effect).toBe("DENY");
  });

  it("evaluatePolicy returns results for all requested actions", () => {
    const p: Principal = { id: "u1", roles: ["viewer"], attributes: {} };
    const r: Resource = { id: "doc-1", kind: "document", attributes: {} };
    const resp = evaluatePolicy({ principal: p, resource: r, actions: ["read", "write"] });
    expect(resp.results).toHaveLength(2);
    expect(resp.results.find((x) => x.action === "read")?.effect).toBe("ALLOW");
  });
});

// ── getPrincipalRoles (relation tuples) ───────────────────────────────────────

describe("getPrincipalRoles", () => {
  it("returns roles from relation tuples for principal", () => {
    addRelationTuple({ subjectNamespace: "user", subjectId: "u1", relation: "member", objectNamespace: "role", objectId: "developer" });
    addRelationTuple({ subjectNamespace: "user", subjectId: "u1", relation: "member", objectNamespace: "role", objectId: "viewer" });
    const roles = getPrincipalRoles("u1");
    expect(roles).toContain("developer");
    expect(roles).toContain("viewer");
  });
});

// ── generateRbacReport ────────────────────────────────────────────────────────

describe("generatePolicyReport (RBAC)", () => {
  it("returns correct counts after policies registered", () => {
    registerPolicy({ kind: "repo", rules: [
      { id: "r1", actions: ["read"], effect: "ALLOW" },
      { id: "r2", actions: ["write"], effect: "DENY" },
    ]});
    const report = generateRbacReport();
    expect(report.totalPolicies).toBeGreaterThanOrEqual(1);
    expect(report.kindsCovered).toContain("repo");
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe("recordAuditEvent + loadAuditLog", () => {
  it("creates audit-log.jsonl on first event", () => {
    recordAuditEvent({ actor: "admin@co.com", actorType: "user", action: "user.invite", resource: "user:x", resourceKind: "user", outcome: "success", metadata: {} }, tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "audit-log.jsonl"))).toBe(true);
  });

  it("reads back multiple events correctly", () => {
    recordAuditEvent({ actor: "a", actorType: "user", action: "user.login", resource: "s:1", resourceKind: "session", outcome: "success", metadata: {} }, tmpDir);
    recordAuditEvent({ actor: "b", actorType: "service", action: "api_key.create", resource: "k:1", resourceKind: "api_key", outcome: "failure", metadata: {} }, tmpDir);
    const events = loadAuditLog(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0]!.actor).toBe("a");
    expect(events[1]!.outcome).toBe("failure");
  });

  it("returns empty array when no file exists", () => {
    expect(loadAuditLog(tmpDir)).toEqual([]);
  });
});

// ── queryAuditLog ─────────────────────────────────────────────────────────────

describe("queryAuditLog", () => {
  const events = [
    { eventId: "1", actor: "alice", actorType: "user" as const, action: "user.login" as const, resource: "s:1", resourceKind: "session", outcome: "success" as const, metadata: {}, orgId: "org-a", recordedAt: "2026-04-01T00:00:00Z" },
    { eventId: "2", actor: "bob", actorType: "user" as const, action: "user.login" as const, resource: "s:2", resourceKind: "session", outcome: "denied" as const, metadata: {}, orgId: "org-a", recordedAt: "2026-04-02T00:00:00Z" },
    { eventId: "3", actor: "alice", actorType: "user" as const, action: "data.export" as const, resource: "audit:x", resourceKind: "audit_log", outcome: "success" as const, metadata: {}, orgId: "org-b", recordedAt: "2026-04-03T00:00:00Z" },
  ];

  it("filters by actor", () => {
    expect(queryAuditLog(events, { actor: "alice" })).toHaveLength(2);
  });

  it("filters by outcome", () => {
    expect(queryAuditLog(events, { outcome: "denied" })).toHaveLength(1);
  });

  it("filters by orgId", () => {
    expect(queryAuditLog(events, { orgId: "org-b" })).toHaveLength(1);
  });

  it("respects limit", () => {
    expect(queryAuditLog(events, { limit: 1 })).toHaveLength(1);
  });
});

// ── exportAuditLog ────────────────────────────────────────────────────────────

describe("exportAuditLog", () => {
  const events = [
    { eventId: "e1", actor: "admin", actorType: "user" as const, action: "policy.update" as const, resource: "p:1", resourceKind: "admin_policy", outcome: "success" as const, metadata: {}, recordedAt: "2026-04-20T00:00:00Z" },
  ];

  it("exports as CSV with header row", () => {
    const r = exportAuditLog(events, "csv");
    expect(r.format).toBe("csv");
    expect(r.content).toContain("eventId,recordedAt");
    expect(r.content).toContain("e1");
    expect(r.eventCount).toBe(1);
  });

  it("exports as JSON array", () => {
    const r = exportAuditLog(events, "json");
    const parsed = JSON.parse(r.content) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("exports as JSONL (one per line)", () => {
    const r = exportAuditLog(events, "jsonl");
    expect(r.content.trim().split("\n")).toHaveLength(1);
  });
});

// ── AdminPolicy load/validate/report ─────────────────────────────────────────

describe("AdminPolicy", () => {
  const goodPolicy: AdminPolicy = {
    orgId: "org-test",
    version: "1.0",
    enforcementMode: "strict",
    maxSessionTtlSeconds: 3600,
    requireMfa: true,
    allowedAuthMethods: ["oidc"],
    ipAllowlist: ["10.0.0.0/8"],
    roles: [{ name: "admin", permissions: ["*"], description: "Full access" }],
    scopes: [{ name: "code:read", description: "Read code", allowedActions: ["read"], toolsAllowed: [] }],
    dataRetentionDays: 365,
    auditLevel: "verbose",
    updatedAt: "2026-04-23T00:00:00Z",
  };

  it("validateAdminPolicy returns valid for well-formed policy", () => {
    expect(validateAdminPolicy(goodPolicy).valid).toBe(true);
  });

  it("validateAdminPolicy returns errors for missing orgId", () => {
    const bad = { ...goodPolicy, orgId: "" };
    expect(validateAdminPolicy(bad).valid).toBe(false);
  });

  it("warns when requireMfa is false", () => {
    const noMfa = { ...goodPolicy, requireMfa: false };
    const r = validateAdminPolicy(noMfa);
    expect(r.warnings.some((w) => w.includes("MFA"))).toBe(true);
  });

  it("saveAdminPolicy + loadAdminPolicy round-trips correctly", () => {
    saveAdminPolicy(goodPolicy, tmpDir);
    const loaded = loadAdminPolicy(tmpDir);
    expect(loaded?.orgId).toBe("org-test");
    expect(loaded?.version).toBe("1.0");
  });

  it("loadAdminPolicy returns null when no file exists", () => {
    expect(loadAdminPolicy(tmpDir)).toBeNull();
  });

  it("generatePolicyReport includes all sections", () => {
    const report = generatePolicyReport(goodPolicy);
    expect(report.sections.map((s) => s.heading)).toContain("Authentication");
    expect(report.sections.map((s) => s.heading)).toContain("Access Control");
    expect(report.riskSummary.level).toBe("low");
  });

  it("generatePolicyReport flags high risk when MFA off, no IP allowlist, permissive mode", () => {
    const risky: AdminPolicy = { ...goodPolicy, requireMfa: false, ipAllowlist: [], enforcementMode: "permissive" };
    const report = generatePolicyReport(risky);
    expect(report.riskSummary.level).toBe("high");
    expect(report.riskSummary.findings.length).toBeGreaterThanOrEqual(3);
  });
});
