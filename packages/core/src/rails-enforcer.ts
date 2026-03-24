export type VerificationRailMode = "hard" | "soft";

export interface VerificationRail {
  id: string;
  name: string;
  description?: string;
  mode?: VerificationRailMode;
  requiredSubstrings?: string[];
  forbiddenPatterns?: string[];
  minLength?: number;
  maxLength?: number;
}

export interface VerificationRailFinding {
  railId: string;
  railName: string;
  mode: VerificationRailMode;
  passed: boolean;
  violations: string[];
}

export class VerificationRailRegistry {
  private readonly rails = new Map<string, VerificationRail>();

  addRail(rail: VerificationRail): VerificationRail {
    const normalized: VerificationRail = {
      ...rail,
      mode: rail.mode ?? "hard",
      requiredSubstrings: rail.requiredSubstrings ? [...rail.requiredSubstrings] : undefined,
      forbiddenPatterns: rail.forbiddenPatterns ? [...rail.forbiddenPatterns] : undefined,
    };
    this.rails.set(normalized.id, normalized);
    return normalized;
  }

  listRails(): VerificationRail[] {
    return [...this.rails.values()].map((rail) => ({
      ...rail,
      requiredSubstrings: rail.requiredSubstrings ? [...rail.requiredSubstrings] : undefined,
      forbiddenPatterns: rail.forbiddenPatterns ? [...rail.forbiddenPatterns] : undefined,
    }));
  }

  clear(): void {
    this.rails.clear();
  }

  evaluate(
    task: string,
    output: string,
    rails: VerificationRail[] = this.listRails(),
  ): VerificationRailFinding[] {
    void task;
    return rails.map((rail) => evaluateRail(rail, output));
  }
}

export function evaluateRail(rail: VerificationRail, output: string): VerificationRailFinding {
  const violations: string[] = [];
  const normalizedOutput = output.toLowerCase();
  const mode = rail.mode ?? "hard";

  for (const required of rail.requiredSubstrings ?? []) {
    if (!normalizedOutput.includes(required.toLowerCase())) {
      violations.push(`Missing required content: "${required}"`);
    }
  }

  for (const forbidden of rail.forbiddenPatterns ?? []) {
    if (normalizedOutput.includes(forbidden.toLowerCase())) {
      violations.push(`Forbidden pattern present: "${forbidden}"`);
    }
  }

  if (typeof rail.minLength === "number" && output.length < rail.minLength) {
    violations.push(`Output length ${output.length} is below minimum ${rail.minLength}`);
  }

  if (typeof rail.maxLength === "number" && output.length > rail.maxLength) {
    violations.push(`Output length ${output.length} exceeds maximum ${rail.maxLength}`);
  }

  return {
    railId: rail.id,
    railName: rail.name,
    mode,
    passed: violations.length === 0,
    violations,
  };
}

export const globalVerificationRailRegistry = new VerificationRailRegistry();
