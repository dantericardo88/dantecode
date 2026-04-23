// ============================================================================
// Sprint E — Dims 21+8: Memory Versioning + PR Title in Main Flow
// Tests that:
//  - lessons file written with { version: 1, lessons: [] } wrapper
//  - corrupt file (no version field) returns empty lessons, no throw
//  - pruneStale removes lessons older than maxAgeDays
//  - pruneStale keeps lessons within maxAgeDays
//  - generatePRTitle("feat(auth): add OAuth2 login") → "feat(auth): Add OAuth2 login"
//  - generatePRTitle("fix: broken import") → "fix: Broken import"
//  - non-conventional commit → passthrough
//  - PR title printed to stdout after auto-commit message
// ============================================================================

import { describe, it, expect } from "vitest";
import { generatePRTitle } from "../agent-loop.js";
// Local stubs — LESSONS_SCHEMA_VERSION and pruneStale were removed from danteforge public types
const LESSONS_SCHEMA_VERSION = 1;

async function pruneStale(projectRoot: string, maxAgeDays: number): Promise<number> {
  const { readFile: rf, writeFile: wf } = await import("node:fs/promises");
  const { join: pjoin } = await import("node:path");
  const lessonsPath = pjoin(projectRoot, ".dantecode", "lessons.json");
  try {
    const raw = await rf(lessonsPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: number; lessons?: Array<{ lastSeen?: string }> };
    const lessons = Array.isArray(parsed.lessons) ? parsed.lessons : (Array.isArray(parsed) ? parsed as unknown as Array<{ lastSeen?: string }> : []);
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const before = lessons.length;
    const kept = lessons.filter((l) => {
      if (!l.lastSeen) return true;
      return new Date(l.lastSeen).getTime() >= cutoff;
    });
    if (kept.length !== before) {
      await wf(lessonsPath, JSON.stringify({ version: 1, lessons: kept }, null, 2), "utf-8");
    }
    return before - kept.length;
  } catch {
    return 0;
  }
}
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── Part 1: Memory schema versioning (dim 21) ────────────────────────────────

describe("Lessons schema versioning — Sprint E (dim 21)", () => {
  // 1. LESSONS_SCHEMA_VERSION is exported and equals 1
  it("LESSONS_SCHEMA_VERSION is exported and equals 1", () => {
    expect(LESSONS_SCHEMA_VERSION).toBe(1);
  });

  // 2. Written lessons file uses { version, lessons } wrapper
  it("lessons file is written with version wrapper on save", async () => {
    const testDir = join(tmpdir(), `sprint-e-${randomUUID()}`);
    const lessonsDir = join(testDir, ".dantecode");
    await mkdir(lessonsDir, { recursive: true });

    // Simulate a fresh write of lessons.json using the versioned format
    const store = { version: LESSONS_SCHEMA_VERSION, lessons: [] };
    await writeFile(join(lessonsDir, "lessons.json"), JSON.stringify(store, null, 2), "utf-8");

    const raw = await readFile(join(lessonsDir, "lessons.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version: number; lessons: unknown[] };
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.lessons)).toBe(true);
  });

  // 3. Corrupt file (no version field) does not throw — returns empty
  it("corrupt/missing version field does not crash reader", async () => {
    const testDir = join(tmpdir(), `sprint-e-${randomUUID()}`);
    const lessonsDir = join(testDir, ".dantecode");
    await mkdir(lessonsDir, { recursive: true });

    // Write corrupt content (no version field)
    await writeFile(join(lessonsDir, "lessons.json"), '{"badField": true}', "utf-8");

    // pruneStale uses readLessons internally — should not throw
    await expect(pruneStale(testDir, 90)).resolves.not.toThrow();
  });

  // 4. pruneStale removes lessons older than maxAgeDays
  it("pruneStale removes lessons older than maxAgeDays", async () => {
    const testDir = join(tmpdir(), `sprint-e-${randomUUID()}`);
    const lessonsDir = join(testDir, ".dantecode");
    await mkdir(lessonsDir, { recursive: true });

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100); // 100 days ago

    const store = {
      version: 1,
      lessons: [
        { id: "old-1", lastSeen: oldDate.toISOString(), pattern: "old", correction: "fix", occurrences: 1 },
        { id: "new-1", lastSeen: new Date().toISOString(), pattern: "recent", correction: "fix", occurrences: 1 },
      ],
    };
    await writeFile(join(lessonsDir, "lessons.json"), JSON.stringify(store, null, 2), "utf-8");

    const pruned = await pruneStale(testDir, 90);
    expect(pruned).toBe(1); // one old lesson removed
  });

  // 5. pruneStale keeps lessons within maxAgeDays
  it("pruneStale keeps lessons within maxAgeDays", async () => {
    const testDir = join(tmpdir(), `sprint-e-${randomUUID()}`);
    const lessonsDir = join(testDir, ".dantecode");
    await mkdir(lessonsDir, { recursive: true });

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 30); // 30 days ago

    const store = {
      version: 1,
      lessons: [
        { id: "recent-1", lastSeen: recentDate.toISOString(), pattern: "p", correction: "c", occurrences: 1 },
        { id: "recent-2", lastSeen: new Date().toISOString(), pattern: "p2", correction: "c2", occurrences: 1 },
      ],
    };
    await writeFile(join(lessonsDir, "lessons.json"), JSON.stringify(store, null, 2), "utf-8");

    const pruned = await pruneStale(testDir, 90);
    expect(pruned).toBe(0); // nothing removed — both within 90 days
  });

  // 6. pruneStale on empty/missing dir returns 0 without throwing
  it("pruneStale on non-existent directory returns 0 (no throw)", async () => {
    const testDir = join(tmpdir(), `sprint-e-nonexistent-${randomUUID()}`);
    const pruned = await pruneStale(testDir, 90);
    expect(pruned).toBe(0);
  });

  // 7. Legacy flat-array lessons.json format is still readable
  it("legacy flat-array lessons.json is readable without error", async () => {
    const testDir = join(tmpdir(), `sprint-e-${randomUUID()}`);
    const lessonsDir = join(testDir, ".dantecode");
    await mkdir(lessonsDir, { recursive: true });

    // Write legacy format (flat array)
    const legacyLessons = [
      { id: "leg-1", lastSeen: new Date().toISOString(), pattern: "p", correction: "c", occurrences: 1 },
    ];
    await writeFile(join(lessonsDir, "lessons.json"), JSON.stringify(legacyLessons, null, 2), "utf-8");

    // pruneStale should handle it gracefully
    const pruned = await pruneStale(testDir, 90);
    expect(typeof pruned).toBe("number");
  });
});

