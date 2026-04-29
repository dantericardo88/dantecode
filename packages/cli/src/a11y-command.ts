import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  generateA11yGateReport,
  recordA11yAudit,
  runAccessibilityGate,
  type AccessibilityGateResult,
} from "@dantecode/core";

type A11yOutputFormat = "text" | "json" | "markdown";

interface A11yCommandOptions {
  cwd: string;
  stdin?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

interface ParsedA11yArgs {
  file?: string;
  url?: string;
  useStdin: boolean;
  format: A11yOutputFormat;
  threshold: number;
  evidence: boolean;
}

function parseA11yArgs(args: string[]): ParsedA11yArgs {
  const tokens = args[0] === "audit" ? args.slice(1) : args;
  const parsed: ParsedA11yArgs = {
    useStdin: false,
    format: "text",
    threshold: 90,
    evidence: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "--file" || token === "-f") {
      parsed.file = tokens[++i];
      continue;
    }
    if (token === "--url") {
      parsed.url = tokens[++i];
      continue;
    }
    if (token === "--stdin") {
      parsed.useStdin = true;
      continue;
    }
    if (token === "--format") {
      const format = tokens[++i] as A11yOutputFormat | undefined;
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

async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function loadHtml(parsed: ParsedA11yArgs, cwd: string, stdin?: string): Promise<{
  html: string;
  source: string;
}> {
  if (parsed.file) {
    const filePath = resolve(cwd, parsed.file);
    return { html: await readFile(filePath, "utf-8"), source: filePath };
  }

  if (parsed.url) {
    const response = await fetch(parsed.url);
    if (!response.ok) {
      throw new Error(`Unable to fetch ${parsed.url}: ${response.status} ${response.statusText}`);
    }
    return { html: await response.text(), source: parsed.url };
  }

  if (parsed.useStdin || stdin !== undefined) {
    return { html: stdin ?? (await readProcessStdin()), source: "stdin" };
  }

  throw new Error("Usage: dantecode a11y audit --file <html> | --url <url> | --stdin");
}

function formatText(result: AccessibilityGateResult): string {
  const lines = [
    `Accessibility Gate: ${result.pass ? "PASSED" : "FAILED"}`,
    `Score: ${result.score}/100 (threshold: ${result.threshold})`,
    `Violations: ${result.audit.violationCount} (${result.audit.criticalCount} critical, ${result.audit.seriousCount} serious)`,
  ];

  if (result.blockers.length > 0) {
    lines.push("Blockers:");
    lines.push(...result.blockers.map((blocker) => `- ${blocker}`));
  }

  lines.push("Proof:");
  lines.push(...result.proof.map((proof) => `- ${proof}`));
  return `${lines.join("\n")}\n`;
}

function formatJson(result: AccessibilityGateResult): string {
  return `${JSON.stringify(
    {
      pass: result.pass,
      score: result.score,
      threshold: result.threshold,
      blockers: result.blockers,
      coverage: result.coverage,
      proof: result.proof,
      violations: result.audit.violations,
      source: result.source,
      surface: result.surface,
      auditedAt: result.auditedAt,
    },
    null,
    2,
  )}\n`;
}

async function writeEvidence(result: AccessibilityGateResult, cwd: string): Promise<void> {
  const evidenceDir = join(cwd, ".danteforge", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const jsonPath = join(evidenceDir, "accessibility-dim48.json");
  const mdPath = join(evidenceDir, "accessibility-dim48.md");
  await writeFile(jsonPath, formatJson(result), "utf-8");
  await writeFile(mdPath, generateA11yGateReport(result), "utf-8");
  await mkdir(dirname(jsonPath), { recursive: true });
}

export async function runA11yCommand(
  args: string[],
  options: A11yCommandOptions,
): Promise<number> {
  const stdout = options.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text: string) => process.stderr.write(text));

  try {
    const parsed = parseA11yArgs(args);
    const { html, source } = await loadHtml(parsed, options.cwd, options.stdin);
    const result = runAccessibilityGate(html, {
      minimumScore: parsed.threshold,
      source,
      surface: source === "stdin" ? "stdin" : "html",
    });
    recordA11yAudit(
      {
        sessionId: `cli-a11y-${Date.now()}`,
        url: source,
        violationCount: result.audit.violationCount,
        criticalCount: result.audit.criticalCount,
        wcag2aViolations: result.audit.wcag2aViolations,
        score: result.score,
        recordedAt: result.auditedAt,
      },
      options.cwd,
    );

    if (parsed.evidence) {
      await writeEvidence(result, options.cwd);
    }

    if (parsed.format === "json") {
      stdout(formatJson(result));
    } else if (parsed.format === "markdown") {
      stdout(`${generateA11yGateReport(result)}\n`);
    } else {
      stdout(formatText(result));
    }

    return result.pass ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`Accessibility audit failed: ${message}\n`);
    return 1;
  }
}
