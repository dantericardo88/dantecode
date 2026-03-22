import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { addChangeset } from "./changeset-manager.js";

describe("addChangeset", () => {
  it("creates a changeset file with frontmatter and message content", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "changeset-"));

    try {
      const result = await addChangeset(
        "minor",
        ["@dantecode/mcp", "@dantecode/git-engine"],
        "Add reactive git automation.",
        { cwd: tmpDir, id: "automation-release" },
      );

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(path.join(tmpDir, ".changeset", "automation-release.md"));

      const content = fs.readFileSync(result.filePath!, "utf-8");
      expect(content).toContain("---");
      expect(content).toContain('"@dantecode/mcp": minor');
      expect(content).toContain('"@dantecode/git-engine": minor');
      expect(content).toContain("Add reactive git automation.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
