import type { 
  RuntimeEvent, 
  RuntimeTaskPacket, 
  Checkpoint 
} from "@dantecode/runtime-spine";

export interface HandoffSignal {
  fromId: string;
  toRole: string;
  reason: string;
  context: Record<string, unknown>;
}

/**
 * Handoff engine for managing agent-to-agent control transfers.
 */
export class HandoffEngine {
  async initiateHandoff(signal: HandoffSignal): Promise<RuntimeEvent> {
    const event: RuntimeEvent = {
      at: new Date().toISOString(),
      kind: "subagent.handoff",
      taskId: signal.fromId,
      payload: {
        toRole: signal.toRole,
        reason: signal.reason,
        context: signal.context
      }
    };

    // logic to persist handoff in checkpoint
    return event;
  }

  async resumeFromHandoff(checkpoint: Checkpoint): Promise<RuntimeTaskPacket> {
    if (!checkpoint.handoff) {
      throw new Error("Checkpoint does not contain handoff metadata");
    }

    return {
      ...checkpoint.task,
      role: checkpoint.handoff.toRole,
      context: {
        ...checkpoint.task.context,
        handoffReason: checkpoint.handoff.reason
      }
    };
  }
}
