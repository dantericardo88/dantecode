// Generate stub .d.ts file for dante-sandbox package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/dante-sandbox

// Primary Integration Surface
export const DanteSandbox: {
  setup(options?: any): Promise<void>;
  execute(request: any, options?: any): Promise<any>;
  execSync(command: string, options?: any): Promise<string>;
  toToolResult(result: any): any;
  status(): Promise<any>;
  setMode(mode: any): void;
  getAuditLog(): any;
  teardown(): Promise<void>;
  isReady(): boolean;
};

export function getEngine(): any;
export function toToolResult(result: any): any;
export function sandboxRun(request: any, options?: any): Promise<any>;
export function setGlobalProxy(proxy: any): void;
export function getGlobalProxy(): any;

// Approval Engine
export class ApprovalEngine {
  constructor(policy?: any);
  approve(request: any): Promise<any>;
  setPolicy(policy: any): void;
  addAllowRule(pattern: string): void;
}
export const globalApprovalEngine: ApprovalEngine;
export function getGlobalApprovalEngine(): ApprovalEngine;

// Engine & Layers
export class SandboxEngine {
  constructor(config?: any);
  execute(request: any): Promise<any>;
  teardown(): Promise<void>;
  setMode(mode: any): void;
  getStatus(): any;
  registerLayer(layer: any): void;
}

export class ExecutionProxy {
  constructor(engine: any);
  execute(request: any): Promise<any>;
  runSync(command: string, options?: any): Promise<string>;
}

export class NativeSandbox {
  constructor(projectRoot: string);
}

export class DockerIsolationLayer {
  constructor(projectRoot: string);
}

export class WorktreeIsolationLayer {
  constructor(projectRoot: string);
}

export class HostEscapeLayer {}

// Audit
export class SandboxAuditLog {
  constructor(options?: any);
  sink: any;
  flush(): Promise<void>;
}

export function noopAuditSink(record: any): void;

// Gates & Policy
export function buildDanteForgeGate(): any;
export function permissiveGate(): any;
export function evaluatePolicy(request: any, config?: any): any;
export function buildDecision(result: any): any;
export function buildBlockDecision(violation: any): any;

// Capability Detection
export function isDockerAvailable(): Promise<boolean>;
export function isWorktreeAvailable(): Promise<boolean>;
export function detectAvailableStrategies(): Promise<string[]>;
export function selectStrategy(available: string[]): string;
export function resetCapabilityCache(): void;

// Types
export type SandboxMode = "off" | "advisory" | "enforce" | "docker" | "worktree";
export type IsolationStrategy = "host" | "native" | "docker" | "worktree";
export type RiskLevel = "low" | "medium" | "high";
export type GateVerdict = "allow" | "warn" | "block";
export type ExecutionRequest = any;
export type ExecutionResult = any;
export type SandboxDecision = any;
export type SandboxViolation = any;
export type SandboxAuditRecord = any;
export type SandboxAuditRef = any;
export type SandboxStatus = any;
export type IsolationLayer = any;
export type GateFn = any;
export type AuditSink = any;
export type ProxyCallOptions = any;
export type SandboxEngineConfig = any;
export type ApprovalPolicy = any;
export type ApprovalRequest = any;
export type DanteSandboxSetupOptions = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
