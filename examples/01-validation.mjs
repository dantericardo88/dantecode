// 01-validation.mjs — Boundary-point input validation primitives.
//
// When user input, model output, or external data crosses into a sensitive
// boundary (filesystem, shell, network, HTML), it must be sanitized first.
// DanteCode ships these as discriminated-union validators so callers can
// pattern-match without exception handling.
//
// Run: node examples/01-validation.mjs

import {
  validateRelativePath,
  validateHttpUrl,
  validateShellArg,
  escapeHtml,
  parseJsonBounded,
} from "../packages/core/dist/index.js";

console.log("=== validateRelativePath ===");
for (const input of [
  "src/index.ts",            // ok
  "../../etc/passwd",        // path traversal — rejected
  "/etc/passwd",             // absolute — rejected
  "C:\\Windows\\System32",   // Windows absolute — rejected
  "src\\foo//bar.ts",        // ok, normalized to src/foo/bar.ts
]) {
  const r = validateRelativePath(input);
  console.log(`  ${r.ok ? "OK   " : "BLOCK"}  ${JSON.stringify(input).padEnd(35)} ${r.ok ? "→ " + r.value : "← " + r.reason}`);
}

console.log("\n=== validateHttpUrl ===");
for (const input of [
  "https://example.com/api",       // ok
  "javascript:alert(1)",           // wrong protocol — rejected
  "http://169.254.169.254/latest", // AWS metadata service — SSRF rejected
  "http://localhost:3000",         // localhost — rejected by default
  "http://10.0.0.5",               // RFC1918 private — rejected
]) {
  const r = validateHttpUrl(input);
  console.log(`  ${r.ok ? "OK   " : "BLOCK"}  ${JSON.stringify(input).padEnd(35)} ${r.ok ? "→ " + r.value.hostname : "← " + r.reason}`);
}

console.log("\n=== validateShellArg ===");
for (const input of [
  "hello-world.txt",        // ok
  "$(rm -rf /)",            // command substitution — rejected
  "foo; ls",                // semicolon chain — rejected
  "--flag=value",           // ok
]) {
  const r = validateShellArg(input);
  console.log(`  ${r.ok ? "OK   " : "BLOCK"}  ${JSON.stringify(input).padEnd(35)} ${r.ok ? "→ as-is" : "← " + r.reason}`);
}

console.log("\n=== escapeHtml ===");
const xss = `<script>alert("pwn")</script>`;
console.log(`  raw:     ${xss}`);
console.log(`  escaped: ${escapeHtml(xss)}`);

console.log("\n=== parseJsonBounded (size-limited JSON.parse) ===");
const small = parseJsonBounded(`{"hello": "world"}`);
console.log(`  small ok: ${small.ok}, value: ${JSON.stringify(small.value)}`);
const tooBig = parseJsonBounded("x".repeat(2_000_000), { maxBytes: 1024 });
console.log(`  too big: ${tooBig.ok ? "ok" : "blocked — " + tooBig.reason}`);

console.log("\nUse the throwing variants (assertValid*) where the caller cannot continue without a valid value.");
