// ============================================================================
// packages/core/src/admin-policy.ts
// Dim 28 — Org-level admin policy: load, validate, report artifact
// Patterns from: casdoor (org scoping, multi-tenant app model, scope binding),
//               cerbos (resource policy rules), opal (config-driven updates)
// ============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PolicyEnforcementMode = "strict" | "permissive" | "audit-only";

export interface ScopeRule {
  name: string;
  description: string;
  allowedActions: string[];
  toolsAllowed: string[];
}

export interface RoleDefinition {
  name: string;
  permissions: string[];
  inheritsFrom?: string[];
  description: string;
}

export interface AdminPolicy {
  orgId: string;
  version: string;
  enforcementMode: PolicyEnforcementMode;
  maxSessionTtlSeconds: number;
  requireMfa: boolean;
  allowedAuthMethods: string[];
  ipAllowlist: string[];
  roles: RoleDefinition[];
  scopes: ScopeRule[];
  dataRetentionDays: number;
  auditLevel: "minimal" | "standard" | "verbose";
  updatedAt: string;
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PolicyReportSection {
  heading: string;
  items: string[];
}

export interface PolicyReport {
  orgId: string;
  version: string;
  enforcementMode: PolicyEnforcementMode;
  sections: PolicyReportSection[];
  riskSummary: {
    level: "low" | "medium" | "high";
    findings: string[];
  };
  generatedAt: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function policyPath(projectRoot: string): string {
  return join(projectRoot, ".danteforge", "admin-policy.json");
}

// ── Load / Save ───────────────────────────────────────────────────────────────

export function loadAdminPolicy(projectRoot: string): AdminPolicy | null {
  const path = policyPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AdminPolicy;
  } catch {
    return null;
  }
}

export function saveAdminPolicy(policy: AdminPolicy, projectRoot: string): void {
  const dir = join(projectRoot, ".danteforge");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(policyPath(projectRoot), JSON.stringify(policy, null, 2), "utf-8");
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateAdminPolicy(policy: AdminPolicy): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!policy.orgId || policy.orgId.trim() === "") {
    errors.push("orgId is required");
  }
  if (!policy.version || !/^\d+\.\d+$/.test(policy.version)) {
    errors.push("version must be in format N.N (e.g. 1.0)");
  }
  if (!["strict", "permissive", "audit-only"].includes(policy.enforcementMode)) {
    errors.push(`invalid enforcementMode: ${policy.enforcementMode}`);
  }
  if (policy.maxSessionTtlSeconds <= 0) {
    errors.push("maxSessionTtlSeconds must be positive");
  }
  if (policy.dataRetentionDays < 0) {
    errors.push("dataRetentionDays cannot be negative");
  }

  if (policy.enforcementMode === "permissive") {
    warnings.push("enforcementMode is 'permissive' — policy violations are logged but not blocked");
  }
  if (!policy.requireMfa) {
    warnings.push("MFA not required — consider enabling for enterprise deployments");
  }
  if (policy.ipAllowlist.length === 0) {
    warnings.push("no IP allowlist configured — access allowed from all IPs");
  }
  if (policy.maxSessionTtlSeconds > 86400 * 7) {
    warnings.push("session TTL exceeds 7 days — consider shorter sessions");
  }
  if (policy.dataRetentionDays < 90) {
    warnings.push("dataRetentionDays < 90 may not meet enterprise compliance requirements");
  }

  const roleNames = new Set(policy.roles.map((r) => r.name));
  for (const role of policy.roles) {
    for (const inherited of role.inheritsFrom ?? []) {
      if (!roleNames.has(inherited)) {
        errors.push(`role '${role.name}' inherits from undefined role '${inherited}'`);
      }
    }
    if (role.permissions.length === 0) {
      warnings.push(`role '${role.name}' has no permissions`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Report Generator ──────────────────────────────────────────────────────────

export function generatePolicyReport(policy: AdminPolicy): PolicyReport {
  const sections: PolicyReportSection[] = [];
  const riskFindings: string[] = [];

  sections.push({
    heading: "Authentication",
    items: [
      `Enforcement mode: ${policy.enforcementMode}`,
      `MFA required: ${policy.requireMfa ? "yes" : "no"}`,
      `Allowed auth methods: ${policy.allowedAuthMethods.join(", ") || "none specified"}`,
      `Max session TTL: ${Math.round(policy.maxSessionTtlSeconds / 3600)}h`,
    ],
  });

  sections.push({
    heading: "Access Control",
    items: [
      `Roles defined: ${policy.roles.length}`,
      ...policy.roles.map((r) => `  ${r.name}: ${r.permissions.length} permission(s)${r.inheritsFrom?.length ? ` (inherits: ${r.inheritsFrom.join(", ")})` : ""}`),
      `IP allowlist: ${policy.ipAllowlist.length > 0 ? policy.ipAllowlist.join(", ") : "unrestricted"}`,
    ],
  });

  sections.push({
    heading: "Scopes & Tools",
    items: policy.scopes.map(
      (s) =>
        `${s.name}: ${s.allowedActions.join(", ")}${s.toolsAllowed.length > 0 ? ` | tools: ${s.toolsAllowed.join(", ")}` : ""}`,
    ),
  });

  sections.push({
    heading: "Data & Audit",
    items: [
      `Data retention: ${policy.dataRetentionDays} days`,
      `Audit level: ${policy.auditLevel}`,
    ],
  });

  if (!policy.requireMfa) riskFindings.push("MFA not required");
  if (policy.ipAllowlist.length === 0) riskFindings.push("no IP allowlist");
  if (policy.enforcementMode !== "strict") riskFindings.push(`non-strict enforcement (${policy.enforcementMode})`);
  if (policy.dataRetentionDays < 90) riskFindings.push("short data retention period");

  const riskLevel =
    riskFindings.length >= 3 ? "high" :
    riskFindings.length >= 1 ? "medium" : "low";

  return {
    orgId: policy.orgId,
    version: policy.version,
    enforcementMode: policy.enforcementMode,
    sections,
    riskSummary: { level: riskLevel, findings: riskFindings },
    generatedAt: new Date().toISOString(),
  };
}
