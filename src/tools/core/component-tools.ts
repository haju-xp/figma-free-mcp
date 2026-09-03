import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { compact, fail, nodeId, text } from "../../schemas/common";

/**
 * Register component-related tools to the MCP server
 * This module contains tools for working with components in Figma
 * @param server - The MCP server instance
 */
export function registerComponentTools(server: McpServer): void {
  // Create Component Instance Tool
  server.tool(
    "create_component_instance",
    "Create an instance of a component in Figma. x/y are local coordinates relative to parent.",
    {
      componentKey: z.string().describe("Component key (not the node ID)"),
      x: z.number(),
      y: z.number(),
    },
    async ({ componentKey, x, y }) => {
      try {
        const result = await sendCommandToFigma("create_component_instance", {
          componentKey,
          x,
          y,
        });
        const { id } = result as { id: string };
        return text(`instance ${id}`);
      } catch (error) {
        return fail("create_component_instance failed", error);
      }
    }
  );

  // Create Component from Node Tool
  server.tool(
    "create_component_from_node",
    "Convert an existing node (frame, group, etc.) into a reusable component in Figma. Returns the component key needed by create_component_instance.",
    {
      nodeId,
      name: z.string().optional().describe("New component name"),
    },
    async ({ nodeId, name }) => {
      try {
        const result = await sendCommandToFigma("create_component_from_node", {
          nodeId,
          name,
        });
        const typedResult = result as { id: string; key: string };
        return text(`component ${typedResult.id} key=${typedResult.key}`);
      } catch (error) {
        return fail("create_component_from_node failed", error);
      }
    }
  );

  // Create Component Set from Components Tool
  server.tool(
    "create_component_set",
    "Create a component set (variants) from multiple component nodes in Figma",
    {
      componentIds: z.array(z.string()).describe("Component node IDs to combine"),
      name: z.string().optional(),
    },
    async ({ componentIds, name }) => {
      try {
        const result = await sendCommandToFigma("create_component_set", {
          componentIds,
          name,
        });
        const typedResult = result as { id: string; key: string; variantCount: number };
        return text(`componentSet ${typedResult.id} key=${typedResult.key} variants=${typedResult.variantCount}`);
      } catch (error) {
        return fail("create_component_set failed", error);
      }
    }
  );

  // Set Instance Variant Tool
  server.tool(
    "set_instance_variant",
    "Change the variant properties of a component instance without recreating it. This preserves instance overrides and is more efficient than delete + create workflow.",
    {
      nodeId: z.string().describe("Instance node ID"),
      properties: z
        .record(z.string())
        .describe('Variant properties, e.g. { "State": "Hover", "Size": "Large" }'),
    },
    async ({ nodeId, properties }) => {
      try {
        const result = await sendCommandToFigma("set_instance_variant", {
          nodeId,
          properties,
        });
        const typedResult = result as { properties: Record<string, string> };
        return text(`variant ${nodeId} ${compact(typedResult.properties)}`);
      } catch (error) {
        return fail("set_instance_variant failed", error);
      }
    }
  );
}
