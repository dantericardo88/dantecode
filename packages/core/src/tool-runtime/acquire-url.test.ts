import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globalArtifactStore } from "./artifact-store.js";
import { acquireUrl } from "./acquire-url.js";
import { ToolScheduler } from "./tool-scheduler.js";

describe("AcquireUrl integration", () => {
  let projectRoot = "";
  let server: Server | undefined;
  let baseUrl = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-acquire-url-"));
    globalArtifactStore.clear();

    server = createServer((_req, res) => {
      const body = "verified runtime artifact\n".repeat(8);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(body);
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP test server address.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    globalArtifactStore.clear();

    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = "";
    }
  });

  it("downloads a file and registers a verified artifact", async () => {
    const result = await acquireUrl({
      url: `${baseUrl}/artifact.txt`,
      dest: "external/artifact.txt",
      projectRoot,
    });

    expect(result.success).toBe(true);
    expect(result.isError).toBe(false);
    expect(result.localPath).toContain("external");
    expect(result.sizeBytes).toBeGreaterThan(64);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

    const saved = await readFile(result.localPath!, "utf-8");
    expect(saved).toContain("verified runtime artifact");

    const artifact = globalArtifactStore.get(result.artifactId!);
    expect(artifact?.kind).toBe("download");
    expect(artifact?.verified).toBe(true);
    expect(artifact?.path).toBe(result.localPath);
  });

  it("supports AcquireUrl -> Read as a scheduler-owned golden flow", async () => {
    const scheduler = new ToolScheduler(undefined, undefined, {
      policies: [
        { tool: "AcquireUrl", executionClass: "acquire", verifyAfterExecution: true },
        { tool: "Read", executionClass: "read_only", dependsOn: ["AcquireUrl"] },
      ],
    });

    const results = await scheduler.executeBatch(
      [
        {
          id: "acquire-call",
          toolName: "AcquireUrl",
          input: {
            url: `${baseUrl}/spec.txt`,
            dest: "external/spec.txt",
          },
        },
        {
          id: "read-call",
          toolName: "Read",
          input: {
            file_path: "external/spec.txt",
          },
        },
      ],
      {
        requestId: "req-gf-01",
        projectRoot,
        execute: async (request) => {
          if (request.toolName === "AcquireUrl") {
            return acquireUrl({
              url: String(request.input["url"]),
              dest: String(request.input["dest"]),
              projectRoot,
            });
          }

          const content = await readFile(
            join(projectRoot, String(request.input["file_path"])),
            "utf-8",
          );
          return {
            content,
            isError: false,
          };
        },
      },
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.record.status).toBe("success");
    expect(results[1]!.record.status).toBe("success");
    expect(results[1]!.result?.content).toContain("verified runtime artifact");

    const downloadArtifacts = globalArtifactStore.getByKind("download");
    expect(downloadArtifacts).toHaveLength(1);
    expect(downloadArtifacts[0]!.verified).toBe(true);
  });
});
