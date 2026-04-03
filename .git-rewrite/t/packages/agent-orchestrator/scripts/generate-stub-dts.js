// Generate stub .d.ts file for agent-orchestrator package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/agent-orchestrator

export const AgentOrchestrator: any;
export const createSubAgent: any;
export class UpliftOrchestrator {
  constructor(options: any);
  executeSubTask(parentId: string, role: string, task: string): Promise<string>;
}

export type SubAgentConfig = any;
export type OrchestratorOptions = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
