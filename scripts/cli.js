#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import https from "https";

const command = process.argv[2];

const PLUGIN_FILES = [
  { url: "https://raw.githubusercontent.com/haju-xp/figma-free-mcp/main/plugin/manifest.json", name: "manifest.json" },
  { url: "https://raw.githubusercontent.com/haju-xp/figma-free-mcp/main/plugin/code.js", name: "code.js" },
  { url: "https://raw.githubusercontent.com/haju-xp/figma-free-mcp/main/plugin/ui.html", name: "ui.html" },
];

function getPluginDir() {
  return join(homedir(), ".figma-free-mcp", "plugin");
}

function getClaudeDesktopConfigPath() {
  if (platform() === "win32") {
    return join(process.env.APPDATA || homedir(), "Claude", "claude_desktop_config.json");
  } else if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else {
    return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = { data: "" };
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      res.on("data", (chunk) => { file.data += chunk; });
      res.on("end", () => {
        writeFileSync(dest, file.data, "utf-8");
        resolve();
      });
    }).on("error", reject);
  });
}

async function downloadPlugin() {
  const pluginDir = getPluginDir();
  if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });

  console.log("Downloading Figma plugin files...");
  for (const file of PLUGIN_FILES) {
    const dest = join(pluginDir, file.name);
    await downloadFile(file.url, dest);
    console.log(`  ✓ ${file.name}`);
  }
  return pluginDir;
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

  // 소켓 서버도 Claude Desktop과 함께 자동 실행
  config.mcpServers["figma-free-mcp-socket"] = {
    command: "npx",
    args: ["--package", "figma-free-mcp", "figma-free-mcp-socket"],
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log(`\n✓ Added to Claude Desktop config: ${configPath}`);
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
    delete config.mcpServers["figma-free-mcp-socket"];
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log("Removed figma-free-mcp from Claude Desktop config.");
  }
}

if (command === "setup") {
  console.log("Setting up figma-free-mcp...\n");

  // 1. MCP 등록
  try {
    execSync("claude mcp add figma-free-mcp -- npx -y figma-free-mcp", { stdio: "inherit" });
    console.log("✓ Registered in Claude Code CLI");
  } catch {
    console.log("Claude Code CLI not found. Using Claude Desktop config...");
    setupClaudeDesktop();
  }

  // 2. 플러그인 다운로드
  const pluginDir = await downloadPlugin().catch((err) => {
    console.warn(`\nPlugin download failed: ${err.message}`);
    console.warn("You can manually install from: https://github.com/haju-xp/figma-free-mcp/tree/main/plugin");
    return null;
  });

  if (pluginDir) {
    console.log(`\n✓ Plugin downloaded to: ${pluginDir}`);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Next steps:");
    console.log("1. Restart Claude Desktop (소켓 서버 자동 실행됨)");
    console.log("2. Open Figma Desktop");
    console.log("3. Plugins → Development → Import plugin from manifest...");
    console.log(`4. Select: ${join(pluginDir, "manifest.json")}`);
    console.log("5. Run 'Figma Free MCP' plugin in Figma");
    console.log("6. Done! Claude auto-connects to your Figma file.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
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
  npx figma-free-mcp setup      Register MCP + download Figma plugin
  npx figma-free-mcp uninstall  Remove MCP
  `);
}
