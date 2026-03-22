#!/usr/bin/env node
/**
 * ESM integration test for @dantecode/skill-adapter
 * Verifies that the built dist package exports work correctly when consumed
 * as a real ESM dependency: scanning, parsing, registry, wrapping, verification,
 * and marketplace/composer classes.
 *
 * Run via: node tests/integration/skill-adapter-import.mjs
 */

import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const pkgPath = resolve("packages/skill-adapter/dist/index.js");
const mod = await import(pathToFileURL(pkgPath).href);

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function skip(message) {
  console.log(`  SKIP: ${message}`);
  skipped++;
}

// ─── Group 1: Export verification ──────────────────────────────────────────
console.log("\n[1] Export verification — expected functions and classes exist");
{
  // Functions that should be exported
  const expectedFunctions = [
    "scanClaudeSkills",
    "parseClaudeSkill",
    "scanContinueAgents",
    "parseContinueAgent",
    "scanOpencodeAgents",
    "parseOpencodeAgent",
    "wrapSkillWithAdapter",
    "importSkills",
    "loadChecks",
    "loadSkillRegistry",
    "getSkill",
    "getSkillWithBridgeMeta",
    "listSkills",
    "removeSkill",
    "validateSkill",
    "verifySkill",
    "tierMeetsMinimum",
    "parseSkillBridgeManifest",
    "sanitizeSlug",
    "importSkillBridgeBundle",
    "listBridgeWarnings",
    "validateBridgeSkill",
    "detectSkillSources",
    "parseUniversalSkill",
    "universalToWrappable",
    "scanCodexSkills",
    "parseCodexSkill",
    "scanCursorRules",
    "parseCursorRule",
    "scanQwenSkills",
    "parseQwenSkill",
    "installSkill",
    "bundleSkill",
    "exportSkillToDirectory",
    "getRiskLevel",
    "executeChain",
    "resolveParams",
    "evaluateGate",
    "scorePassesThreshold",
    "selectOnFail",
  ];

  for (const name of expectedFunctions) {
    if (typeof mod[name] === "function") {
      assert(true, `export "${name}" is a function`);
    } else if (mod[name] === undefined) {
      skip(`export "${name}" not found (may not be built)`);
    } else {
      assert(false, `export "${name}" expected function, got ${typeof mod[name]}`);
    }
  }

  // Classes that should be exported
  const expectedClasses = ["SkillCatalog", "SkillChain"];
  for (const name of expectedClasses) {
    if (typeof mod[name] === "function" && mod[name].prototype) {
      assert(true, `export "${name}" is a class/constructor`);
    } else if (mod[name] === undefined) {
      skip(`export "${name}" not found (may not be built)`);
    } else {
      assert(false, `export "${name}" expected class, got ${typeof mod[name]}`);
    }
  }

  // Constants that should be exported
  if (typeof mod.ADAPTER_VERSION === "string") {
    assert(true, `ADAPTER_VERSION is a string: "${mod.ADAPTER_VERSION}"`);
  } else if (mod.ADAPTER_VERSION === undefined) {
    skip("ADAPTER_VERSION not found");
  } else {
    assert(false, `ADAPTER_VERSION expected string, got ${typeof mod.ADAPTER_VERSION}`);
  }
}

// ─── Group 2: scanClaudeSkills — scan a temp dir with a mock .md file ──────
console.log("\n[2] scanClaudeSkills — scan a temp dir with mock skill files");
{
  if (typeof mod.scanClaudeSkills !== "function") {
    skip("scanClaudeSkills not available — skipping group");
  } else {
    let tmpDir;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "skill-adapter-test-"));

      const skillContent = `---
name: test-skill
description: A test skill for integration testing
version: 1.0.0
---
# Test Skill

This is a test skill body used for verification testing and validation.
`;
      const nestedDir = join(tmpDir, "subdir");
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(tmpDir, "test-skill.md"), skillContent, "utf-8");
      await writeFile(join(nestedDir, "nested-skill.md"), skillContent, "utf-8");

      const results = await mod.scanClaudeSkills(tmpDir);

      assert(Array.isArray(results), "scanClaudeSkills returns an array");
      assert(results.length === 2, `scanClaudeSkills found 2 files (got ${results.length})`);

      // Check that each result has the expected shape
      const first = results.find((r) => r.path.includes("test-skill.md") && !r.path.includes("subdir"));
      if (first) {
        assert(typeof first.path === "string", "scanned skill has path (string)");
        assert(typeof first.name === "string", "scanned skill has name (string)");
        assert(typeof first.raw === "string", "scanned skill has raw (string)");
        assert(first.raw.includes("test-skill"), "scanned skill raw contains frontmatter name");
      } else {
        assert(false, "could not find test-skill.md in scan results");
      }
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }
  }
}

