import { parseActionsFromToolCalls } from "./action-dispatcher.js";

export interface DispatchToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface NormalizeActionToolCallsOptions {
  silent: boolean;
}

export interface NormalizeActionToolCallsResult<TToolCall extends DispatchToolCall> {
  normalizedToolCalls: TToolCall[];
  inlineToolResults: string[];
  virtualToolCallCount: number;
  logMessages: string[];
}

export const ACTION_TOOL_NAMES = new Set([
  "execute_bash",
  "str_replace_based_edit_tool",
  "think",
  "finish",
]);

export function normalizeActionToolCalls<TToolCall extends DispatchToolCall>(
  toolCalls: TToolCall[],
  options: NormalizeActionToolCallsOptions,
): NormalizeActionToolCallsResult<TToolCall> {
  const normalizedToolCalls: TToolCall[] = [];
  const inlineToolResults: string[] = [];
  const logMessages: string[] = [];
  let virtualToolCallCount = 0;

  for (const toolCall of toolCalls) {
    if (!ACTION_TOOL_NAMES.has(toolCall.name)) {
      normalizedToolCalls.push(toolCall);
      continue;
    }

    const actions = parseActionsFromToolCalls([
      { toolName: toolCall.name, args: toolCall.input },
    ]);

    for (const action of actions) {
      switch (action.type) {
        case "cmd_run":
          normalizedToolCalls.push({
            ...toolCall,
            name: "Bash",
            input: {
              command: action.command,
              ...(action.timeout !== undefined ? { timeout: action.timeout } : {}),
            },
          });
          break;
        case "file_write":
          normalizedToolCalls.push({
            ...toolCall,
            name: "Write",
            input: {
              file_path: action.path,
              content: action.content,
            },
          });
          break;
        case "file_read":
          normalizedToolCalls.push({
            ...toolCall,
            name: "Read",
            input: { file_path: action.path },
          });
          break;
        case "file_edit":
          normalizedToolCalls.push({
            ...toolCall,
            name: "Edit",
            input: {
              file_path: action.path,
              old_string: action.old_str,
              new_string: action.new_str,
            },
          });
          break;
        case "think":
          inlineToolResults.push(`[think] ${action.thought.slice(0, 3000)}`);
          virtualToolCallCount++;
          break;
        case "agent_finish": {
          const finishContent = action.thought || JSON.stringify(action.outputs);
          inlineToolResults.push(`[agent_finish] ${finishContent.slice(0, 3000)}`);
          virtualToolCallCount++;
          if (!options.silent) {
            logMessages.push("[agent_finish] task declared complete");
          }
          break;
        }
        case "condense":
          inlineToolResults.push(`[condense] ${action.summary.slice(0, 3000)}`);
          virtualToolCallCount++;
          break;
      }
    }
  }

  return {
    normalizedToolCalls,
    inlineToolResults,
    virtualToolCallCount,
    logMessages,
  };
}
