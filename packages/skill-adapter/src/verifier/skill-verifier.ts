// ============================================================================
// @dantecode/skill-adapter — Skill Verifier
// DanteForge constitutional verification on imported skills.
// Checks: anti-stub, completeness, security patterns, constitutional compliance.
// ============================================================================

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { UniversalParsedSkill } from "../parsers/universal-parser.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface SkillFinding {
  severity: "critical" | "warning" | "info";
  category: "safety" | "completeness" | "anti-stub" | "security" | "constitutional" | "quality";
  message: string;
  line?: number;
}

export interface ScriptSafetyResult {
  safe: boolean;
  shellInjectionRisk: boolean;
  networkAccess: boolean;
  credentialAccess: boolean;
  filesystemScope: "project-only" | "user-home" | "system-wide" | "unknown";
  findings: string[];
}

export interface SkillVerificationResult {
  skillName: string;
  source: string;
  overallScore: number; // 0-100
  tier: "guardian" | "sentinel" | "sovereign";
  passed: boolean;
  findings: SkillFinding[];
  scriptSafety: ScriptSafetyResult | null;
}

export interface VerifyOptions {
  tier?: "guardian" | "sentinel" | "sovereign"; // min required tier, default: "guardian"
  projectConstitution?: string; // content of CONSTITUTION.md
  checkScripts?: boolean; // default: true
}

// ----------------------------------------------------------------------------
// Tier Helpers
// ----------------------------------------------------------------------------

const TIER_ORDER: Record<"guardian" | "sentinel" | "sovereign", number> = {
  guardian: 0,
  sentinel: 1,
  sovereign: 2,
};

/**
 * Returns true if the qualified tier meets or exceeds the required tier.
 */
export function tierMeetsMinimum(
  qualified: "guardian" | "sentinel" | "sovereign",
  required: "guardian" | "sentinel" | "sovereign",
): boolean {
  return TIER_ORDER[qualified] >= TIER_ORDER[required];
}

// ----------------------------------------------------------------------------
// Anti-Stub Check
// ----------------------------------------------------------------------------

const STUB_PATTERNS: { pattern: RegExp; msg: string }[] = [
  { pattern: /TODO/i, msg: "Instructions contain TODO marker" },
  { pattern: /FIXME/i, msg: "Instructions contain FIXME marker" },
  { pattern: /\bTBD\b/i, msg: "Instructions contain TBD marker" },
  { pattern: /placeholder/i, msg: "Instructions contain placeholder marker" },
  { pattern: /add steps here/i, msg: "Instructions contain 'add steps here' placeholder" },
  { pattern: /implement this/i, msg: "Instructions contain 'implement this' placeholder" },
];

function checkAntiStub(instructions: string): SkillFinding[] {
  const findings: SkillFinding[] = [];
  for (const { pattern, msg } of STUB_PATTERNS) {
    if (pattern.test(instructions)) {
      findings.push({
        severity: "warning",
        category: "anti-stub",
        message: msg,
      });
    }
  }
  return findings;
}

// ----------------------------------------------------------------------------
// Completeness Check
// ----------------------------------------------------------------------------

function checkCompleteness(instructions: string, description: string): SkillFinding[] {
  const findings: SkillFinding[] = [];
  if (instructions.length < 50) {
    findings.push({
      severity: "warning",
      category: "completeness",
      message: "Instructions are very short (<50 chars)",
    });
  }
  if (!description || description.length < 10) {
    findings.push({
      severity: "warning",
      category: "completeness",
      message: "Description is missing or too short",
    });
  }
  return findings;
}

// ----------------------------------------------------------------------------
// Script Safety Check
// ----------------------------------------------------------------------------

