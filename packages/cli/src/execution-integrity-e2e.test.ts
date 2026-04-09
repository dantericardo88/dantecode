import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { executionIntegrity, ToolClass } from "@dantecode/core";
import { parseJsonRecord, parseToolCallPayload } from "./tool-call-parser.js";
import { repairMalformedJsonPayload } from "./provider-normalization.js";

// Import the tools but we need to mock/stub out parts or just call the handlers if they are exported.
// Wait, the tools in `tools.ts` are mostly not exported individually, but executed via `executeTool`.
import { executeTool } from "./tools.js";

describe("Execution Integrity E2E (V+E Masterplan)", () => {
  let projectRoot: string;
  let sessionId: string;
  
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-integ-test-"));
    sessionId = "test-session-" + Date.now();
    
    // Initialize ledger for this session
    executionIntegrity.startSession(sessionId, "msg-0", "code");
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("GF-4 (Stale-read trap): Agent edit fails if file was externally modified after read", async () => {
    const testFile = "target.ts";
    const absPath = join(projectRoot, testFile);
    
    // 1. Initial creation
    await writeFile(absPath, "function test() { return 1; }", "utf-8");
    
    const readResult = await executeTool(
      "Read", 
      { file_path: testFile }, 
      projectRoot, 
      sessionId
    );
    expect(readResult.isError).toBe(false);

    // Simulate Agent Loop recording the read tool
    executionIntegrity.recordToolCall(sessionId, "msg-1", {
      toolClass: ToolClass.READ_ONLY,
      toolName: "Read",
      calledAt: new Date().toISOString(),
      arguments: { file_path: testFile },
      result: readResult,
    });
    console.log("DEBUG STATE:", (executionIntegrity as any).fileState.get(testFile));
    
    
    // Wait slightly to ensure mtime changes
    await new Promise(r => setTimeout(r, 10));

    // 3. EXTERNAL MUTATION (simulating another process, or user editing)
    await writeFile(absPath, "function test() { return 2; }", "utf-8");
    
    // 4. Agent attempts to Edit the file
    const editResult = await executeTool(
      "Edit", 
      { 
        file_path: testFile, 
        old_string: "return 1;", 
        new_string: "return 3;" 
      }, 
      projectRoot, 
      sessionId
    );
    
    // 5. Verification -> Expect rejection!
    // The read limit / stale-read protection should have kicked in
    expect(editResult.isError).toBe(true);
    expect(editResult.content).toContain("stale read protection");
    expect(editResult.content).toContain("Re-run Read");
  });

  it("GF-5 (Provider Canonicalization): Grok malformed JSON chunks are transparently repaired", () => {
    // A typical Grok failure where it streams unescaped quotes or missing closing braces
    const malformedChunk = `{
      "name": "Write",
      "input": {
        "file_path": "src/app.ts",
        "content": "const a = \\"quoted\\"; console.log(a);"
    `; 

    // Directly test the parsing logic which now hooks into provider-normalization
    const result = parseToolCallPayload(malformedChunk);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Write");
      expect((result.data.input as any).content).toContain("const a = \"quoted\"; console.log(a);");
    }
  });

  it("GF-6 (Provider thought injection): Remove <thought> blocks inside JSON", () => {
    const malformedWithThought = `{
      "name": "Bash",
      <thought>
      I need to compile first.
      </thought>
      "input": {
        "command": "npm run build"
      }
    }`;
    
    const result = parseToolCallPayload(malformedWithThought);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Bash");
      expect((result.data.input as any).command).toBe("npm run build");
    }
  });
});
