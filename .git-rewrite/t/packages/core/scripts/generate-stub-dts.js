// Generate stub .d.ts file for core package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Stub declaration for @dantecode/core
// Generated because circular dependency prevents automated DTS
// All exports typed as any - use with skipLibCheck: true
declare const _core: any;
export default _core;
export const DimensionScorer: any;
export const EventEngine: any;
export const BrowserAgent: any;
export const ModelRouterImpl: any;
export const normalizeApprovalMode: any;
export const getModeToolExclusions: any;
export const appendAuditEvent: any;
export const detectInstallContext: any;
export const isProtectedWriteTarget: any;
export const isRepoInternalCdChain: any;
export const isSelfImprovementWriteAllowed: any;
export const resolvePreferredShell: any;
export type CanonicalApprovalMode = any;
export type ColoredDiffHunk = any;
export type SelfImprovementContext = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
