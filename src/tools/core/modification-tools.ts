import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { applyDefault, FIGMA_DEFAULTS } from "../../utils/defaults";
import {
  compact,
  fail,
  hexColor,
  hexColorOptional,
  nodeId,
  text,
  toFigmaColor,
} from "../../schemas/common";

/**
 * Register modification tools to the MCP server
 * This module contains tools for modifying existing elements in Figma
 * @param server - The MCP server instance
 */
export function registerModificationTools(server: McpServer): void {
  // Set Fill Color Tool
  server.tool(
    "set_fill_color",
    "Set the fill color of a node in Figma. Replaces all existing fills. Alpha comes from the hex (#RRGGBBAA); without it alpha is 1 (opaque).",
    {
      nodeId,
      color: hexColor,
    },
    async ({ nodeId, color }) => {
      try {
        await sendCommandToFigma("set_fill_color", {
          nodeId,
          color: toFigmaColor(color),
        });
        return text(`fill ${color} -> ${nodeId}`);
      } catch (error) {
        return fail("set_fill_color failed", error);
      }
    }
  );

  // Set Stroke Color Tool
  server.tool(
    "set_stroke_color",
    "Set the stroke color of a node in Figma (default weight 1)",
    {
      nodeId,
      color: hexColor,
      strokeWeight: z.number().min(0).optional().describe(">= 0 (default: 1)"),
    },
    async ({ nodeId, color, strokeWeight }) => {
      try {
        const weight = applyDefault(strokeWeight, FIGMA_DEFAULTS.stroke.weight);
        await sendCommandToFigma("set_stroke_color", {
          nodeId,
          color: toFigmaColor(color),
          strokeWeight: weight,
        });
        return text(`stroke ${color} w=${weight} -> ${nodeId}`);
      } catch (error) {
        return fail("set_stroke_color failed", error);
      }
    }
  );

  // Set Selection Colors Tool - recursively change all descendant stroke/fill colors
  server.tool(
    "set_selection_colors",
    "Recursively change all stroke and fill colors of a node and all its descendants. Works like Figma's 'Selection colors' feature - perfect for recoloring icon instances.",
    {
      nodeId,
      color: hexColor,
    },
    async ({ nodeId, color }) => {
      try {
        const rgba = toFigmaColor(color);
        const result = await sendCommandToFigma("set_selection_colors", {
          nodeId,
          r: rgba.r,
          g: rgba.g,
          b: rgba.b,
          a: rgba.a,
        });
        const typedResult = result as { nodesChanged: number };
        return text(`recolored ${nodeId} ${color} (${typedResult.nodesChanged} paints)`);
      } catch (error) {
        return fail("set_selection_colors failed", error);
      }
    }
  );

  // Move Node Tool
  server.tool(
    "move_node",
    "Move a node to a new position in Figma. x/y are local coordinates relative to parent.",
    {
      nodeId,
      x: z.number(),
      y: z.number(),
    },
    async ({ nodeId, x, y }) => {
      try {
        await sendCommandToFigma("move_node", { nodeId, x, y });
        return text(`moved ${nodeId}`);
      } catch (error) {
        return fail("move_node failed", error);
      }
    }
  );

  // Resize Node Tool
  server.tool(
    "resize_node",
    "Resize a node in Figma",
    {
      nodeId,
      width: z.number().positive(),
      height: z.number().positive(),
    },
    async ({ nodeId, width, height }) => {
      try {
        await sendCommandToFigma("resize_node", { nodeId, width, height });
        return text(`resized ${nodeId} ${width}x${height}`);
      } catch (error) {
        return fail("resize_node failed", error);
      }
    }
  );

  // Delete Node Tool
  server.tool(
    "delete_node",
    "Delete a node from Figma",
    {
      nodeId,
    },
    async ({ nodeId }) => {
      try {
        await sendCommandToFigma("delete_node", { nodeId });
        return text(`deleted ${nodeId}`);
      } catch (error) {
        return fail("delete_node failed", error);
      }
    }
  );

  // Set Corner Radius Tool
  server.tool(
    "set_corner_radius",
    "Set the corner radius of a node in Figma",
    {
      nodeId,
      radius: z.number().min(0).describe("Radius in px"),
      corners: z
        .array(z.boolean())
        .length(4)
        .optional()
        .describe("Which corners to round [topLeft, topRight, bottomRight, bottomLeft] (default: all)"),
    },
    async ({ nodeId, radius, corners }) => {
      try {
        await sendCommandToFigma("set_corner_radius", {
          nodeId,
          radius,
          corners: corners || [true, true, true, true],
        });
        return text(`radius ${radius}px -> ${nodeId}`);
      } catch (error) {
        return fail("set_corner_radius failed", error);
      }
    }
  );

  // Auto Layout Tool
  server.tool(
    "set_auto_layout",
    "Configure auto layout properties for a node in Figma. All padding/spacing values are in px.",
    {
      nodeId,
      layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]),
      paddingTop: z.number().optional(),
      paddingBottom: z.number().optional(),
      paddingLeft: z.number().optional(),
      paddingRight: z.number().optional(),
      itemSpacing: z.number().optional().describe("Spacing between items"),
      primaryAxisAlignItems: z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]).optional(),
      counterAxisAlignItems: z.enum(["MIN", "CENTER", "MAX"]).optional(),
      layoutWrap: z.enum(["WRAP", "NO_WRAP"]).optional(),
      strokesIncludedInLayout: z.boolean().optional(),
    },
    async ({ nodeId, layoutMode, paddingTop, paddingBottom, paddingLeft, paddingRight,
             itemSpacing, primaryAxisAlignItems, counterAxisAlignItems, layoutWrap, strokesIncludedInLayout }) => {
      try {
        await sendCommandToFigma("set_auto_layout", {
          nodeId,
          layoutMode,
          paddingTop,
          paddingBottom,
          paddingLeft,
          paddingRight,
          itemSpacing,
          primaryAxisAlignItems,
          counterAxisAlignItems,
          layoutWrap,
          strokesIncludedInLayout,
        });
        return text(`autolayout ${layoutMode} -> ${nodeId}`);
      } catch (error) {
        return fail("set_auto_layout failed", error);
      }
    }
  );

  // Set Effects Tool
  server.tool(
    "set_effects",
    "Set the visual effects of a node in Figma. Replaces all existing effects.",
    {
      nodeId,
      effects: z.array(
        z.object({
          type: z.enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]),
          color: hexColorOptional.describe("Shadow color (shadows only)"),
          offset: z
            .object({ x: z.number(), y: z.number() })
            .optional()
            .describe("Shadow offset in px (shadows only)"),
          radius: z.number().optional().describe("Blur radius in px"),
          spread: z.number().optional().describe("Shadow spread in px (shadows only)"),
          visible: z.boolean().optional().describe("(default: true)"),
          blendMode: z.string().optional(),
        })
      ),
    },
    async ({ nodeId, effects }) => {
      try {
        await sendCommandToFigma("set_effects", {
          nodeId,
          effects: effects.map((e) => ({
            ...e,
            color: toFigmaColor(e.color),
          })),
        });
        return text(`${effects.length} effect(s) -> ${nodeId}`);
      } catch (error) {
        return fail("set_effects failed", error);
      }
    }
  );

  // Set Effect Style ID Tool
  server.tool(
    "set_effect_style_id",
    "Apply an effect style to a node in Figma",
    {
      nodeId,
      effectStyleId: z.string().describe("Effect style ID"),
    },
    async ({ nodeId, effectStyleId }) => {
      try {
        await sendCommandToFigma("set_effect_style_id", { nodeId, effectStyleId });
        return text(`effect style ${effectStyleId} -> ${nodeId}`);
      } catch (error) {
        return fail("set_effect_style_id failed", error);
      }
    }
  );

  // Rotate Node Tool
  server.tool(
    "rotate_node",
    "Rotate a node in Figma. Note: locked nodes can still be rotated — the Plugin API bypasses the UI lock by design.",
    {
      nodeId,
      angle: z.number().describe("Rotation angle in degrees (clockwise)"),
      relative: z.boolean().optional().describe("Add to current rotation instead of setting absolute (default: false)"),
    },
    async ({ nodeId, angle, relative }) => {
      try {
        const result = await sendCommandToFigma("rotate_node", {
          nodeId,
          angle,
          relative: relative || false,
        });
        const typedResult = result as { rotation: number };
        return text(`rotated ${nodeId} to ${typedResult.rotation}°`);
      } catch (error) {
        return fail("rotate_node failed", error);
      }
    }
  );

  // Set Node Properties Tool (visibility, lock, opacity)
  server.tool(
    "set_node_properties",
    "Set visibility, lock state, and/or opacity of a node in Figma. Only provided properties are changed; omitted properties remain unchanged.",
    {
      nodeId,
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional().describe("0 = transparent, 1 = opaque"),
    },
    async ({ nodeId, visible, locked, opacity }) => {
      try {
        const result = await sendCommandToFigma("set_node_properties", {
          nodeId,
          visible,
          locked,
          opacity,
        });
        const typedResult = result as { visible: boolean; locked: boolean; opacity: number };
        const changes: string[] = [];
        if (visible !== undefined) changes.push(`visible=${typedResult.visible}`);
        if (locked !== undefined) changes.push(`locked=${typedResult.locked}`);
        if (opacity !== undefined) changes.push(`opacity=${typedResult.opacity}`);
        return text(`${nodeId} ${changes.join(" ")}`);
      } catch (error) {
        return fail("set_node_properties failed", error);
      }
    }
  );

  // Reorder Node Tool (z-order within same parent)
  server.tool(
    "reorder_node",
    "Change the z-order (layer order) of a node within its parent. Distinct from insert_child which re-parents a node — reorder_node changes position within the same parent.",
    {
      nodeId,
      position: z.enum(["front", "back", "forward", "backward"]).optional(),
      index: z.number().optional().describe("Direct index among siblings (0 = bottom). Overrides position if both given."),
    },
    async ({ nodeId, position, index }) => {
      try {
        const result = await sendCommandToFigma("reorder_node", { nodeId, position, index });
        const typedResult = result as { newIndex: number; parentChildCount: number };
        return text(`reordered ${nodeId} to index ${typedResult.newIndex}/${typedResult.parentChildCount}`);
      } catch (error) {
        return fail("reorder_node failed", error);
      }
    }
  );

  // Convert to Frame Tool
  server.tool(
    "convert_to_frame",
    "Convert a group or shape node into a frame in Figma. Preserves position, size, visual properties, and children. Useful for converting groups into auto-layout-capable frames.",
    {
      nodeId,
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("convert_to_frame", { nodeId });
        const typedResult = result as { id: string; childCount: number };
        return text(`frame ${typedResult.id} children=${typedResult.childCount}`);
      } catch (error) {
        return fail("convert_to_frame failed", error);
      }
    }
  );

  // Set Gradient Fill Tool
  server.tool(
    "set_gradient",
    "Set a gradient fill on a node in Figma. Replaces all existing fills (same behavior as set_fill_color).",
    {
      nodeId,
      type: z.enum(["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"]),
      stops: z
        .array(
          z.object({
            position: z.number().min(0).max(1).describe("0 = start, 1 = end"),
            color: hexColor,
          })
        )
        .min(2)
        .describe("Color stops (min 2)"),
      gradientTransform: z
        .array(z.array(z.number()))
        .optional()
        .describe("2x3 affine matrix [[a,b,tx],[c,d,ty]] (default left-to-right: [[1,0,0],[0,1,0]])"),
    },
    async ({ nodeId, type, stops, gradientTransform }) => {
      try {
        await sendCommandToFigma("set_gradient", {
          nodeId,
          type,
          stops: stops.map((s) => ({
            position: s.position,
            color: toFigmaColor(s.color),
          })),
          gradientTransform: gradientTransform || [[1, 0, 0], [0, 1, 0]],
        });
        return text(`${type} ${stops.length} stops -> ${nodeId}`);
      } catch (error) {
        return fail("set_gradient failed", error);
      }
    }
  );

  // Set Image Fill Tool
  server.tool(
    "set_image",
    "Set an image fill on a node from base64-encoded image data. Supports PNG, JPEG, GIF, WebP.",
    {
      nodeId,
      imageData: z.string().max(7_000_000).describe("Base64 image data (PNG/JPEG/GIF/WebP). Max ~5MB after decode."),
      scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional().describe("(default: FILL)"),
    },
    async ({ nodeId, imageData, scaleMode }) => {
      try {
        const result = await sendCommandToFigma("set_image", {
          nodeId,
          imageData,
          scaleMode: scaleMode || "FILL",
        });
        const typedResult = result as { imageHash: string };
        return text(`image ${scaleMode || "FILL"} -> ${nodeId} hash=${typedResult.imageHash}`);
      } catch (error) {
        return fail("set_image failed", error);
      }
    }
  );

  // Set Layout Grid Tool
  server.tool(
    "set_grid",
    "Apply layout grids to a frame node in Figma. Replaces existing grids. All sizes are in px.",
    {
      nodeId: z.string().describe("Frame node ID"),
      grids: z.array(
        z.object({
          pattern: z.enum(["COLUMNS", "ROWS", "GRID"]),
          count: z.number().optional().describe("Number of columns/rows (ignored for GRID)"),
          sectionSize: z.number().optional().describe("Size of each section"),
          gutterSize: z.number().optional().describe("Gutter between sections"),
          offset: z.number().optional().describe("Offset from the edge"),
          alignment: z.enum(["MIN", "CENTER", "MAX", "STRETCH"]).optional(),
          visible: z.boolean().optional().describe("(default: true)"),
          color: hexColorOptional,
        })
      ),
    },
    async ({ nodeId, grids }) => {
      try {
        const result = await sendCommandToFigma("set_grid", {
          nodeId,
          grids: grids.map((g) => ({ ...g, color: toFigmaColor(g.color) })),
        });
        const typedResult = result as { gridCount: number };
        return text(`${typedResult.gridCount} grid(s) -> ${nodeId}`);
      } catch (error) {
        return fail("set_grid failed", error);
      }
    }
  );

  // Get Layout Grid Tool
  server.tool(
    "get_grid",
    "Read layout grids from a frame node in Figma",
    {
      nodeId: z.string().describe("Frame node ID"),
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_grid", { nodeId });
        const typedResult = result as { name: string; grids: unknown[] };
        return text(compact({ name: typedResult.name, grids: typedResult.grids }));
      } catch (error) {
        return fail("get_grid failed", error);
      }
    }
  );

  // Set Guide Tool
  server.tool(
    "set_guide",
    "Set guides on a page in Figma. Replaces all existing guides on the page.",
    {
      pageId: z.string().describe("Page ID"),
      guides: z.array(
        z.object({
          axis: z.enum(["X", "Y"]).describe("X = vertical, Y = horizontal"),
          offset: z.number().describe("Offset in px"),
        })
      ),
    },
    async ({ pageId, guides }) => {
      try {
        const result = await sendCommandToFigma("set_guide", { pageId, guides });
        const typedResult = result as { guideCount: number };
        return text(`${typedResult.guideCount} guide(s) -> ${pageId}`);
      } catch (error) {
        return fail("set_guide failed", error);
      }
    }
  );

  // Get Guide Tool
  server.tool(
    "get_guide",
    "Read guides from a page in Figma",
    {
      pageId: z.string().describe("Page ID"),
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma("get_guide", { pageId });
        const typedResult = result as { name: string; guides: unknown[] };
        return text(compact({ name: typedResult.name, guides: typedResult.guides }));
      } catch (error) {
        return fail("get_guide failed", error);
      }
    }
  );

  // Set Annotation Tool
  server.tool(
    "set_annotation",
    "Add an annotation label to a node in Figma. Uses the proposed Annotations API — requires Figma Desktop with enableProposedApi.",
    {
      nodeId,
      label: z.string().describe("Annotation text"),
    },
    async ({ nodeId, label }) => {
      try {
        const result = await sendCommandToFigma("set_annotation", { nodeId, label });
        const typedResult = result as { annotationCount: number };
        return text(`annotated ${nodeId} (${typedResult.annotationCount} total)`);
      } catch (error) {
        return fail("set_annotation failed", error);
      }
    }
  );

  // Get Annotation Tool
  server.tool(
    "get_annotation",
    "Read annotations from a node in Figma. Uses the proposed Annotations API.",
    {
      nodeId,
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_annotation", { nodeId });
        const typedResult = result as { name: string; annotations: unknown[] };
        return text(compact({ name: typedResult.name, annotations: typedResult.annotations }));
      } catch (error) {
        return fail("get_annotation failed", error);
      }
    }
  );

  // Rename Node Tool
  server.tool(
    "rename_node",
    "Rename a node (frame, component, group, etc.) in Figma",
    {
      nodeId,
      name: z.string().describe("New name"),
    },
    async ({ nodeId, name }) => {
      try {
        const result = await sendCommandToFigma("rename_node", { nodeId, name });
        const typedResult = result as { name: string; oldName: string };
        return text(`renamed ${nodeId} "${typedResult.oldName}" -> "${typedResult.name}"`);
      } catch (error) {
        return fail("rename_node failed", error);
      }
    }
  );
}
