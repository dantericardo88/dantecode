// ============================================================================
// @dantecode/cli — Non-blocking auto-update checker
// Checks npm registry for latest version on startup.
// Shows notification if an update is available.
// Never blocks startup — all errors are silently swallowed.
// ============================================================================

/** Response shape from the npm registry latest endpoint. */
interface NpmRegistryResponse {
  version: string;
}

/**
 * Compares two semver strings. Returns true if `latest` is newer than `current`.
 * Falls back to simple string inequality when versions are non-parseable.
 */
function isNewer(current: string, latest: string): boolean {
  if (current === latest) return false;

  const parse = (v: string): number[] =>
    v
      .replace(/^[^0-9]*/, "")
      .split(".")
      .map((p) => parseInt(p, 10) || 0);

  const [ca, cb, cc] = parse(current);
  const [la, lb, lc] = parse(latest);

  if (la !== ca) return (la ?? 0) > (ca ?? 0);
  if (lb !== cb) return (lb ?? 0) > (cb ?? 0);
  return (lc ?? 0) > (cc ?? 0);
}

/**
 * Fire-and-forget auto-update check.
 *
 * Fetches the latest version of `@dantecode/cli` from the npm registry.
 * If a newer version is available, prints a dim notification to stderr.
 * Completes within 3 seconds or gives up silently.
 *
 * MUST be called without `await` at the call site so it never blocks startup.
 *
 * @param currentVersion - The currently installed version string (e.g. "1.0.0").
 */
export async function checkForUpdate(currentVersion: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3-second hard timeout

    let response: Response;
    try {
      response = await fetch("https://registry.npmjs.org/@dantecode/cli/latest", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return;

    const data = (await response.json()) as NpmRegistryResponse;
    const latestVersion = data?.version;

    if (!latestVersion || !isNewer(currentVersion, latestVersion)) return;

    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
    const yellow = "\x1b[33m";
    process.stderr.write(
      `${dim}${yellow}Update available: ${currentVersion} -> ${latestVersion}${reset}\n`,
    );
    process.stderr.write(`${dim}Run: npm install -g @dantecode/cli${reset}\n`);
  } catch {
    // Silently ignore all errors — network failures, JSON parse errors, AbortError, etc.
    // The update check must never surface errors to the user.
  }
}
