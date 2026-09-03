import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, joinChannel } from "../../utils/websocket";
import { filterFigmaNode, hasTruncation } from "../../utils/figma-helpers";
import { compact, text, fail, nodeId, depth, childLimit } from "../../schemas/common";
import * as nodeCache from "../../utils/node-cache";

/** 조회 응답에서 유지할 키 화이트리스트 파라미터. */
const fields = z.array(z.string()).optional().describe("Keep only these keys (id/name/type always kept)");

/** 절단이 발생했을 때 붙이는 짧은 힌트. */
function truncationHint(currentDepth: number): string {
  return `\n+ truncated at depth ${currentDepth}; call again with depth:${currentDepth + 1} for more`;
}

/**
 * Register document-related tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerDocumentTools(server: McpServer): void {
  // Document Info Tool
  server.tool(
    "get_document_info",
    "Get detailed information about the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_document_info");
        return text(compact(result));
      } catch (error) {
        return fail("Error getting document info", error);
      }
    }
  );

  // Selection Tool
  server.tool(
    "get_selection",
    "Get information about the current selection in Figma",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_selection");
        return text(compact(result));
      } catch (error) {
        return fail("Error getting selection", error);
      }
    }
  );

  // Node Info Tool
  server.tool(
    "get_node_info",
    "Get info about a node. Defaults to depth 1 (node + direct children) and 50 children per level; raise depth for deeper subtrees.",
    {
      nodeId,
      depth,
      childLimit,
      fields,
    },
    async ({ nodeId, depth: reqDepth, childLimit: reqChildLimit, fields: reqFields }) => {
      const effectiveDepth = reqDepth ?? 1;
      const effectiveChildLimit = reqChildLimit ?? 50;
      const key = nodeCache.cacheKey("get_node_info", {
        nodeId,
        depth: effectiveDepth,
        childLimit: effectiveChildLimit,
        fields: reqFields,
      });

      const cached = nodeCache.get(key);
      if (cached !== undefined) return text(cached);

      try {
        // 플러그인에도 제한을 넘긴다. 구 버전 플러그인은 무시하고 전체를 보내므로
        // 서버에서 filterFigmaNode로 반드시 다시 자른다(이중 방어).
        const result = await sendCommandToFigma("get_node_info", {
          nodeId,
          depth: effectiveDepth,
          childLimit: effectiveChildLimit,
        });

        const filtered = filterFigmaNode(result, {
          depth: effectiveDepth,
          childLimit: effectiveChildLimit,
          fields: reqFields,
        });

        if (!filtered) return text(compact({ id: nodeId, skipped: "VECTOR" }));

        const payload =
          filtered.absoluteBoundingBox && filtered.localPosition
            ? { ...filtered, _note: "absoluteBoundingBox=global, localPosition=local(use for move_node)" }
            : filtered;

        let body = compact(payload);
        if (hasTruncation(filtered)) body += truncationHint(effectiveDepth);

        nodeCache.set(key, body);
        return text(body);
      } catch (error) {
        return fail("Error getting node info", error);
      }
    }
  );

  // Nodes Info Tool
  server.tool(
    "get_nodes_info",
    "Get info about multiple nodes. Defaults to depth 1 and 50 children per level; raise depth for deeper subtrees.",
    {
      nodeIds: z.array(z.string()).describe("Node IDs to inspect"),
      depth,
      childLimit,
      fields,
    },
    async ({ nodeIds, depth: reqDepth, childLimit: reqChildLimit, fields: reqFields }) => {
      const effectiveDepth = reqDepth ?? 1;
      const effectiveChildLimit = reqChildLimit ?? 50;
      const key = nodeCache.cacheKey("get_nodes_info", {
        nodeIds,
        depth: effectiveDepth,
        childLimit: effectiveChildLimit,
        fields: reqFields,
      });

      const cached = nodeCache.get(key);
      if (cached !== undefined) return text(cached);

      try {
        const results = (await sendCommandToFigma("get_nodes_info", {
          nodeIds,
          depth: effectiveDepth,
          childLimit: effectiveChildLimit,
        })) as any[];

        const filtered = results.map((result) =>
          filterFigmaNode(result.document || result.info, {
            depth: effectiveDepth,
            childLimit: effectiveChildLimit,
            fields: reqFields,
          })
        );

        let body = compact(filtered);
        if (hasTruncation(filtered)) body += truncationHint(effectiveDepth);

        nodeCache.set(key, body);
        return text(body);
      } catch (error) {
        return fail("Error getting nodes info", error);
      }
    }
  );

  // Get Styles Tool
  server.tool(
    "get_styles",
    "Get all styles from the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_styles");
        return text(compact(result));
      } catch (error) {
        return fail("Error getting styles", error);
      }
    }
  );

  // Get Local Components Tool
  server.tool(
    "get_local_components",
    "Get all local components from the Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_local_components");
        return text(compact(result));
      } catch (error) {
        return fail("Error getting local components", error);
      }
    }
  );

  // Get Remote Components Tool
  server.tool(
    "get_remote_components",
    "Get available components from team libraries in Figma",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_remote_components");
        return text(compact(result));
      } catch (error) {
        return fail("Error getting remote components", error);
      }
    }
  );

  // Text Node Scanning Tool
  server.tool(
    "scan_text_nodes",
    "Scan all text nodes in the selected Figma node",
    {
      nodeId,
    },
    async ({ nodeId }) => {
      try {
        // Use the plugin's scan_text_nodes function with chunking flag
        const result = await sendCommandToFigma("scan_text_nodes", {
          nodeId,
          useChunking: true,  // Enable chunking on the plugin side
          chunkSize: 10       // Process 10 nodes at a time
        });

        // If the result indicates chunking was used, format the response accordingly
        if (result && typeof result === 'object' && 'chunks' in result) {
          const typedResult = result as {
            success: boolean,
            totalNodes: number,
            processedNodes: number,
            chunks: number,
            textNodes: Array<any>
          };

          return text(
            `${typedResult.totalNodes} text nodes in ${typedResult.chunks} chunks\n${compact(typedResult.textNodes)}`
          );
        }

        // If chunking wasn't used or wasn't reported in the result format, return the result as is
        return text(compact(result));
      } catch (error) {
        return fail("Error scanning text nodes", error);
      }
    }
  );

  // Join Channel Tool
  server.tool(
    "join_channel",
    "Join a specific channel to communicate with Figma",
    {
      channel: z.string().describe("The name of the channel to join"),
    },
    async ({ channel }) => {
      try {
        if (!channel) {
          // If no channel provided, ask the user for input
          return {
            ...text("Please provide a channel name to join:"),
            followUp: {
              tool: "join_channel",
              description: "Join the specified channel",
            },
          };
        }

        // Use joinChannel instead of sendCommandToFigma to ensure currentChannel is updated
        await joinChannel(channel);

        return text(`Successfully joined channel: ${channel}`);
      } catch (error) {
        return fail("Error joining channel", error);
      }
    }
  );

  // Export Node as Image Tool
  server.tool(
    "export_node_as_image",
    "Export a node as an image from Figma. Inline images are token-expensive: scale is capped at 2 (default 1).",
    {
      nodeId,
      format: z
        .enum(["PNG", "JPG", "SVG", "PDF"])
        .optional()
        .describe("Export format"),
      scale: z.number().positive().max(2).optional().describe("Export scale (default 1, max 2)"),
    },
    async ({ nodeId, format, scale }) => {
      try {
        const result = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: format || "PNG",
          scale: scale || 1,
        }, 120000); // 120 second timeout for image export
        const typedResult = result as { imageData: string; mimeType: string };

        return {
          content: [
            {
              type: "image" as const,
              data: typedResult.imageData,
              mimeType: typedResult.mimeType || "image/png",
            },
          ],
        };
      } catch (error) {
        return fail("Error exporting node as image", error);
      }
    }
  );

  // Create Page Tool
  server.tool(
    "create_page",
    "Create a new page in the current Figma document",
    {
      name: z.string().describe("Name for the new page"),
    },
    async ({ name }) => {
      try {
        const result = await sendCommandToFigma("create_page", { name });
        nodeCache.invalidateAll();
        const typedResult = result as { id: string; name: string };
        return text(`Created page "${typedResult.name}" with ID: ${typedResult.id}`);
      } catch (error) {
        return fail("Error creating page", error);
      }
    }
  );

  // Delete Page Tool
  server.tool(
    "delete_page",
    "Delete a page from the current Figma document",
    {
      pageId: z.string().describe("ID of the page to delete"),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma("delete_page", { pageId });
        nodeCache.invalidateAll();
        const typedResult = result as { success: boolean; name: string };
        return text(`Deleted page "${typedResult.name}" successfully`);
      } catch (error) {
        return fail("Error deleting page", error);
      }
    }
  );

  // Rename Page Tool
  server.tool(
    "rename_page",
    "Rename an existing page in the Figma document",
    {
      pageId: z.string().describe("ID of the page to rename"),
      name: z.string().describe("New name for the page"),
    },
    async ({ pageId, name }) => {
      try {
        const result = await sendCommandToFigma("rename_page", { pageId, name });
        nodeCache.invalidateAll();
        const typedResult = result as { id: string; name: string; oldName: string };
        return text(`Renamed page from "${typedResult.oldName}" to "${typedResult.name}"`);
      } catch (error) {
        return fail("Error renaming page", error);
      }
    }
  );

  // Get Pages Tool
  server.tool(
    "get_pages",
    "Get all pages in the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_pages");
        return text(compact(result));
      } catch (error) {
        return fail("Error getting pages", error);
      }
    }
  );

  // Set Current Page Tool
  server.tool(
    "set_current_page",
    "Switch to a specific page in the Figma document",
    {
      pageId: z.string().describe("ID of the page to switch to"),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma("set_current_page", { pageId });
        nodeCache.invalidateAll();
        const typedResult = result as { id: string; name: string };
        return text(`Switched to page "${typedResult.name}"`);
      } catch (error) {
        return fail("Error switching page", error);
      }
    }
  );

  // Duplicate Page Tool
  server.tool(
    "duplicate_page",
    "Duplicate an existing page in the Figma document, creating a complete copy of all its contents",
    {
      pageId: z.string().describe("ID of the page to duplicate"),
      name: z.string().optional().describe("Optional name for the duplicated page (defaults to 'Original Name (Copy)')"),
    },
    async ({ pageId, name }) => {
      try {
        const result = await sendCommandToFigma("duplicate_page", { pageId, name });
        nodeCache.invalidateAll();
        const typedResult = result as { id: string; name: string; originalName: string };
        return text(`Duplicated page "${typedResult.originalName}" → "${typedResult.name}" with ID: ${typedResult.id}`);
      } catch (error) {
        return fail("Error duplicating page", error);
      }
    }
  );
}
