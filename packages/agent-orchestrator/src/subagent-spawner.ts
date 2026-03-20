import { randomUUID } from "node:crypto";
import type { 
  RuntimeTaskPacket 
} from "@dantecode/runtime-spine";

export interface SpawnerOptions {
  maxConcurrency?: number;
}

export interface SubAgentInstance {
  id: string;
  role: string;
  task: RuntimeTaskPacket;
  status: "idle" | "running" | "completed" | "failed";
}

/**
 * Dynamic subagent spawner.
 * Responsible for creating and tracking specialized subagents.
 */
export class SubAgentSpawner {
  private instances = new Map<string, SubAgentInstance>();

  constructor(_options: SpawnerOptions = {}) {
    // maxConcurrency can be used for rate limiting in future
  }

  spawn(role: string, objective: string, context: Record<string, unknown> = {}): SubAgentInstance {
    const id = randomUUID();
    const task: RuntimeTaskPacket = {
      id: randomUUID(),
      kind: "subagent-task",
      objective,
      role,
      context,
      createdAt: new Date().toISOString()
    };

    const instance: SubAgentInstance = {
      id,
      role,
      task,
      status: "idle"
    };

    this.instances.set(id, instance);
    return instance;
  }

  getInstance(id: string): SubAgentInstance | undefined {
    return this.instances.get(id);
  }

  listInstances(): SubAgentInstance[] {
    return Array.from(this.instances.values());
  }

  updateStatus(id: string, status: SubAgentInstance["status"]): void {
    const instance = this.instances.get(id);
    if (instance) {
      instance.status = status;
    }
  }
}