async function verifyScripts(scriptPaths: string[]): Promise<ScriptSafetyResult> {
  const findings: string[] = [];
  let shellInjectionRisk = false;
  let networkAccess = false;
  let credentialAccess = false;
  let filesystemScope: "project-only" | "user-home" | "system-wide" | "unknown" = "project-only";

  for (const scriptPath of scriptPaths) {
    let content: string;
    try {
      content = await readFile(scriptPath, "utf-8");
    } catch {
      findings.push(`Could not read script: ${basename(scriptPath)}`);
      continue;
    }

    if (/eval|exec\(|child_process|subprocess|os\.system/.test(content)) {
      shellInjectionRisk = true;
      findings.push(`Shell injection risk detected in ${basename(scriptPath)}`);
    }

    if (/fetch|https?:|curl|wget|axios|request\(/.test(content)) {
      networkAccess = true;
      findings.push(`Network access detected in ${basename(scriptPath)}`);
    }

    if (/process\.env|\.env|keychain|credential|secret/.test(content)) {
      credentialAccess = true;
      findings.push(`Credential/secret access detected in ${basename(scriptPath)}`);
    }

    if (/\/etc\/|\/usr\/|\/var\/|~\/\./.test(content)) {
      filesystemScope = "system-wide";
    } else if (
      filesystemScope !== "system-wide" &&
      /~\/|process\.env\.HOME|\$HOME/.test(content)
    ) {
      filesystemScope = "user-home";
    }
  }

  const safe = !shellInjectionRisk && !networkAccess && !credentialAccess;

  return {
    safe,
    shellInjectionRisk,
    networkAccess,
    credentialAccess,
    filesystemScope,
    findings,
  };
}

// ----------------------------------------------------------------------------
// Dangerous Patterns in Instructions
// ----------------------------------------------------------------------------

const DANGEROUS_PATTERNS: { pattern: RegExp; msg: string }[] = [
  {
    pattern: /curl.*\|\s*(?:sh|bash)/i,
    msg: "Remote code execution via pipe to shell",
  },
  { pattern: /eval\s*\(/i, msg: "Eval usage in instructions" },
  { pattern: /rm\s+-rf\s+\//i, msg: "Destructive filesystem command" },
  {
    pattern: /password|secret|token|api.?key/i,
    msg: "Potential credential handling without vault",
  },
];

function checkDangerousPatterns(instructions: string): SkillFinding[] {
  const findings: SkillFinding[] = [];
  for (const { pattern, msg } of DANGEROUS_PATTERNS) {
    if (pattern.test(instructions)) {
      findings.push({
        severity: "warning",
        category: "security",
        message: msg,
      });
    }
  }
  return findings;
}

// ----------------------------------------------------------------------------
// Constitutional Compliance Check
// ----------------------------------------------------------------------------

const CONSTITUTION_FORBIDDEN = [
  "rm -rf",
  "eval",
  "hardcode",
  "skip tests",
  "ignore lint",
];

function checkConstitutionalCompliance(
  instructions: string,
  constitution: string,
): SkillFinding[] {
  const findings: SkillFinding[] = [];
  const constitutionLower = constitution.toLowerCase();
  const instructionsLower = instructions.toLowerCase();

  for (const forbidden of CONSTITUTION_FORBIDDEN) {
    const forbiddenLower = forbidden.toLowerCase();
    if (
      instructionsLower.includes(forbiddenLower) &&
      constitutionLower.includes(forbiddenLower)
    ) {
      findings.push({
        severity: "warning",
        category: "constitutional",
        message: `Instructions contain "${forbidden}" which is explicitly forbidden in the project constitution`,
      });
    }
  }

  return findings;
}

// ----------------------------------------------------------------------------
// Quality Score
// ----------------------------------------------------------------------------

function scoreInstructionQuality(instructions: string, description: string): number {
  let score = 85;

  if (instructions.length > 200) score += 5;
  if (instructions.length > 500) score += 5;
  if (description.length > 30) score += 5;

  // Penalize single-sentence instructions
  const sentences = instructions.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length <= 1) score -= 10;

  return Math.max(0, Math.min(100, score));
}

// ----------------------------------------------------------------------------
// Main Verifier
// ----------------------------------------------------------------------------

/**
 * Performs constitutional verification on an imported skill.
 * Checks anti-stub markers, completeness, security patterns, and constitution.
 *
 * @param skill - The universal parsed skill to verify.
 * @param options - Verification options (tier, constitution, script checking).
 * @returns A SkillVerificationResult with score, tier, pass/fail, and findings.
 */
export async function verifySkill(
  skill: UniversalParsedSkill,
  options?: VerifyOptions,
): Promise<SkillVerificationResult> {
  const requiredTier = options?.tier ?? "guardian";
  const findings: SkillFinding[] = [];

  // 1. Anti-stub check
  findings.push(...checkAntiStub(skill.instructions));

  // 2. Completeness check
  findings.push(...checkCompleteness(skill.instructions, skill.description));

  // 3. Script safety check
  let scriptSafety: ScriptSafetyResult | null = null;
  if (options?.checkScripts !== false && skill.scripts && skill.scripts.length > 0) {
    scriptSafety = await verifyScripts(skill.scripts);
    if (!scriptSafety.safe) {
      findings.push({
        severity: "critical",
        category: "safety",
        message: `Script safety check failed: ${scriptSafety.findings.join("; ")}`,
      });
    }
  }

  // 4. Dangerous patterns in instructions
  findings.push(...checkDangerousPatterns(skill.instructions));

  // 5. Constitutional compliance
  if (options?.projectConstitution) {
    findings.push(
      ...checkConstitutionalCompliance(skill.instructions, options.projectConstitution),
    );
  }

  // 6. Quality score
  const qualityScore = scoreInstructionQuality(skill.instructions, skill.description);

  // 7. Overall score
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const overallScore = Math.max(0, qualityScore - criticalCount * 20 - warningCount * 5);

  // 8. Tier assignment
  let tier: "guardian" | "sentinel" | "sovereign";
  if (overallScore >= 85) {
    tier = "sovereign";
  } else if (overallScore >= 70) {
    tier = "sentinel";
  } else {
    tier = "guardian";
  }

  // 9. Passed check
  const passed = tierMeetsMinimum(tier, requiredTier);

  return {
    skillName: skill.name,
    source: skill.sourcePath,
    overallScore,
    tier,
    passed,
    findings,
    scriptSafety,
  };
}
