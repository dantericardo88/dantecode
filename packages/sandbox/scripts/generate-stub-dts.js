// Generate stub .d.ts file for sandbox package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/sandbox

// Container Lifecycle
export class SandboxManager {
  constructor(spec: any);
  start(): Promise<void>;
  stop(): Promise<void>;
  execute(command: string, options?: any): Promise<any>;
}
export type ExecOptions = any;

// High-Level Executor
export class SandboxExecutor {
  constructor(manager: SandboxManager, projectRoot: string, auditLogger: any);
  run(command: string, timeoutMs?: number): Promise<any>;
  runBatch(commands: string[]): Promise<any[]>;
  isAvailable(): Promise<boolean>;
}
export function createDefaultSandboxSpec(projectRoot: string): any;
export type AuditLoggerFn = (event: any) => void;

// Fallback (No Docker)
export class LocalExecutor {
  execute(command: string): Promise<any>;
}
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
