// ============================================================================
// @dantecode/skill-adapter — Import Orchestrator
// Main entry point for importing skills from Claude, Continue.dev, and
// OpenCode into the DanteCode project as wrapped SKILL.dc.md files.
// ============================================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runAntiStubScanner, runConstitutionCheck } from "@dantecode/danteforge";
import { appendAuditEvent, readOrInitializeState, updateStateYaml } from "@dantecode/core";
import type { SkillFrontmatter } from "@dantecode/config-types";

import {
  scanClaudeSkills,
  parseClaudeSkill,
  scanContinueAgents,
  parseContinueAgent,
  scanOpencodeAgents,
  parseOpencodeAgent,
} from "./parsers/index.js";
import { wrapSkillWithAdapter } from "./wrap.js";
import type { ImportSource, ParsedSkill } from "./wrap.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Configuration options for the import operation. */
export interface ImportOptions {
  /** Which source system to import from. */
  source: ImportSource;
  /** Optional override for the source directory to scan. */
  sourceDir?: string;
  /** Absolute path to the project root where .dantecode/ lives. */
  projectRoot: string;
  /** Session ID for audit logging. Defaults to "import-session". */
  sessionId?: string;
  /** Model ID for audit logging. Defaults to "skill-adapter". */
  modelId?: string;
  /** Whether to skip anti-stub scanning. Defaults to false. */
  skipAntiStub?: boolean;
  /** Whether to skip constitution checking. Defaults to false. */
  skipConstitution?: boolean;
}

/** A single skill that was skipped during import with its reason. */
export interface SkippedSkill {
  name: string;
  reason: string;
}

/** Result of the import operation. */
export interface ImportResult {
  /** Names of skills that were successfully imported. */
  imported: string[];
  /** Skills that were skipped with reasons. */
  skipped: SkippedSkill[];
  /** Error messages for skills that failed to import. */
  errors: string[];
}

// ----------------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------------

/** Unified shape for a scanned+parsed skill from any source. */
interface UnifiedParsedSkill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
}

/**
 * Scans and parses skills from the given source.
 *
 * @param source - The import source identifier.
 * @param sourceDir - Optional directory override.
 * @returns Array of parsed skills.
 */
async function scanAndParse(
  source: ImportSource,
  sourceDir?: string,
): Promise<UnifiedParsedSkill[]> {
  switch (source) {
    case "claude": {
      const scanned = await scanClaudeSkills(sourceDir);
      return scanned.map((s) => parseClaudeSkill(s.raw, s.path));
    }
    case "continue": {
      const scanned = await scanContinueAgents(sourceDir);
      return scanned.map((s) => parseContinueAgent(s.raw, s.path));
    }
    case "opencode": {
      const scanned = await scanOpencodeAgents(sourceDir);
      return scanned.map((s) => parseOpencodeAgent(s.raw, s.path));
    }
  }
}

/**
 * Sanitizes a skill name for use as a directory name.
 * Replaces non-alphanumeric characters (except hyphens) with hyphens
 * and collapses consecutive hyphens.
 */
function sanitizeSkillName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "") || "unnamed-skill"
  );
}

// ----------------------------------------------------------------------------
// Main Import Orchestrator
// ----------------------------------------------------------------------------

/**
 * Imports skills from an external source (Claude, Continue.dev, or OpenCode)
 * into the DanteCode project.
 *
 * The import process follows these steps for each discovered skill:
 * 1. Scan the source directory for skill/agent markdown files
 * 2. Parse each file to extract frontmatter and instructions
 * 3. Run the anti-stub scanner on the skill instructions
 * 4. Run the constitution checker on the skill instructions
 * 5. Wrap each passing skill with the DanteForge adapter (preamble + postamble)
 * 6. Write the wrapped skill to `.dantecode/skills/<name>/SKILL.dc.md`
 * 7. Update STATE.yaml with the import record
 * 8. Log audit events for each import action
 *
 * Skills that fail the anti-stub scan or constitution check are skipped
 * (not imported) and reported in the result.
 *
 * @param options - Import configuration specifying source, directory, and project root.
 * @returns An ImportResult with lists of imported, skipped, and errored skills.
 */
export async function loadChecks(projectRoot: string): Promise<ParsedSkill[]> {
  const checksDir = join(projectRoot, '.dantecode', 'checks');
  const checks = await glob('**/*.md', { cwd: checksDir });
  return Promise.all(checks.map(async (c) => {
    const path = join(checksDir, c);
    const raw = await readFile(path, 'utf-8');
    return parseClaudeSkill(raw, path);
  }));
}

