// Generate stub .d.ts file for skill-adapter package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/skill-adapter

// --- Parsers ---
export function scanClaudeSkills(dir: string): any;
export function parseClaudeSkill(content: string, filePath: string): any;
export function scanContinueAgents(dir: string): any;
export function parseContinueAgent(content: string, filePath: string): any;
export function scanOpencodeAgents(dir: string): any;
export function parseOpencodeAgent(content: string, filePath: string): any;
export function scanCodexSkills(dir: string): any;
export function parseCodexSkill(content: string, filePath: string): any;
export function scanCursorRules(dir: string): any;
export function parseCursorRule(content: string, filePath: string): any;
export function scanQwenSkills(dir: string): any;
export function parseQwenSkill(content: string, filePath: string): any;

export type ScannedSkill = any;
export type ParsedClaudeSkill = any;
export type ScannedContinueAgent = any;
export type ParsedContinueAgent = any;
export type ScannedOpencodeAgent = any;
export type ParsedOpencodeAgent = any;
export type ScannedCodexSkill = any;
export type ParsedCodexSkill = any;
export type ScannedCursorRule = any;
export type ParsedCursorRule = any;
export type ScannedQwenSkill = any;
export type ParsedQwenSkill = any;

// --- Adapter Wrapping ---
export function wrapSkillWithAdapter(parsedSkill: any, source: any): any;
export const ADAPTER_VERSION: string;
export type ParsedSkill = any;
export type ImportSource = string;

// --- Import Orchestrator ---
export function importSkills(options: any): Promise<any>;
export function loadChecks(projectRoot: string): Promise<any>;
export type ImportOptions = any;
export type ImportResult = any;
export type SkippedSkill = any;

// --- Skill Registry ---
export function loadSkillRegistry(projectRoot: string): Promise<any[]>;
export function getSkill(name: string, projectRoot: string): Promise<any | null>;
export function getSkillWithBridgeMeta(name: string, projectRoot: string): Promise<any | null>;
export function listSkills(projectRoot: string): Promise<any[]>;
export function removeSkill(name: string, projectRoot: string): Promise<boolean>;
export function validateSkill(skill: any, projectRoot: string): Promise<any>;

export type SkillRegistryEntry = any;
export type SkillValidationResult = any;
export type SkillDefinitionWithMeta = any;

// --- SkillBridge Types ---
export type SkillBridgeManifest = any;
export type SkillBridgeSource = any;
export type SkillBridgeEmitters = any;
export type SkillBridgeVerification = any;
export type SkillBridgeTarget = any;
export type SkillBridgeParseResult = any;
export type SkillClassification = any;
export type SkillRiskLevel = any;
export type EmitterStatus = any;
export type EmitterResult = any;
export type CapabilityProfile = any;
export type NormalizedSkill = any;
export type BridgeBundleMetadata = any;
export type BundleBucket = any;
export function getRiskLevel(classification: any): any;

// --- SkillBridge Parser ---
export function parseSkillBridgeManifest(manifestPath: string): any;
export function bundleHasDanteCodeTarget(manifest: any): boolean;
export function getDanteCodeTargetPath(manifest: any): string | null;
export function sanitizeSlug(slug: string): string;

// --- SkillBridge Import Bridge ---
export function importSkillBridgeBundle(bundlePath: string, options?: any): Promise<any>;
export function listBridgeWarnings(skillName: string): any[];
export function validateBridgeSkill(skillName: string): any;
export function checkBridgeManifestIntegrity(manifestPath: string): any;
export type ImportBridgeOptions = any;
export type ImportBridgeResult = any;

// --- Universal Parser + Format Detection ---
export function detectSkillSources(dir: string): any;
export function parseUniversalSkill(filePath: string, format: any): any;
export function universalToWrappable(parsed: any, source: any): any;
export type SkillSourceFormat = any;
export type DetectionResult = any;
export type UniversalParsedSkill = any;

// --- Skill Verifier ---
export function verifySkill(skill: any, options?: any): Promise<any>;
export function tierMeetsMinimum(actual: any, required: any): boolean;
export type SkillFinding = any;
export type ScriptSafetyResult = any;
export type SkillVerificationResult = any;
export type VerifyOptions = any;

// --- Marketplace ---
export class SkillCatalog {
  constructor();
  load(): Promise<void>;
  search(query: string): any[];
  getEntry(id: string): any;
}
export function installSkill(entryId: string, options?: any): Promise<any>;
export function bundleSkill(skillName: string, options?: any): Promise<any>;
export function exportSkillToDirectory(skillName: string, targetDir: string): Promise<void>;
export type CatalogEntry = any;
export type InstallOptions = any;
export type InstallResult = any;
export type BundleOptions = any;
export type BundleResult = any;

// --- Composer ---
export class SkillChain {
  constructor(definition: any);
  execute(context: any): Promise<any>;
}
export function executeChain(definition: any, context: any): Promise<any>;
export function resolveParams(params: any, context: any): any;
export function evaluateGate(gate: any, context: any): any;
export function scorePassesThreshold(score: number, threshold: number): boolean;
export function selectOnFail(failAction: any): any;
export type ChainStep = any;
export type ChainDefinition = any;
export type StepExecutionResult = any;
export type ChainExecutionResult = any;
export type StepCallbackResult = any;
export type ExecutionContext = any;
export type GateEvaluation = any;
export type GateCondition = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
