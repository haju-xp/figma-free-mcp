import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { text, fail, nodeId } from "../../schemas/common";
import * as nodeCache from "../../utils/node-cache";

/** get_svg 기본 상한. 읽기 응답이 무제한으로 커지는 것을 막는다. */
const DEFAULT_SVG_MAX_CHARS = 20000;

/**
 * Register SVG-related tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerSvgTools(server: McpServer): void {
  // Import SVG Tool
  server.tool(
    "set_svg",
    "Import an SVG string as a vector node in Figma. The SVG is sanitized (scripts and external resources are stripped) before import. Max 500KB.",
    {
      svgString: z.string().max(500_000).describe("SVG markup string (max 500KB). Must contain a valid <svg> element."),
      x: z.number().optional().describe("X position for the imported SVG (default: 0)"),
      y: z.number().optional().describe("Y position for the imported SVG (default: 0)"),
      name: z.string().optional().describe("Optional name for the imported node"),
      parentId: z.string().optional().describe("Optional parent node ID to place the SVG into"),
    },
    async ({ svgString, x, y, name, parentId }) => {
      try {
        const result = await sendCommandToFigma("set_svg", {
          svgString,
          x: x || 0,
          y: y || 0,
          name,
          parentId,
        });
        nodeCache.invalidateAll();
        const typedResult = result as { id: string; name: string; width: number; height: number };
        return text(
          `Imported SVG as "${typedResult.name}" with ID: ${typedResult.id} (${typedResult.width}x${typedResult.height})`
        );
      } catch (error) {
        return fail("Error importing SVG", error);
      }
    }
  );

  // Export SVG Tool
  server.tool(
    "get_svg",
    "Export a single node as an SVG string from Figma, including nested children. Output is capped at maxChars (default 20000).",
    {
      nodeId,
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(500_000)
        .optional()
        .describe("Max SVG characters returned (default 20000)"),
    },
    async ({ nodeId, maxChars }) => {
      const limit = maxChars ?? DEFAULT_SVG_MAX_CHARS;
      const key = nodeCache.cacheKey("get_svg", { nodeId, maxChars: limit });

      const cached = nodeCache.get(key);
      if (cached !== undefined) return text(cached);

      try {
        const result = await sendCommandToFigma("get_svg", { nodeId }, 120000);
        const typedResult = result as { svgString: string; name: string };
        const svg = typedResult.svgString ?? "";

        const body =
          svg.length > limit
            ? `${svg.slice(0, limit)}\n<!-- truncated: ${svg.length - limit} of ${svg.length} chars omitted -->`
            : svg;

        nodeCache.set(key, body);
        return text(body);
      } catch (error) {
        return fail("Error exporting SVG", error);
      }
    }
  );
}
