import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { compact, fail, hexColorOptional, text, toFigmaColor } from "../../schemas/common";

/**
 * Register FigJam-specific tools to the MCP server.
 * FigJam is Figma's whiteboard tool with unique node types:
 *   - Sticky notes (STICKY)
 *   - Shapes with text (SHAPE_WITH_TEXT)
 *   - Connectors (CONNECTOR)
 *   - Sections (SECTION)
 *   - Stamps (STAMP)
 *
 * These tools work in FigJam documents. Some tools (e.g. create_section) also
 * work inside regular Figma documents.
 *
 * @param server - The MCP server instance
 */
export function registerFigJamTools(server: McpServer): void {
  // ─── Read tools ────────────────────────────────────────────────────────────

  /**
   * Get all FigJam-specific elements on the current page.
   * Returns stickies, connectors, shapes-with-text, sections and stamps.
   */
  server.tool(
    "get_figjam_elements",
    "Get all FigJam-specific elements (stickies, connectors, shapes with text, sections, stamps) on the current page. Use this to read the contents of a FigJam board.",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_figjam_elements", {});
        return text(compact(result));
      } catch (error) {
        return fail("get_figjam_elements failed", error);
      }
    }
  );

  // ─── Write tools ───────────────────────────────────────────────────────────

  /**
   * Create a sticky note in FigJam.
   */
  server.tool(
    "create_sticky",
    "Create a sticky note in a FigJam board. Sticky notes are the primary way to add text content in FigJam. x/y are canvas coordinates.",
    {
      x: z.number(),
      y: z.number(),
      text: z.string().describe("Sticky note text"),
      color: z
        .enum([
          "yellow",
          "pink",
          "green",
          "blue",
          "purple",
          "red",
          "orange",
          "teal",
          "gray",
          "white",
        ])
        .optional()
        .describe("Background color name (default: yellow)"),
      isWide: z.boolean().optional().describe("Wide format (default: false)"),
      name: z.string().optional(),
      parentId: z.string().optional().describe("Parent node ID (e.g. a section)"),
    },
    async ({ x, y, text: content, color, isWide, name, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_sticky", {
          x,
          y,
          text: content,
          color: color ?? "yellow",
          isWide: isWide ?? false,
          name,
          parentId,
        });
        const { id } = result as { id: string };
        return text(`sticky ${id}`);
      } catch (error) {
        return fail("create_sticky failed", error);
      }
    }
  );

  /**
   * Update the text on an existing sticky note.
   */
  server.tool(
    "set_sticky_text",
    "Update the text content of an existing FigJam sticky note.",
    {
      nodeId: z.string().describe("Sticky note node ID"),
      text: z.string().describe("New text content"),
    },
    async ({ nodeId, text: content }) => {
      try {
        await sendCommandToFigma("set_sticky_text", { nodeId, text: content });
        return text(`sticky text set ${nodeId}`);
      } catch (error) {
        return fail("set_sticky_text failed", error);
      }
    }
  );

  /**
   * Create a FigJam shape with text (e.g. process box, decision diamond).
   */
  server.tool(
    "create_shape_with_text",
    "Create a FigJam shape with text inside. Useful for flowcharts, diagrams, and process maps. x/y are canvas coordinates.",
    {
      x: z.number(),
      y: z.number(),
      width: z.number().optional().describe("(default: 200)"),
      height: z.number().optional().describe("(default: 200)"),
      shapeType: z
        .enum([
          "SQUARE",
          "ELLIPSE",
          "ROUNDED_RECTANGLE",
          "DIAMOND",
          "TRIANGLE_UP",
          "TRIANGLE_DOWN",
          "PARALLELOGRAM_RIGHT",
          "PARALLELOGRAM_LEFT",
        ])
        .optional()
        .describe("(default: ROUNDED_RECTANGLE)"),
      text: z.string().optional().describe("Text inside the shape"),
      fillColor: hexColorOptional,
      name: z.string().optional(),
      parentId: z.string().optional().describe("Parent node ID"),
    },
    async ({ x, y, width, height, shapeType, text: content, fillColor, name, parentId }) => {
      try {
        const result = await sendCommandToFigma("create_shape_with_text", {
          x,
          y,
          width: width ?? 200,
          height: height ?? 200,
          shapeType: shapeType ?? "ROUNDED_RECTANGLE",
          text: content ?? "",
          fillColor: toFigmaColor(fillColor),
          name,
          parentId,
        });
        const { id } = result as { id: string };
        return text(`shape ${id}`);
      } catch (error) {
        return fail("create_shape_with_text failed", error);
      }
    }
  );

  /**
   * Create a connector (arrow/line) between two nodes or at arbitrary positions.
   */
  server.tool(
    "create_connector",
    "Create a connector (arrow or line) in FigJam. Connectors can link two existing nodes by ID, or connect arbitrary canvas positions. Use this to draw flow arrows between stickies, shapes, etc.",
    {
      startNodeId: z.string().optional().describe("Start node ID (omit to use startX/startY)"),
      startX: z.number().optional().describe("Canvas X, used when startNodeId is omitted"),
      startY: z.number().optional().describe("Canvas Y, used when startNodeId is omitted"),
      endNodeId: z.string().optional().describe("End node ID (omit to use endX/endY)"),
      endX: z.number().optional().describe("Canvas X, used when endNodeId is omitted"),
      endY: z.number().optional().describe("Canvas Y, used when endNodeId is omitted"),
      connectorLineType: z
        .enum(["ELBOWED", "STRAIGHT", "CURVED"])
        .optional()
        .describe("(default: ELBOWED)"),
      startStrokeCap: z
        .enum(["NONE", "ARROW", "ARROW_EQUILATERAL", "CIRCLE_FILLED", "DIAMOND_FILLED"])
        .optional()
        .describe("Arrowhead at the start (default: NONE)"),
      endStrokeCap: z
        .enum(["NONE", "ARROW", "ARROW_EQUILATERAL", "CIRCLE_FILLED", "DIAMOND_FILLED"])
        .optional()
        .describe("Arrowhead at the end (default: ARROW)"),
      strokeColor: hexColorOptional,
      strokeWeight: z.number().positive().optional(),
      name: z.string().optional(),
    },
    async ({
      startNodeId,
      startX,
      startY,
      endNodeId,
      endX,
      endY,
      connectorLineType,
      startStrokeCap,
      endStrokeCap,
      strokeColor,
      strokeWeight,
      name,
    }) => {
      try {
        const result = await sendCommandToFigma("create_connector", {
          startNodeId,
          startX,
          startY,
          endNodeId,
          endX,
          endY,
          connectorLineType: connectorLineType ?? "ELBOWED",
          startStrokeCap: startStrokeCap ?? "NONE",
          endStrokeCap: endStrokeCap ?? "ARROW",
          strokeColor: toFigmaColor(strokeColor),
          strokeWeight,
          name,
        });
        const { id } = result as { id: string };
        return text(`connector ${id}`);
      } catch (error) {
        return fail("create_connector failed", error);
      }
    }
  );

  /**
   * Create a FigJam section to group and organise content.
   */
  server.tool(
    "create_section",
    "Create a FigJam section. Sections group and organise content on the board and appear as labelled coloured regions. x/y are canvas coordinates.",
    {
      x: z.number(),
      y: z.number(),
      width: z.number().optional().describe("(default: 800)"),
      height: z.number().optional().describe("(default: 600)"),
      name: z.string().optional().describe("Section label (default: Section)"),
      fillColor: hexColorOptional,
    },
    async ({ x, y, width, height, name, fillColor }) => {
      try {
        const result = await sendCommandToFigma("create_section", {
          x,
          y,
          width: width ?? 800,
          height: height ?? 600,
          name: name ?? "Section",
          fillColor: toFigmaColor(fillColor),
        });
        const { id } = result as { id: string };
        return text(`section ${id}`);
      } catch (error) {
        return fail("create_section failed", error);
      }
    }
  );
}
