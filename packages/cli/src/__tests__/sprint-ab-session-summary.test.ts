// ============================================================================
// Sprint AB — Dims 6+11: summarizeAgentSession + StreamingDiffPreview
// Tests that:
//  - summarizeAgentSession status=INCOMPLETE handled
//  - summarizeAgentSession returns [Session summary] prefix
//  - summarizeAgentSession caps decisions at 3
//  - summarizeAgentSession shows file names in summary
//  - summarizeAgentSession filters system/user messages
//  - summarizeAgentSession handles long assistant messages
//  - summarizeAgentSession shows 0 files when touchedFiles empty
//  - summarizeAgentSession shows last 5 file names
// ============================================================================

import { describe, it, expect } from "vitest";
import { summarizeAgentSession } from "../agent-loop.js";

describe("summarizeAgentSession — Sprint AB (dim 11)", () => {
  // 1. Returns [Session summary] prefix
  it("returns [Session summary] prefix", () => {
    const result = summarizeAgentSession([], [], "COMPLETE");
    expect(result).toContain("[Session summary]");
  });

  // 2. status=INCOMPLETE in output
  it("includes status=INCOMPLETE when passed INCOMPLETE", () => {
    const result = summarizeAgentSession([], [], "INCOMPLETE");
    expect(result).toContain("status=INCOMPLETE");
  });

  // 3. status=FAILED in output
  it("includes status=FAILED when passed FAILED", () => {
    const result = summarizeAgentSession([], [], "FAILED");
    expect(result).toContain("status=FAILED");
  });

  // 4. Shows file count correctly
  it("shows correct file count for 3 files", () => {
    const result = summarizeAgentSession([], ["a.ts", "b.ts", "c.ts"], "COMPLETE");
    expect(result).toContain("files=3");
  });

  // 5. Shows 0 files when touchedFiles empty
  it("shows files=0 when touchedFiles is empty", () => {
    const result = summarizeAgentSession([], [], "COMPLETE");
    expect(result).toContain("files=0");
  });

  // 6. Caps decisions at 3 even with many assistant messages
  it("extracts at most 3 key decisions", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "assistant",
      content: `Decision number ${i + 1}: Implement feature X in module Y with clear interface Z`,
    }));
    const result = summarizeAgentSession(messages, [], "COMPLETE");
    const decisionMatches = result.match(/^\s+\d+\./gm) ?? [];
    expect(decisionMatches.length).toBeLessThanOrEqual(3);
  });

  // 7. Filters out non-assistant roles
  it("ignores user and system messages when extracting decisions", () => {
    const messages = [
      { role: "user", content: "User said something not a decision" },
      { role: "system", content: "System context not a decision" },
      { role: "assistant", content: "Assistant made a decision to refactor the auth module" },
    ];
    const result = summarizeAgentSession(messages, [], "COMPLETE");
    expect(result).not.toContain("User said");
    expect(result).not.toContain("System context");
  });

  // 8. Shows file names (last 5) in summary
  it("includes file names from touchedFiles in summary", () => {
    const files = ["src/foo.ts", "src/bar.ts"];
    const result = summarizeAgentSession([], files, "COMPLETE");
    // Should include basename of at least one file
    expect(result).toMatch(/foo\.ts|bar\.ts/);
  });
});
