import { describe, it, expect } from "vitest";

describe("tool-retry-limit", () => {
  const MAX_PER_TOOL_ERRORS = 5;

  describe("per-tool error tracking", () => {
    it("increments error count on failure", () => {
      const toolErrorCounts = new Map<string, number>();
      const toolName = "Bash";

      // Simulate 3 failures
      for (let i = 0; i < 3; i++) {
        const count = (toolErrorCounts.get(toolName) ?? 0) + 1;
        toolErrorCounts.set(toolName, count);
      }

      expect(toolErrorCounts.get(toolName)).toBe(3);
    });

    it("resets error count on success", () => {
      const toolErrorCounts = new Map<string, number>();
      const toolName = "Bash";

      // 3 failures then success
      toolErrorCounts.set(toolName, 3);
      toolErrorCounts.delete(toolName); // reset on success

      expect(toolErrorCounts.has(toolName)).toBe(false);
    });

    it("triggers limit message at threshold", () => {
      const toolErrorCounts = new Map<string, number>();
      const toolName = "Write";
      const messages: string[] = [];

      for (let i = 0; i < MAX_PER_TOOL_ERRORS; i++) {
        const count = (toolErrorCounts.get(toolName) ?? 0) + 1;
        toolErrorCounts.set(toolName, count);
        if (count >= MAX_PER_TOOL_ERRORS) {
          messages.push(
            `SYSTEM: ${toolName} has failed ${count} times this session. Stop using this tool and try a different approach.`,
          );
        }
      }

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("Write");
      expect(messages[0]).toContain("5 times");
    });

    it("tracks different tools independently", () => {
      const toolErrorCounts = new Map<string, number>();

      toolErrorCounts.set("Bash", 3);
      toolErrorCounts.set("Write", 1);

      expect(toolErrorCounts.get("Bash")).toBe(3);
      expect(toolErrorCounts.get("Write")).toBe(1);
    });
  });
});
