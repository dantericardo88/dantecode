// ============================================================================
// @dantecode/skill-adapter — DanteForge Adapter Wrapping (PRD D4.6)
// Wraps parsed skills with the DanteForge preamble/postamble blocks,
// generating complete SKILL.dc.md files.
// ============================================================================

import YAML from "yaml";
import type { SkillFrontmatter } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Current version of the DanteForge skill adapter format. */
export const ADAPTER_VERSION = "1.0.0";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A parsed skill ready for wrapping. */
export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
}

/** The import source identifier. */
export type ImportSource = "claude" | "continue" | "opencode";

// ----------------------------------------------------------------------------
// Preamble Block (PRD D4.6)
// ----------------------------------------------------------------------------

/**
 * The DanteForge preamble block injected before the original skill instructions.
 * Contains the Anti-Stub Doctrine, PDSE Clarity Gate rules, and Constitution Rules.
 */
const PREAMBLE_BLOCK = `<!-- ============================================================ -->
<!-- DANTEFORGE PREAMBLE — Injected by @dantecode/skill-adapter   -->
<!-- ============================================================ -->

## Anti-Stub Doctrine

You MUST produce COMPLETE, PRODUCTION-READY code at all times. The following
are strictly forbidden in any generated output:

- Stub functions or methods with empty bodies
- Placeholder comments (e.g., "implement later", "add logic here")
- Ellipsis markers (\`...\`) indicating omitted code
- \`throw new Error("not implemented")\` or equivalent
- \`pass\` statements used as implementation placeholders
- Any pattern matching: \`/TODO|FIXME|HACK|PLACEHOLDER|NotImplementedError/i\`
- Type annotations using \`any\` or \`as any\` type assertions
- \`@ts-ignore\` or \`@ts-nocheck\` directives

If a function is too complex to implement in one pass, break it into smaller
helper functions and implement ALL of them completely.

**Violation of this doctrine triggers an automatic regeneration cycle via the
DanteForge Autoforge IAL. Repeated violations are recorded as lessons.**

## PDSE Clarity Gate

Every code generation output is scored on four dimensions:

| Dimension     | Weight | Minimum |
|---------------|--------|---------|
| Completeness  | 30%    | 80      |
| Correctness   | 30%    | 80      |
| Clarity       | 20%    | 70      |
| Consistency   | 20%    | 70      |

The overall PDSE score must meet the configured threshold (default: 85) to pass
the quality gate. Outputs that fail are sent through the Autoforge
Iterate-Assess-Loop for automatic correction.

## Constitution Rules

The following security and safety constraints are enforced by the DanteForge
Constitution Checker on ALL generated code:

1. **No Credential Exposure**: Never hardcode API keys, passwords, tokens,
   secrets, or connection strings. Always use environment variables or
   secret management systems.

2. **No Background Processes**: Do not spawn detached processes, daemons,
   or use \`nohup\`/\`disown\`/\`detached: true\` unless explicitly required
   by the skill instructions and approved by the user.

3. **No Dangerous Operations**: Do not generate destructive commands
   (\`rm -rf /\`, \`DROP TABLE\`, \`TRUNCATE\`), filesystem format commands,
   or commands piped to shell (\`curl | sh\`).

4. **No Code Injection**: Do not use the JS \`eval\` function, \`new Function()\`,
   or process \`exec\` with user-supplied input. Avoid prototype pollution.

5. **Principle of Least Privilege**: Request only the minimum permissions,
   file access, and network access required to complete the task.

**Constitution violations of severity "critical" cause an immediate abort.
Violations of severity "warning" are flagged for user review.**

<!-- END DANTEFORGE PREAMBLE -->`;

// ----------------------------------------------------------------------------
// Postamble Block (PRD D4.6)
// ----------------------------------------------------------------------------

/**
 * The DanteForge postamble block injected after the original skill instructions.
 * Contains GStack QA, Lessons Injection, Audit Log, and Commit Hook instructions.
 */
