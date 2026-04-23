import { describe, expect, it } from "vitest";

import { normalizeActionToolCalls } from "./tool-dispatch.js";

describe("tool-dispatch", () => {
  it("leaves native tool calls untouched", () => {
    const toolCalls = [
      {
        id: "native-1",
        name: "Read",
        input: { file_path: "src/example.ts" },
      },
    ];

    const result = normalizeActionToolCalls(toolCalls, { silent: true });

    expect(result.normalizedToolCalls).toEqual(toolCalls);
    expect(result.inlineToolResults).toEqual([]);
    expect(result.virtualToolCallCount).toBe(0);
    expect(result.logMessages).toEqual([]);
  });

  it("normalizes OpenHands action tools into native DanteCode tools", () => {
    const toolCalls = [
      {
        id: "bash-1",
        name: "execute_bash",
        input: { command: "npm test", timeout: 5000 },
      },
      {
        id: "create-1",
        name: "str_replace_based_edit_tool",
        input: {
          command: "create",
          path: "src/new.ts",
          file_text: "export const x = 1;\n",
        },
      },
      {
        id: "view-1",
        name: "str_replace_based_edit_tool",
        input: { command: "view", path: "src/existing.ts" },
      },
      {
        id: "edit-1",
        name: "str_replace_based_edit_tool",
        input: {
          command: "str_replace",
          path: "src/existing.ts",
          old_str: "before",
          new_str: "after",
        },
      },
    ];

    const result = normalizeActionToolCalls(toolCalls, { silent: true });

    expect(result.normalizedToolCalls).toEqual([
      {
        id: "bash-1",
        name: "Bash",
        input: { command: "npm test", timeout: 5000 },
      },
      {
        id: "create-1",
        name: "Write",
        input: { file_path: "src/new.ts", content: "export const x = 1;\n" },
      },
      {
        id: "view-1",
        name: "Read",
        input: { file_path: "src/existing.ts" },
      },
      {
        id: "edit-1",
        name: "Edit",
        input: {
          file_path: "src/existing.ts",
          old_string: "before",
          new_string: "after",
        },
      },
    ]);
  });

  it("turns think and finish actions into inline tool results and virtual tool counts", () => {
    const toolCalls = [
      {
        id: "think-1",
        name: "think",
        input: { thought: "Check the tests first." },
      },
      {
        id: "finish-1",
        name: "finish",
        input: { outputs: { result: "done" }, thought: "All set." },
      },
    ];

    const result = normalizeActionToolCalls(toolCalls, { silent: false });

    expect(result.normalizedToolCalls).toEqual([]);
    expect(result.inlineToolResults).toEqual([
      "[think] Check the tests first.",
      "[agent_finish] All set.",
    ]);
    expect(result.virtualToolCallCount).toBe(2);
    expect(result.logMessages).toEqual(["[agent_finish] task declared complete"]);
  });

  it("drops unsupported action subcommands instead of inventing native tool calls", () => {
    const toolCalls = [
      {
        id: "unknown-1",
        name: "str_replace_based_edit_tool",
        input: { command: "undo", path: "src/example.ts" },
      },
    ];

    const result = normalizeActionToolCalls(toolCalls, { silent: true });

    expect(result.normalizedToolCalls).toEqual([]);
    expect(result.inlineToolResults).toEqual([]);
    expect(result.virtualToolCallCount).toBe(0);
  });
});
