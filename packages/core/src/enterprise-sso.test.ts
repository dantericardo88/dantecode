// ============================================================================
// @dantecode/core — Enterprise SSO Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnterpriseSSOManager } from "./enterprise-sso.js";
import type { SSOConfig, SSOSession } from "./enterprise-sso.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseConfig(overrides?: Partial<SSOConfig>): SSOConfig {
  return {
    provider: "saml",
    idpMetadata: "https://idp.example.com/metadata",
    entityId: "https://sp.example.com",
    acsUrl: "https://sp.example.com/acs",
    sessionTimeoutSec: 3600,
    allowedDomains: [],
    ...overrides,
  };
}

/** Build a minimal SAML assertion XML and base64-encode it. */
function buildAssertion(opts: {
  nameId?: string;
  notOnOrAfter?: string;
  attributes?: Record<string, string>;
}): string {
  const nameId = opts.nameId ?? "alice@example.com";
  const notOnOrAfter = opts.notOnOrAfter ?? new Date(Date.now() + 3_600_000).toISOString();
  const attrs = opts.attributes ?? {};

  let attrXml = "";
  for (const [name, value] of Object.entries(attrs)) {
    attrXml += `<saml:Attribute Name="${name}"><saml:AttributeValue>${value}</saml:AttributeValue></saml:Attribute>`;
  }

  const xml = `
    <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
      <saml:Subject>
        <saml:NameID>${nameId}</saml:NameID>
      </saml:Subject>
      <saml:Conditions NotOnOrAfter="${notOnOrAfter}"/>
      <saml:AttributeStatement>${attrXml}</saml:AttributeStatement>
    </saml:Assertion>`;

  return Buffer.from(xml).toString("base64");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EnterpriseSSOManager", () => {
  let manager: EnterpriseSSOManager;

  beforeEach(() => {
    manager = new EnterpriseSSOManager(baseConfig());
  });

  // ── createSession ──────────────────────────────────────────────────────

  describe("createSession", () => {
    it("creates a session with correct fields", () => {
      const session = manager.createSession({
        email: "bob@example.com",
        nameId: "bob@example.com",
        displayName: "Bob Smith",
        groups: "eng,platform",
      });

      expect(session.userId).toBe("bob@example.com");
      expect(session.email).toBe("bob@example.com");
      expect(session.displayName).toBe("Bob Smith");
      expect(session.groups).toEqual(["eng", "platform"]);
      expect(session.provider).toBe("saml");
      expect(session.issuedAt).toBeTruthy();
      expect(session.expiresAt).toBeTruthy();
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(
        new Date(session.issuedAt).getTime(),
      );
      expect(session.rawAttributes).toHaveProperty("email", "bob@example.com");
    });
  });

  // ── getSession / revokeSession ─────────────────────────────────────────

  describe("getSession / revokeSession", () => {
    it("returns the session when it exists and is valid", () => {
      manager.createSession({ email: "a@b.com", nameId: "a@b.com" });
      const s = manager.getSession("a@b.com");
      expect(s).not.toBeNull();
      expect(s!.email).toBe("a@b.com");
    });

    it("returns null for unknown users", () => {
      expect(manager.getSession("unknown")).toBeNull();
    });

    it("revokes a session and subsequent get returns null", () => {
      manager.createSession({ email: "c@d.com", nameId: "c@d.com" });
      expect(manager.revokeSession("c@d.com")).toBe(true);
      expect(manager.getSession("c@d.com")).toBeNull();
    });

    it("returns false when revoking a non-existent session", () => {
      expect(manager.revokeSession("ghost")).toBe(false);
    });
  });

  // ── isSessionValid ─────────────────────────────────────────────────────

  describe("isSessionValid", () => {
    it("detects an expired session", () => {
      const expired: SSOSession = {
        userId: "old",
        email: "old@example.com",
        displayName: "Old",
        groups: [],
        issuedAt: new Date(Date.now() - 7_200_000).toISOString(),
        expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
        provider: "saml",
        rawAttributes: {},
      };
      expect(manager.isSessionValid(expired)).toBe(false);
    });

    it("recognizes a valid session", () => {
      const session = manager.createSession({ email: "v@e.com", nameId: "v@e.com" });
      expect(manager.isSessionValid(session)).toBe(true);
    });
  });

  // ── isEmailAllowed ─────────────────────────────────────────────────────

  describe("isEmailAllowed", () => {
    it("allows all emails when allowedDomains is empty", () => {
      expect(manager.isEmailAllowed("anyone@anywhere.org")).toBe(true);
    });

    it("rejects emails outside allowed domains", () => {
      const restricted = new EnterpriseSSOManager(baseConfig({ allowedDomains: ["corp.io"] }));
      expect(restricted.isEmailAllowed("user@corp.io")).toBe(true);
      expect(restricted.isEmailAllowed("user@other.com")).toBe(false);
    });

    it("is case-insensitive for domain matching", () => {
      const restricted = new EnterpriseSSOManager(baseConfig({ allowedDomains: ["Corp.IO"] }));
      expect(restricted.isEmailAllowed("user@corp.io")).toBe(true);
    });

    it("rejects emails without a domain", () => {
      const restricted = new EnterpriseSSOManager(baseConfig({ allowedDomains: ["corp.io"] }));
      expect(restricted.isEmailAllowed("nodomain")).toBe(false);
    });
  });

  // ── purgeExpiredSessions ───────────────────────────────────────────────

  describe("purgeExpiredSessions", () => {
    it("removes only expired sessions", () => {
      // Create one valid session
      manager.createSession({ email: "alive@e.com", nameId: "alive@e.com" });

      // Manually insert an expired session into internal state
      const expired: SSOSession = {
        userId: "dead@e.com",
        email: "dead@e.com",
        displayName: "Dead",
        groups: [],
        issuedAt: new Date(Date.now() - 7_200_000).toISOString(),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        provider: "saml",
        rawAttributes: {},
      };
      // Access the internal map via createSession + then overwrite expiresAt
      manager.createSession({ email: "dead@e.com", nameId: "dead@e.com" });
      // Replace the session with the expired version
      (manager as unknown as { sessions: Map<string, SSOSession> }).sessions.set(
        "dead@e.com",
        expired,
      );

      const purged = manager.purgeExpiredSessions();
      expect(purged).toBe(1);
      expect(manager.getSession("alive@e.com")).not.toBeNull();
      expect(manager.getSession("dead@e.com")).toBeNull();
    });
  });

  // ── getActiveSessions ──────────────────────────────────────────────────

  describe("getActiveSessions", () => {
    it("returns only non-expired sessions", () => {
      manager.createSession({ email: "x@e.com", nameId: "x@e.com" });
      manager.createSession({ email: "y@e.com", nameId: "y@e.com" });

      const expired: SSOSession = {
        userId: "z@e.com",
        email: "z@e.com",
        displayName: "Z",
        groups: [],
        issuedAt: new Date(Date.now() - 7_200_000).toISOString(),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        provider: "saml",
        rawAttributes: {},
      };
      (manager as unknown as { sessions: Map<string, SSOSession> }).sessions.set(
        "z@e.com",
        expired,
      );

      const active = manager.getActiveSessions();
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.email).sort()).toEqual(["x@e.com", "y@e.com"]);
    });
  });

  // ── loadConfig / saveConfig ────────────────────────────────────────────

  describe("loadConfig / saveConfig", () => {
    const mockReadFile = vi.fn();
    const mockWriteFile = vi.fn();
    const mockMkdir = vi.fn();

    beforeEach(() => {
      vi.resetModules();
      mockReadFile.mockReset();
      mockWriteFile.mockReset();
      mockMkdir.mockReset();
    });

    it("loadConfig returns null when file does not exist", async () => {
      // Directly test the static method — it catches ENOENT internally
      // We test by pointing at a path that definitely does not exist
      const result = await EnterpriseSSOManager.loadConfig(
        "/tmp/__dantecode_test_nonexistent__/enterprise.json",
      );
      expect(result).toBeNull();
    });

    it("saveConfig writes JSON and loadConfig reads it back", async () => {
      const tmpDir = `/tmp/__dantecode_sso_test_${Date.now()}`;
      const configPath = `${tmpDir}/enterprise.json`;
      const config = baseConfig();

      await EnterpriseSSOManager.saveConfig(configPath, config);
      const loaded = await EnterpriseSSOManager.loadConfig(configPath);

      expect(loaded).not.toBeNull();
      expect(loaded!.provider).toBe("saml");
      expect(loaded!.entityId).toBe(config.entityId);
      expect(loaded!.acsUrl).toBe(config.acsUrl);

      // Cleanup
      const { rm } = await import("node:fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    });
  });

  // ── validateAssertion ──────────────────────────────────────────────────

  describe("validateAssertion", () => {
    it("validates a well-formed SAML assertion", async () => {
      const assertion = buildAssertion({
        nameId: "alice@example.com",
        attributes: {
          email: "alice@example.com",
          displayName: "Alice",
          groups: "admins,dev",
        },
      });

      const result = await manager.validateAssertion(assertion);

      expect(result.valid).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session!.email).toBe("alice@example.com");
      expect(result.session!.displayName).toBe("Alice");
      expect(result.session!.groups).toEqual(["admins", "dev"]);
    });

    it("rejects an empty assertion", async () => {
      const result = await manager.validateAssertion("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Empty assertion");
    });

    it("rejects invalid base64 that does not contain SAML XML", async () => {
      const notSaml = Buffer.from("<html>not saml</html>").toString("base64");
      const result = await manager.validateAssertion(notSaml);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Not a valid SAML assertion");
    });

    it("rejects an expired assertion", async () => {
      const assertion = buildAssertion({
        notOnOrAfter: new Date(Date.now() - 60_000).toISOString(),
      });
      const result = await manager.validateAssertion(assertion);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("expired");
    });

    it("rejects email outside allowed domains", async () => {
      const restricted = new EnterpriseSSOManager(baseConfig({ allowedDomains: ["corp.io"] }));
      const assertion = buildAssertion({ nameId: "alice@other.com" });
      const result = await restricted.validateAssertion(assertion);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not allowed");
    });

    it("handles saml2: namespace prefix", async () => {
      const xml = `
        <saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion">
          <saml2:Subject><saml2:NameID>bob@corp.io</saml2:NameID></saml2:Subject>
          <saml2:Conditions NotOnOrAfter="${new Date(Date.now() + 3_600_000).toISOString()}"/>
          <saml2:AttributeStatement>
            <saml2:Attribute Name="email"><saml2:AttributeValue>bob@corp.io</saml2:AttributeValue></saml2:Attribute>
          </saml2:AttributeStatement>
        </saml2:Assertion>`;
      const assertion = Buffer.from(xml).toString("base64");
      const result = await manager.validateAssertion(assertion);
      expect(result.valid).toBe(true);
      expect(result.session!.email).toBe("bob@corp.io");
    });

    it("rejects assertion with NotBefore in the future", async () => {
      const futureTime = new Date(Date.now() + 3_600_000).toISOString();
      const xml = `
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
          <saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject>
          <saml:Conditions NotBefore="${futureTime}" NotOnOrAfter="${new Date(Date.now() + 7_200_000).toISOString()}"/>
        </saml:Assertion>`;
      const assertion = Buffer.from(xml).toString("base64");
      const result = await manager.validateAssertion(assertion);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not yet valid");
    });
  });
});
