import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { compact, fail, nodeId, text, toFigmaColor } from "../../schemas/common";

/**
 * Register variable tools to the MCP server
 * This module contains tools for managing Figma Variables (design tokens)
 * @param server - The MCP server instance
 */
export function registerVariableTools(server: McpServer): void {
  // Get Variables Tool
  server.tool(
    "get_variables",
    "List all variable collections and their variables in the current Figma file. Returns collections with their modes and variables.",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_variables", {});
        return text(compact(result));
      } catch (error) {
        return fail("get_variables failed", error);
      }
    }
  );

  // Set Variable Tool
  server.tool(
    "set_variable",
    "Create or update a variable in a Figma variable collection. Creates the collection if collectionName is provided and it doesn't exist.",
    {
      collectionId: z.string().optional().describe("Existing collection ID"),
      collectionName: z.string().optional().describe("Name for a new collection (used if collectionId is omitted)"),
      name: z.string().describe("Variable name"),
      resolvedType: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]),
      value: z
        .any()
        .describe("COLOR: hex string like #ee6112. FLOAT: number. STRING: string. BOOLEAN: boolean."),
      modeId: z.string().optional().describe("Mode ID (default: the collection's default mode)"),
    },
    async ({ collectionId, collectionName, name, resolvedType, value, modeId }) => {
      try {
        // COLOR 변수는 hex 문자열을 받아 플러그인이 기대하는 {r,g,b,a}로 변환한다.
        // 이미 객체로 넘어온 경우는 그대로 통과시킨다(하위 호환).
        const resolvedValue =
          resolvedType === "COLOR" && typeof value === "string" ? toFigmaColor(value) : value;

        const result = await sendCommandToFigma("set_variable", {
          collectionId,
          collectionName,
          name,
          resolvedType,
          value: resolvedValue,
          modeId,
        });
        const typedResult = result as { variableId: string; collectionName: string };
        return text(`variable ${typedResult.variableId} "${name}" in "${typedResult.collectionName}"`);
      } catch (error) {
        return fail("set_variable failed", error);
      }
    }
  );

  // Apply Variable to Node Tool
  server.tool(
    "apply_variable_to_node",
    "Bind a variable to a node property in Figma. Call once per field — for multiple fields, call multiple times.",
    {
      nodeId,
      variableId: z.string().describe("Variable ID"),
      field: z.string().describe("Property path, e.g. 'fills/0/color', 'opacity', 'width', 'height'"),
    },
    async ({ nodeId, variableId, field }) => {
      try {
        const result = await sendCommandToFigma("apply_variable_to_node", {
          nodeId,
          variableId,
          field,
        });
        const typedResult = result as { variableName: string; field: string };
        return text(`bound "${typedResult.variableName}" to ${typedResult.field} on ${nodeId}`);
      } catch (error) {
        return fail("apply_variable_to_node failed", error);
      }
    }
  );

  // Switch Variable Mode Tool
  server.tool(
    "switch_variable_mode",
    "Switch the variable mode on a node for a specific collection. This changes which mode's values are used for bound variables.",
    {
      nodeId,
      collectionId: z.string().describe("Variable collection ID"),
      modeId: z.string().describe("Mode ID to switch to"),
    },
    async ({ nodeId, collectionId, modeId }) => {
      try {
        const result = await sendCommandToFigma("switch_variable_mode", {
          nodeId,
          collectionId,
          modeId,
        });
        const typedResult = result as { collectionName: string; modeName: string };
        return text(`mode "${typedResult.modeName}" (${typedResult.collectionName}) -> ${nodeId}`);
      } catch (error) {
        return fail("switch_variable_mode failed", error);
      }
    }
  );
}
