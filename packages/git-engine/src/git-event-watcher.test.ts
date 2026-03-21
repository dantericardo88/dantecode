import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { GitEventWatcher, listGitWatchers } from "./git-event-watcher.js";

describe("GitEventWatcher", () => {
  let tmpDir: string | undefined;
  let watcher: GitEventWatcher | undefined;

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("emits post-commit events and persists watcher state", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-watch-"));
    const eventDir = path.join(tmpDir, "events");
    const markerPath = path.join(eventDir, "post-commit.log");
    fs.mkdirSync(eventDir, { recursive: true });
    fs.writeFileSync(markerPath, "initial\n", "utf-8");

    watcher = new GitEventWatcher({ cwd: tmpDir, debounceMs: 25 });
    watcher.watch("post-commit", "events/post-commit.log");

    const eventPromise = new Promise<{ type: string; data: { hook: string } }>((resolve) => {
      watcher?.once("event", (event) => resolve(event as { type: string; data: { hook: string } }));
    });

    fs.appendFileSync(markerPath, "second\n", "utf-8");

    const event = await eventPromise;
    expect(event.type).toBe("post-commit");
    expect(event.data.hook).toBe("post-commit");
    await watcher.flush();

    const records = await listGitWatchers(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.eventCount).toBe(1);
    expect(records[0]?.recentEvents[0]?.summary).toContain("Hook triggered");
  });

  it("emits file-change events for watched files", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-watch-file-"));
    const srcDir = path.join(tmpDir, "src");
    const testFile = path.join(srcDir, "index.ts");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(testFile, "export const value = 1;\n", "utf-8");

    watcher = new GitEventWatcher({ cwd: tmpDir, debounceMs: 25 });
    watcher.watch("file-change", "src");

    const eventPromise = new Promise<{ data: { file: string; relativePath: string } }>(
      (resolve) => {
        watcher?.once("event", (event) => {
          resolve(event as { data: { file: string; relativePath: string } });
        });
      },
    );

    fs.writeFileSync(testFile, "export const value = 2;\n", "utf-8");

    const event = await eventPromise;
    expect(event.data.file).toBe("index.ts");
    expect(event.data.relativePath).toContain("src");
    await watcher.flush();
  });
});