export async function importSkills(options: ImportOptions): Promise<ImportResult> {
  const {
    source,
    sourceDir,
    projectRoot,
    sessionId = "import-session",
    modelId = "skill-adapter",
    skipAntiStub = false,
    skipConstitution = false,
  } = options;

  const result: ImportResult = {
    imported: [],
    skipped: [],
    errors: [],
  };

  // Step 1 + 2: Scan and parse skills from the source
  let parsedSkills: UnifiedParsedSkill[];
  try {
    parsedSkills = await scanAndParse(source, sourceDir);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to scan ${source} skills: ${message}`);
    return result;
  }

  if (parsedSkills.length === 0) {
    return result;
  }

  // Ensure the skills output directory exists
  const skillsBaseDir = join(projectRoot, ".dantecode", "skills");
  await mkdir(skillsBaseDir, { recursive: true });

  // Process each skill
  for (const skill of parsedSkills) {
    const skillName = skill.frontmatter.name;
    const sanitizedName = sanitizeSkillName(skillName);

    try {
      // Step 3: Run anti-stub scan on the skill instructions
      if (!skipAntiStub) {
        const antiStubResult = runAntiStubScanner(
          skill.instructions,
          projectRoot,
          skill.sourcePath,
        );

        if (!antiStubResult.passed) {
          const violationCount = antiStubResult.hardViolations.length;
          const firstViolation = antiStubResult.hardViolations[0];
          const violationSummary = firstViolation
            ? `: ${firstViolation.message} (line ${firstViolation.line ?? "?"})`
            : "";

          result.skipped.push({
            name: skillName,
            reason: `Anti-stub scan failed with ${violationCount} hard violation(s)${violationSummary}`,
          });

          // Log the skip as an audit event
          await appendAuditEvent(projectRoot, {
            sessionId,
            timestamp: new Date().toISOString(),
            type: "skill_import",
            payload: {
              action: "skipped",
              skillName,
              source,
              sourcePath: skill.sourcePath,
              reason: "anti_stub_scan_failed",
              hardViolations: violationCount,
            },
            modelId,
            projectRoot,
          });

          continue;
        }
      }

      // Step 4: Run constitution check on the skill instructions
      if (!skipConstitution) {
        const constitutionResult = runConstitutionCheck(skill.instructions, skill.sourcePath);

        // Only block on critical violations; warnings are allowed through
        const criticalViolations = constitutionResult.violations.filter(
          (v: { severity: string }) => v.severity === "critical",
        );

        if (criticalViolations.length > 0) {
          const firstViolation = criticalViolations[0];
          const violationSummary = firstViolation
            ? `: ${firstViolation.message} (line ${firstViolation.line ?? "?"})`
            : "";

          result.skipped.push({
            name: skillName,
            reason: `Constitution check failed with ${criticalViolations.length} critical violation(s)${violationSummary}`,
          });

          // Log the skip as an audit event
          await appendAuditEvent(projectRoot, {
            sessionId,
            timestamp: new Date().toISOString(),
            type: "constitution_violation",
            payload: {
              action: "skill_import_blocked",
              skillName,
              source,
              sourcePath: skill.sourcePath,
              criticalViolations: criticalViolations.length,
              violations: criticalViolations.map(
                (v: { type: string; message: string; line?: number }) => ({
                  type: v.type,
                  message: v.message,
                  line: v.line,
                }),
              ),
            },
            modelId,
            projectRoot,
          });

          continue;
        }
      }

      // Step 5: Wrap the skill with the DanteForge adapter
      const adaptedSkill: ParsedSkill = {
        frontmatter: skill.frontmatter,
        instructions: skill.instructions,
        sourcePath: skill.sourcePath,
      };
      const wrappedContent = wrapSkillWithAdapter(adaptedSkill, source);

      // Step 6: Write the wrapped skill to .dantecode/skills/<name>/SKILL.dc.md
      const skillDir = join(skillsBaseDir, sanitizedName);
      await mkdir(skillDir, { recursive: true });

      const outputPath = join(skillDir, "SKILL.dc.md");
      await writeFile(outputPath, wrappedContent, "utf-8");

      result.imported.push(skillName);

      // Step 8: Log the import as an audit event
      await appendAuditEvent(projectRoot, {
        sessionId,
        timestamp: new Date().toISOString(),
        type: "skill_import",
        payload: {
          action: "imported",
          skillName,
          sanitizedName,
          source,
          sourcePath: skill.sourcePath,
          outputPath,
          hasTools: skill.frontmatter.tools !== undefined && skill.frontmatter.tools.length > 0,
          hasModel: skill.frontmatter.model !== undefined,
          mode: skill.frontmatter.mode,
        },
        modelId,
        projectRoot,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to import skill "${skillName}": ${message}`);

      // Log the error as an audit event
      try {
        await appendAuditEvent(projectRoot, {
          sessionId,
          timestamp: new Date().toISOString(),
          type: "skill_import",
          payload: {
            action: "error",
            skillName,
            source,
            sourcePath: skill.sourcePath,
            error: message,
          },
          modelId,
          projectRoot,
        });
      } catch {
        // If audit logging itself fails, we still want to continue
      }
    }
  }

  // Step 7: Update STATE.yaml with the import record
  if (result.imported.length > 0) {
    try {
      const state = await readOrInitializeState(projectRoot);

      // Build the updated skills config, recording the import source
      const currentDirs = state.skills.directories;
      const skillsDirEntry = ".dantecode/skills";
      const updatedDirs = currentDirs.includes(skillsDirEntry)
        ? currentDirs
        : [...currentDirs, skillsDirEntry];

      await updateStateYaml(projectRoot, {
        skills: {
          ...state.skills,
          directories: updatedDirs,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to update STATE.yaml: ${message}`);
    }
  }

  return result;
}
