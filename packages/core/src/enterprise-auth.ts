// ============================================================================
// packages/core/src/enterprise-auth.ts
// Dim 28 — Enterprise SSO/OIDC/SAML config model + org/workspace identity
// Patterns from: ory/kratos (AAL, credential types, session lifecycle),
//               casdoor (org/app scoping, provider chain, signin methods)
// ============================================================================

// ── Types ─────────────────────────────────────────────────────────────────────

export type SsoProtocol = "oidc" | "saml" | "oauth2";
export type AuthenticatorAssuranceLevel = "aal0" | "aal1" | "aal2";
export type CredentialType = "password" | "oidc" | "saml" | "totp" | "webauthn" | "passkey" | "api_key";

export interface OidcProviderConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  claimsMap?: Record<string, string>;
}

export interface SamlProviderConfig {
  entityId: string;
  ssoUrl: string;
  x509Certificate: string;
  nameIdFormat: "emailAddress" | "persistent" | "transient";
  attributeMap?: Record<string, string>;
}

export type SsoProviderConfig = OidcProviderConfig | SamlProviderConfig;

export interface SsoConfig {
  protocol: SsoProtocol;
  provider: SsoProviderConfig;
  minimumAal: AuthenticatorAssuranceLevel;
  sessionTtlSeconds: number;
  allowedDomains: string[];
  enforceEmailVerification: boolean;
}

export interface OrgIdentity {
  orgId: string;
  orgName: string;
  displayName: string;
  domains: string[];
  ssoConfigs: SsoConfig[];
  workspaces: WorkspaceIdentity[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceIdentity {
  workspaceId: string;
  workspaceName: string;
  orgId: string;
  members: WorkspaceMember[];
  defaultRole: string;
  createdAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  roles: string[];
  joinedAt: string;
}

export interface SsoValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SsoAuthUrlResult {
  url: string;
  state: string;
  nonce?: string;
}

export interface SsoCallbackResult {
  userId: string;
  email: string;
  roles: string[];
  orgId: string;
  workspaceId?: string;
  rawClaims: Record<string, unknown>;
  aalAchieved: AuthenticatorAssuranceLevel;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateSsoConfig(config: SsoConfig): SsoValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.protocol) errors.push("protocol is required");
  if (!["oidc", "saml", "oauth2"].includes(config.protocol)) {
    errors.push(`unsupported protocol: ${config.protocol}`);
  }

  if (config.protocol === "oidc" || config.protocol === "oauth2") {
    const p = config.provider as OidcProviderConfig;
    if (!p.issuerUrl) errors.push("provider.issuerUrl is required for OIDC/OAuth2");
    if (!p.clientId) errors.push("provider.clientId is required");
    if (!p.clientSecret) errors.push("provider.clientSecret is required");
    if (!p.redirectUri) errors.push("provider.redirectUri is required");
    if (!p.scopes || p.scopes.length === 0) {
      warnings.push("no scopes specified; defaulting to openid");
    }
    if (p.issuerUrl && !p.issuerUrl.startsWith("https://")) {
      warnings.push("issuerUrl should use HTTPS in production");
    }
  }

  if (config.protocol === "saml") {
    const p = config.provider as SamlProviderConfig;
    if (!p.entityId) errors.push("provider.entityId is required for SAML");
    if (!p.ssoUrl) errors.push("provider.ssoUrl is required for SAML");
    if (!p.x509Certificate) errors.push("provider.x509Certificate is required for SAML");
  }

  if (config.sessionTtlSeconds <= 0) {
    errors.push("sessionTtlSeconds must be positive");
  }
  if (config.sessionTtlSeconds > 86400 * 30) {
    warnings.push("sessionTtlSeconds exceeds 30 days — consider shorter sessions for security");
  }

  const aalLevels: AuthenticatorAssuranceLevel[] = ["aal0", "aal1", "aal2"];
  if (!aalLevels.includes(config.minimumAal)) {
    errors.push(`minimumAal must be one of: ${aalLevels.join(", ")}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Auth URL Builder ──────────────────────────────────────────────────────────

export function buildSsoAuthUrl(config: SsoConfig, stateHint?: string): SsoAuthUrlResult {
  const state = stateHint ?? crypto.randomUUID();

  if (config.protocol === "saml") {
    const p = config.provider as SamlProviderConfig;
    const params = new URLSearchParams({
      SAMLRequest: Buffer.from(
        `<AuthnRequest xmlns="urn:oasis:names:tc:SAML:2.0:protocol" ID="${state}" />`,
      ).toString("base64"),
      RelayState: state,
    });
    return { url: `${p.ssoUrl}?${params.toString()}`, state };
  }

  const p = config.provider as OidcProviderConfig;
  const nonce = crypto.randomUUID();
  const scopes = p.scopes.length > 0 ? p.scopes : ["openid", "profile", "email"];
  const params = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: scopes.join(" "),
    state,
    nonce,
  });
  return { url: `${p.issuerUrl}/authorize?${params.toString()}`, state, nonce };
}

// ── Callback Parser ───────────────────────────────────────────────────────────

export function parseSsoCallback(
  callbackParams: Record<string, string>,
  config: SsoConfig,
  expectedState: string,
): SsoCallbackResult {
  if (callbackParams["state"] !== expectedState) {
    throw new Error("SSO callback state mismatch — potential CSRF");
  }

  if (callbackParams["error"]) {
    throw new Error(`SSO provider error: ${callbackParams["error"]} — ${callbackParams["error_description"] ?? ""}`);
  }

  const email = callbackParams["email"] ?? "";
  const userId = callbackParams["sub"] ?? callbackParams["nameID"] ?? email;
  const rolesRaw = callbackParams["roles"] ?? "";
  const roles = rolesRaw ? rolesRaw.split(",").map((r) => r.trim()).filter(Boolean) : [];

  if (config.enforceEmailVerification && callbackParams["email_verified"] === "false") {
    throw new Error("SSO callback: email not verified");
  }

  if (config.allowedDomains.length > 0 && email) {
    const domain = email.split("@")[1] ?? "";
    if (!config.allowedDomains.includes(domain)) {
      throw new Error(`SSO callback: email domain ${domain} not in allowedDomains`);
    }
  }

  const aalAchieved: AuthenticatorAssuranceLevel =
    callbackParams["acr"] === "aal2" ? "aal2" :
    callbackParams["acr"] === "aal1" || userId ? "aal1" : "aal0";

  const { state: _state, ...rawClaims } = callbackParams;

  return {
    userId,
    email,
    roles,
    orgId: callbackParams["org_id"] ?? "",
    workspaceId: callbackParams["workspace_id"],
    rawClaims,
    aalAchieved,
  };
}
