// ============================================================================
// @dantecode/cli — /verify command
// Honest feature health report. Run this after every implementation session.
// The output of this command IS the score. No other score is valid.
// ============================================================================

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export interface VerifyOptions {
  feature?: string;
  wiringOnly?: boolean;
  quick?: boolean;
}

export async function runVerify(
  projectRoot: string,
  options: VerifyOptions = {}
): Promise<string> {
  const {
    getRegisteredFeatures,
    getFeatureWiring,
    ALL_SCENARIOS,
    runFeatureTest,
  } = await import("@dantecode/core");

  const lines: string[] = [];
  lines.push(`\n${BOLD}DanteCode Feature Verification Report${RESET}`);
  lines.push("═".repeat(72));
  lines.push(
    `${"Feature".padEnd(28)}${"Wired".padEnd(10)}${"Test".padEnd(10)}${"Score".padEnd(8)}Status`
  );
  lines.push("─".repeat(72));

  const testResults = new Map<string, { passed: boolean; score: number; error?: string }>();

  if (!options.wiringOnly) {
    const scenarios = options.feature
      ? ALL_SCENARIOS.filter((s) => s.name === options.feature)
      : options.quick
        ? ALL_SCENARIOS.slice(0, 4)
        : ALL_SCENARIOS;

    for (const scenario of scenarios) {
      const result = await runFeatureTest(scenario, projectRoot);
      testResults.set(result.featureName, {
        passed: result.passed,
        score: result.score,
        error: result.error,
      });
    }
  }

  let totalScore = 0;
  let count = 0;
  let greenCount = 0;
  let yellowCount = 0;
  let redCount = 0;

  const allFeatures = getRegisteredFeatures();
  const featuresToShow = options.feature
    ? allFeatures.filter((f) => f === options.feature)
    : allFeatures;

  for (const featureName of featuresToShow) {
    const wiring = getFeatureWiring(featureName);
    const isWired = wiring !== undefined;

    const wiringIcon = isWired ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;

    const testResult = testResults.get(featureName);
    const testIcon = !testResult
      ? `${DIM}SKIP${RESET}`
      : testResult.passed
        ? `${GREEN}PASS${RESET}`
        : `${RED}FAIL${RESET}`;

    const baseScore = isWired ? 8 : 0;
    const finalScore = testResult
      ? Math.min(baseScore, testResult.score)
      : baseScore;

    const statusLabel =
      finalScore >= 8 ? `${GREEN}GREEN${RESET}` :
      finalScore >= 6 ? `${YELLOW}YELLOW${RESET}` :
      `${RED}RED${RESET}`;

    if (finalScore >= 8) greenCount++;
    else if (finalScore >= 6) yellowCount++;
    else redCount++;

    lines.push(
      `${featureName.padEnd(28)}${wiringIcon.padEnd(18)}${testIcon.padEnd(18)}${String(finalScore + "/10").padEnd(8)}${statusLabel}`
    );

    if (finalScore < 6) {
      const detail = testResult?.error ?? wiring?.wiredIn ?? "Not wired into any hot path";
      lines.push(`  ${DIM}↳ ${detail}${RESET}`);
    }

    totalScore += finalScore;
    count++;
  }

  lines.push("─".repeat(72));

  const avg = count > 0 ? Math.round((totalScore / count) * 10) / 10 : 0;

  lines.push(
    `${BOLD}Overall: ${avg}/10${RESET}  |  ` +
    `${GREEN}${greenCount} GREEN${RESET}  |  ` +
    `${YELLOW}${yellowCount} YELLOW${RESET}  |  ` +
    `${RED}${redCount} RED${RESET}`
  );
  lines.push("═".repeat(72));
  lines.push(`${DIM}This is the authoritative score. No claimed score above this is valid.${RESET}`);
  lines.push(`${DIM}Run: /verify --feature=<name> for detailed evidence on one feature.${RESET}\n`);

  return lines.join("\n");
}
