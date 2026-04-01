#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";

const command = process.argv[2];

function getClaudeDesktopConfigPath() {
  if (platform() === "win32") {
    return join(process.env.APPDATA || homedir(), "Claude", "claude_desktop_config.json");
  } else if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else {
    return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
  }
}

function setupClaudeDesktop() {
  const configPath = getClaudeDesktopConfigPath();
  let config = { mcpServers: {} };

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      console.error("Failed to parse existing config.");
    }
  }

  config.mcpServers["figma-free-mcp"] = {
    command: "npx",
    args: ["-y", "--package", "figma-free-mcp", "figma-free-mcp-server"],
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log(`\nAdded to Claude Desktop config: ${configPath}`);
  console.log("\nDone! Restart Claude Desktop and open the Figma plugin.");
}

function removeClaudeDesktop() {
  const configPath = getClaudeDesktopConfigPath();
  if (!existsSync(configPath)) {
    console.log("No Claude Desktop config found.");
    return;
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  if (config.mcpServers) {
    delete config.mcpServers["figma-free-mcp"];
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log("Removed figma-free-mcp from Claude Desktop config.");
  }
}

if (command === "setup") {
  console.log("Setting up figma-free-mcp...\n");

  // Claude Code CLI 시도
  try {
    execSync("claude mcp add figma-free-mcp -- npx -y figma-free-mcp", { stdio: "inherit" });
    console.log("\nDone! (Claude Code CLI)");
  } catch {
    // Claude Desktop 폴백
    console.log("Claude Code CLI not found. Trying Claude Desktop config...");
    setupClaudeDesktop();
  }

} else if (command === "uninstall") {
  console.log("Removing figma-free-mcp...\n");

  try {
    execSync("claude mcp remove figma-free-mcp", { stdio: "inherit" });
    console.log("Removed. (Claude Code CLI)");
  } catch {
    removeClaudeDesktop();
  }

} else {
  console.log(`
figma-free-mcp — Enhanced MCP for Figma Free (82+ tools)

Commands:
  npx figma-free-mcp setup      Register MCP (Claude Code or Claude Desktop)
  npx figma-free-mcp uninstall  Remove MCP
  `);
}
