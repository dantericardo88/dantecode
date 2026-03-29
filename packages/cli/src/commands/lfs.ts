/**
 * lfs.ts - Git LFS CLI commands
 *
 * Commands:
 * - dantecode lfs status           - Show LFS status
 * - dantecode lfs init             - Initialize LFS
 * - dantecode lfs track <pattern>  - Track pattern with LFS
 * - dantecode lfs untrack <pattern> - Untrack pattern
 * - dantecode lfs migrate <pattern> - Migrate existing files to LFS
 * - dantecode lfs pull             - Pull LFS files
 */

import {
  getLfsStatus,
  initializeLfs,
  trackPattern,
  untrackPattern,
  migrateToLfs,
  pullLfsFiles,
  COMMON_LFS_PATTERNS,
} from "@dantecode/git-engine";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

/**
 * Show LFS status
 */
export async function cmdLfsStatus(projectRoot: string): Promise<void> {
  const status = getLfsStatus(projectRoot);

  console.log(`\n${BOLD}Git LFS Status${RESET}\n`);

  if (!status.installed) {
    console.log(`${RED}✗ Git LFS is not installed${RESET}`);
    console.log(
      `${DIM}Install from: https://git-lfs.github.com/${RESET}\n`
    );
    return;
  }

  console.log(`${GREEN}✓ Git LFS is installed${RESET} ${DIM}(v${status.version})${RESET}`);

  if (!status.initialized) {
    console.log(`${YELLOW}⚠ Git LFS is not initialized in this repository${RESET}`);
    console.log(`${DIM}Run: dantecode lfs init${RESET}\n`);
    return;
  }

  console.log(`${GREEN}✓ Git LFS is initialized${RESET}\n`);

  if (status.trackedPatterns.length === 0) {
    console.log(`${DIM}No patterns tracked${RESET}`);
    console.log(`${DIM}Use: dantecode lfs track <pattern>${RESET}\n`);
  } else {
    console.log(`${BOLD}Tracked Patterns (${status.trackedPatterns.length}):${RESET}`);
    for (const pattern of status.trackedPatterns) {
      console.log(`  ${CYAN}${pattern}${RESET}`);
    }
    console.log();
  }

  if (status.trackedFiles > 0) {
    console.log(`${BOLD}Statistics:${RESET}`);
    console.log(`  Files: ${status.trackedFiles}`);
    if (status.totalSize) {
      console.log(`  Total Size: ${status.totalSize}`);
    }
    console.log();
  }
}

/**
 * Initialize LFS
 */
export async function cmdLfsInit(projectRoot: string): Promise<void> {
  const result = initializeLfs(projectRoot);

  if (result.success) {
    console.log(`${GREEN}✓ ${result.message}${RESET}`);
  } else {
    console.error(`${RED}✗ ${result.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Track pattern with LFS
 */
export async function cmdLfsTrack(
  projectRoot: string,
  pattern: string,
  options: { common?: string } = {}
): Promise<void> {
  // Handle common patterns
  if (options.common) {
    const category = options.common as keyof typeof COMMON_LFS_PATTERNS;
    if (!(category in COMMON_LFS_PATTERNS)) {
      console.error(
        `${RED}Unknown common pattern category: ${category}${RESET}`
      );
      console.log(`${DIM}Available: ${Object.keys(COMMON_LFS_PATTERNS).join(", ")}${RESET}`);
      process.exit(1);
    }

    const patterns = COMMON_LFS_PATTERNS[category];
    console.log(`${CYAN}Tracking ${patterns.length} ${category} patterns...${RESET}\n`);

    let succeeded = 0;
    for (const p of patterns) {
      const result = trackPattern(projectRoot, p);
      if (result.success) {
        console.log(`${GREEN}✓${RESET} ${p}`);
        succeeded++;
      } else {
        console.log(`${RED}✗${RESET} ${p}: ${result.message}`);
      }
    }

    console.log(`\n${GREEN}Tracked ${succeeded}/${patterns.length} patterns${RESET}`);
    return;
  }

  // Track single pattern
  const result = trackPattern(projectRoot, pattern);

  if (result.success) {
    console.log(`${GREEN}✓ ${result.message}${RESET}`);
    console.log(`${DIM}Pattern added to .gitattributes${RESET}`);
  } else {
    console.error(`${RED}✗ ${result.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Untrack pattern from LFS
 */
export async function cmdLfsUntrack(
  projectRoot: string,
  pattern: string
): Promise<void> {
  const result = untrackPattern(projectRoot, pattern);

  if (result.success) {
    console.log(`${GREEN}✓ ${result.message}${RESET}`);
  } else {
    console.error(`${RED}✗ ${result.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Migrate existing files to LFS
 */
export async function cmdLfsMigrate(
  projectRoot: string,
  pattern: string,
  options: { ref?: string } = {}
): Promise<void> {
  console.log(`${CYAN}Migrating "${pattern}" to Git LFS...${RESET}`);
  console.log(`${DIM}This may take a while for large files${RESET}\n`);

  const result = migrateToLfs(projectRoot, pattern, {
    includeRef: options.ref,
  });

  if (result.success) {
    console.log(`${GREEN}✓ ${result.message}${RESET}`);
    if (result.migratedCount !== undefined) {
      console.log(`${DIM}Migrated ${result.migratedCount} object(s)${RESET}`);
    }
    console.log(`\n${YELLOW}Note: This rewrites Git history. Force push may be required.${RESET}`);
  } else {
    console.error(`${RED}✗ ${result.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Pull LFS files
 */
export async function cmdLfsPull(projectRoot: string): Promise<void> {
  console.log(`${CYAN}Pulling Git LFS files...${RESET}`);

  const result = pullLfsFiles(projectRoot);

  if (result.success) {
    console.log(`${GREEN}✓ ${result.message}${RESET}`);
  } else {
    console.error(`${RED}✗ ${result.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Show common patterns guide
 */
export async function cmdLfsPatterns(): Promise<void> {
  console.log(`\n${BOLD}Common Git LFS Patterns${RESET}\n`);

  for (const [category, patterns] of Object.entries(COMMON_LFS_PATTERNS)) {
    console.log(`${CYAN}${category}:${RESET}`);
    for (const pattern of patterns) {
      console.log(`  ${pattern}`);
    }
    console.log();
  }

  console.log(`${DIM}Usage: dantecode lfs track --common=<category>${RESET}`);
  console.log(`${DIM}Example: dantecode lfs track --common=images${RESET}\n`);
}
