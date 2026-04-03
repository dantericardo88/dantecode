// ============================================================================
// FileBridgeAdapter — Unit Tests
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { FileBridgeAdapter } from "./file-bridge.js";
import type { CouncilTaskPacket } from "../council-types.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const testDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = join(tmpdir(), `fb-test-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  testDirs.push(dir);
  return dir;
}

function makePacket(overrides: Partial<CouncilTaskPacket> = {}): CouncilTaskPacket {
  return {
    packetId: randomUUID(),
    runId: "test-run-1",
    laneId: "lane-a",
    objective: "Test objective",
    taskCategory: "coding",
    ownedFiles: ["src/foo.ts"],
    readOnlyFiles: [],
    forbiddenFiles: [],
    contractDependencies: [],
    worktreePath: "/tmp/worktree",
    branch: "feat/test",
    baseBranch: "main",
    assumptions: [],
    ...overrides,
  };
}

afterEach(async () => {
  for (const dir of testDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  }
});

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("FileBridgeAdapter", () => {
  it("submitTask writes task.md and packet.json to inbox sessionDir", async () => {
    const bridgeDir = await makeTmpDir();
    const adapter = new FileBridgeAdapter(bridgeDir);
    const packet = makePacket();

    const submission = await adapter.submitTask(packet);

    expect(submission.accepted).toBe(true);
    expect(submission.sessionId).toBeTruthy();
    expect(typeof submission.sessionId).toBe("string");

    const taskMd = await readFile(
      join(bridgeDir, "inbox", submission.sessionId, "task.md"),
      "utf-8",
    );
    expect(typeof taskMd).toBe("string");
    expect(taskMd.length).toBeGreaterThan(0);

    const rawPacket = await readFile(
      join(bridgeDir, "inbox", submission.sessionId, "packet.json"),
      "utf-8",
    );
    const written = JSON.parse(rawPacket) as CouncilTaskPacket;

    expect(written.runId).toBe(packet.runId);
    expect(written.laneId).toBe(packet.laneId);
    expect(written.objective).toBe(packet.objective);
    expect(written.ownedFiles).toEqual(packet.ownedFiles);
  });

  it("pollStatus returns running when outbox done.json absent", async () => {
    const bridgeDir = await makeTmpDir();
    const adapter = new FileBridgeAdapter(bridgeDir);
    const packet = makePacket();

    const submission = await adapter.submitTask(packet);
    const status = await adapter.pollStatus(submission.sessionId);

    expect(status.sessionId).toBe(submission.sessionId);
    expect(status.status).toBe("running");
  });

  it("pollStatus returns completed when outbox done.json has success:true", async () => {
    const bridgeDir = await makeTmpDir();
    const adapter = new FileBridgeAdapter(bridgeDir);
    const packet = makePacket();

    const submission = await adapter.submitTask(packet);
    const sessionDir = join(bridgeDir, "outbox", submission.sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "done.json"),
      JSON.stringify({ success: true, exitCode: 0, completedAt: new Date().toISOString() }),
      "utf-8",
    );

    const status = await adapter.pollStatus(submission.sessionId);

    expect(status.sessionId).toBe(submission.sessionId);
    expect(status.status).toBe("completed");
    expect(status.lastOutputAt).toBeTruthy();
  });

  it("pollStatus returns failed when outbox done.json has success:false with error", async () => {
    const bridgeDir = await makeTmpDir();
    const adapter = new FileBridgeAdapter(bridgeDir);
    const packet = makePacket();

    const submission = await adapter.submitTask(packet);
    const sessionDir = join(bridgeDir, "outbox", submission.sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "done.json"),
      JSON.stringify({ success: false, error: "typecheck failed" }),
      "utf-8",
    );

    const status = await adapter.pollStatus(submission.sessionId);

    expect(status.sessionId).toBe(submission.sessionId);
    expect(status.status).toBe("failed");
    // error is surfaced via spread — AdapterStatus doesn't formally have an
    // error field, so we check the raw object to verify the value is present.
    const raw = status as unknown as Record<string, unknown>;
    expect(raw["error"]).toBe("typecheck failed");
  });

  it("collectPatch reads patch.diff and parses changedFiles", async () => {
    const bridgeDir = await makeTmpDir();
    const adapter = new FileBridgeAdapter(bridgeDir);
    const packet = makePacket();

    const submission = await adapter.submitTask(packet);
    const sessionDir = join(bridgeDir, "outbox", submission.sessionId);
    await mkdir(sessionDir, { recursive: true });

    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index 0000000..1111111 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,1 +1,2 @@",
      " export const x = 1;",
      "+export const y = 2;",
      "diff --git a/src/bar.ts b/src/bar.ts",
      "index 0000000..2222222 100644",
      "--- a/src/bar.ts",
      "+++ b/src/bar.ts",
      "@@ -1,1 +1,2 @@",
      " export const a = 1;",
      "+export const b = 2;",
    ].join("\n");

    await writeFile(join(sessionDir, "patch.diff"), diff, "utf-8");

    const patch = await adapter.collectPatch(submission.sessionId);

    expect(patch).not.toBeNull();
    expect(patch!.sessionId).toBe(submission.sessionId);
    expect(patch!.unifiedDiff).toBe(diff);
    expect(patch!.changedFiles).toContain("src/foo.ts");
    expect(patch!.changedFiles).toContain("src/bar.ts");
    expect(patch!.changedFiles).toHaveLength(2);
  });

  it("getResultPath returns outbox path for done.json", async () => {
    const bridgeDir = await makeTmpDir();
    const adapter = new FileBridgeAdapter(bridgeDir);
    const expected = join(bridgeDir, "outbox", "abc123", "done.json");
    expect(adapter.getResultPath("abc123")).toBe(expected);
  });

  it("getPatchPath returns outbox path for patch.diff", async () => {
    const bridgeDir = await makeTmpDir();
    const adapter = new FileBridgeAdapter(bridgeDir);
    const expected = join(bridgeDir, "outbox", "abc123", "patch.diff");
    expect(adapter.getPatchPath("abc123")).toBe(expected);
  });
});
