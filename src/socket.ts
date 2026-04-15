/**
 * WebSocket 중계 서버 — Node.js 호환 (ws 라이브러리)
 * Figma 플러그인 ↔ MCP 서버 간 메시지 중계
 */

import { WebSocketServer, WebSocket } from "ws";
import http from "http";

const PORT = 3055;

// 로거
const logger = {
  info: (msg: string, ...args: unknown[]) => process.stderr.write(`[INFO] ${msg} ${args.join(" ")}\n`),
  debug: (msg: string, ...args: unknown[]) => process.stderr.write(`[DEBUG] ${msg} ${args.join(" ")}\n`),
  warn: (msg: string, ...args: unknown[]) => process.stderr.write(`[WARN] ${msg} ${args.join(" ")}\n`),
  error: (msg: string, ...args: unknown[]) => process.stderr.write(`[ERROR] ${msg} ${args.join(" ")}\n`),
};

// 채널별 클라이언트 관리
const channels = new Map<string, Set<WebSocket>>();

// 통계
const stats = {
  totalConnections: 0,
  activeConnections: 0,
  messagesSent: 0,
  messagesReceived: 0,
  errors: 0,
};

// HTTP 서버 (REST API + WebSocket 업그레이드)
const httpServer = http.createServer((req, res) => {
  // CORS 헤더
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // /status — 서버 상태
  if (req.url === "/status") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "running", uptime: process.uptime(), stats }));
    return;
  }

  // /channels — 활성 채널 목록 (auto_connect 핵심 API)
  if (req.url === "/channels") {
    const activeChannels: Array<{ channel: string; clients: number }> = [];
    channels.forEach((clients, channelName) => {
      const activeClients = [...clients].filter((c) => c.readyState === WebSocket.OPEN).length;
      if (activeClients > 0) {
        activeChannels.push({ channel: channelName, clients: activeClients });
      }
    });
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", channels: activeChannels, count: activeChannels.length }));
    return;
  }

  // 기본 응답
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Claude to Figma WebSocket server running. Connect with a WebSocket client.");
});

// WebSocket 서버
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  stats.totalConnections++;
  stats.activeConnections++;
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  logger.info(`New client connected: ${clientId}`);

  // 환영 메시지
  ws.send(JSON.stringify({ type: "system", message: "Please join a channel to start communicating with Figma" }));

  ws.on("message", (raw) => {
    try {
      stats.messagesReceived++;
      const data = JSON.parse(raw.toString());

      // 채널 참가
      if (data.type === "join") {
        const channelName = data.channel;
        if (!channelName || typeof channelName !== "string") {
          ws.send(JSON.stringify({ type: "error", message: "Channel name is required" }));
          return;
        }

        if (!channels.has(channelName)) {
          logger.info(`Creating new channel: ${channelName}`);
          channels.set(channelName, new Set());
        }

        const channelClients = channels.get(channelName)!;
        channelClients.add(ws);
        logger.info(`Client ${clientId} joined channel: ${channelName}`);

        // 참가 확인
        ws.send(JSON.stringify({ type: "system", message: `Joined channel: ${channelName}`, channel: channelName }));
        stats.messagesSent++;

        ws.send(JSON.stringify({ type: "system", message: { id: data.id, result: "Connected to channel: " + channelName }, channel: channelName }));
        stats.messagesSent++;

        // 다른 클라이언트에 알림
        channelClients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "system", message: "A new client has joined the channel", channel: channelName }));
            stats.messagesSent++;
          }
        });
        return;
      }

      // 일반 메시지 브로드캐스트
      if (data.type === "message") {
        const channelName = data.channel;
        if (!channelName) {
          ws.send(JSON.stringify({ type: "error", message: "Channel name is required" }));
          return;
        }

        const channelClients = channels.get(channelName);
        if (!channelClients || !channelClients.has(ws)) {
          ws.send(JSON.stringify({ type: "error", message: "You must join the channel first" }));
          return;
        }

        channelClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "broadcast", message: data.message, sender: client === ws ? "You" : "User", channel: channelName }));
            stats.messagesSent++;
          }
        });
      }

      // 진행 상태 업데이트
      if (data.type === "progress_update") {
        const channelClients = channels.get(data.channel);
        if (channelClients) {
          channelClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(data));
              stats.messagesSent++;
            }
          });
        }
      }
    } catch (err) {
      stats.errors++;
      logger.error("Error handling message:", err);
      ws.send(JSON.stringify({ type: "error", message: `Error: ${err instanceof Error ? err.message : String(err)}` }));
    }
  });

  ws.on("close", () => {
    logger.info(`Client disconnected: ${clientId}`);
    stats.activeConnections--;
    // 모든 채널에서 제거 + 빈 채널 삭제
    channels.forEach((clients, channelName) => {
      if (clients.delete(ws)) {
        logger.debug(`Removed ${clientId} from channel ${channelName}`);
        // 빈 채널이면 Map에서 완전히 삭제
        if (clients.size === 0) {
          channels.delete(channelName);
          logger.info(`Channel ${channelName} removed (empty)`);
          return;
        }
        // 남은 클라이언트에 알림
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "system", message: "A client has left the channel", channel: channelName }));
          }
        });
      }
    });
  });

  ws.on("error", (error) => {
    stats.errors++;
    logger.error(`WebSocket error for ${clientId}: ${error.message}`);
  });
});

httpServer.listen(PORT, () => {
  logger.info(`Claude to Figma WebSocket server running on port ${PORT}`);
  logger.info(`Status: http://localhost:${PORT}/status`);
  logger.info(`Active channels: http://localhost:${PORT}/channels`);
});