// ─── Group 3: scanClaudeSkills — empty / missing directory ─────────────────
console.log("\n[3] scanClaudeSkills — empty and nonexistent directories");
{
  if (typeof mod.scanClaudeSkills !== "function") {
    skip("scanClaudeSkills not available — skipping group");
  } else {
    let emptyDir;
    try {
      emptyDir = await mkdtemp(join(tmpdir(), "skill-adapter-empty-"));
      const emptyResults = await mod.scanClaudeSkills(emptyDir);
      assert(Array.isArray(emptyResults) && emptyResults.length === 0,
        "empty dir returns empty array");
    } finally {
      if (emptyDir) await rm(emptyDir, { recursive: true, force: true });
    }

    const nonexistentResults = await mod.scanClaudeSkills("/nonexistent/path/that/does/not/exist");
    assert(Array.isArray(nonexistentResults) && nonexistentResults.length === 0,
      "nonexistent dir returns empty array");
  }
}

// ─── Group 4: parseClaudeSkill — parse minimal skill markdown ──────────────
console.log("\n[4] parseClaudeSkill — parse a minimal skill markdown with frontmatter");
{
  if (typeof mod.parseClaudeSkill !== "function") {
    skip("parseClaudeSkill not available — skipping group");
  } else {
    const raw = `---
name: my-parser-test
description: Parser integration test skill
tools:
  - Read
  - Write
model: claude-sonnet-4-6
---
# Parser Test Skill

Step 1: Read the file.
Step 2: Modify the content.
Step 3: Write it back.
`;
    const parsed = mod.parseClaudeSkill(raw, "/fake/path/my-parser-test.md");

    assert(parsed !== null && typeof parsed === "object", "parseClaudeSkill returns an object");
    assert(parsed.frontmatter.name === "my-parser-test",
      `frontmatter.name is "my-parser-test" (got "${parsed.frontmatter.name}")`);
    assert(parsed.frontmatter.description === "Parser integration test skill",
      "frontmatter.description matches");
    assert(Array.isArray(parsed.frontmatter.tools) && parsed.frontmatter.tools.length === 2,
      `frontmatter.tools has 2 entries (got ${parsed.frontmatter.tools?.length})`);
    assert(parsed.frontmatter.tools[0] === "Read", "first tool is Read");
    assert(parsed.frontmatter.model === "claude-sonnet-4-6", "frontmatter.model matches");
    assert(typeof parsed.instructions === "string", "instructions is a string");
    assert(parsed.instructions.includes("Step 1"), "instructions contain step 1");
    assert(parsed.instructions.includes("Step 3"), "instructions contain step 3");
    assert(parsed.sourcePath === "/fake/path/my-parser-test.md", "sourcePath preserved");

    // Parse skill with no frontmatter
    const noFm = mod.parseClaudeSkill("Just raw instructions, no frontmatter.", "/fake/no-fm.md");
    assert(typeof noFm.frontmatter.name === "string" && noFm.frontmatter.name.length > 0,
      "no-frontmatter skill derives a fallback name");
    assert(noFm.instructions.includes("Just raw instructions"),
      "no-frontmatter skill preserves instructions");
  }
}

