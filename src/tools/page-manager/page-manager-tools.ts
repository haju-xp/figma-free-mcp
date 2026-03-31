import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../../utils/websocket.js";

/**
 * Normalize a page name for duplicate detection.
 * Strips emoji, trims whitespace, and lowercases.
 */
function normalizeName(name: string): string {
  return name
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu,
      ""
    )
    .trim()
    .toLowerCase();
}

/**
 * Extract a leading number prefix like "01." or "02 " from a page name.
 * Returns the numeric value or Infinity if no prefix is found.
 */
function extractNumberPrefix(name: string): number {
  const match = name.match(/^(\d+)[.\s-]/);
  return match ? parseInt(match[1], 10) : Infinity;
}

interface PageInfo {
  id: string;
  name: string;
  children?: unknown[];
}

/**
 * Register page manager tools to the MCP server.
 * Provides advanced page management utilities: listing with duplicate detection,
 * deduplication, reordering, and empty page cleanup.
 * @param server - The MCP server instance
 */
export function registerPageManagerTools(server: McpServer): void {
  // List All Pages Detailed Tool
  server.tool(
    "list_all_pages_detailed",
    "List all pages in the Figma document with frame counts and duplicate detection",
    {},
    async () => {
      try {
        const docInfo = (await sendCommandToFigma("get_document_info")) as {
          pages?: PageInfo[];
          document?: { children?: PageInfo[] };
        };

        const pages: PageInfo[] =
          docInfo.pages ?? docInfo.document?.children ?? [];

        // Build normalized name groups for duplicate detection
        const normalizedGroups = new Map<string, string[]>();
        for (const page of pages) {
          const key = normalizeName(page.name);
          if (!normalizedGroups.has(key)) {
            normalizedGroups.set(key, []);
          }
          normalizedGroups.get(key)!.push(page.id);
        }

        const result = pages.map((page) => {
          const frameCount = Array.isArray(page.children)
            ? page.children.length
            : 0;
          const key = normalizeName(page.name);
          const group = normalizedGroups.get(key) ?? [];
          const isDuplicate = group.length > 1;

          const entry: {
            pageId: string;
            name: string;
            frameCount: number;
            isDuplicate: boolean;
            duplicateOf?: string;
          } = {
            pageId: page.id,
            name: page.name,
            frameCount,
            isDuplicate,
          };

          // Point to the first page in the group that is not this one
          if (isDuplicate) {
            const original = group.find((id) => id !== page.id);
            if (original) {
              entry.duplicateOf = original;
            }
          }

          return entry;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing pages: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Deduplicate Pages Tool
  server.tool(
    "deduplicate_pages",
    "Find and remove duplicate pages, keeping the one with more content",
    {
      dryRun: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "If true, only report duplicates without deleting (default: true)"
        ),
    },
    async ({ dryRun }) => {
      try {
        const docInfo = (await sendCommandToFigma("get_document_info")) as {
          pages?: PageInfo[];
          document?: { children?: PageInfo[] };
        };

        const pages: PageInfo[] =
          docInfo.pages ?? docInfo.document?.children ?? [];

        // Group pages by normalized name
        const groups = new Map<string, PageInfo[]>();
        for (const page of pages) {
          const key = normalizeName(page.name);
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push(page);
        }

        const report: {
          kept: { id: string; name: string; frameCount: number };
          deleted: { id: string; name: string; frameCount: number }[];
        }[] = [];

        for (const [, group] of groups) {
          if (group.length <= 1) continue;

          // Sort by frame count descending -- keep the one with more content
          const sorted = group
            .map((p) => ({
              ...p,
              frameCount: Array.isArray(p.children) ? p.children.length : 0,
            }))
            .sort((a, b) => b.frameCount - a.frameCount);

          const kept = sorted[0];
          const toDelete = sorted.slice(1);

          if (!dryRun) {
            for (const page of toDelete) {
              await sendCommandToFigma("delete_page", { pageId: page.id });
            }
          }

          report.push({
            kept: {
              id: kept.id,
              name: kept.name,
              frameCount: kept.frameCount,
            },
            deleted: toDelete.map((p) => ({
              id: p.id,
              name: p.name,
              frameCount: p.frameCount,
            })),
          });
        }

        const summary = dryRun
          ? `[DRY RUN] Found ${report.length} duplicate group(s). No pages were deleted.`
          : `Removed duplicates from ${report.length} group(s).`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ summary, dryRun, report }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deduplicating pages: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Organize Pages Tool
  server.tool(
    "organize_pages",
    "Reorder pages alphabetically or by a custom number prefix (01., 02., etc.)",
    {
      order: z
        .enum(["numbered", "alphabetical"])
        .optional()
        .default("numbered")
        .describe(
          "Sort order: 'numbered' sorts by leading number prefix, 'alphabetical' sorts A-Z (default: numbered)"
        ),
    },
    async ({ order }) => {
      try {
        const docInfo = (await sendCommandToFigma("get_document_info")) as {
          pages?: PageInfo[];
          document?: { children?: PageInfo[] };
        };

        const pages: PageInfo[] =
          docInfo.pages ?? docInfo.document?.children ?? [];

        // Sort pages by the chosen strategy
        const sorted = [...pages].sort((a, b) => {
          if (order === "numbered") {
            const numA = extractNumberPrefix(a.name);
            const numB = extractNumberPrefix(b.name);
            if (numA !== numB) return numA - numB;
            // Fall back to alphabetical if same prefix or no prefix
            return a.name.localeCompare(b.name);
          }
          // alphabetical
          return a.name.localeCompare(b.name);
        });

        // Move each page to its target position
        for (let i = 0; i < sorted.length; i++) {
          await sendCommandToFigma("move_page", {
            pageId: sorted[i].id,
            index: i,
          });
        }

        const newOrder = sorted.map((p, i) => ({
          position: i,
          pageId: p.id,
          name: p.name,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Pages reordered by ${order} order.`,
                  order: newOrder,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error organizing pages: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Cleanup Empty Pages Tool
  server.tool(
    "cleanup_empty_pages",
    "Find and optionally delete pages with no children/frames",
    {
      dryRun: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "If true, only report empty pages without deleting (default: true)"
        ),
    },
    async ({ dryRun }) => {
      try {
        const docInfo = (await sendCommandToFigma("get_document_info")) as {
          pages?: PageInfo[];
          document?: { children?: PageInfo[] };
        };

        const pages: PageInfo[] =
          docInfo.pages ?? docInfo.document?.children ?? [];

        const emptyPages = pages.filter(
          (p) => !Array.isArray(p.children) || p.children.length === 0
        );

        if (!dryRun) {
          // Figma requires at least one page; keep the last one if all are empty
          const deletable =
            emptyPages.length === pages.length
              ? emptyPages.slice(0, -1)
              : emptyPages;

          for (const page of deletable) {
            await sendCommandToFigma("delete_page", { pageId: page.id });
          }

          const skipped = emptyPages.length - deletable.length;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message: `Deleted ${deletable.length} empty page(s).${skipped > 0 ? ` Skipped ${skipped} page(s) to keep at least one page in the document.` : ""}`,
                    dryRun: false,
                    deleted: deletable.map((p) => ({
                      pageId: p.id,
                      name: p.name,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `[DRY RUN] Found ${emptyPages.length} empty page(s). No pages were deleted.`,
                  dryRun: true,
                  emptyPages: emptyPages.map((p) => ({
                    pageId: p.id,
                    name: p.name,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error cleaning up pages: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