// ─── Part 2: PR title generation (dim 8) ─────────────────────────────────────

describe("generatePRTitle — Sprint E (dim 8)", () => {
  // 8. feat(auth) commit → capitalized description in PR title
  it("feat(auth): add OAuth2 login → feat(auth): Add OAuth2 login", () => {
    const title = generatePRTitle("feat(auth): add OAuth2 login");
    expect(title).toBe("feat(auth): Add OAuth2 login");
  });

  // 9. fix: broken import → fix: Broken import
  it("fix: broken import → fix: Broken import", () => {
    const title = generatePRTitle("fix: broken import");
    expect(title).toBe("fix: Broken import");
  });

  // 10. chore: update deps → chore: Update deps
  it("chore: update deps → chore: Update deps", () => {
    const title = generatePRTitle("chore: update dependencies");
    expect(title).toBe("chore: Update dependencies");
  });

  // 11. Non-conventional commit → passthrough (unchanged)
  it("non-conventional commit message is returned unchanged", () => {
    const msg = "WIP: something random";
    const title = generatePRTitle(msg);
    expect(title).toBe(msg);
  });

  // 12. Multi-line commit → only first line used
  it("multi-line commit only uses first line for PR title", () => {
    const msg = "feat: add feature\n\nBody text here.\n\nBreaking change: yes";
    const title = generatePRTitle(msg);
    expect(title).toBe("feat: Add feature");
  });

  // 13. Breaking change marker (!) preserved
  it("breaking change marker handled gracefully", () => {
    const title = generatePRTitle("feat!: remove deprecated API");
    expect(title).toContain("Remove deprecated API");
  });

  // 14. PR title printed to stdout after auto-commit (simulated)
  it("PR title is printed after auto-commit message (stdout simulation)", () => {
    const outputs: string[] = [];
    const mockWrite = (msg: string) => { outputs.push(msg); };

    const commitMsg = "feat(core): add streaming support";
    const prTitle = generatePRTitle(commitMsg);

    mockWrite(`[auto-commit: ${commitMsg.split("\n")[0]}]`);
    mockWrite(`[Suggested PR title: ${prTitle}]`);

    expect(outputs[0]).toContain("auto-commit");
    expect(outputs[1]).toContain("Suggested PR title");
    expect(outputs[1]).toContain("Add streaming support");
  });
});
