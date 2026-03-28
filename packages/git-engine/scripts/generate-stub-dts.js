// Generate stub .d.ts file for git-engine package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/git-engine
// Circular dependency with core prevents automated DTS generation

export const generateColoredHunk: any;
export const WorktreeManager: any;
export const GitRepoMap: any;
export const AutomationOrchestrator: any;
export const FilePatternWatcher: any;
export const matchGlob: any;
export const runAutomationAgent: any;

export type WorktreeHooks = any;
export type AutomationDefinition = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
