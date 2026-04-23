#!/usr/bin/env node
/**
 * Measurement script for Dim 5+15: benchmarked correctness + autonomy.
 * Outputs a single integer 0–100 to stdout.
 *
 * Score breakdown:
 *   0–30  : Task difficulty classification accuracy (semantic hard vs easy)
 *   0–25  : Ambiguity detection precision/recall
 *   0–25  : Error recovery specificity (non-generic actions)
 *   0–20  : Verify-repair loop signal quality (completion oracle coverage)
 */

import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const coreIndexPath = resolve(__dir, "../packages/core/dist/index.js");
const coreIndexUrl = pathToFileURL(coreIndexPath).href;

let mod;
try {
  mod = await import(coreIndexUrl);
} catch (e) {
  process.stderr.write(`[measure] Core import failed: ${e.message}\n`);
  process.stdout.write("0\n");
  process.exit(0);
}

const { detectTaskAmbiguity, classifyTaskDifficulty, globalErrorRecoveryRouter } = mod;

// ── Section 1: Task difficulty classification (30 pts) ────────────────────────
// Labeled dataset: ground truth difficulty for prompts
// Hard = multi-file refactor, architectural change, migration, cross-cutting concern
// Easy = single-function fix, simple add, small localized change

const difficultyLabeled = [
  // HARD tasks — semantic signals: "refactor", "migrate", "across N files", "entire", "all", "system"
  { prompt: "Refactor the entire authentication system across 12 files to use OAuth2 instead of JWT", expected: "hard" },
  { prompt: "Migrate all database queries from raw SQL to TypeORM entities and update all service files", expected: "hard" },
  { prompt: "Rewrite the plugin system to support async loading and update every plugin consumer", expected: "hard" },
  { prompt: "Add rate limiting to all API endpoints and wire through middleware stack and logging", expected: "hard" },
  { prompt: "Convert the monolith to microservices: extract auth, billing, and notification services", expected: "hard" },
  // MEDIUM tasks
  { prompt: "Add input validation to the user registration form and show error messages", expected: "medium" },
  { prompt: "Create a new endpoint GET /api/users/:id that returns user profile data", expected: "medium" },
  // EASY tasks
  { prompt: "Fix the typo in the error message in src/auth/login.ts line 42", expected: "easy" },
  { prompt: "Add a console.log to debug the auth flow in token.ts", expected: "easy" },
  { prompt: "Rename the variable 'usr' to 'user' in auth-service.ts", expected: "easy" },
];

let difficultyCorrect = 0;
for (const tc of difficultyLabeled) {
  const got = classifyTaskDifficulty(tc.prompt, []);
  if (got === tc.expected) difficultyCorrect++;
}

const difficultyAccuracy = difficultyCorrect / difficultyLabeled.length;
// Weight hard misses more (false "easy" for hard task is the worst failure mode)
const hardCases = difficultyLabeled.filter((t) => t.expected === "hard");
const hardCorrect = hardCases.filter((tc) => classifyTaskDifficulty(tc.prompt, []) === "hard").length;
const hardRecall = hardCases.length > 0 ? hardCorrect / hardCases.length : 0;
// Score: 60% overall accuracy + 40% hard recall
const difficultyScore = Math.round((difficultyAccuracy * 0.6 + hardRecall * 0.4) * 30);

// ── Section 2: Ambiguity detection precision/recall (25 pts) ─────────────────

const ambiguityLabeled = [
  // Ambiguous (should detect)
  { prompt: "fix it", expectedAmbiguous: true },
  { prompt: "improve performance", expectedAmbiguous: true },
  { prompt: "make it better", expectedAmbiguous: true },
  { prompt: "update the tests", expectedAmbiguous: true },
  { prompt: "clean up the code", expectedAmbiguous: true },
  // Clear (should NOT detect as ambiguous)
  { prompt: "Add TypeScript types to src/auth/token.ts — the generateToken function must accept userId: string and return Promise<string>", expectedAmbiguous: false },
  { prompt: "Fix the null check bug in packages/core/src/session-store.ts line 89 where sessions[id] can be undefined", expectedAmbiguous: false },
  { prompt: "Add a DELETE /api/users/:id endpoint in src/routes/users.ts that soft-deletes by setting deletedAt timestamp", expectedAmbiguous: false },
];

let ambiguityTP = 0; // correctly flagged as ambiguous
let ambiguityFP = 0; // wrongly flagged as ambiguous
let ambiguityFN = 0; // missed ambiguous prompt
let ambiguityTN = 0; // correctly not flagged

for (const tc of ambiguityLabeled) {
  const result = detectTaskAmbiguity(tc.prompt);
  const detected = result.isAmbiguous;
  if (detected && tc.expectedAmbiguous) ambiguityTP++;
  else if (detected && !tc.expectedAmbiguous) ambiguityFP++;
  else if (!detected && tc.expectedAmbiguous) ambiguityFN++;
  else ambiguityTN++;
}

