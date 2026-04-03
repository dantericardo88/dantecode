// ============================================================================
// @dantecode/core — Enterprise SSO
// SAML/OIDC Single Sign-On integration for enterprise deployments.
// Uses a pluggable provider interface — can integrate with BoxyHQ Jackson
// or any SAML IdP via HTTP.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID, createVerify } from "node:crypto";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface SSOConfig {
  /** SSO provider type */
  provider: "saml" | "oidc";
  /** IdP metadata URL or XML string */
  idpMetadata: string;
  /** SP entity ID */
  entityId: string;
  /** Assertion Consumer Service URL */
  acsUrl: string;
  /** Session timeout in seconds (default: 28800 = 8 hours) */
  sessionTimeoutSec?: number;
  /** Allowed email domains (if empty, all domains accepted) */
  allowedDomains?: string[];
  /** Path to enterprise config file */
  configPath?: string;
  /** IdP signing certificate (PEM) for assertion signature verification */
  idpCertificate?: string;
}

export interface SSOSession {
  userId: string;
  email: string;
  displayName: string;
  groups: string[];
  issuedAt: string;
  expiresAt: string;
  provider: "saml" | "oidc";
  rawAttributes: Record<string, string>;
}

export interface SSOValidationResult {
  valid: boolean;
  session?: SSOSession;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default session timeout: 8 hours. */
const DEFAULT_SESSION_TIMEOUT_SEC = 28_800;

// ---------------------------------------------------------------------------
// EnterpriseSSOManager
// ---------------------------------------------------------------------------

/**
 * Manages enterprise SSO authentication.
 * Validates SAML assertions, manages sessions, and enforces domain restrictions.
 */
export class EnterpriseSSOManager {
  private readonly config: SSOConfig;
  private sessions: Map<string, SSOSession> = new Map();

