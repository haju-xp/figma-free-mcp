#!/usr/bin/env node

import { execSync } from "child_process";

const command = process.argv[2];

if (command === "setup") {
  console.log("Setting up figma-free-mcp for Claude Code...\n");
  try {
    execSync("claude mcp add figma-free-mcp -- npx -y figma-free-mcp", {
      stdio: "inherit",
    });
    console.log("\nDone! Now open Figma and use the plugin.");
  } catch {
    console.error("Failed. Is Claude Code installed?");
    process.exit(1);
  }
} else if (command === "uninstall") {
  console.log("Removing figma-free-mcp from Claude Code...\n");
  try {
    execSync("claude mcp remove figma-free-mcp", { stdio: "inherit" });
    console.log("\nRemoved.");
  } catch {
    console.error("Failed to remove.");
    process.exit(1);
  }
} else {
  console.log(`
figma-free-mcp — Enhanced MCP for Figma Free (82+ tools)

Commands:
  npx figma-free-mcp setup      Register MCP in Claude Code
  npx figma-free-mcp uninstall  Remove MCP from Claude Code
  `);
}
