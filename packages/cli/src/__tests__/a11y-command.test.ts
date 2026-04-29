import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runA11yCommand } from "../a11y-command.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dantecode-a11y-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const accessibleHtml = [
  '<html lang="en">',
  '<head>',
  '  <title>DanteCode Accessible Fixture</title>',
  '  <style>',
  '    :focus-visible { outline: 2px solid var(--vscode-focusBorder); }',
  '    @media (forced-colors: active) { * { forced-color-adjust: auto; } }',
  '    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }',
  '  </style>',
  '</head>',
  '<body>',
  '  <main role="main" aria-label="Accessible fixture">',
  '    <h1>DanteCode</h1>',
  '    <button aria-label="Run audit" data-keyboard="true">Run</button>',
  '    <div id="dante-sr-announcer" role="status" aria-live="polite" aria-atomic="true"></div>',
  '  </main>',
  '</body>',
  '</html>',
].join("\n");

describe("a11y audit command", () => {
  it("exits non-zero and reports blockers for critical violations", async () => {
    const badFile = join(tmpDir, "bad.html");
    writeFileSync(badFile, "<html><body><button></button><input type=\"text\"></body></html>");
    const output: string[] = [];

    const code = await runA11yCommand(["audit", "--file", badFile, "--threshold", "90"], {
      cwd: tmpDir,
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
    });

    expect(code).toBe(1);
    expect(output.join("")).toContain("Accessibility Gate: FAILED");
    expect(output.join("")).toContain("critical violations");
  });

  it("emits JSON and writes deterministic evidence for clean fixtures", async () => {
    const cleanFile = join(tmpDir, "clean.html");
    writeFileSync(cleanFile, accessibleHtml);
    const output: string[] = [];

    const code = await runA11yCommand(
      ["audit", "--file", cleanFile, "--format", "json", "--threshold", "90", "--evidence"],
      {
        cwd: tmpDir,
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
      },
    );

    expect(code).toBe(0);
    const payload = JSON.parse(output.join(""));
    expect(payload.pass).toBe(true);
    expect(payload.score).toBe(100);
    expect(existsSync(join(tmpDir, ".danteforge", "evidence", "accessibility-dim48.json"))).toBe(
      true,
    );
    expect(
      readFileSync(join(tmpDir, ".danteforge", "evidence", "accessibility-dim48.md"), "utf-8"),
    ).toContain("Accessibility Gate Report");
    expect(
      readFileSync(join(tmpDir, ".danteforge", "accessibility-audit-log.jsonl"), "utf-8"),
    ).toContain('"score":100');
  });

  it("audits stdin when no file is supplied", async () => {
    const output: string[] = [];
    const code = await runA11yCommand(["audit", "--stdin", "--format", "markdown"], {
      cwd: tmpDir,
      stdin: accessibleHtml,
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
    });

    expect(code).toBe(0);
    expect(output.join("")).toContain("# Accessibility Gate Report");
  });
});