const POSTAMBLE_BLOCK = `<!-- ============================================================ -->
<!-- DANTEFORGE POSTAMBLE — Injected by @dantecode/skill-adapter  -->
<!-- ============================================================ -->

## GStack QA Pipeline

After generating code, the following quality assurance commands are executed
automatically in sequence. All non-soft-failure commands must pass:

1. **Type Check** (\`tsc --noEmit\`): Ensures TypeScript compilation succeeds
   with zero type errors.
2. **Lint** (\`eslint .\`): Enforces code style and catches common issues.
   Lint failures are soft (warning-only) by default.
3. **Test** (\`vitest run\`): Runs the project test suite. All tests must pass.

If any hard-failure GStack command fails, the output enters the Autoforge
Iterate-Assess-Loop for automatic correction (up to the configured max
iterations).

## Lessons Injection

Before generating code, the DanteForge lessons system queries for relevant
prior lessons based on:
- The current file path and language
- Previously recorded correction patterns
- Minimum severity threshold

Lessons are injected into the system prompt as additional context to prevent
repeating past mistakes. After each generation cycle, new lessons are
automatically extracted from:
- PDSE scoring violations
- Autoforge iteration corrections
- Constitution check findings
- User-provided feedback

## Audit Log

Every skill invocation, code generation, quality gate result, and
constitution check is recorded in the append-only audit log at
\`.dantecode/audit.jsonl\`. Audit events include:

- \`skill_import\`: When a skill is imported and wrapped
- \`skill_activate\`: When a wrapped skill is loaded for use
- \`pdse_gate_pass\` / \`pdse_gate_fail\`: Quality gate results
- \`constitution_violation\`: Security constraint violations
- \`autoforge_iteration\`: Each correction iteration
- \`lesson_record\` / \`lesson_inject\`: Lessons learned and applied

The audit log is immutable and retained for the configured retention period.

## Commit Hook

When git auto-commit is enabled, DanteCode automatically creates structured
commits after successful code generation:

- Commit messages follow the format: \`<prefix> <type>(<scope>): <description>\`
- The commit includes only the files touched during the generation
- A \`Co-Authored-By: DanteCode\` trailer is appended
- If worktree mode is active, changes are committed to the session worktree
  branch and can be merged back after review

**The commit hook only fires after ALL quality gates pass (PDSE, GStack,
Constitution). Failed generations are never committed.**

<!-- END DANTEFORGE POSTAMBLE -->`;

// ----------------------------------------------------------------------------
// Wrapping Function
// ----------------------------------------------------------------------------

/**
 * Wraps a parsed skill with DanteForge adapter blocks, producing a
 * complete SKILL.dc.md file content string.
 *
 * The generated file has the following structure:
 * 1. YAML frontmatter (original metadata + adapter metadata)
 * 2. PREAMBLE block (Anti-Stub Doctrine, PDSE Clarity Gate, Constitution Rules)
 * 3. ORIGINAL SKILL INSTRUCTIONS (verbatim from the source skill)
 * 4. POSTAMBLE block (GStack QA, Lessons Injection, Audit Log, Commit Hook)
 *
 * @param skill - The parsed skill with frontmatter and instructions.
 * @param importSource - The source system ("claude" | "continue" | "opencode").
 * @returns The complete SKILL.dc.md content as a string.
 */
export function wrapSkillWithAdapter(skill: ParsedSkill, importSource: ImportSource): string {
  // Build the enhanced frontmatter with adapter metadata
  const wrappedFrontmatter: Record<string, unknown> = {
    name: skill.frontmatter.name,
    description: skill.frontmatter.description,
    adapter_version: ADAPTER_VERSION,
    wrapped_at: new Date().toISOString(),
    import_source: importSource,
    original_source_path: skill.sourcePath,
    dante_tools: [
      "anti_stub_scanner",
      "pdse_scorer",
      "constitution_checker",
      "gstack_runner",
      "lessons_system",
      "audit_logger",
    ],
  };

  // Carry over optional original frontmatter fields
  if (skill.frontmatter.tools !== undefined && skill.frontmatter.tools.length > 0) {
    wrappedFrontmatter["original_tools"] = skill.frontmatter.tools;
  }
  if (skill.frontmatter.model !== undefined) {
    wrappedFrontmatter["original_model"] = skill.frontmatter.model;
  }
  if (skill.frontmatter.mode !== undefined) {
    wrappedFrontmatter["mode"] = skill.frontmatter.mode;
  }
  if (skill.frontmatter.hidden !== undefined) {
    wrappedFrontmatter["hidden"] = skill.frontmatter.hidden;
  }
  if (skill.frontmatter.color !== undefined) {
    wrappedFrontmatter["color"] = skill.frontmatter.color;
  }

  // Serialize the frontmatter as YAML
  const frontmatterYaml = YAML.stringify(wrappedFrontmatter, {
    indent: 2,
    lineWidth: 120,
  }).trim();

  // Assemble the complete SKILL.dc.md content
  const sections = [
    `---`,
    frontmatterYaml,
    `---`,
    ``,
    PREAMBLE_BLOCK,
    ``,
    `<!-- ============================================================ -->`,
    `<!-- ORIGINAL SKILL INSTRUCTIONS                                  -->`,
    `<!-- Source: ${importSource} | File: ${skill.sourcePath}  -->`,
    `<!-- ============================================================ -->`,
    ``,
    skill.instructions,
    ``,
    POSTAMBLE_BLOCK,
    ``,
  ];

  return sections.join("\n");
}
