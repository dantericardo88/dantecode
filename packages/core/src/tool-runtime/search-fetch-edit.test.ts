import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolScheduler } from "./tool-scheduler.js";

describe("Search -> fetch -> edit integration", () => {
  let projectRoot = "";
  let server: Server | undefined;
  let baseUrl = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-search-fetch-edit-"));

    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end('const headline = "Patched from fetched content";\n');
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP test server address.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "app.ts"),
      'const headline = "TODO";\n',
      "utf-8",
    );
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

    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = "";
    }
  });

  it("supports WebSearch -> WebFetch -> Edit as a scheduler-owned golden flow", async () => {
    const scheduler = new ToolScheduler(undefined, undefined, {
      policies: [
        { tool: "WebSearch", executionClass: "network" },
        { tool: "WebFetch", executionClass: "network", dependsOn: ["WebSearch"] },
        { tool: "Edit", executionClass: "file_write", dependsOn: ["WebFetch"], verifyAfterExecution: true },
      ],
    });
    const executed: string[] = [];
    const targetFile = join(projectRoot, "src", "app.ts");

    const results = await scheduler.executeBatch(
      [
        {
          id: "search-call",
          toolName: "WebSearch",
          input: { query: "headline patch" },
        },
        {
          id: "fetch-call",
          toolName: "WebFetch",
          input: { url: `${baseUrl}/patch.txt` },
        },
        {
          id: "edit-call",
          toolName: "Edit",
          input: {
            file_path: targetFile,
            old_string: 'const headline = "TODO";',
            new_string: 'const headline = "Patched from fetched content";',
          },
        },
      ],
      {
        requestId: "req-gf-02",
        projectRoot,
        execute: async (request) => {
          executed.push(request.toolName);

          if (request.toolName === "WebSearch") {
            return {
              content: `Found patch at ${baseUrl}/patch.txt`,
              isError: false,
            };
          }

          if (request.toolName === "WebFetch") {
            const response = await fetch(String(request.input["url"]));
            const content = await response.text();
            return { content, isError: false };
          }

          const current = await readFile(String(request.input["file_path"]), "utf-8");
          const updated = current.replace(
            String(request.input["old_string"]),
            String(request.input["new_string"]),
          );
          await writeFile(String(request.input["file_path"]), updated, "utf-8");
          return { content: "Edited file", isError: false };
        },
      },
    );

    expect(executed).toEqual(["WebSearch", "WebFetch", "Edit"]);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.record.status)).toEqual(["success", "success", "success"]);
    expect(await readFile(targetFile, "utf-8")).toContain("Patched from fetched content");
  });
});
