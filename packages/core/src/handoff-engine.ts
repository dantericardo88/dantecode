// ============================================================================
// @dantecode/core — Swarm Handoff Engine
// Extremely lightweight and elegant handoff mechanism for on-the-fly spawning.
// Harvested from OpenAI Swarm patterns.
// ============================================================================

import type { SubAgentManager } from "./subagent-manager.js";

export interface AgentContext {
  id: string;
  role: string;
  instructions: string;
  variables: Record<string, any>;
  history: Array<{ role: string; content: string }>;
}

export interface HandoffSignal {
  _isHandoff: true;
  targetRole: string;
  reason: string;
  instructions: string;
  contextUpdates?: Record<string, any>;
}

export interface HandoffEngineOptions {
  manager: SubAgentManager;
  maxHandoffs?: number;
}

export class HandoffEngine {
  private manager: SubAgentManager;
  private maxHandoffs: number;

  constructor(options: HandoffEngineOptions) {
    this.manager = options.manager;
    this.maxHandoffs = options.maxHandoffs ?? 10;
  }

  /**
   * Creates a formal handoff signal object that an agent can return to indicate
   * it wants to transfer control to another specialized role.
   */
  createHandoff(
    targetRole: string,
    reason: string,
    instructions: string,
    contextUpdates?: Record<string, any>,
  ): HandoffSignal {
    return {
      _isHandoff: true,
      targetRole,
      reason,
      instructions,
      contextUpdates,
    };
  }

  /**
   * Checks if an object is a HandoffSignal.
   */
  isHandoff(obj: any): obj is HandoffSignal {
    return obj && typeof obj === "object" && obj._isHandoff === true;
  }

  /**
   * Executes a Swarm-style loop, handing off between agents dynamically until
   * a terminal response is reached (or max handoffs exceeded).
   */
  async runHandoffLoop(
    startContext: AgentContext,
    agentExecutor: (ctx: AgentContext) => Promise<string | HandoffSignal>,
  ): Promise<string> {
    const currentContext = { ...startContext };
    let handoffCount = 0;

    // Auto-spawn the first agent via the manager
    let currentTask = this.manager.spawn(startContext.instructions, {
      name: startContext.role,
      description: `Starts the handoff loop as ${startContext.role}`,
    });

    try {
      while (handoffCount < this.maxHandoffs) {
        // Execute the current agent
        const response = await agentExecutor(currentContext);

        if (this.isHandoff(response)) {
          // Record completion of the current task
          this.manager.completeTask(
            currentTask.id,
            `Handed off to ${response.targetRole}: ${response.reason}`,
          );

          handoffCount++;

          // Apply variable updates
          currentContext.variables = { ...currentContext.variables, ...response.contextUpdates };
          currentContext.role = response.targetRole;
          currentContext.instructions = response.instructions;
          // Add handoff notice to history
          currentContext.history.push({
            role: "system",
            content: `Swarm handoff transferred control to ${response.targetRole}. Reason: ${response.reason}`,
          });

          // Spawn the next agent via the manager
          currentTask = this.manager.spawn(response.instructions, {
            name: response.targetRole,
            description: `Handoff from previous agent: ${response.reason}`,
            parentId: currentTask.agentId,
          });
        } else {
          // Terminal string output reached
          this.manager.completeTask(currentTask.id, response);

          return response;
        }
      }

      const failMsg = `Max Swarm handoffs (${this.maxHandoffs}) exceeded. Terminating to prevent infinite loop.`;
      this.manager.failTask(currentTask.id, failMsg);
      return `Error: ${failMsg}`;
    } catch (err: any) {
      this.manager.failTask(currentTask.id, err.message || String(err));
      throw err;
    }
  }
}
