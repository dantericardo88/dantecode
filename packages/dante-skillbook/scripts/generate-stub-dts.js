// Generate stub .d.ts file for dante-skillbook package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/dante-skillbook

export class DanteSkillbook {
  constructor(options?: any);
  applyUpdate(update: any): Promise<void>;
}

export class GitSkillbookStore {
  constructor(projectRoot: string);
  save(skillbook: any): Promise<void>;
  load(): Promise<any>;
}

export class DanteSkillbookIntegration {
  constructor(options?: any);
  readonly reviewQueue: any;
  stats(): any;
  getRelevantSkills(context: any, limit?: number): any[];
  triggerReflection(taskResult: any, options?: any, llmCall?: any): Promise<any>;
  applyProposals(proposals: any[], decisions: any[], opts?: any): { applied: number; queued: number; rejected: number };
  applyReviewItem(queueId: string): boolean;
  prune(policy?: any): void;
  save(): void;
  reload(): void;
  getTopSkills(n: number): any[];
  recordSkillUse(skillId: string): void;
  recordSessionOutcome(skillIds: string[], succeeded: boolean): void;
  getEffectivenessReport(): Array<{ skillId: string; winRate: number; appliedInSessions: number; effectivenessScore: number }>;
}

export function getRelevantSkills(skills: any[], context: any, limit?: number): any[];
export function pruneSkills(skills: any[], policy?: any): any[];
export function computeStats(skills: any[]): any;

export type Skill = any;
export type UpdateOperation = any;
export type SkillbookGateDecision = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
