/**
 * tool-runtime.test.ts — DTR Phase 1 unit tests
 *
 * Tests: state transitions, verification-checks pattern detection,
 * ArtifactStore, ToolScheduler.verifyBashArtifacts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";

import {
  TERMINAL_STATES,
  VALID_TRANSITIONS,
} from "./tool-call-types.js";
import { ArtifactStore } from "./artifact-store.js";
import {
  detectGitCloneTarget,
  detectMkdirTarget,
  detectDownloadTarget,
  inferVerificationChecks,
  formatVerificationMessage,
  runVerificationChecks,
} from "./verification-checks.js";
import { ToolScheduler } from "./tool-scheduler.js";
import { ApprovalGateway } from "./approval-gateway.js";

// ─── ToolCallStatus / transitions ─────────────────────────────────────────────

describe("ToolCallStatus state machine", () => {
  it("TERMINAL_STATES contains the 4 terminal states", () => {
    expect(TERMINAL_STATES.has("success")).toBe(true);
    expect(TERMINAL_STATES.has("error")).toBe(true);
    expect(TERMINAL_STATES.has("cancelled")).toBe(true);
    expect(TERMINAL_STATES.has("timed_out")).toBe(true);
  });

  it("terminal states have no valid transitions", () => {
    for (const s of TERMINAL_STATES) {
      expect(VALID_TRANSITIONS[s]).toHaveLength(0);
    }
  });

  it("created → validating → scheduled → executing → verifying → success chain is valid", () => {
    const chain: Array<keyof typeof VALID_TRANSITIONS> = [
      "created", "validating", "scheduled", "executing", "verifying",
    ];
    const targets = ["validating", "scheduled", "executing", "verifying", "success"];
    chain.forEach((state, i) => {
      expect(VALID_TRANSITIONS[state]).toContain(targets[i]);
    });
  });

  it("validating can transition to awaiting_approval", () => {
    expect(VALID_TRANSITIONS["validating"]).toContain("awaiting_approval");
  });

  it("awaiting_approval → scheduled is valid", () => {
    expect(VALID_TRANSITIONS["awaiting_approval"]).toContain("scheduled");
  });

  it("executing can be cancelled", () => {
    expect(VALID_TRANSITIONS["executing"]).toContain("cancelled");
  });

  it("executing can time out", () => {
    expect(VALID_TRANSITIONS["executing"]).toContain("timed_out");
  });
});

// ─── Pattern Detectors ────────────────────────────────────────────────────────

describe("detectGitCloneTarget", () => {
  it("detects simple clone with explicit dir", () => {
    expect(detectGitCloneTarget("git clone https://github.com/org/repo.git mydir")).toBe("mydir");
  });

  it("infers dir from URL when no explicit dir given", () => {
    expect(detectGitCloneTarget("git clone https://github.com/org/qwen-code.git")).toBe("qwen-code");
  });

  it("strips --depth flag", () => {
    expect(detectGitCloneTarget("git clone --depth 1 https://github.com/org/repo.git out")).toBe("out");
  });

  it("strips --branch flag", () => {
    expect(detectGitCloneTarget("git clone --branch main https://github.com/org/repo.git dest")).toBe("dest");
  });

  it("strips -q flag", () => {
    expect(detectGitCloneTarget("git clone -q https://github.com/org/repo.git dest")).toBe("dest");
  });

  it("returns null for non-clone commands", () => {
    expect(detectGitCloneTarget("git status")).toBeNull();
    expect(detectGitCloneTarget("npm install")).toBeNull();
    expect(detectGitCloneTarget("")).toBeNull();
  });

  it("strips .git suffix when inferring dir", () => {
    expect(detectGitCloneTarget("git clone https://github.com/org/my-project.git")).toBe("my-project");
  });
});

describe("detectMkdirTarget", () => {
  it("detects mkdir -p", () => {
    expect(detectMkdirTarget("mkdir -p packages/core/src/tool-runtime")).toBe("packages/core/src/tool-runtime");
  });

  it("detects simple mkdir", () => {
    expect(detectMkdirTarget("mkdir newdir")).toBe("newdir");
  });

  it("returns null for non-mkdir", () => {
    expect(detectMkdirTarget("ls -la")).toBeNull();
  });
});

describe("detectDownloadTarget", () => {
  it("detects curl -o", () => {
    expect(detectDownloadTarget("curl -o myfile.tar.gz https://example.com/file.tar.gz")).toBe("myfile.tar.gz");
  });

  it("detects curl --output", () => {
    expect(detectDownloadTarget("curl --output archive.zip https://example.com/a.zip")).toBe("archive.zip");
  });

  it("detects wget -O", () => {
    expect(detectDownloadTarget("wget -O myfile.zip https://example.com/file.zip")).toBe("myfile.zip");
  });

  it("returns null for unrecognized commands", () => {
    expect(detectDownloadTarget("npm install")).toBeNull();
  });
});

describe("inferVerificationChecks", () => {
  it("detects git clone and returns 2 checks", () => {
    const results = inferVerificationChecks("git clone https://github.com/org/repo.git myrepo");
    expect(results).toHaveLength(1);
    expect(results[0]!.artifact).toBe("git_clone");
    expect(results[0]!.target).toBe("myrepo");
    expect(results[0]!.checks).toHaveLength(2); // directory_exists + git_repo_valid
  });

  it("detects download and returns 2 checks", () => {
    const results = inferVerificationChecks("curl -o myfile.zip https://example.com/a.zip");
    expect(results).toHaveLength(1);
    expect(results[0]!.artifact).toBe("download");
    expect(results[0]!.checks.some((c) => c.kind === "file_size_nonzero")).toBe(true);
  });

  it("detects mkdir and returns 1 check", () => {
    const results = inferVerificationChecks("mkdir -p packages/foo/src");
    expect(results).toHaveLength(1);
    expect(results[0]!.artifact).toBe("directory_create");
    expect(results[0]!.checks[0]!.kind).toBe("directory_exists");
  });

  it("returns empty array for non-artifact commands", () => {
    expect(inferVerificationChecks("npm run typecheck")).toHaveLength(0);
    expect(inferVerificationChecks("git status")).toHaveLength(0);
  });

  it("handles multi-command strings with &&", () => {
    const results = inferVerificationChecks(
      "mkdir -p mydir && git clone https://github.com/org/r.git myrepo",
    );
    expect(results.length).toBeGreaterThanOrEqual(2);
    const kinds = results.map((r) => r.artifact);
    expect(kinds).toContain("directory_create");
    expect(kinds).toContain("git_clone");
  });
});

// ─── runVerificationChecks ────────────────────────────────────────────────────

describe("runVerificationChecks", () => {
  const tmpRoot = "/tmp/dtr-test-" + Date.now();

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("passes file_exists check for an existing file", async () => {
    const filePath = tmpRoot + "/testfile.txt";
    fs.writeFileSync(filePath, "hello");
    const result = await runVerificationChecks(
      [{ kind: "file_exists", path: filePath }],
      tmpRoot,
    );
    expect(result.passed).toBe(true);
  });

  it("fails file_exists check for a missing file", async () => {
    const result = await runVerificationChecks(
      [{ kind: "file_exists", path: tmpRoot + "/nonexistent.txt" }],
      tmpRoot,
    );
    expect(result.passed).toBe(false);
    expect(result.failedChecks).toHaveLength(1);
  });

  it("passes directory_exists check for an existing directory", async () => {
    const dir = tmpRoot + "/subdir";
    fs.mkdirSync(dir);
    const result = await runVerificationChecks(
      [{ kind: "directory_exists", path: dir }],
      tmpRoot,
    );
    expect(result.passed).toBe(true);
  });

  it("fails directory_exists check for missing directory", async () => {
    const result = await runVerificationChecks(
      [{ kind: "directory_exists", path: tmpRoot + "/nodir" }],
      tmpRoot,
    );
    expect(result.passed).toBe(false);
  });

  it("passes file_size_nonzero for non-empty file", async () => {
    const filePath = tmpRoot + "/nonempty.txt";
    fs.writeFileSync(filePath, "content here");
    const result = await runVerificationChecks(
      [{ kind: "file_size_nonzero", path: filePath }],
      tmpRoot,
    );
    expect(result.passed).toBe(true);
  });

  it("fails file_size_nonzero for empty file", async () => {
    const filePath = tmpRoot + "/empty.txt";
    fs.writeFileSync(filePath, "");
    const result = await runVerificationChecks(
      [{ kind: "file_size_nonzero", path: filePath }],
      tmpRoot,
    );
    expect(result.passed).toBe(false);
  });

  it("passes git_repo_valid for directory with .git", async () => {
    const repoDir = tmpRoot + "/fakerepo";
    fs.mkdirSync(repoDir + "/.git", { recursive: true });
    const result = await runVerificationChecks(
      [{ kind: "git_repo_valid", path: repoDir }],
      tmpRoot,
    );
    expect(result.passed).toBe(true);
  });

  it("fails git_repo_valid when .git is missing", async () => {
    const noRepoDir = tmpRoot + "/notrepo";
    fs.mkdirSync(noRepoDir, { recursive: true });
    const result = await runVerificationChecks(
      [{ kind: "git_repo_valid", path: noRepoDir }],
      tmpRoot,
    );
    expect(result.passed).toBe(false);
  });

  it("resolves relative paths against projectRoot", async () => {
    const filePath = tmpRoot + "/rel.txt";
    fs.writeFileSync(filePath, "relative test");
    // Pass relative path, expect it to be joined with tmpRoot
    const result = await runVerificationChecks(
      [{ kind: "file_exists", path: "rel.txt" }],
      tmpRoot,
    );
    expect(result.passed).toBe(true);
  });
});

// ─── formatVerificationMessage ────────────────────────────────────────────────

describe("formatVerificationMessage", () => {
  it("returns success message when all passed", async () => {
    const tmpRoot2 = "/tmp/dtr-fmt-" + Date.now();
    fs.mkdirSync(tmpRoot2, { recursive: true });
    const filePath = tmpRoot2 + "/f.txt";
    fs.writeFileSync(filePath, "x");
    const result = await runVerificationChecks(
      [{ kind: "file_exists", path: filePath }],
      tmpRoot2,
    );
    const msg = formatVerificationMessage(result, "Write");
    expect(msg).toContain("✓");
    fs.rmSync(tmpRoot2, { recursive: true, force: true });
  });

  it("returns failure message with DTR-VERIFY prefix when failed", () => {
    const result = {
      passed: false,
      checks: [{ check: { kind: "file_exists" as const, path: "/missing/file.ts" }, passed: false, errorMessage: "File not found" }],
      failedChecks: [{ check: { kind: "file_exists" as const, path: "/missing/file.ts" }, passed: false, errorMessage: "File not found" }],
    };
    const msg = formatVerificationMessage(result, "Write(/missing/file.ts)");
    expect(msg).toContain("[DTR-VERIFY]");
    expect(msg).toContain("VERIFICATION FAILED");
    expect(msg).toContain("Do NOT proceed");
  });
});

// ─── ArtifactStore ────────────────────────────────────────────────────────────

describe("ArtifactStore", () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = new ArtifactStore();
  });

  it("records artifact and assigns id + createdAt", () => {
    const rec = store.record({
      kind: "git_clone",
      path: "/tmp/myrepo",
      toolCallId: "call_1",
    });
    expect(rec.id).toBeTruthy();
    expect(rec.kind).toBe("git_clone");
    expect(rec.verified).toBe(false);
    expect(rec.createdAt).toBeGreaterThan(0);
  });

  it("markVerified sets verified + verifiedAt", () => {
    const rec = store.record({ kind: "file_write", path: "/tmp/f.ts", toolCallId: "c2" });
    store.markVerified(rec.id);
    expect(store.get(rec.id)?.verified).toBe(true);
    expect(store.get(rec.id)?.verifiedAt).toBeGreaterThan(0);
  });

  it("getByKind filters correctly", () => {
    store.record({ kind: "git_clone", path: "/a", toolCallId: "c1" });
    store.record({ kind: "file_write", path: "/b", toolCallId: "c2" });
    expect(store.getByKind("git_clone")).toHaveLength(1);
    expect(store.getByKind("file_write")).toHaveLength(1);
  });

  it("unverifiedCount tracks correctly", () => {
    const r1 = store.record({ kind: "git_clone", path: "/a", toolCallId: "c1" });
    store.record({ kind: "file_write", path: "/b", toolCallId: "c2" });
    expect(store.unverifiedCount()).toBe(2);
    store.markVerified(r1.id);
    expect(store.unverifiedCount()).toBe(1);
  });

  it("serialize / restore round-trips", () => {
    store.record({ kind: "download", path: "/downloads/f.zip", toolCallId: "c3" });
    const data = store.serialize();
    const store2 = new ArtifactStore();
    store2.restore(data);
    expect(store2.all()).toHaveLength(1);
    expect(store2.all()[0]!.kind).toBe("download");
  });

  it("clear removes all records", () => {
    store.record({ kind: "git_clone", path: "/a", toolCallId: "c1" });
    store.clear();
    expect(store.all()).toHaveLength(0);
  });
});

// ─── ToolScheduler ────────────────────────────────────────────────────────────

describe("ToolScheduler", () => {
  let scheduler: ToolScheduler;

  beforeEach(() => {
    scheduler = new ToolScheduler();
  });

  it("submit creates a record in 'validating' state", () => {
    const rec = scheduler.submit("Bash", { command: "ls" }, "req_1");
    expect(rec.status).toBe("validating");
    expect(rec.statusHistory).toHaveLength(2); // created → validating
  });

  it("isRunning returns false before any schedule()", () => {
    scheduler.submit("Bash", { command: "ls" }, "req_1");
    // Not scheduled yet
    expect(scheduler.isRunning()).toBe(false);
  });

  it("schedule transitions validating → scheduled → executing and sets isRunning()", () => {
    const rec = scheduler.submit("Bash", { command: "ls" }, "req_1");
    scheduler.schedule(rec.id);
    const updated = scheduler.get(rec.id)!;
    expect(updated.status).toBe("executing");
    expect(scheduler.isRunning()).toBe(true);
  });

  it("complete transitions executing → success and clears isRunning()", async () => {
    const rec = scheduler.submit("Bash", { command: "ls" }, "req_1");
    scheduler.schedule(rec.id);
    await scheduler.complete(rec.id, { content: "ok", isError: false });
    const updated = scheduler.get(rec.id)!;
    expect(updated.status).toBe("success");
    expect(scheduler.isRunning()).toBe(false);
  });

  it("cancel transitions to cancelled and clears isRunning()", () => {
    const rec = scheduler.submit("Bash", { command: "ls" }, "req_1");
    scheduler.schedule(rec.id);
    scheduler.cancel(rec.id, "user cancelled");
    expect(scheduler.get(rec.id)!.status).toBe("cancelled");
    expect(scheduler.isRunning()).toBe(false);
  });

  it("error transitions to error state", () => {
    const rec = scheduler.submit("Bash", { command: "bad" }, "req_1");
    scheduler.schedule(rec.id);
    scheduler.error(rec.id, "timeout after 120s");
    expect(scheduler.get(rec.id)!.status).toBe("error");
    expect(scheduler.get(rec.id)!.errorMessage).toBe("timeout after 120s");
  });

  it("does not transition from terminal states", () => {
    const rec = scheduler.submit("Bash", { command: "ls" }, "req_1");
    scheduler.schedule(rec.id);
    scheduler.error(rec.id, "some error");
    // Attempt to transition again — should be a no-op
    scheduler.error(rec.id, "double error");
    expect(scheduler.get(rec.id)!.status).toBe("error");
  });

  it("emits stateChange event on each transition", () => {
    const changes: string[] = [];
    scheduler.on("stateChange", (record, prev) => {
      changes.push(`${prev}→${record.status}`);
    });
    const rec = scheduler.submit("Bash", { command: "ls" }, "req_1");
    scheduler.schedule(rec.id);
    expect(changes).toContain("created→validating");
    expect(changes).toContain("validating→scheduled");
    expect(changes).toContain("scheduled→executing");
  });

  it("verifyBashArtifacts returns null for non-artifact commands", async () => {
    const msg = await scheduler.verifyBashArtifacts("npm run typecheck", "/tmp");
    expect(msg).toBeNull();
  });

  it("verifyBashArtifacts returns warning message when git clone target does not exist", async () => {
    const msg = await scheduler.verifyBashArtifacts(
      "git clone https://github.com/org/repo.git nonexistent-repo-xyz",
      "/tmp",
    );
    expect(msg).toBeTruthy();
    expect(msg).toContain("[DTR-VERIFY]");
    expect(msg).toContain("nonexistent-repo-xyz");
  });

  it("verifyBashArtifacts returns null when all artifacts verified (directory present)", async () => {
    // Use /tmp which always exists — but that won't have .git, so use a real tmpdir
    const tmpDir = "/tmp/dtr-sched-test-" + Date.now();
    fs.mkdirSync(tmpDir + "/.git", { recursive: true });
    const msg = await scheduler.verifyBashArtifacts(
      `git clone https://example.com/r.git ${tmpDir}`,
      "/tmp",
    );
    // Should pass because directory + .git both exist
    expect(msg).toBeNull();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("verifyWriteArtifact returns null when file exists", async () => {
    const tmpFile = "/tmp/dtr-write-test-" + Date.now() + ".ts";
    fs.writeFileSync(tmpFile, "export {}");
    const msg = await scheduler.verifyWriteArtifact(tmpFile, "/tmp");
    expect(msg).toBeNull();
    fs.rmSync(tmpFile);
  });

  it("verifyWriteArtifact returns warning when file missing", async () => {
    const msg = await scheduler.verifyWriteArtifact("/tmp/definitely-not-written-xyz.ts", "/tmp");
    expect(msg).toBeTruthy();
    expect(msg).toContain("[DTR-VERIFY]");
  });

  it("approval gateway: auto_approve when gateway disabled", () => {
    const gateway = new ApprovalGateway({ enabled: false });
    const decision = gateway.check("Bash", { command: "git push --force" });
    expect(decision.decision).toBe("auto_approve");
  });

  it("approval gateway: requires_approval for configured tool", () => {
    const gateway = new ApprovalGateway({
      enabled: true,
      rules: [
        {
          reason: "Push requires approval",
          tools: ["Bash"],
          pathPatterns: [/\bgit\s+push\s+.*--force\b/],
          decision: "requires_approval",
        },
      ],
    });
    const decision = gateway.check("Bash", { command: "git push origin main --force" });
    expect(decision.decision).toBe("requires_approval");
    expect(decision.reason).toContain("approval");
  });
});