const precision = ambiguityTP + ambiguityFP > 0 ? ambiguityTP / (ambiguityTP + ambiguityFP) : 0;
const recall = ambiguityTP + ambiguityFN > 0 ? ambiguityTP / (ambiguityTP + ambiguityFN) : 0;
const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
const ambiguityScore = Math.round(f1 * 25);

// ── Section 3: Error recovery specificity (25 pts) ────────────────────────────
// Frontier tools (Codex, Ralph) give specific recovery actions, not generic "retry"
// Measure: for each typed error, does the router return an action that is NOT "retry-immediate"?

const errorCases = [
  { content: "TypeError: Cannot read properties of undefined (reading 'length') at auth.ts:42" },
  { content: "SyntaxError: Unexpected token '}' in src/config.ts:18" },
  { content: "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'" },
  { content: "ENOENT: no such file or directory, open './config/production.json'" },
  { content: "EACCES: permission denied, open '/etc/ssl/certs/ca.pem'" },
  { content: "Error: connect ECONNREFUSED 127.0.0.1:5432 (database connection)" },
  { content: "429 Too Many Requests — rate limit exceeded" },
  { content: "RangeError: Maximum call stack size exceeded in recursiveProcess at recursion.ts:15" },
];

let specificActionCount = 0;
let correctClassCount = 0;

const expectedClasses = /** @type {Record<string, string>} */ ({
  "TypeError: Cannot read": "type",
  "SyntaxError: Unexpected": "syntax",
  "error TS": "syntax",
  "ENOENT:": "not-found",
  "EACCES:": "permission",
  "ECONNREFUSED": "network",
  "429 Too Many": "rate-limit",
  "RangeError:": "runtime",
});

for (const tc of errorCases) {
  const session = globalErrorRecoveryRouter.startSession(tc.content);
  const action = globalErrorRecoveryRouter.nextAction(session.id);
  if (action && action !== "retry-immediate") specificActionCount++;

  // Check correct classification
  for (const [prefix, cls] of Object.entries(expectedClasses)) {
    if (tc.content.includes(prefix) && session.fingerprint.errorClass === cls) {
      correctClassCount++;
      break;
    }
  }
}

const specificityRate = specificActionCount / errorCases.length;
const classAccuracy = correctClassCount / errorCases.length;
const recoveryScore = Math.round((specificityRate * 0.5 + classAccuracy * 0.5) * 25);

// ── Section 4: Completion oracle signal quality (20 pts) ─────────────────────
// The [PROOF ATTACHED] oracle pattern: verify that the wiring exists in agent-loop
// and that the oracle would fire. We check source code presence as a proxy.
// This is a code-quality/wiring check, not a runtime test.

import { readFileSync, existsSync } from "node:fs";

let oracleScore = 0;
const agentLoopPath = resolve(__dir, "../packages/cli/src/agent-loop.ts");

if (existsSync(agentLoopPath)) {
  const src = readFileSync(agentLoopPath, "utf-8");

  // Check 1: [PROOF ATTACHED] oracle wired (5 pts)
  if (src.includes("[PROOF ATTACHED]")) oracleScore += 5;

  // Check 2: dynamic verify budget wired (5 pts)
  if (src.includes("maxVerifyRetries") && src.includes("hardTaskFinishRate")) oracleScore += 5;

  // Check 3: error recovery router wired (5 pts)
  if (src.includes("globalErrorRecoveryRouter") && src.includes("errorClass")) oracleScore += 5;

  // Check 4: task ambiguity wired (5 pts) — ambiguity detection injected into messages
  if (src.includes("detectTaskAmbiguity") || src.includes("Task Assumptions")) oracleScore += 5;
}

// ── Final score ────────────────────────────────────────────────────────────────

const total = difficultyScore + ambiguityScore + recoveryScore + oracleScore;

process.stderr.write(
  `[measure] Difficulty classifier: ${(difficultyAccuracy * 100).toFixed(0)}% overall, ` +
    `${(hardRecall * 100).toFixed(0)}% hard recall → ${difficultyScore}/30\n` +
  `[measure] Ambiguity detector: P=${(precision * 100).toFixed(0)}% R=${(recall * 100).toFixed(0)}% F1=${f1.toFixed(2)} → ${ambiguityScore}/25\n` +
  `[measure] Error recovery: ${specificActionCount}/${errorCases.length} specific, ` +
    `${correctClassCount}/${errorCases.length} correctly classified → ${recoveryScore}/25\n` +
  `[measure] Completion oracle wiring → ${oracleScore}/20\n` +
  `[measure] Total: ${total}/100\n`,
);

process.stdout.write(`${total}\n`);
