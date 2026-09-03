import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { hexColorOptional, nodeId, text, fail, toFigmaColor } from "../../schemas/common";

/**
 * Register creation tools to the MCP server
 * This module contains tools for creating various shapes and elements in Figma
 * @param server - The MCP server instance
 */
export function registerCreationTools(server: McpServer): void {
  // Create Rectangle Tool
  server.tool(
    "create_rectangle",
    "Create a rectangle in Figma. x/y are local coordinates relative to parent.",
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      name: z.string().optional(),
      parentId: z.string().optional().describe("Parent node ID"),
    },
    async ({ x, y, width, height, name, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_rectangle", {
          x,
          y,
          width,
          height,
          name: name || "Rectangle",
          parentId,
        });
        const { id } = result as { id: string };
        return text(`rect ${id}`);
      } catch (error) {
        return fail("create_rectangle failed", error);
      }
    }
  );

  // Create Frame Tool
  server.tool(
    "create_frame",
    "Create a frame in Figma. x/y are local coordinates relative to parent. Returned id can be used as parentId for children.",
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      name: z.string().optional(),
      parentId: z.string().optional().describe("Parent node ID"),
      fillColor: hexColorOptional,
      strokeColor: hexColorOptional,
      strokeWeight: z.number().positive().optional(),
    },
    async ({
      x,
      y,
      width,
      height,
      name,
      parentId,
      fillColor,
      strokeColor,
      strokeWeight,
    }) => {
      try {
        const result = await sendCommandToFigma("create_frame", {
          x,
          y,
          width,
          height,
          name: name || "Frame",
          parentId,
          fillColor: toFigmaColor(fillColor ?? "#ffffff"),
          strokeColor: toFigmaColor(strokeColor),
          strokeWeight,
        });
        const { id } = result as { id: string };
        return text(`frame ${id}`);
      } catch (error) {
        return fail("create_frame failed", error);
      }
    }
  );

  // Create Text Tool
  server.tool(
    "create_text",
    "Create a text node in Figma. x/y are local coordinates relative to parent.",
    {
      x: z.number(),
      y: z.number(),
      text: z.string().describe("Text content"),
      fontSize: z.number().optional().describe("(default: 14)"),
      fontWeight: z.number().optional().describe("400 = Regular, 700 = Bold (default: 400)"),
      fontColor: hexColorOptional.describe("hex color (default: #000000)"),
      name: z.string().optional().describe("Node name (defaults to the text content)"),
      parentId: z.string().optional().describe("Parent node ID"),
      textAlignHorizontal: z
        .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
        .optional()
        .describe("Use RIGHT for Arabic/RTL text."),
      textAutoResize: z
        .enum(["WIDTH_AND_HEIGHT", "HEIGHT", "NONE", "TRUNCATE"])
        .optional()
        .describe("Use HEIGHT for fixed-width text that wraps."),
      width: z
        .number()
        .positive()
        .optional()
        .describe("Fixed width; use with textAutoResize HEIGHT to wrap within it."),
    },
    async ({ x, y, text: content, fontSize, fontWeight, fontColor, name, parentId, textAlignHorizontal, textAutoResize, width }) => {
      try {
        const result = await sendCommandToFigma("create_text", {
          x,
          y,
          text: content,
          fontSize: fontSize || 14,
          fontWeight: fontWeight || 400,
          fontColor: toFigmaColor(fontColor ?? "#000000"),
          name: name || "Text",
          parentId,
          textAlignHorizontal,
          textAutoResize,
          width,
        });
        const { id } = result as { id: string };
        return text(`text ${id}`);
      } catch (error) {
        return fail("create_text failed", error);
      }
    }
  );

  // Create Ellipse Tool
  server.tool(
    "create_ellipse",
    "Create an ellipse in Figma. x/y are local coordinates relative to parent.",
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      name: z.string().optional(),
      parentId: z.string().optional().describe("Parent node ID"),
      fillColor: hexColorOptional,
      strokeColor: hexColorOptional,
      strokeWeight: z.number().positive().optional(),
    },
    async ({ x, y, width, height, name, parentId, fillColor, strokeColor, strokeWeight }) => {
      try {
        const result = await sendCommandToFigma("create_ellipse", {
          x,
          y,
          width,
          height,
          name: name || "Ellipse",
          parentId,
          fillColor: toFigmaColor(fillColor),
          strokeColor: toFigmaColor(strokeColor),
          strokeWeight,
        });
        const { id } = result as { id: string };
        return text(`ellipse ${id}`);
      } catch (error) {
        return fail("create_ellipse failed", error);
      }
    }
  );

  // Create Polygon Tool
  server.tool(
    "create_polygon",
    "Create a polygon in Figma. x/y are local coordinates relative to parent.",
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      sides: z.number().min(3).optional().describe("(default: 6)"),
      name: z.string().optional(),
      parentId: z.string().optional().describe("Parent node ID"),
      fillColor: hexColorOptional,
      strokeColor: hexColorOptional,
      strokeWeight: z.number().positive().optional(),
    },
    async ({ x, y, width, height, sides, name, parentId, fillColor, strokeColor, strokeWeight }) => {
      try {
        const result = await sendCommandToFigma("create_polygon", {
          x,
          y,
          width,
          height,
          sides: sides || 6,
          name: name || "Polygon",
          parentId,
          fillColor: toFigmaColor(fillColor),
          strokeColor: toFigmaColor(strokeColor),
          strokeWeight,
        });
        const { id } = result as { id: string };
        return text(`polygon ${id} sides=${sides || 6}`);
      } catch (error) {
        return fail("create_polygon failed", error);
      }
    }
  );

  // Create Star Tool
  server.tool(
    "create_star",
    "Create a star in Figma. x/y are local coordinates relative to parent.",
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      points: z.number().min(3).optional().describe("(default: 5)"),
      innerRadius: z.number().min(0.01).max(0.99).optional().describe("Ratio 0.01-0.99 (default: 0.5)"),
      name: z.string().optional(),
      parentId: z.string().optional().describe("Parent node ID"),
      fillColor: hexColorOptional,
      strokeColor: hexColorOptional,
      strokeWeight: z.number().positive().optional(),
    },
    async ({ x, y, width, height, points, innerRadius, name, parentId, fillColor, strokeColor, strokeWeight }) => {
      try {
        const result = await sendCommandToFigma("create_star", {
          x,
          y,
          width,
          height,
          points: points || 5,
          innerRadius: innerRadius || 0.5,
          name: name || "Star",
          parentId,
          fillColor: toFigmaColor(fillColor),
          strokeColor: toFigmaColor(strokeColor),
          strokeWeight,
        });
        const { id } = result as { id: string };
        return text(`star ${id} points=${points || 5} innerRadius=${innerRadius || 0.5}`);
      } catch (error) {
        return fail("create_star failed", error);
      }
    }
  );

  // Group Nodes Tool
  server.tool(
    "group_nodes",
    "Group nodes in Figma",
    {
      nodeIds: z.array(z.string()).describe("Node IDs to group"),
      name: z.string().optional(),
    },
    async ({ nodeIds, name }) => {
      try {
        const result = await sendCommandToFigma("group_nodes", { nodeIds, name });
        const typedResult = result as { id: string; children: unknown[] };
        return text(`group ${typedResult.id} children=${typedResult.children.length}`);
      } catch (error) {
        return fail("group_nodes failed", error);
      }
    }
  );

  // Ungroup Nodes Tool
  server.tool(
    "ungroup_nodes",
    "Ungroup a group or frame in Figma, releasing its children to the parent",
    {
      nodeId,
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("ungroup_nodes", { nodeId });
        const typedResult = result as { ungroupedCount: number; items: Array<{ id: string }> };
        return text(`ungrouped ${typedResult.ungroupedCount}: ${(typedResult.items || []).map((i) => i.id).join(",")}`);
      } catch (error) {
        return fail("ungroup_nodes failed", error);
      }
    }
  );

  // Clone Node Tool
  server.tool(
    "clone_node",
    "Clone an existing node in Figma. x/y are local coordinates relative to parent.",
    {
      nodeId,
      x: z.number().optional(),
      y: z.number().optional(),
    },
    async ({ nodeId, x, y }) => {
      try {
        const result = await sendCommandToFigma("clone_node", { nodeId, x, y });
        const { id } = result as { id: string };
        return text(`clone ${id}`);
      } catch (error) {
        return fail("clone_node failed", error);
      }
    }
  );

  // Insert Child Tool
  server.tool(
    "insert_child",
    "Insert a child node inside a parent node in Figma (re-parents the child)",
    {
      parentId: z.string().describe("Parent node ID"),
      childId: z.string().describe("Child node ID"),
      index: z.number().optional().describe("Insert index (default: append at end)"),
    },
    async ({ parentId, childId, index }) => {
      try {
        const result = await sendCommandToFigma("insert_child", { parentId, childId, index });
        const typedResult = result as { parentId: string; childId: string; index: number };
        return text(`inserted ${typedResult.childId} into ${typedResult.parentId} at ${typedResult.index}`);
      } catch (error) {
        return fail("insert_child failed", error);
      }
    }
  );

  // Flatten Node Tool
  server.tool(
    "flatten_node",
    "Flatten a node in Figma (e.g., for boolean operations or converting to path)",
    {
      nodeId,
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("flatten_node", { nodeId });
        const typedResult = result as { id: string; type: string };
        return text(`flattened ${typedResult.id} ${typedResult.type}`);
      } catch (error) {
        return fail("flatten_node failed", error);
      }
    }
  );

  // Boolean Operation Tool
  server.tool(
    "boolean_operation",
    "Perform a boolean operation (union, subtract, intersect, exclude) on two or more nodes. All nodes must share the same parent.",
    {
      nodeIds: z.array(z.string()).min(2).describe("Node IDs to combine (min 2). Order matters for SUBTRACT."),
      operation: z.enum(["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"]),
      name: z.string().optional(),
    },
    async ({ nodeIds, operation, name }) => {
      try {
        const result = await sendCommandToFigma("boolean_operation", {
          nodeIds,
          operation,
          name,
        });
        const { id } = result as { id: string };
        return text(`${operation} ${id}`);
      } catch (error) {
        return fail("boolean_operation failed", error);
      }
    }
  );
}
