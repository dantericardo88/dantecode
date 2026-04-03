// ============================================================================
// @dantecode/mcp — MCP Tool Bridge
// Converts MCP tool definitions (JSON Schema) to AI SDK Zod schemas so they
// can be used alongside native DanteCode tools in streamWithTools().
// ============================================================================

import { z } from "zod";
import type { MCPToolDefinition } from "@dantecode/config-types";

/** A tool schema compatible with AI SDK's streamText({ tools }). */
export interface BridgedToolSchema {
  description: string;
  parameters: z.ZodTypeAny;
}

/**
 * Converts a JSON Schema type to a Zod schema.
 * Handles: string, number, integer, boolean, array, object.
 * Falls back to z.any() for complex/unsupported schemas.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema.type as string | undefined;
  const description = schema.description as string | undefined;

  if (!type) {
    return description ? z.any().describe(description) : z.any();
  }

  switch (type) {
    case "string": {
      if (schema.enum && Array.isArray(schema.enum)) {
        const values = schema.enum as [string, ...string[]];
        return description ? z.enum(values).describe(description) : z.enum(values);
      }
      const s = z.string();
      return description ? s.describe(description) : s;
    }

    case "number":
    case "integer": {
      let n = z.number();
      if (type === "integer") n = n.int();
      return description ? n.describe(description) : n;
    }

    case "boolean":
      return description ? z.boolean().describe(description) : z.boolean();

    case "array": {
      const itemSchema = schema.items as Record<string, unknown> | undefined;
      const items = itemSchema ? jsonSchemaToZod(itemSchema) : z.any();
      return description ? z.array(items).describe(description) : z.array(items);
    }

    case "object": {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (schema.required as string[]) ?? [];

      if (!properties || Object.keys(properties).length === 0) {
        return description
          ? z.record(z.string(), z.any()).describe(description)
          : z.record(z.string(), z.any());
      }

      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        const zodProp = jsonSchemaToZod(propSchema);
        shape[key] = required.includes(key) ? zodProp : zodProp.optional();
      }
      return description ? z.object(shape).describe(description) : z.object(shape);
    }

    default:
      return description ? z.any().describe(description) : z.any();
  }
}

/**
 * Converts a single MCP tool definition to an AI SDK-compatible Zod tool schema.
 */
export function mcpToolToZodSchema(tool: MCPToolDefinition): BridgedToolSchema {
  const inputSchema = tool.inputSchema;
  const parameters = jsonSchemaToZod(inputSchema);

  return {
    description: tool.description || `MCP tool: ${tool.name} (from ${tool.serverName})`,
    parameters,
  };
}

/**
 * Converts all MCP tools to AI SDK tool schemas.
 * Tool names are prefixed with `mcp_` to avoid collisions with native tools.
 */
export function mcpToolsToAISDKTools(
  tools: MCPToolDefinition[],
): Record<string, BridgedToolSchema> {
  const result: Record<string, BridgedToolSchema> = {};
  for (const tool of tools) {
    // Prefix to distinguish MCP tools from native tools
    const key = `mcp_${tool.serverName}_${tool.name}`;
    result[key] = mcpToolToZodSchema(tool);
  }
  return result;
}

/**
 * Parses an MCP-prefixed tool name back to server + tool name.
 * Returns null if the name is not an MCP tool.
 */
export function parseMCPToolName(name: string): { serverName: string; toolName: string } | null {
  if (!name.startsWith("mcp_")) return null;
  const rest = name.slice(4); // remove "mcp_"
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore === -1) return null;
  return {
    serverName: rest.slice(0, firstUnderscore),
    toolName: rest.slice(firstUnderscore + 1),
  };
}
