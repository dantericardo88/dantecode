import { describe, it, expect } from "vitest";
import { RuntimeEventSchema } from "@dantecode/runtime-spine";
import { SubAgentSpawner } from "./subagent-spawner";
import { HandoffEngine } from "./handoff-engine";

describe("Agent Orchestrator MVP", () => {
  describe("SubAgentSpawner", () => {
    it("should spawn a new subagent with a valid task packet", () => {
      const spawner = new SubAgentSpawner();
      const instance = spawner.spawn("researcher", "Research AI trends");

      expect(instance.role).toBe("researcher");
      expect(instance.task.objective).toBe("Research AI trends");
      expect(instance.status).toBe("idle");
    });
  });

  describe("HandoffEngine", () => {
    it("should initiate a handoff event", async () => {
      const engine = new HandoffEngine();
      const event = await engine.initiateHandoff({
        fromId: "agent-1",
        toRole: "critic",
        reason: "Need review",
        context: {},
      });

      expect(event.kind).toBe("subagent.handoff");
      expect(event.payload.fromId).toBe("agent-1");
      expect(event.payload.toRole).toBe("critic");
      expect(RuntimeEventSchema.safeParse(event).success).toBe(true);
    });
  });
});
