export type VerificationRuleDecision = "auto_approve" | "requires_approval" | "auto_deny";
export type VerificationGate = "hard" | "soft";
export type VerificationRuleMatchKind = "tool" | "domain" | "path";

export interface VerificationRule {
  reason: string;
  tools?: string[];
  domains?: string[];
  pathPatterns?: RegExp[];
  decision: VerificationRuleDecision;
  gate?: VerificationGate;
}

export interface VerificationRuleMatch {
  rule: VerificationRule;
  matchedBy: VerificationRuleMatchKind[];
  checkValue: string;
}

export interface VerificationRuleEvaluation {
  decision: VerificationRuleDecision;
  reason?: string;
  warnings: string[];
  matchedRules: VerificationRuleMatch[];
  enforcedRules: VerificationRuleMatch[];
}

const DECISION_PRIORITY: Record<VerificationRuleDecision, number> = {
  auto_approve: 0,
  requires_approval: 1,
  auto_deny: 2,
};

export function matchesVerificationRule(
  rule: VerificationRule,
  toolName: string,
  input: Record<string, unknown>,
): VerificationRuleMatch | null {
  const matchedBy: VerificationRuleMatchKind[] = [];
  let checkValue = toolName;

  if (rule.tools && rule.tools.length > 0) {
    if (!rule.tools.includes(toolName)) {
      return null;
    }
    matchedBy.push("tool");
  }

  if (rule.domains && rule.domains.length > 0) {
    const candidate = String(input["url"] ?? input["query"] ?? "");
    if (!candidate || !rule.domains.some((domain) => candidate.includes(domain))) {
      return null;
    }
    matchedBy.push("domain");
    checkValue = candidate;
  }

  if (rule.pathPatterns && rule.pathPatterns.length > 0) {
    const candidate = String(input["command"] ?? input["file_path"] ?? input["path"] ?? "");
    if (!candidate || !rule.pathPatterns.every((pattern) => pattern.test(candidate))) {
      return null;
    }
    matchedBy.push("path");
    checkValue = candidate;
  }

  return {
    rule,
    matchedBy,
    checkValue,
  };
}

export function evaluateVerificationRules(
  toolName: string,
  input: Record<string, unknown>,
  rules: VerificationRule[],
): VerificationRuleEvaluation {
  const matchedRules = rules
    .map((rule) => matchesVerificationRule(rule, toolName, input))
    .filter((match): match is VerificationRuleMatch => match !== null);

  const enforcedRules = matchedRules.filter((match) => (match.rule.gate ?? "hard") === "hard");
  const softRules = matchedRules.filter((match) => (match.rule.gate ?? "hard") === "soft");
  const chosenRule = enforcedRules.reduce<VerificationRuleMatch | undefined>((selected, match) => {
    if (!selected) {
      return match;
    }

    return DECISION_PRIORITY[match.rule.decision] > DECISION_PRIORITY[selected.rule.decision]
      ? match
      : selected;
  }, undefined);

  return {
    decision: chosenRule?.rule.decision ?? "auto_approve",
    reason: chosenRule?.rule.reason,
    warnings: softRules.map((match) => `[soft gate] ${match.rule.reason}`),
    matchedRules,
    enforcedRules,
  };
}
