import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { compact, fail, text } from "../../schemas/common";

/** Text tools all target a TEXT node, so the type hint is worth keeping. */
const textNodeId = z.string().describe("Text node ID");

/**
 * Register text-related tools to the MCP server
 * This module contains tools for working with text elements in Figma
 * @param server - The MCP server instance
 */
export function registerTextTools(server: McpServer): void {
  // Set Text Content Tool
  server.tool(
    "set_text_content",
    "Set the text content of an existing text node in Figma",
    {
      nodeId: textNodeId,
      text: z.string().describe("New text content"),
    },
    async ({ nodeId, text: content }) => {
      try {
        await sendCommandToFigma("set_text_content", { nodeId, text: content });
        return text(`text set ${nodeId}`);
      } catch (error) {
        return fail("set_text_content failed", error);
      }
    }
  );

  // Set Multiple Text Contents Tool
  server.tool(
    "set_multiple_text_contents",
    "Replace the text of many text nodes at once, in batches. Faster than calling set_text_content repeatedly.",
    {
      nodeId: z.string().describe("Container node ID holding the text nodes"),
      text: z
        .array(
          z.object({
            nodeId: textNodeId,
            text: z.string().describe("Replacement text"),
          })
        )
        .describe("Text node IDs and their replacement texts"),
    },
    async ({ nodeId, text: replacements }) => {
      try {
        if (!replacements || replacements.length === 0) {
          return text("no replacements provided");
        }

        const result = await sendCommandToFigma("set_multiple_text_contents", {
          nodeId,
          text: replacements,
        });

        interface TextReplaceResult {
          replacementsApplied?: number;
          replacementsFailed?: number;
          results?: Array<{ success: boolean; nodeId: string; error?: string }>;
        }
        const typedResult = result as TextReplaceResult;

        const failed = (typedResult.results || []).filter((item) => !item.success);
        const failedDetail = failed.length
          ? ` failed: ${failed.map((item) => `${item.nodeId}(${item.error || "unknown"})`).join(", ")}`
          : "";

        return text(
          `${typedResult.replacementsApplied || 0}/${replacements.length} updated, ${typedResult.replacementsFailed || 0} failed.${failedDetail}`
        );
      } catch (error) {
        return fail("set_multiple_text_contents failed", error);
      }
    }
  );

  // Set Font Name Tool
  server.tool(
    "set_font_name",
    "Set the font family and style of a text node in Figma",
    {
      nodeId: textNodeId,
      family: z.string().describe("Font family"),
      style: z.string().optional().describe("e.g. 'Regular', 'Bold', 'Italic'"),
    },
    async ({ nodeId, family, style }) => {
      try {
        const result = await sendCommandToFigma("set_font_name", { nodeId, family, style });
        const typedResult = result as { fontName: { family: string; style: string } };
        return text(`font ${typedResult.fontName.family} ${typedResult.fontName.style} -> ${nodeId}`);
      } catch (error) {
        return fail("set_font_name failed", error);
      }
    }
  );

  // Set Font Size Tool
  server.tool(
    "set_font_size",
    "Set the font size of a text node in Figma",
    {
      nodeId: textNodeId,
      fontSize: z.number().positive().describe("Size in px"),
    },
    async ({ nodeId, fontSize }) => {
      try {
        const result = await sendCommandToFigma("set_font_size", { nodeId, fontSize });
        const typedResult = result as { fontSize: number };
        return text(`fontSize ${typedResult.fontSize}px -> ${nodeId}`);
      } catch (error) {
        return fail("set_font_size failed", error);
      }
    }
  );

  // Set Font Weight Tool
  server.tool(
    "set_font_weight",
    "Set the font weight of a text node in Figma",
    {
      nodeId: textNodeId,
      weight: z.number().describe("100-900 in steps of 100 (400 = Regular, 700 = Bold)"),
    },
    async ({ nodeId, weight }) => {
      try {
        const result = await sendCommandToFigma("set_font_weight", { nodeId, weight });
        const typedResult = result as { fontName: { style: string }; weight: number };
        return text(`weight ${typedResult.weight} (${typedResult.fontName.style}) -> ${nodeId}`);
      } catch (error) {
        return fail("set_font_weight failed", error);
      }
    }
  );

  // Set Letter Spacing Tool
  server.tool(
    "set_letter_spacing",
    "Set the letter spacing of a text node in Figma",
    {
      nodeId: textNodeId,
      letterSpacing: z.number(),
      unit: z.enum(["PIXELS", "PERCENT"]).optional().describe("(default: PIXELS)"),
    },
    async ({ nodeId, letterSpacing, unit }) => {
      try {
        const result = await sendCommandToFigma("set_letter_spacing", {
          nodeId,
          letterSpacing,
          unit: unit || "PIXELS",
        });
        const typedResult = result as { letterSpacing: { value: number; unit: string } };
        return text(`letterSpacing ${typedResult.letterSpacing.value} ${typedResult.letterSpacing.unit} -> ${nodeId}`);
      } catch (error) {
        return fail("set_letter_spacing failed", error);
      }
    }
  );

  // Set Line Height Tool
  server.tool(
    "set_line_height",
    "Set the line height of a text node in Figma",
    {
      nodeId: textNodeId,
      lineHeight: z.number(),
      unit: z.enum(["PIXELS", "PERCENT", "AUTO"]).optional().describe("(default: PIXELS)"),
    },
    async ({ nodeId, lineHeight, unit }) => {
      try {
        const result = await sendCommandToFigma("set_line_height", {
          nodeId,
          lineHeight,
          unit: unit || "PIXELS",
        });
        const typedResult = result as { lineHeight: { value: number; unit: string } };
        return text(`lineHeight ${typedResult.lineHeight.value} ${typedResult.lineHeight.unit} -> ${nodeId}`);
      } catch (error) {
        return fail("set_line_height failed", error);
      }
    }
  );

  // Set Paragraph Spacing Tool
  server.tool(
    "set_paragraph_spacing",
    "Set the paragraph spacing of a text node in Figma",
    {
      nodeId: textNodeId,
      paragraphSpacing: z.number().describe("Spacing in px"),
    },
    async ({ nodeId, paragraphSpacing }) => {
      try {
        const result = await sendCommandToFigma("set_paragraph_spacing", { nodeId, paragraphSpacing });
        const typedResult = result as { paragraphSpacing: number };
        return text(`paragraphSpacing ${typedResult.paragraphSpacing}px -> ${nodeId}`);
      } catch (error) {
        return fail("set_paragraph_spacing failed", error);
      }
    }
  );

  // Set Text Case Tool
  server.tool(
    "set_text_case",
    "Set the text case of a text node in Figma",
    {
      nodeId: textNodeId,
      textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE"]),
    },
    async ({ nodeId, textCase }) => {
      try {
        await sendCommandToFigma("set_text_case", { nodeId, textCase });
        return text(`textCase ${textCase} -> ${nodeId}`);
      } catch (error) {
        return fail("set_text_case failed", error);
      }
    }
  );

  // Set Text Decoration Tool
  server.tool(
    "set_text_decoration",
    "Set the text decoration of a text node in Figma",
    {
      nodeId: textNodeId,
      textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]),
    },
    async ({ nodeId, textDecoration }) => {
      try {
        await sendCommandToFigma("set_text_decoration", { nodeId, textDecoration });
        return text(`textDecoration ${textDecoration} -> ${nodeId}`);
      } catch (error) {
        return fail("set_text_decoration failed", error);
      }
    }
  );

  // Get Styled Text Segments Tool
  server.tool(
    "get_styled_text_segments",
    "Get text segments of a text node grouped by a styling property",
    {
      nodeId: textNodeId,
      property: z
        .enum([
          "fillStyleId",
          "fontName",
          "fontSize",
          "textCase",
          "textDecoration",
          "textStyleId",
          "fills",
          "letterSpacing",
          "lineHeight",
          "fontWeight",
        ])
        .describe("Property to group segments by"),
    },
    async ({ nodeId, property }) => {
      try {
        const result = await sendCommandToFigma("get_styled_text_segments", { nodeId, property });
        return text(compact(result));
      } catch (error) {
        return fail("get_styled_text_segments failed", error);
      }
    }
  );

  // Set Text Style ID Tool
  server.tool(
    "set_text_style_id",
    "Apply a text style to a text node in Figma",
    {
      nodeId: textNodeId,
      textStyleId: z.string().describe("Text style ID"),
    },
    async ({ nodeId, textStyleId }) => {
      try {
        const result = await sendCommandToFigma("set_text_style_id", { nodeId, textStyleId });
        const typedResult = result as { styleName: string };
        return text(`style "${typedResult.styleName}" -> ${nodeId}`);
      } catch (error) {
        return fail("set_text_style_id failed", error);
      }
    }
  );

  // Load Font Async Tool
  server.tool(
    "load_font_async",
    "Load a font in Figma so it can be applied to text nodes",
    {
      family: z.string().describe("Font family"),
      style: z.string().optional().describe("e.g. 'Regular', 'Bold', 'Italic' (default: Regular)"),
    },
    async ({ family, style }) => {
      try {
        const result = await sendCommandToFigma("load_font_async", {
          family,
          style: style || "Regular",
        });
        const typedResult = result as { message?: string };
        return text(typedResult.message || `font loaded ${family} ${style || "Regular"}`);
      } catch (error) {
        return fail("load_font_async failed", error);
      }
    }
  );

  // Set Text Align Tool
  server.tool(
    "set_text_align",
    "Set the text alignment of a text node in Figma. Use textAlignHorizontal RIGHT for RTL/Arabic text.",
    {
      nodeId: textNodeId,
      textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional(),
      textAlignVertical: z.enum(["TOP", "CENTER", "BOTTOM"]).optional(),
    },
    async ({ nodeId, textAlignHorizontal, textAlignVertical }) => {
      try {
        const result = await sendCommandToFigma("set_text_align", {
          nodeId,
          textAlignHorizontal,
          textAlignVertical,
        });
        const typedResult = result as { textAlignHorizontal: string; textAlignVertical: string };
        return text(`align h=${typedResult.textAlignHorizontal} v=${typedResult.textAlignVertical} -> ${nodeId}`);
      } catch (error) {
        return fail("set_text_align failed", error);
      }
    }
  );
}
