// 04-tool-runtime.mjs — Verifying that a tool's claimed effects actually happened.
//
// When a model emits a Bash tool call like `git clone <url> mydir`, the model
// can fabricate success even when the command failed silently. The deterministic
// tool runtime verifies the claim by checking the filesystem afterward — if the
// directory doesn't exist, the call is reported as failed regardless of what
// the model "saw."
// Run: node examples/04-tool-runtime.mjs

import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyBashArtifacts } from "../packages/core/dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "dc-example-"));
console.log(`Working in ${dir}`);

try {
  // Simulate Case 1: The model claimed to mkdir 'real-dir' AND the dir exists.
  const realDir = join(dir, "real-dir");
  writeFileSync(join(dir, "marker"), "x");  // sibling marker
  // (in real life Bash created realDir; here we create it ourselves)
  writeFileSync(join(realDir + ".keep"), ""); // not a dir
  await import("node:fs/promises").then((fs) => fs.mkdir(realDir));

  const ok = await verifyBashArtifacts({
    command: `mkdir ${realDir}`,
    cwd: dir,
  });
  console.log(`Case 1 — real mkdir: verification=${ok.allArtifactsExist ? "PASS" : "FAIL"}`);

  // Simulate Case 2: The model claimed to mkdir 'fake-dir' but it never happened.
  const fakeDir = join(dir, "fake-dir");
  const fail = await verifyBashArtifacts({
    command: `mkdir ${fakeDir}`,
    cwd: dir,
  });
  console.log(`Case 2 — fake mkdir: verification=${fail.allArtifactsExist ? "PASS" : "FAIL"}`);
  console.log(`  missing artifacts: ${fail.missingArtifacts?.join(", ") ?? "(none)"}`);

  console.log("\nThe tool runtime catches model fabrication: when the model claims");
  console.log("a side effect that didn't actually happen, the verification step");
  console.log("flags it before the result is appended to the conversation, so the");
  console.log("model is forced to retry instead of building on a phantom success.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
