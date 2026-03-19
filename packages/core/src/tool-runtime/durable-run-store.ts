// packages/core/src/tool-runtime/durable-run-store.ts — DTR Gen7: Persist/resume tool runs

import fs from 'fs/promises';
import path from 'path';
import type { ToolCallRecord, ToolExecutionResult } from './tool-call-types.js';
import { ArtifactStore } from './artifact-store.js';

import type { Session } from '@dantecode/config-types';

export interface DurableRunState {
  id: string;
  sessionId: string;
  workflow?: string;
  prompt: string;
  toolCalls: ToolCallRecord[];
  results: ToolExecutionResult[];
  artifacts: string[]; // ArtifactIDs
  evidence: Array<{ kind: string; label: string; success: boolean }>;
  status: 'running' | 'paused' | 'complete' | 'failed';
  lastConfirmedStep: string;
  lastSuccessfulTool?: string;
  nextAction: string;
  touchedFiles: string[];
  createdAt: string;
  updatedAt: string;
}

export class DurableRunStore {
  private readonly storeDir: string;
  private readonly storeFile(sessionId: string): string {
    return path.join(this.storeDir, `${sessionId}.json`);
  }

  constructor(projectRoot: string) {
    this.storeDir = path.join(projectRoot, '.dantecode', 'runs');
  }

  async initializeRun(init: {
    runId: string;
    session: Session;
    prompt: string;
    workflow?: string;
  }): Promise<DurableRunState> {
    const state: DurableRunState = {
      id: init.runId,
      sessionId: init.session.id,
      workflow: init.workflow,
      prompt: init.prompt,
      toolCalls: [],
      results: [],
      artifacts: [],
      evidence: [],
      status: 'running',
      lastConfirmedStep: 'Initialized',
      nextAction: 'Execute first tool calls',
      touchedFiles: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.persistState(init.session.id, state);
    return state;
  }

  async persistState(sessionId: string, state: DurableRunState): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    state.updatedAt = new Date().toISOString();
    await fs.writeFile(this.storeFile(sessionId), JSON.stringify(state, null, 2));
  }

  async loadRun(runId: string): Promise<DurableRunState | null> {
    try {
      const files = await fs.readdir(this.storeDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const data = await fs.readFile(path.join(this.storeDir, file), 'utf8');
          const state: DurableRunState = JSON.parse(data);
          if (state.id === runId) {
            // Restore artifacts
            for (const artifactId of state.artifacts) {
              ArtifactStore.restore(artifactId);
            }
            return state;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async getLatestWaitingUserRun(): Promise<DurableRunState | null> {
    // Impl: scan for latest 'running' or 'paused' w/ waiting user input
    return null; // Stub for now
  }

  async checkpoint(runId: string, checkpoint: {
    session: Session;
    touchedFiles: string[];
    lastConfirmedStep: string;
    lastSuccessfulTool?: string;
    nextAction: string;
    evidence: Array<{ kind: string; label: string; success: boolean }>;
  }): Promise<void> {
    const state = await this.loadRun(runId);
    if (state) {
      state.toolCalls = []; // From session
      state.results = []; // From session
      state.touchedFiles.push(...checkpoint.touchedFiles);
      state.lastConfirmedStep = checkpoint.lastConfirmedStep;
      state.lastSuccessfulTool = checkpoint.lastSuccessfulTool;
      state.nextAction = checkpoint.nextAction;
      state.evidence.push(...checkpoint.evidence);
      await this.persistState(state.sessionId, state);
    }
  }

  async completeRun(runId: string, final: {
    session: Session;
    touchedFiles: string[];
    lastConfirmedStep: string;
    lastSuccessfulTool?: string;
    nextAction: string;
    evidence: Array<{ kind: string; label: string; success: boolean }>;
  }): Promise<void> {
    const state = await this.loadRun(runId);
    if (state) {
      state.status = 'complete';
      state.touchedFiles.push(...final.touchedFiles);
      state.lastConfirmedStep = final.lastConfirmedStep;
      state.lastSuccessfulTool = final.lastSuccessfulTool;
      state.nextAction = final.nextAction;
      state.evidence.push(...final.evidence);
      await this.persistState(state.sessionId, state);
    }
  }

  async pauseRun(runId: string, pause: {
    session: Session;
    touchedFiles: string[];
    lastConfirmedStep: string;
    lastSuccessfulTool?: string;
    nextAction: string;
    reason: string;
    message: string;
    evidence: Array<{ kind: string; label: string; success: boolean }>;
  }): Promise<void> {
    const state = await this.loadRun(runId);
    if (state) {
      state.status = 'paused';
      state.touchedFiles.push(...pause.touchedFiles);
      state.lastConfirmedStep = pause.lastConfirmedStep;
      state.lastSuccessfulTool = pause.lastSuccessfulTool;
      state.nextAction = pause.nextAction;
      state.evidence.push(...pause.evidence);
      await this.persistState(state.sessionId, state);
    }
  }

  async failRun(runId: string, fail: {
    session: Session;
    touchedFiles: string[];
    lastConfirmedStep: string;
    lastSuccessfulTool?: string;
    nextAction: string;
    message: string;
    evidence: Array<{ kind: string; label: string; success: boolean }>;
  }): Promise<void> {
    const state = await this.loadRun(runId);
    if (state) {
      state.status = 'failed';
      state.touchedFiles.push(...fail.touchedFiles);
      state.lastConfirmedStep = fail.lastConfirmedStep;
      state.lastSuccessfulTool = fail.lastSuccessfulTool;
      state.nextAction = fail.nextAction;
      state.evidence.push(...fail.evidence);
      await this.persistState(state.sessionId, state);
    }
  }

  async persistArtifacts(runId: string, artifacts: string[]): Promise<void> {
    const state = await this.loadRun(runId);
    if (state) {
      state.artifacts.push(...artifacts);
      await this.persistState(state.sessionId, state);
    }
  }

  async getResumeHint(runId: string): Promise<{
    summary?: string;
    lastConfirmedStep?: string;
    lastSuccessfulTool?: string;
    nextAction?: string;
  } | null> {
    const state = await this.loadRun(runId);
    if (state && (state.status === 'running' || state.status === 'paused')) {
      return {
        summary: `Status: ${state.status}, ${state.touchedFiles.length} files touched`,
        lastConfirmedStep: state.lastConfirmedStep,
        lastSuccessfulTool: state.lastSuccessfulTool,
        nextAction: state.nextAction,
      };
    }
    return null;
  }

  async loadSessionSnapshot(runId: string): Promise<Session | null> {
    // Stub: restore full session from run state
    return null;
  }
}

// Global singleton
let globalDurableStore: DurableRunStore | undefined;
export function getDurableRunStore(projectRoot: string): DurableRunStore {
  if (!globalDurableStore) {
    globalDurableStore = new DurableRunStore(projectRoot);
  }
  return globalDurableStore;
}

// Export for agent-loop
import type { SessionMessage } from '@dantecode/config-types';
export type ToolCallRecord = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  message?: SessionMessage;
};