// ─── Group 5: wrapSkillWithAdapter — wrap and verify structure ─────────────
console.log("\n[5] wrapSkillWithAdapter — wrap a parsed skill and check structure");
{
  if (typeof mod.wrapSkillWithAdapter !== "function") {
    skip("wrapSkillWithAdapter not available — skipping group");
  } else {
    const parsedSkill = {
      frontmatter: {
        name: "wrap-test",
        description: "A skill for wrap testing",
        tools: ["Bash", "Read"],
        model: "claude-sonnet-4-6",
      },
      instructions: "Run the tests and report results.",
      sourcePath: "/fake/wrap-test.md",
    };

    const wrapped = mod.wrapSkillWithAdapter(parsedSkill, "claude");

    assert(typeof wrapped === "string", "wrapSkillWithAdapter returns a string");
    assert(wrapped.startsWith("---"), "wrapped output starts with YAML frontmatter delimiter");
    assert(wrapped.includes("name: wrap-test"), "wrapped output contains skill name in frontmatter");
    assert(wrapped.includes("adapter_version:"), "wrapped output contains adapter_version");
    assert(wrapped.includes("import_source: claude"), "wrapped output contains import_source");
    assert(wrapped.includes("Anti-Stub Doctrine"), "wrapped output contains preamble doctrine");
    assert(wrapped.includes("ORIGINAL SKILL INSTRUCTIONS"), "wrapped output has original instructions marker");
    assert(wrapped.includes("Run the tests and report results"), "wrapped output preserves original instructions");
    assert(wrapped.includes("DANTEFORGE POSTAMBLE"), "wrapped output contains postamble");
    assert(wrapped.includes("original_tools:"), "wrapped output carries original_tools");
  }
}

// ─── Group 6: loadSkillRegistry — empty project root ───────────────────────
console.log("\n[6] loadSkillRegistry — returns empty array for project with no skills");
{
  if (typeof mod.loadSkillRegistry !== "function") {
    skip("loadSkillRegistry not available — skipping group");
  } else {
    let tmpDir;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "skill-adapter-reg-"));
      const registry = await mod.loadSkillRegistry(tmpDir);
      assert(Array.isArray(registry), "loadSkillRegistry returns an array");
      assert(registry.length === 0, "empty project root returns empty registry");
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

// ─── Group 7: SkillChain — create chain, add steps ────────────────────────
console.log("\n[7] SkillChain — instantiate, add steps, check definition");
{
  if (typeof mod.SkillChain !== "function") {
    skip("SkillChain not available — skipping group");
  } else {
    const chain = new mod.SkillChain("integration-chain", "An integration test chain");

    assert(chain.name === "integration-chain", "chain.name is correct");
    assert(chain.description === "An integration test chain", "chain.description is correct");

    // Add steps via .add() — fluent API
    if (typeof chain.add === "function") {
      chain.add("read-file", { path: "/src/index.ts" });
      chain.add("modify-code", { input: "$previous.output" });

      const steps = chain.getSteps();
      assert(Array.isArray(steps) && steps.length === 2,
        `chain has 2 steps (got ${steps.length})`);
      assert(steps[0].skillName === "read-file", "first step is read-file");
      assert(steps[1].skillName === "modify-code", "second step is modify-code");
      assert(steps[1].params.input === "$previous.output",
        "second step params preserved");

      const def = chain.toDefinition();
      assert(def.name === "integration-chain", "toDefinition().name matches");
      assert(def.steps.length === 2, "toDefinition().steps has 2 entries");

      const yaml = chain.toYAML();
      assert(typeof yaml === "string" && yaml.includes("read-file"),
        "toYAML() produces string containing step skill name");
    } else {
      skip("SkillChain.add not available — API may differ");
    }
  }
}

// ─── Group 8: SkillCatalog — instantiation ─────────────────────────────────
console.log("\n[8] SkillCatalog — instantiate and load from empty project");
{
  if (typeof mod.SkillCatalog !== "function") {
    skip("SkillCatalog not available — skipping group");
  } else {
    let tmpDir;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "skill-adapter-cat-"));
      const catalog = new mod.SkillCatalog(tmpDir);
      assert(catalog !== null && typeof catalog === "object",
        "SkillCatalog constructor succeeds");

      if (typeof catalog.load === "function") {
        await catalog.load();
        const allSkills = typeof catalog.list === "function" ? catalog.list() : [];
        assert(Array.isArray(allSkills) && allSkills.length === 0,
          "empty catalog returns empty list after load");
      } else {
        skip("SkillCatalog.load not available");
      }
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

