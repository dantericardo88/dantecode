import { spawnSync } from "node:child_process";

const WINDOWS_SHELL = process.env.ComSpec ?? "cmd.exe";

export function spawnNpm(args, cwd) {
  const options = {
    cwd,
    encoding: "utf8",
    env: process.env,
  };

  if (process.platform === "win32") {
    return spawnSync(WINDOWS_SHELL, ["/d", "/s", "/c", "npm", ...args], options);
  }

  return spawnSync("npm", args, options);
}

export function runNpm(args, cwd) {
  const result = spawnNpm(args, cwd);
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.error) {
    throw new Error(
      [`Command failed: npm ${args.join(" ")}`, result.error.message, combinedOutput.trim()]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  if (result.status !== 0) {
    throw new Error(
      [`Command failed: npm ${args.join(" ")}`, combinedOutput.trim()].filter(Boolean).join("\n\n"),
    );
  }

  return combinedOutput;
}
