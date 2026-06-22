import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { autoConnect, getActiveChannels, joinChannel } from "../../utils/websocket.js";

export function registerAutoConnectTools(server: McpServer): void {
  server.tool(
    "auto_connect",
    "Automatically detect and connect to an active Figma plugin channel. No channel ID needed. ALWAYS call this tool first before any other Figma tool. Never ask the user for a channel ID.",
    {},
    async () => {
      try {
        const result = await autoConnect();
        return { content: [{ type: "text" as const, text: result }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Auto-connect failed: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );

  server.tool(
    "list_active_channels",
    "List all active Figma plugin channels with the file and page each one is connected to. Use this to pick the right channel when multiple Figma files are open.",
    {},
    async () => {
      try {
        const channels = await getActiveChannels();
        if (channels.length === 0) {
          return { content: [{ type: "text" as const, text: "No active channels. Open the Figma plugin first." }] };
        }
        const list = channels.map((ch, i) => {
          const label = ch.fileName ? ` — ${ch.fileName}${ch.pageName ? ` / ${ch.pageName}` : ""}` : " — (file unknown: update the plugin)";
          return `${i + 1}. Channel: ${ch.channel}${label} (${ch.clients} client(s))`;
        }).join("\n");
        return { content: [{ type: "text" as const, text: `Active channels:\n${list}` }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to list channels: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );

  server.tool(
    "connect_to_file",
    "Connect to a Figma channel by matching its file name (and optional page name) instead of a channel ID. Use when multiple Figma files are open and you know the target file name.",
    {
      fileName: z.string().describe("Full or partial file name to match (case-insensitive)."),
      pageName: z.string().optional().describe("Optional page name to disambiguate when the same file is open in multiple channels."),
    },
    async ({ fileName, pageName }) => {
      try {
        const channels = await getActiveChannels();
        if (channels.length === 0) {
          return { content: [{ type: "text" as const, text: "No active channels. Open the Figma plugin first." }] };
        }
        const needle = fileName.toLowerCase();
        let matches = channels.filter((c) => c.fileName && c.fileName.toLowerCase().includes(needle));
        if (pageName) {
          const pageNeedle = pageName.toLowerCase();
          matches = matches.filter((c) => c.pageName && c.pageName.toLowerCase().includes(pageNeedle));
        }
        if (matches.length === 0) {
          const available = channels.map((c) => c.fileName ?? c.channel).join(", ");
          return { content: [{ type: "text" as const, text: `No open file matching "${fileName}". Open it in Figma, or update the plugin so channels report file names. Currently open: ${available}` }] };
        }
        if (matches.length > 1) {
          const list = matches.map((c, i) => `${i + 1}. ${c.fileName} / ${c.pageName ?? "?"} (${c.channel})`).join("\n");
          return { content: [{ type: "text" as const, text: `Multiple channels match "${fileName}". Pass pageName to disambiguate:\n${list}` }] };
        }
        const target = matches[0];
        await joinChannel(target.channel);
        return { content: [{ type: "text" as const, text: `Connected to "${target.fileName}"${target.pageName ? ` / ${target.pageName}` : ""} (channel ${target.channel})` }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `connect_to_file failed: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );
}
