// Monorepo-aware large-fn scanner — walks src/ AND packages/*/src/.
// Mirrors the maturity-engine's >100 LOC penalty so we can surface what
// the harsh-scorer is counting.
//
// Usage: node scripts/find-large-fns-monorepo.mjs [threshold]
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const threshold = Number(process.argv[2] ?? 100);

function extractLargeFns(content) {
  const sf = ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const large = [];
  for (const stmt of sf.statements) {
    let name = null;
    let text = null;
    if (ts.isFunctionDeclaration(stmt)) {
      name = stmt.name?.text ?? "(anonymous)";
      text = stmt.getFullText(sf);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          name = decl.name.getText ? decl.name.getText(sf) : String(decl.name.escapedText);
          text = stmt.getFullText(sf);
        }
      }
    }
    if (text && text.split("\n").length > threshold) {
      large.push({ name, lines: text.split("\n").length });
    }
  }
  return large;
}

function walk(dir) {
  const files = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".danteforge" || e.name === ".git") continue;
        files.push(...walk(path.join(dir, e.name)));
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !e.name.endsWith(".test.ts")) {
        files.push(path.join(dir, e.name));
      }
    }
  } catch {}
  return files;
}

const root = process.cwd();
const dirs = [path.join(root, "src")];
try {
  for (const e of readdirSync(path.join(root, "packages"), { withFileTypes: true })) {
    if (e.isDirectory()) dirs.push(path.join(root, "packages", e.name, "src"));
  }
} catch {}

const allFiles = [];
for (const d of dirs) allFiles.push(...walk(d));

let total = 0;
const byFile = [];
for (const f of allFiles) {
  try {
    const content = readFileSync(f, "utf8");
    const large = extractLargeFns(content);
    if (large.length > 0) {
      total += large.length;
      byFile.push({
        file: path.relative(root, f).split(path.sep).join("/"),
        count: large.length,
        max: Math.max(...large.map((x) => x.lines)),
        fns: large,
      });
    }
  } catch {}
}
byFile.sort((a, b) => b.max - a.max);
console.log(`Total large fns >${threshold} LOC: ${total}`);
byFile.slice(0, 15).forEach((f) => {
  console.log(`\n  [${f.count} fns, max ${f.max}L] ${f.file}`);
  f.fns.forEach((fn) => console.log(`      ${fn.lines}L: ${fn.name}`));
});
