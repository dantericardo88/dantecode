#!/usr/bin/env node

// ============================================================================
// DanteCode Hook Installer
// Installs pre-commit hooks to enforce anti-overclaiming verification
// ============================================================================

import { copyFileSync, chmodSync, existsSync } from "fs";
import { join, resolve } from "path";

const ROOT_DIR = resolve(process.cwd());
const HOOKS_DIR = join(ROOT_DIR, ".git", "hooks");
const PRE_COMMIT_HOOK = join(HOOKS_DIR, "pre-commit");

console.log("🔧 Installing DanteCode Pre-Commit Hooks...");

function installHooks() {
  // Check if .git/hooks exists
  if (!existsSync(HOOKS_DIR)) {
    console.log("❌ .git/hooks directory not found. Is this a git repository?");
    process.exit(1);
  }

  const hookSource = join(ROOT_DIR, "scripts", "pre-commit-hook.js");
  const hookTarget = join(HOOKS_DIR, "pre-commit");

  try {
    // Copy the hook
    copyFileSync(hookSource, hookTarget);
    chmodSync(hookTarget, "755");

    console.log("✅ Pre-commit hook installed successfully");
    console.log(`   Hook location: ${hookTarget}`);
    console.log("");
    console.log("🎯 Anti-Overclaiming Protection Active:");
    console.log("   • Blocks commits with TODO/FIXME markers");
    console.log("   • Prevents commits with failing tests");
    console.log("   • Enforces constitution compliance");
    console.log("   • Requires anti-stub clean code");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("❌ Failed to install pre-commit hook:", message);
    process.exit(1);
  }
}

installHooks();
