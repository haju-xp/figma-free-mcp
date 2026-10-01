#!/usr/bin/env node

import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { homedir, platform } from "os";
import { fileURLToPath } from "url";

const command = process.argv[2];
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8")).version;
const PKG_SPEC = `figma-free-mcp@${VERSION}`;
const PLUGIN_DIR = join(homedir(), ".figma-free-mcp", "plugin");
const SKILLS_DIR = join(homedir(), ".claude", "skills");
const CLAUDE_JSON = join(homedir(), ".claude.json");
// 1.2.0 까지의 스킬 이름. 한글 이름은 Claude 데스크톱 앱 입력창에서 슬래시 명령으로 보내지지 않아 바꿨다.
const OLD_SKILL = "피그마연결";

// MCP 서버 실행 인자. 버전을 고정해 플러그인·중계 서버·서버가 항상 같은 버전으로 묶인다.
// 업데이트는 install 을 다시 실행하면 된다.
const SERVER_ARGS = ["-y", "-p", PKG_SPEC, "figma-free-mcp-server"];

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const info = (m) => console.log(`    ${m}`);

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", ...opts });
}

function trySh(cmd, opts = {}) {
  try {
    return { ok: true, out: sh(cmd, opts) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

function hasClaudeCli() {
  return trySh("claude --version").ok;
}

function getClaudeDesktopConfigPath() {
  if (platform() === "win32") {
    return join(process.env.APPDATA || homedir(), "Claude", "claude_desktop_config.json");
  } else if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

/** ~/.claude.json 에서 폴더 전용(local scope)으로 등록된 프로젝트 경로들. */
function localScopeProjects() {
  if (!existsSync(CLAUDE_JSON)) return [];
  try {
    const cfg = JSON.parse(readFileSync(CLAUDE_JSON, "utf-8"));
    return Object.entries(cfg.projects || {})
      .filter(([, v]) => v && v.mcpServers && v.mcpServers["figma-free-mcp"])
      .map(([p]) => p);
  } catch {
    return [];
  }
}

function userScopeEntry() {
  if (!existsSync(CLAUDE_JSON)) return null;
  try {
    const cfg = JSON.parse(readFileSync(CLAUDE_JSON, "utf-8"));
    return (cfg.mcpServers || {})["figma-free-mcp"] || null;
  } catch {
    return null;
  }
}

function globalInstallVersion() {
  const r = trySh("npm ls -g figma-free-mcp --depth=0 --json");
  if (!r.out) return null;
  try {
    const deps = JSON.parse(r.out).dependencies || {};
    return deps["figma-free-mcp"] ? deps["figma-free-mcp"].version : null;
  } catch {
    return null;
  }
}

// ---------- steps ----------

function registerClaudeCode() {
  if (!hasClaudeCli()) {
    warn("Claude Code CLI not found — skipped Claude Code registration");
    return false;
  }
  // 폴더 전용으로 등록된 예전 항목은 그 폴더에서만 보이고 다른 폴더에선 사라진다. 지운다.
  for (const p of localScopeProjects()) {
    if (existsSync(p)) {
      trySh("claude mcp remove figma-free-mcp -s local", { cwd: p });
      ok(`removed folder-only registration: ${p}`);
    }
  }
  trySh("claude mcp remove figma-free-mcp -s user");
  const add = spawnSync("claude", ["mcp", "add", "figma-free-mcp", "-s", "user", "--", "npx", ...SERVER_ARGS], {
    encoding: "utf-8",
  });
  if (add.status !== 0) {
    warn(`registration failed: ${(add.stderr || add.stdout || "").trim()}`);
    return false;
  }
  ok(`registered for all folders (user scope) → ${PKG_SPEC}`);
  return true;
}

/** Claude 데스크톱 앱 설정에 이미 있으면 같은 버전으로 맞춘다. 없으면 건드리지 않는다. */
function syncClaudeDesktop({ add = false } = {}) {
  const path = getClaudeDesktopConfigPath();
  let cfg = { mcpServers: {} };
  if (existsSync(path)) {
    try {
      cfg = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      warn(`could not parse ${path} — left unchanged`);
      return;
    }
  }
  cfg.mcpServers = cfg.mcpServers || {};
  delete cfg.mcpServers["figma-free-mcp-socket"];
  if (!cfg.mcpServers["figma-free-mcp"] && !add) return;
  cfg.mcpServers["figma-free-mcp"] = { command: "npx", args: SERVER_ARGS };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), "utf-8");
  ok(`Claude Desktop config synced → ${PKG_SPEC}`);
}

function installPlugin() {
  const src = join(PKG_ROOT, "plugin");
  mkdirSync(PLUGIN_DIR, { recursive: true });
  for (const f of readdirSync(src)) cpSync(join(src, f), join(PLUGIN_DIR, f));
  writeFileSync(join(PLUGIN_DIR, "VERSION"), VERSION, "utf-8");
  ok(`Figma plugin files → ${PLUGIN_DIR}`);
}

function installSkills() {
  const src = join(PKG_ROOT, "skills");
  if (!existsSync(src)) return;
  const old = join(SKILLS_DIR, OLD_SKILL);
  if (existsSync(old)) {
    rmSync(old, { recursive: true, force: true });
    ok(`removed old skill /${OLD_SKILL} (renamed to /figma-connect)`);
  }
  mkdirSync(SKILLS_DIR, { recursive: true });
  for (const name of readdirSync(src)) {
    cpSync(join(src, name), join(SKILLS_DIR, name), { recursive: true });
    ok(`skill /${name} → ${join(SKILLS_DIR, name)}`);
  }
}

function removeGlobalInstall() {
  const v = globalInstallVersion();
  if (!v) return;
  const r = trySh("npm uninstall -g figma-free-mcp");
  if (r.ok) ok(`removed old global install (v${v}) — it mixed versions`);
  else warn(`old global install v${v} found; remove it with: npm uninstall -g figma-free-mcp`);
}

function openPluginFolder() {
  const manifest = join(PLUGIN_DIR, "manifest.json");
  if (platform() === "darwin") trySh(`open -R "${manifest}"`);
  else if (platform() === "win32") trySh(`explorer /select,"${manifest}"`);
}

function install() {
  console.log(`figma-free-mcp ${VERSION} — install\n`);
  const cc = registerClaudeCode();
  syncClaudeDesktop({ add: !cc || process.argv.includes("--desktop") });
  installPlugin();
  installSkills();
  removeGlobalInstall();
  openPluginFolder();
  console.log(`
Next (only the first time on this PC):
  1. Figma desktop app → Plugins → Development → Import plugin from manifest…
     → pick manifest.json in the folder that just opened
     (${join(PLUGIN_DIR, "manifest.json")})
  2. Restart Claude Code

Every time:
  Figma → Plugins → Development → Figma Free MCP, then type /figma-connect in Claude (or say "피그마 연결해줘").
  The relay server starts by itself.

Update later: run this same command again.
`);
}

async function relayStatus() {
  try {
    const res = await fetch("http://localhost:3055/channels", { signal: AbortSignal.timeout(1500) });
    return await res.json();
  } catch {
    return null;
  }
}

async function doctor() {
  console.log(`figma-free-mcp ${VERSION} — doctor\n`);
  const [major] = process.versions.node.split(".").map(Number);
  major >= 20 ? ok(`Node ${process.versions.node}`) : warn(`Node ${process.versions.node} — 20 or newer needed`);

  if (hasClaudeCli()) {
    const user = userScopeEntry();
    const locals = localScopeProjects();
    if (user) {
      const spec = (user.args || []).find((a) => String(a).startsWith("figma-free-mcp")) || "?";
      ok(`registered for all folders → ${spec}`);
    } else warn("not registered for all folders — run: npx -y figma-free-mcp@latest install");
    if (locals.length) warn(`folder-only registrations (fixed by install): ${locals.join(", ")}`);
  } else warn("Claude Code CLI not found");

  const pv = existsSync(join(PLUGIN_DIR, "VERSION")) ? readFileSync(join(PLUGIN_DIR, "VERSION"), "utf-8").trim() : null;
  if (!existsSync(join(PLUGIN_DIR, "manifest.json"))) warn(`plugin files missing in ${PLUGIN_DIR} — run install`);
  else if (pv !== VERSION) warn(`plugin files are ${pv ? "v" + pv : "an older version"} — run install, then re-run the plugin in Figma`);
  else ok(`plugin files v${pv}`);

  existsSync(join(SKILLS_DIR, "figma-connect", "SKILL.md")) ? ok("skill /figma-connect") : warn("skill /figma-connect missing — run install");
  if (existsSync(join(SKILLS_DIR, OLD_SKILL))) warn(`old skill folder ${OLD_SKILL} still there — install removes it`);

  const g = globalInstallVersion();
  if (g) warn(`old global install v${g} — install removes it`);

  const relay = await relayStatus();
  if (!relay) info("relay server: off (starts automatically when Claude connects)");
  else {
    const chans = relay.channels || [];
    ok(`relay server: on, ${chans.length} channel(s)`);
    for (const c of chans) info(`- ${c.channel}: ${c.clients} client(s)${c.fileName ? " · " + c.fileName : ""}${c.clients >= 2 ? " (Claude connected)" : ""}`);
    if (chans.length === 0) info("open the Figma Free MCP plugin in Figma");
  }
}

function uninstall() {
  console.log("Removing figma-free-mcp...\n");
  if (hasClaudeCli()) {
    trySh("claude mcp remove figma-free-mcp -s user");
    ok("removed Claude Code registration");
  }
  const path = getClaudeDesktopConfigPath();
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf-8"));
      if (cfg.mcpServers) {
        delete cfg.mcpServers["figma-free-mcp"];
        delete cfg.mcpServers["figma-free-mcp-socket"];
        writeFileSync(path, JSON.stringify(cfg, null, 2), "utf-8");
        ok("removed from Claude Desktop config");
      }
    } catch (err) {
      warn(`could not update Claude Desktop config: ${err.message}`);
    }
  }
  info(`plugin files kept in ${PLUGIN_DIR}`);
}

if (command === "install" || command === "setup") {
  install();
} else if (command === "doctor") {
  await doctor();
} else if (command === "uninstall") {
  uninstall();
} else if (command === "socket") {
  // 전역 설치본(PATH)이 아니라 이 패키지 안의 중계 서버를 실행한다.
  const r = spawnSync(process.execPath, [join(PKG_ROOT, "dist", "socket.js"), ...process.argv.slice(3)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 0);
} else {
  console.log(`
figma-free-mcp ${VERSION}

  npx -y figma-free-mcp@latest install   Install or update everything (run again to update)
  npx -y figma-free-mcp doctor           Check what is installed and connected
  npx -y figma-free-mcp uninstall        Remove the Claude registration
  npx -y figma-free-mcp socket           Start the relay server by hand (normally automatic)
`);
}