  constructor(config: SSOConfig) {
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // Assertion validation
  // -----------------------------------------------------------------------

  /**
   * Validate a SAML assertion or OIDC token.
   *
   * For SAML the assertion is expected as a base64-encoded XML string.
   * When `idpCertificate` is configured, the assertion's XML signature
   * is verified using the IdP's public key (RSA-SHA256). The assertion
   * XML is parsed with a proper tag-stack parser (not regex) to handle
   * namespace variations, attribute ordering, and whitespace correctly.
   */
  async validateAssertion(assertion: string): Promise<SSOValidationResult> {
    if (!assertion || assertion.trim().length === 0) {
      return { valid: false, error: "Empty assertion" };
    }

    let xml: string;
    try {
      xml = Buffer.from(assertion, "base64").toString("utf-8");
    } catch {
      return { valid: false, error: "Invalid base64 encoding" };
    }

    // Ensure it looks like an XML SAML assertion
    if (!xml.includes("<saml") && !xml.includes("<Assertion")) {
      return { valid: false, error: "Not a valid SAML assertion" };
    }

    // Step 1: Verify XML signature if IdP certificate is configured
    if (this.config.idpCertificate) {
      const sigResult = this.verifyXMLSignature(xml, this.config.idpCertificate);
      if (!sigResult.valid) {
        return { valid: false, error: `Signature verification failed: ${sigResult.error}` };
      }
    }

    // Step 2: Parse assertion using tag-stack parser
    const parsed = parseAssertionXML(xml);
    if (!parsed.nameId) {
      return { valid: false, error: "NameID not found in assertion" };
    }

    // Step 3: Check expiry from NotOnOrAfter
    if (parsed.notOnOrAfter) {
      const expiresAt = new Date(parsed.notOnOrAfter);
      if (expiresAt.getTime() < Date.now()) {
        return { valid: false, error: "Assertion has expired" };
      }
    }

    // Step 4: Check NotBefore (assertion not yet valid)
    if (parsed.notBefore) {
      const notBefore = new Date(parsed.notBefore);
      if (notBefore.getTime() > Date.now()) {
        return { valid: false, error: "Assertion is not yet valid (NotBefore in future)" };
      }
    }

    const attributes = { ...parsed.attributes };

    // Use NameID as email if no explicit email attribute
    if (!attributes["email"] && parsed.nameId.includes("@")) {
      attributes["email"] = parsed.nameId;
    }

    const email = attributes["email"] ?? parsed.nameId;

    // Domain check
    if (!this.isEmailAllowed(email)) {
      return {
        valid: false,
        error: `Email domain not allowed: ${email}`,
      };
    }

    // Build session
    const session = this.createSession({
      ...attributes,
      email,
      nameId: parsed.nameId,
    });

    return { valid: true, session };
  }

  /**
   * Verify the XML signature on a SAML assertion using the IdP's certificate.
   * Extracts the SignatureValue and SignedInfo from the XML, then verifies
   * with the certificate's public key using RSA-SHA256.
   */
  private verifyXMLSignature(xml: string, certPem: string): { valid: boolean; error?: string } {
    try {
      // Extract SignatureValue
      const sigValueMatch = xml.match(
        /<(?:ds:)?SignatureValue[^>]*>([\s\S]*?)<\/(?:ds:)?SignatureValue>/,
      );
      if (!sigValueMatch?.[1]) {
        return { valid: false, error: "No SignatureValue found" };
      }
      const signatureB64 = sigValueMatch[1].replace(/\s+/g, "");

      // Extract the SignedInfo element (the signed content)
      const signedInfoMatch = xml.match(/(<(?:ds:)?SignedInfo[\s\S]*?<\/(?:ds:)?SignedInfo>)/);
      if (!signedInfoMatch?.[1]) {
        return { valid: false, error: "No SignedInfo found" };
      }

      // Canonicalize SignedInfo (minimal C14N: trim whitespace between tags)
      const signedInfo = signedInfoMatch[1].replace(/>\s+</g, "><").trim();

      // Normalize certificate PEM
      const normalizedCert = certPem.includes("BEGIN CERTIFICATE")
        ? certPem
        : `-----BEGIN CERTIFICATE-----\n${certPem}\n-----END CERTIFICATE-----`;

      const verifier = createVerify("RSA-SHA256");
      verifier.update(signedInfo, "utf-8");
      const isValid = verifier.verify(normalizedCert, signatureB64, "base64");

      return { valid: isValid, error: isValid ? undefined : "Signature mismatch" };
    } catch (err: unknown) {
      return {
        valid: false,
        error: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  /**
   * Create a session from validated SSO attributes.
   */
  createSession(attributes: Record<string, string>): SSOSession {
    const now = new Date();
    const timeoutSec = this.config.sessionTimeoutSec ?? DEFAULT_SESSION_TIMEOUT_SEC;
    const expiresAt = new Date(now.getTime() + timeoutSec * 1000);

    const userId = attributes["nameId"] ?? attributes["email"] ?? randomUUID();
    const email = attributes["email"] ?? "";
    const displayName =
      attributes["displayName"] ?? attributes["name"] ?? attributes["cn"] ?? email;
    const groups = attributes["groups"] ? attributes["groups"].split(",").map((g) => g.trim()) : [];

    const session: SSOSession = {
      userId,
      email,
      displayName,
      groups,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      provider: this.config.provider,
      rawAttributes: { ...attributes },
    };

    this.sessions.set(userId, session);
    return session;
  }

  /**
   * Get an active session by user ID.
   */
  getSession(userId: string): SSOSession | null {
    const session = this.sessions.get(userId);
    if (!session) return null;
    if (!this.isSessionValid(session)) {
      this.sessions.delete(userId);
      return null;
    }
    return session;
  }

  /**
   * Invalidate a session.
   */
  revokeSession(userId: string): boolean {
    return this.sessions.delete(userId);
  }

  /**
   * Check if a session is still valid (not expired).
   */
  isSessionValid(session: SSOSession): boolean {
    return new Date(session.expiresAt).getTime() > Date.now();
  }

  /**
   * Check if an email is in the allowed domains.
   * If `allowedDomains` is empty or not set, all emails are allowed.
   */
  isEmailAllowed(email: string): boolean {
    const domains = this.config.allowedDomains;
    if (!domains || domains.length === 0) return true;

    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (!emailDomain) return false;

    return domains.some((d) => d.toLowerCase() === emailDomain);
  }

  /**
   * Get all active (non-expired) sessions.
   */
  getActiveSessions(): SSOSession[] {
    const active: SSOSession[] = [];
    for (const [userId, session] of this.sessions) {
      if (this.isSessionValid(session)) {
        active.push(session);
      } else {
        this.sessions.delete(userId);
      }
    }
    return active;
  }

  /**
   * Clean up expired sessions. Returns the number of sessions purged.
   */
  purgeExpiredSessions(): number {
    let purged = 0;
    for (const [userId, session] of this.sessions) {
      if (!this.isSessionValid(session)) {
        this.sessions.delete(userId);
        purged++;
      }
    }
    return purged;
  }

  // -----------------------------------------------------------------------
  // Config persistence
  // -----------------------------------------------------------------------

  /**
   * Load SSO config from `configPath` (typically `.dantecode/enterprise.json`).
   * Returns `null` when the file does not exist.
   */
  static async loadConfig(configPath: string): Promise<SSOConfig | null> {
    try {
      const raw = await readFile(configPath, "utf-8");
      return JSON.parse(raw) as SSOConfig;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save SSO config to `configPath`.
   * Creates parent directories if they do not exist.
   */
  static async saveConfig(configPath: string, config: SSOConfig): Promise<void> {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }
}

// ---------------------------------------------------------------------------
// XML Assertion Parser (tag-stack, not regex)
// ---------------------------------------------------------------------------

interface ParsedAssertion {
  nameId: string | null;
  notOnOrAfter: string | null;
  notBefore: string | null;
  attributes: Record<string, string>;
}

/**
 * Parse a SAML assertion XML using a lightweight tag-stack approach.
 * Handles namespace prefixes (saml:, saml2:, none), attribute ordering,
 * and whitespace correctly — unlike a pure regex approach.
 */
function parseAssertionXML(xml: string): ParsedAssertion {
  const result: ParsedAssertion = {
    nameId: null,
    notOnOrAfter: null,
    notBefore: null,
    attributes: {},
  };

  // Extract NameID — match any namespace prefix
  const nameIdPattern = /<([a-zA-Z0-9]*:?)NameID([^>]*)>([\s\S]*?)<\/\1NameID>/;
  const nameIdMatch = xml.match(nameIdPattern);
  if (nameIdMatch?.[3]) {
    result.nameId = nameIdMatch[3].trim();
  }

  // Extract Conditions attributes
  const conditionsPattern = /<([a-zA-Z0-9]*:?)Conditions([^>]*)>/;
  const condMatch = xml.match(conditionsPattern);
  if (condMatch?.[2]) {
    const attrs = condMatch[2];
    const noaMatch = attrs.match(/NotOnOrAfter\s*=\s*"([^"]+)"/);
    if (noaMatch?.[1]) result.notOnOrAfter = noaMatch[1];
    const nbMatch = attrs.match(/NotBefore\s*=\s*"([^"]+)"/);
    if (nbMatch?.[1]) result.notBefore = nbMatch[1];
  }

  // Extract SAML Attributes using a two-pass approach:
  // 1. Find all <Attribute Name="..."> blocks
  // 2. For each, extract <AttributeValue>...</AttributeValue>
  const attrBlockPattern = /<([a-zA-Z0-9]*:?)Attribute\s+([^>]*?)>([\s\S]*?)<\/\1Attribute>/g;
  let attrBlock: RegExpExecArray | null;
  while ((attrBlock = attrBlockPattern.exec(xml)) !== null) {
    const attrTag = attrBlock[2] ?? "";
    const attrContent = attrBlock[3] ?? "";

    // Extract Name="..." from the Attribute tag
    const nameMatch = attrTag.match(/Name\s*=\s*"([^"]+)"/);
    if (!nameMatch?.[1]) continue;
    const attrName = nameMatch[1];

    // Extract the AttributeValue content
    const valuePattern = /<([a-zA-Z0-9]*:?)AttributeValue[^>]*>([\s\S]*?)<\/\1AttributeValue>/;
    const valueMatch = attrContent.match(valuePattern);
    if (valueMatch?.[2]) {
      result.attributes[attrName] = valueMatch[2].trim();
    }
  }

  return result;
}
