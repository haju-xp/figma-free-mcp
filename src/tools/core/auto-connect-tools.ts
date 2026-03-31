import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { autoConnect, getActiveChannels } from "../../utils/websocket.js";

/**
 * 자동 채널 연결 도구 등록
 */
export function registerAutoConnectTools(server: McpServer): void {
  // 자동 연결 — Figma 플러그인이 열려있으면 채널 ID 없이 바로 연결
  server.tool(
    "auto_connect",
    "Automatically detect and connect to an active Figma plugin channel. No channel ID needed.",
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

  // 활성 채널 목록 조회
  server.tool(
    "list_active_channels",
    "List all active Figma plugin channels currently connected to the WebSocket server.",
    {},
    async () => {
      try {
        const channels = await getActiveChannels();
        if (channels.length === 0) {
          return { content: [{ type: "text" as const, text: "No active channels. Open the Figma plugin first." }] };
        }
        const list = channels.map((ch, i) => `${i + 1}. Channel: ${ch.channel} (${ch.clients} client(s))`).join("\n");
        return { content: [{ type: "text" as const, text: `Active channels:\n${list}` }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to list channels: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );
}
