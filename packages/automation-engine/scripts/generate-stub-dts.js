// Generate stub .d.ts file for automation-engine package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/automation-engine

export class GitAutomationOrchestrator {
  constructor(options: any);
  runWorkflow(request: any): Promise<any>;
  runWorkflowInBackground(request: any): Promise<any>;
  runAutoPRInBackground(options: any): Promise<any>;
  createPullRequest(options: any): Promise<any>;
  listExecutions(): Promise<any[]>;
}

export type WorkflowRequest = any;
export type WorkflowBackgroundRequest = any;
export type FileChangeEvent = any;
export type AutomationDefinition = any;
export type AgentBridgeConfig = any;
export type AgentBridgeResult = any;

export class FilePatternWatcher {
  constructor(options: any);
  start(): Promise<void>;
  stop(): void;
  on(event: string, callback: (event: any) => void): void;
}

export function getTemplate(name: string): any;
export function listTemplates(): any[];
export function substitutePromptVars(template: string, context: any): string;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
