import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { compact, fail, nodeId, text } from "../../schemas/common";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Register image manipulation tools to the MCP server
 * This module contains tools for setting, replacing, and transforming images on nodes
 * @param server - The MCP server instance
 */
export function registerImageTools(server: McpServer): void {
  // Set Image Fill Tool
  server.tool(
    "set_image_fill",
    "Apply an image to a node from a URL or base64 data",
    {
      nodeId,
      imageSource: z.string().describe("Image URL or base64 data string"),
      sourceType: z.enum(["url", "base64"]).describe("'url' for an image URL, 'base64' for encoded data"),
      scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional().describe("(default: FILL)"),
    },
    async ({ nodeId, imageSource, sourceType, scaleMode }) => {
      try {
        const result = await sendCommandToFigma("set_image_fill", {
          nodeId,
          imageSource,
          sourceType,
          scaleMode: scaleMode || "FILL",
        }, 60000); // 60 second timeout for image upload

        const typedResult = result as { scaleMode: string };
        return text(`image ${typedResult.scaleMode} -> ${nodeId}`);
      } catch (error) {
        throw new Error(`set_image_fill failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Get Image from Node Tool
  server.tool(
    "get_image_from_node",
    "Extract image fill metadata (hash, size, scale mode, rotation, filters) from a node",
    {
      nodeId,
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_image_from_node", { nodeId });
        const typedResult = result as {
          name: string;
          hasImage: boolean;
          imageHash?: string;
          scaleMode?: string;
          imageSize?: { width: number; height: number };
          rotation?: number;
          filters?: Record<string, number> | null;
        };

        if (!typedResult.hasImage) {
          return text(`no image fill on ${nodeId}`);
        }

        return text(compact({
          hash: typedResult.imageHash,
          scaleMode: typedResult.scaleMode,
          size: typedResult.imageSize,
          rotation: typedResult.rotation,
          filters: typedResult.filters ?? undefined,
        }));
      } catch (error) {
        return fail("get_image_from_node failed", error);
      }
    }
  );

  // Replace Image Fill Tool
  server.tool(
    "replace_image_fill",
    "Replace the existing image on a node with a new one, keeping the image transform",
    {
      nodeId,
      newImageSource: z.string().describe("New image URL or base64 data"),
      sourceType: z.enum(["url", "base64"]).describe("'url' for an image URL, 'base64' for encoded data"),
      preserveTransform: z.boolean().optional().describe("(default: true)"),
    },
    async ({ nodeId, newImageSource, sourceType, preserveTransform }) => {
      try {
        const result = await sendCommandToFigma("replace_image_fill", {
          nodeId,
          newImageSource,
          sourceType,
          preserveTransform: preserveTransform !== false,
        }, 60000); // 60 second timeout

        const typedResult = result as { preserved: boolean };
        return text(`image replaced ${nodeId}${typedResult.preserved ? " (transform preserved)" : ""}`);
      } catch (error) {
        throw new Error(`replace_image_fill failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // COMMENTED OUT: get_image_bytes - Issues pending investigation
  // Known issues: 400 errors, inconsistent behavior (black images), file save path needs discussion
  /*
  server.tool(
    "get_image_bytes",
    "Download image from Figma and save to local file",
    {
      imageHash: z.string().optional().describe("Image hash to download"),
      nodeId: z.string().optional().describe("Node ID to get image from (alternative to imageHash)"),
    },
    async ({ imageHash, nodeId }) => {
      try {
        if (!imageHash && !nodeId) {
          throw new Error("Either imageHash or nodeId must be provided");
        }

        const result = await sendCommandToFigma("get_image_bytes", {
          imageHash,
          nodeId,
        }, 120000); // 120 second timeout for download

        const typedResult = result as {
          imageData: string;
          mimeType: string;
          size: number;
        };

        const imageBuffer = Buffer.from(typedResult.imageData, "base64");
        const ext = typedResult.mimeType === "image/png" ? "png" : "jpg";
        const hashOrId = imageHash?.substring(0, 8) || nodeId?.replace(/:/g, "-") || "unknown";
        const filename = `figma-${hashOrId}-${Date.now()}.${ext}`;
        const filepath = path.join(os.tmpdir(), filename);

        fs.writeFileSync(filepath, imageBuffer);

        return text(`Image saved: ${filepath} (${typedResult.size} bytes, ${typedResult.mimeType})`);
      } catch (error) {
        return fail("get_image_bytes failed", error);
      }
    }
  );
  */

  // Apply Image Transform Tool
  server.tool(
    "apply_image_transform",
    "Adjust image position, scale, and rotation within a node. Rotates the IMAGE inside the node, not the node itself.",
    {
      nodeId,
      scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional(),
      rotation: z
        .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
        .optional()
        .describe("Degrees, 90-degree increments only"),
      translateX: z.number().optional().describe("Horizontal offset"),
      translateY: z.number().optional().describe("Vertical offset"),
      scale: z.number().positive().optional().describe("1 = 100%"),
    },
    async ({ nodeId, scaleMode, rotation, translateX, translateY, scale }) => {
      try {
        const result = await sendCommandToFigma("apply_image_transform", {
          nodeId,
          scaleMode,
          rotation,
          translateX,
          translateY,
          scale,
        });

        const typedResult = result as { transformApplied: string[] };
        return text(`transform ${nodeId}: ${typedResult.transformApplied.join(", ")}`);
      } catch (error) {
        throw new Error(`apply_image_transform failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Set Image Filters Tool
  server.tool(
    "set_image_filters",
    "Apply color and light adjustments to an image fill. All values range -1.0 to 1.0.",
    {
      nodeId,
      exposure: z.number().min(-1).max(1).optional().describe("Brightness"),
      contrast: z.number().min(-1).max(1).optional(),
      saturation: z.number().min(-1).max(1).optional().describe("-1 = grayscale"),
      temperature: z.number().min(-1).max(1).optional().describe("Warm/cool tint"),
      tint: z.number().min(-1).max(1).optional().describe("Green/magenta shift"),
      highlights: z.number().min(-1).max(1).optional().describe("Bright areas"),
      shadows: z.number().min(-1).max(1).optional().describe("Dark areas"),
    },
    async ({ nodeId, exposure, contrast, saturation, temperature, tint, highlights, shadows }) => {
      try {
        const filters: Record<string, number> = {};
        if (exposure !== undefined) filters.exposure = exposure;
        if (contrast !== undefined) filters.contrast = contrast;
        if (saturation !== undefined) filters.saturation = saturation;
        if (temperature !== undefined) filters.temperature = temperature;
        if (tint !== undefined) filters.tint = tint;
        if (highlights !== undefined) filters.highlights = highlights;
        if (shadows !== undefined) filters.shadows = shadows;

        const result = await sendCommandToFigma("set_image_filters", { nodeId, filters });

        const typedResult = result as { appliedFilters: Record<string, number> };
        return text(`filters ${nodeId} ${compact(typedResult.appliedFilters)}`);
      } catch (error) {
        throw new Error(`set_image_filters failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}
