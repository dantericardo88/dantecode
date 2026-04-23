// ============================================================================
// packages/core/src/rbac-engine.ts
// Dim 28 — RBAC/ABAC policy engine
// Patterns from: cerbos (principal/resource/action + trace),
//               openfga (tuple-based check + consistency),
//               keto (relation tuples + batch operations)
// ============================================================================

// ── Types ─────────────────────────────────────────────────────────────────────

export type PolicyEffect = "ALLOW" | "DENY";
export type ConsistencyLevel = "HIGHER" | "EVENTUAL";

export interface Principal {
  id: string;
  roles: string[];
  attributes: Record<string, unknown>;
}

export interface Resource {
  id: string;
  kind: string;
  attributes: Record<string, unknown>;
}

export interface PolicyRule {
  id: string;
  actions: string[];
  effect: PolicyEffect;
  condition?: PolicyCondition;
}

export interface PolicyCondition {
  type: "attr_eq" | "attr_in" | "role_has" | "expr";
  field?: string;
  value?: unknown;
  expression?: string;
}

export interface ResourcePolicy {
  kind: string;
  rules: PolicyRule[];
}

export interface PolicyCheckRequest {
  principal: Principal;
  resource: Resource;
  actions: string[];
  consistency?: ConsistencyLevel;
}

export type TraceComponentKind =
  | "ACTION"
  | "POLICY_RULE"
  | "CONDITION"
  | "ROLE_CHECK"
  | "DEFAULT_DENY";

export interface TraceComponent {
  kind: TraceComponentKind;
  id: string;
  status: "ACTIVATED" | "SKIPPED";
  reason?: string;
}

export interface PolicyCheckResult {
  action: string;
  effect: PolicyEffect;
  trace: TraceComponent[];
}

export interface PolicyCheckResponse {
  principal: string;
  resource: string;
  results: PolicyCheckResult[];
  evaluatedAt: string;
}

export interface PolicyReport {
  totalPolicies: number;
  totalRules: number;
  kindsCovered: string[];
  allowRuleCount: number;
  denyRuleCount: number;
  conditionalRuleCount: number;
  generatedAt: string;
}

export interface RelationTuple {
  subjectNamespace: string;
  subjectId: string;
  relation: string;
  objectNamespace: string;
  objectId: string;
}

// ── In-memory policy store (replace with persistent store in production) ──────

const policyStore = new Map<string, ResourcePolicy>();
const relationTuples: RelationTuple[] = [];

export function registerPolicy(policy: ResourcePolicy): void {
  policyStore.set(policy.kind, policy);
}

export function addRelationTuple(tuple: RelationTuple): void {
  const exists = relationTuples.some(
    (t) =>
      t.subjectId === tuple.subjectId &&
      t.relation === tuple.relation &&
      t.objectId === tuple.objectId,
  );
  if (!exists) relationTuples.push(tuple);
}

// ── Core Engine ───────────────────────────────────────────────────────────────

function evaluateCondition(
  condition: PolicyCondition,
  principal: Principal,
  resource: Resource,
): boolean {
  switch (condition.type) {
    case "attr_eq":
      if (!condition.field) return false;
      if (condition.field.startsWith("principal.")) {
        const key = condition.field.slice("principal.".length);
        return principal.attributes[key] === condition.value;
      }
      if (condition.field.startsWith("resource.")) {
        const key = condition.field.slice("resource.".length);
        return resource.attributes[key] === condition.value;
      }
      return false;

    case "attr_in":
      if (!condition.field || !Array.isArray(condition.value)) return false;
      if (condition.field.startsWith("principal.")) {
        const key = condition.field.slice("principal.".length);
        return (condition.value as unknown[]).includes(principal.attributes[key]);
      }
      if (condition.field.startsWith("resource.")) {
        const key = condition.field.slice("resource.".length);
        return (condition.value as unknown[]).includes(resource.attributes[key]);
      }
      return false;

    case "role_has":
      return typeof condition.value === "string"
        ? principal.roles.includes(condition.value)
        : false;

    case "expr":
      return false;

    default:
      return false;
  }
}

export function checkPermission(
  principal: Principal,
  resource: Resource,
  action: string,
): PolicyCheckResult {
  const trace: TraceComponent[] = [];
  const policy = policyStore.get(resource.kind);

  if (!policy) {
    trace.push({ kind: "DEFAULT_DENY", id: "no-policy", status: "ACTIVATED", reason: `no policy for kind: ${resource.kind}` });
    return { action, effect: "DENY", trace };
  }

  for (const rule of policy.rules) {
    if (!rule.actions.includes(action) && !rule.actions.includes("*")) {
      trace.push({ kind: "POLICY_RULE", id: rule.id, status: "SKIPPED", reason: "action not in rule" });
      continue;
    }

    trace.push({ kind: "ACTION", id: `${rule.id}:${action}`, status: "ACTIVATED" });

    if (rule.condition) {
      const condMet = evaluateCondition(rule.condition, principal, resource);
      trace.push({
        kind: "CONDITION",
        id: `${rule.id}:condition`,
        status: condMet ? "ACTIVATED" : "SKIPPED",
        reason: condMet ? "condition satisfied" : "condition not met",
      });
      if (!condMet) continue;
    }

    trace.push({ kind: "POLICY_RULE", id: rule.id, status: "ACTIVATED", reason: `effect: ${rule.effect}` });
    return { action, effect: rule.effect, trace };
  }

  trace.push({ kind: "DEFAULT_DENY", id: "no-match", status: "ACTIVATED", reason: "no matching rule" });
  return { action, effect: "DENY", trace };
}

export function evaluatePolicy(request: PolicyCheckRequest): PolicyCheckResponse {
  const results = request.actions.map((action) =>
    checkPermission(request.principal, request.resource, action),
  );

  return {
    principal: request.principal.id,
    resource: `${request.resource.kind}:${request.resource.id}`,
    results,
    evaluatedAt: new Date().toISOString(),
  };
}

export function getPrincipalRoles(principalId: string, resourceNamespace?: string): string[] {
  const tupleRoles = relationTuples
    .filter(
      (t) =>
        t.subjectId === principalId &&
        t.relation === "member" &&
        (!resourceNamespace || t.objectNamespace === resourceNamespace),
    )
    .map((t) => t.objectId);

  return Array.from(new Set(tupleRoles));
}

export function generatePolicyReport(): PolicyReport {
  const policies = Array.from(policyStore.values());
  const kindsCovered = policies.map((p) => p.kind);
  let allowCount = 0;
  let denyCount = 0;
  let conditionalCount = 0;

  for (const policy of policies) {
    for (const rule of policy.rules) {
      if (rule.effect === "ALLOW") allowCount++;
      else denyCount++;
      if (rule.condition) conditionalCount++;
    }
  }

  return {
    totalPolicies: policies.length,
    totalRules: policies.reduce((sum, p) => sum + p.rules.length, 0),
    kindsCovered,
    allowRuleCount: allowCount,
    denyRuleCount: denyCount,
    conditionalRuleCount: conditionalCount,
    generatedAt: new Date().toISOString(),
  };
}

export function clearPolicies(): void {
  policyStore.clear();
  relationTuples.length = 0;
}
