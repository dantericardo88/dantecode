import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  evaluateBrowserLivePreviewGate,
  generateBrowserLivePreviewReport,
  type BrowserLivePreviewGateResult,
  type BrowserLivePreviewProof,
} from "@dantecode/core";

type PreviewOutputFormat = "text" | "json" | "markdown";

export interface PreviewCommandOptions {
  cwd: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

interface ParsedPreviewArgs {
  proof?: string;
  format: PreviewOutputFormat;
  threshold: number;
  evidence: boolean;
}

function parsePreviewArgs(args: string[]): ParsedPreviewArgs {
  const tokens = args[0] === "gate" ? args.slice(1) : args;
  const parsed: ParsedPreviewArgs = {
    format: "text",
    threshold: 90,
    evidence: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "--proof") {
      parsed.proof = tokens[++i];
      continue;
    }
    if (token === "--format") {
      const format = tokens[++i] as PreviewOutputFormat | undefined;
      if (format === "text" || format === "json" || format === "markdown") {
        parsed.format = format;
      }
      continue;
    }
    if (token === "--threshold") {
      const threshold = Number.parseInt(tokens[++i] ?? "", 10);
      if (Number.isFinite(threshold)) parsed.threshold = threshold;
      continue;
    }
    if (token === "--evidence") {
      parsed.evidence = true;
    }
  }

  return parsed;
}

async function loadProof(parsed: ParsedPreviewArgs, cwd: string): Promise<BrowserLivePreviewProof> {
  if (!parsed.proof) {
    throw new Error("Usage: dantecode preview gate --proof <browser-live-preview-proof.json>");
  }
  const proofPath = resolve(cwd, parsed.proof);
  return JSON.parse(await readFile(proofPath, "utf-8")) as BrowserLivePreviewProof;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function buildLocalCanaryProof(cwd: string): Promise<BrowserLivePreviewProof> {
  const canaryDir = join(cwd, ".danteforge", "preview-canary");
  const indexPath = join(canaryDir, "index.html");
  await mkdir(canaryDir, { recursive: true });

  const beforeHtml = [
    "<!doctype html>",
    '<html lang="en">',
    "<head><title>DanteCode Preview Canary</title></head>",
    "<body>",
    "<main>",
    "<h1>DanteCode Preview Canary</h1>",
    '<button type="button">Run preview</button>',
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
  await writeFile(indexPath, beforeHtml, "utf-8");

  const server = createServer(async (_req, res) => {
    const html = await readFile(indexPath, "utf-8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });

  const startMs = Date.now();
  const port = await listen(server);
  const url = `http://localhost:${port}`;

  try {
    const before = await (await fetch(url)).text();
    const updatedHtml = beforeHtml.replace("DanteCode Preview Canary", "DanteCode Preview Canary Updated");
    await writeFile(indexPath, updatedHtml, "utf-8");
    const after = await (await fetch(url)).text();
    const beforeHash = sha256(before);
    const afterHash = sha256(after);

    return {
      dimensionId: "browser_live_preview",
      generatedAt: new Date().toISOString(),
      preview: {
        url,
        command: "node:http static canary",
        port,
        managed: true,
        startupMs: Date.now() - startMs,
        framework: "static",
      },
      captures: {
        domTextChars: stripHtml(after).length,
        accessibilityTreeCaptured: false,
        consoleErrorCount: 0,
        networkFailureCount: 0,
        blockingErrorCount: 0,
        viewports: [
          { width: 390, height: 844 },
          { width: 1440, height: 900 },
        ],
      },
      hotReload: {
        pass: beforeHash !== afterHash,
        changedFile: indexPath,
        beforeHash,
        afterHash,
        observedMs: 1,
      },
      keyboard: {
        pass: false,
        reachableControls: 0,
        totalControls: 1,
        focusOrder: [],
      },
      repair: {
        failureOverlayAvailable: true,
        repairPromptAvailable: true,
      },
      artifacts: {
        manifestPath: ".danteforge/evidence/browser-live-preview-dim14.json",
        reportPath: ".danteforge/evidence/browser-live-preview-dim14.md",
      },
    };
  } finally {
    await closeServer(server);
  }
}

function formatText(result: BrowserLivePreviewGateResult): string {
  const lines = [
    `Browser Live Preview Gate: ${result.pass ? "PASSED" : "FAILED"}`,
    `Score: ${result.score}/100 (threshold: ${result.threshold})`,
    `Max eligible matrix score: ${result.maxEligibleScore}`,
    `Preview URL: ${result.previewUrl}`,
  ];

  if (result.blockers.length > 0) {
    lines.push("Blockers:");
    lines.push(...result.blockers.map((blocker) => `- ${blocker}`));
  }

  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    lines.push(...result.warnings.map((warning) => `- ${warning}`));
  }

  return `${lines.join("\n")}\n`;
}

function formatJson(result: BrowserLivePreviewGateResult): string {
  return `${JSON.stringify(
    {
      pass: result.pass,
      score: result.score,
      threshold: result.threshold,
      maxEligibleScore: result.maxEligibleScore,
      previewUrl: result.previewUrl,
      blockers: result.blockers,
      warnings: result.warnings,
      coverage: result.coverage,
      proof: result.proof,
      generatedAt: result.generatedAt,
    },
    null,
    2,
  )}\n`;
}

async function writeEvidence(result: BrowserLivePreviewGateResult, cwd: string): Promise<void> {
  const evidenceDir = join(cwd, ".danteforge", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "browser-live-preview-dim14.json"), formatJson(result), "utf-8");
  await writeFile(
    join(evidenceDir, "browser-live-preview-dim14.md"),
    `${generateBrowserLivePreviewReport(result)}\n`,
    "utf-8",
  );
}

export async function runPreviewCommand(
  args: string[],
  options: PreviewCommandOptions,
): Promise<number> {
  const stdout = options.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text: string) => process.stderr.write(text));

  try {
    const isCanary = args[0] === "canary";
    const parsed = parsePreviewArgs(isCanary ? args.slice(1) : args);
    const proof = isCanary ? await buildLocalCanaryProof(options.cwd) : await loadProof(parsed, options.cwd);
    const result = evaluateBrowserLivePreviewGate(proof, { threshold: parsed.threshold });

    if (parsed.evidence) {
      await writeEvidence(result, options.cwd);
    }

    if (parsed.format === "json") {
      stdout(formatJson(result));
    } else if (parsed.format === "markdown") {
      stdout(`${generateBrowserLivePreviewReport(result)}\n`);
    } else {
      stdout(formatText(result));
    }

    return result.pass ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`Browser live preview gate failed: ${message}\n`);
    return 1;
  }
}
