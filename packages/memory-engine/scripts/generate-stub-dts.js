// Generate stub .d.ts file for memory-engine package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/memory-engine

export class MemoryOrchestrator {
  constructor(options?: any);
  initialize(): Promise<void>;
  memoryStore(key: string, value: any, scope?: any): Promise<any>;
  memoryRecall(query: string, limit?: number, scope?: any): Promise<any>;
  memorySummarize(sessionId: string): Promise<any>;
  memoryPrune(threshold?: number): Promise<any>;
  crossSessionRecall(userGoal?: string, limit?: number): Promise<any>;
  memoryVisualize(scope?: any): any;
}

export function createMemoryOrchestrator(options?: any): MemoryOrchestrator;
export function getGlobalLogger(options?: any): any;

export type MemoryEntry = any;
export type MemoryOrgan = any;
export type MemoryScope = any;
export type MemoryStoreResult = any;
export type MemoryRecallResult = any;
export type MemorySummarizeResult = any;
export type MemoryPruneResult = any;
export type MemoryVisualizeResult = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
