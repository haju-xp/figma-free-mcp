#!/usr/bin/env node

/**
 * HTTP server entry point for PlayMCP / cloud deployment
 * Supports Streamable HTTP transport (MCP spec 2025-03-26)
 */

import http from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_CONFIG } from "./config/config.js";
import { logger } from "./utils/logger.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/index.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

function createMcpServer() {
  const server = new McpServer(SERVER_CONFIG);
  registerTools(server);
  registerPrompts(server);
  return server;
}

const httpServer = http.createServer(async (req, res) => {
  // Health check
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: "figma-free-mcp", version: "1.0.0" }));
    return;
  }

  // MCP endpoint
  if (req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on("close", () => transport.close());

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, () => {
  logger.info(`figma-free-mcp HTTP server running on port ${PORT}`);
  logger.info(`MCP endpoint: http://localhost:${PORT}/mcp`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});
