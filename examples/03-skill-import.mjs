// 03-skill-import.mjs — Importing a Claude-style skill bundle.
//
// DanteCode's skill-adapter parses Claude/Continue/OpenCode bundles into a
// shared Skill shape. SkillBridge bundles include conversion metadata
// (green/amber/red bucket) that the wave orchestrator uses to warn users
// about runtime gaps before activating the skill.
// Run: node examples/03-skill-import.mjs

import { parseSkillBridgeBundle } from "../packages/skill-adapter/dist/index.js";

const fixture = {
  manifest: {
    schemaVersion: "1.0.0",
    sourceFormat: "claude-skill",
    skillId: "demo.example",
    skillName: "Demo Example",
    classification: "green",
    conversionScore: 0.92,
    runtimeWarnings: [],
    capabilities: ["Read", "Write", "Bash"],
  },
  skill: {
    id: "demo.example",
    name: "Demo Example",
    description: "Tiny example skill that prints 'hello' and exits.",
    instructions: "Print 'hello' to stdout and return.",
    metadata: { author: "examples" },
  },
};

const result = parseSkillBridgeBundle(JSON.stringify(fixture));
if (!result.ok) {
  console.error(`Parse failed: ${result.error}`);
  process.exit(1);
}

const { skill, manifest, bucket } = result;
console.log(`Imported skill: ${skill.name} (${skill.id})`);
console.log(`  Bucket: ${bucket}`);
console.log(`  Classification: ${manifest.classification}`);
console.log(`  Conversion score: ${manifest.conversionScore}`);
console.log(`  Capabilities: ${manifest.capabilities.join(", ")}`);
console.log(`  Runtime warnings: ${manifest.runtimeWarnings.length === 0 ? "(none)" : manifest.runtimeWarnings.join(", ")}`);

console.log("\nGreen-bucket skills activate without warnings. Amber/red bundles");
console.log("trigger a preamble injected by buildBridgeWarningPreamble() before");
console.log("the wave orchestrator runs the skill — so the model knows up front");
console.log("that some capabilities may be unsupported in this runtime.");
