import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { autoConnect, getActiveChannels, joinChannel, sendCommandToFigma } from "../../utils/websocket.js";
import { ensureFileOpen } from "../../utils/figma-desktop.js";
import { FigmaCommand } from "../../types/index.js";

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

  server.tool(
    "run_on_file",
    "Run a single Figma command on a specific open file WITHOUT switching the active channel. Use this to edit multiple files concurrently in one session: call it repeatedly with different fileName values. The target file must have its own plugin instance running. params is the same JSON you would pass to the matching tool.",
    {
      fileName: z.string().describe("Full or partial file name of the target file (case-insensitive)."),
      command: z.string().describe("Figma command name, e.g. create_frame, set_text_content, create_rectangle."),
      params: z.record(z.any()).optional().describe("Parameters object for the command, same shape as the dedicated tool expects."),
      pageName: z.string().optional().describe("Optional page name to disambiguate when the same file name has multiple channels."),
      timeoutMs: z.number().optional().describe("Per-command timeout in milliseconds (default 60000)."),
    },
    async ({ fileName, command, params, pageName, timeoutMs }) => {
      try {
        const channels = await getActiveChannels();
        if (channels.length === 0) {
          return { content: [{ type: "text" as const, text: "No active channels. Open the Figma plugin in the target file first." }] };
        }
        const needle = fileName.toLowerCase();
        let matches = channels.filter((c) => c.fileName && c.fileName.toLowerCase().includes(needle));
        if (pageName) {
          const pageNeedle = pageName.toLowerCase();
          matches = matches.filter((c) => c.pageName && c.pageName.toLowerCase().includes(pageNeedle));
        }
        if (matches.length === 0) {
          const available = channels.map((c) => c.fileName ?? c.channel).join(", ");
          return { content: [{ type: "text" as const, text: `No open file matching "${fileName}". Currently open: ${available}` }] };
        }
        if (matches.length > 1) {
          const list = matches.map((c, i) => `${i + 1}. ${c.fileName} / ${c.pageName ?? "?"} (${c.channel})`).join("\n");
          return { content: [{ type: "text" as const, text: `Multiple files match "${fileName}". Pass pageName to disambiguate:\n${list}` }] };
        }
        const target = matches[0];
        const result = await sendCommandToFigma(command as FigmaCommand, params ?? {}, timeoutMs ?? 60000, target.channel);
        return { content: [{ type: "text" as const, text: `[${target.fileName}] ${command} → ${JSON.stringify(result)}` }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `run_on_file failed: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );

  server.tool(
    "ensure_file_open",
    "Make a Figma file reachable by its file key: reuse its live channel, or (macOS) open the file in Figma desktop and launch the plugin so a channel comes up. Verifies the new channel really reports that file key before returning ok, so a mistargeted launch fails instead of editing the wrong file. Call this before run_on_file when the target file may not be open.",
    {
      fileKey: z.string().describe("Figma file key, the alphanumeric segment of a figma.com/file|design|board/<key>/... URL."),
      autoLaunch: z.boolean().optional().describe("Open the file and launch the plugin when no channel matches (default true, macOS only)."),
      timeoutMs: z.number().optional().describe("How long to wait for the channel after launching the plugin (default 25000)."),
    },
    async ({ fileKey, autoLaunch, timeoutMs }) => {
      try {
        const r = await ensureFileOpen(fileKey, { autoLaunch, timeoutMs });
        if (!r.ok) {
          return { content: [{ type: "text" as const, text: `ensure_file_open failed (${r.action}): ${r.reason}` }] };
        }
        const c = r.channel!;
        const label = `${c.fileName ?? fileKey}${c.pageName ? ` / ${c.pageName}` : ""}`;
        return { content: [{ type: "text" as const, text: `Ready (${r.action}): ${label} on channel ${c.channel}` }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `ensure_file_open failed: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );
}
