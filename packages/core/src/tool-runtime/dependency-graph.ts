/**
 * dependency-graph.ts
 *
 * Minimal per-tool-call dependency graph used by the scheduler. This is the
 * explicit call-id layer that the PRD expects in addition to tool-name policy
 * dependencies.
 */

export type DependencyNodeState = 'pending' | 'satisfied' | 'failed';

export interface DependencyReadiness {
  ready: boolean;
  pending: string[];
  failed: string[];
  missing: string[];
  cycle: string[] | null;
}

export class DependencyGraph {
  private readonly _dependencies = new Map<string, string[]>();
  private readonly _states = new Map<string, DependencyNodeState>();

  register(id: string, dependsOn: string[] = []): void {
    this._dependencies.set(id, uniqueIds(dependsOn));
    if (!this._states.has(id)) {
      this._states.set(id, 'pending');
    }
  }

  has(id: string): boolean {
    return this._dependencies.has(id);
  }

  getDependencies(id: string): string[] {
    return [...(this._dependencies.get(id) ?? [])];
  }

  setState(id: string, state: DependencyNodeState): void {
    if (!this._dependencies.has(id)) {
      this.register(id);
    }
    this._states.set(id, state);
  }

  getState(id: string): DependencyNodeState | undefined {
    return this._states.get(id);
  }

  inspect(id: string): DependencyReadiness {
    const cycle = this.detectCycle(id);
    if (cycle) {
      return {
        ready: false,
        pending: [],
        failed: [],
        missing: [],
        cycle,
      };
    }

    const pending: string[] = [];
    const failed: string[] = [];
    const missing: string[] = [];

    for (const dependencyId of this.getDependencies(id)) {
      const state = this._states.get(dependencyId);
      if (typeof state === 'undefined') {
        missing.push(dependencyId);
      } else if (state === 'pending') {
        pending.push(dependencyId);
      } else if (state === 'failed') {
        failed.push(dependencyId);
      }
    }

    return {
      ready: pending.length === 0 && failed.length === 0 && missing.length === 0,
      pending,
      failed,
      missing,
      cycle: null,
    };
  }

  detectCycle(startId: string): string[] | null {
    const visited = new Set<string>();
    return this._visit(startId, visited, []);
  }

  private _visit(
    currentId: string,
    visited: Set<string>,
    path: string[],
  ): string[] | null {
    const cycleStart = path.indexOf(currentId);
    if (cycleStart >= 0) {
      return [...path.slice(cycleStart), currentId];
    }

    if (visited.has(currentId)) {
      return null;
    }

    visited.add(currentId);
    const nextPath = [...path, currentId];
    for (const dependencyId of this.getDependencies(currentId)) {
      const cycle = this._visit(dependencyId, visited, nextPath);
      if (cycle) {
        return cycle;
      }
    }

    return null;
  }
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.length > 0)));
}