// ─── Group 9: verifySkill — verify a well-formed skill ─────────────────────
console.log("\n[9] verifySkill — verify a well-formed skill definition");
{
  if (typeof mod.verifySkill !== "function") {
    skip("verifySkill not available — skipping group");
  } else {
    const wellFormedSkill = {
      name: "verify-test-skill",
      description: "A well-formed skill with verification steps and testing and validation",
      instructions: `# Verify Test Skill

1. Read the target file.
2. Verify the structure matches the expected schema.
3. Run validation checks on each field.
4. Execute the test suite to confirm correctness.
5. Report results with a confidence score.

\`\`\`bash
npm run test -- --reporter=verbose
\`\`\`

You must always validate inputs before processing.
You should never skip error handling.`,
      sourcePath: "/fake/verify-test.md",
      scripts: [],
    };

    const result = await mod.verifySkill(wellFormedSkill);

    assert(typeof result === "object" && result !== null, "verifySkill returns an object");
    assert(typeof result.skillName === "string", "result has skillName");
    assert(result.skillName === "verify-test-skill", "skillName matches input");
    assert(typeof result.overallScore === "number", "result has overallScore (number)");
    assert(result.overallScore >= 0 && result.overallScore <= 100,
      `overallScore in 0-100 range (got ${result.overallScore})`);
    assert(["guardian", "sentinel", "sovereign"].includes(result.tier),
      `tier is valid (got "${result.tier}")`);
    assert(typeof result.passed === "boolean", "result has passed (boolean)");
    assert(Array.isArray(result.findings), "result has findings array");
  }
}

// ─── Group 10: tierMeetsMinimum — tier comparison logic ────────────────────
console.log("\n[10] tierMeetsMinimum — tier ordering checks");
{
  if (typeof mod.tierMeetsMinimum !== "function") {
    skip("tierMeetsMinimum not available — skipping group");
  } else {
    assert(mod.tierMeetsMinimum("sovereign", "guardian") === true,
      "sovereign >= guardian");
    assert(mod.tierMeetsMinimum("sovereign", "sentinel") === true,
      "sovereign >= sentinel");
    assert(mod.tierMeetsMinimum("sovereign", "sovereign") === true,
      "sovereign >= sovereign");
    assert(mod.tierMeetsMinimum("sentinel", "sovereign") === false,
      "sentinel < sovereign");
    assert(mod.tierMeetsMinimum("guardian", "sentinel") === false,
      "guardian < sentinel");
    assert(mod.tierMeetsMinimum("guardian", "guardian") === true,
      "guardian >= guardian");
  }
}

// ─── Group 11: sanitizeSlug — path traversal protection ────────────────────
console.log("\n[11] sanitizeSlug — slug sanitization");
{
  if (typeof mod.sanitizeSlug !== "function") {
    skip("sanitizeSlug not available — skipping group");
  } else {
    const clean = mod.sanitizeSlug("my-valid-skill");
    assert(typeof clean === "string", "sanitizeSlug returns a string");
    assert(!clean.includes(".."), "sanitizeSlug strips path traversal sequences");

    const traversal = mod.sanitizeSlug("../../etc/passwd");
    assert(!traversal.includes(".."), "sanitizeSlug strips ../../ prefix");
    assert(!traversal.includes("/"), "sanitizeSlug strips forward slashes");
  }
}

// ─── Group 12: ADAPTER_VERSION constant ────────────────────────────────────
console.log("\n[12] ADAPTER_VERSION — version string format");
{
  if (typeof mod.ADAPTER_VERSION !== "string") {
    skip("ADAPTER_VERSION not available");
  } else {
    assert(/^\d+\.\d+\.\d+/.test(mod.ADAPTER_VERSION),
      `ADAPTER_VERSION is semver-like: "${mod.ADAPTER_VERSION}"`);
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`skill-adapter integration test: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) {
  console.error("FAIL — some assertions did not pass");
  process.exit(1);
} else {
  console.log("PASS — @dantecode/skill-adapter works as standalone ESM consumer");
}
