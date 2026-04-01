# figma-free-mcp

**Enhanced MCP server for Figma Free** — all the power of AI-assisted design, no paid plan required.

🔌 **Auto-connect** — Claude detects your open Figma file automatically. No more copying channel IDs!

Built on top of [ClaudeTalkToFigma](https://github.com/arinspunk/claude-talk-to-figma-mcp) with auto-connect + 12 additional tools for design system synchronization, page management, and code-to-Figma conversion.

## Why?

- Figma's official MCP requires a **paid plan** (Dev Mode) — this works on **free Figma**
- `ClaudeTalkToFigma` requires manually copying a channel ID every time — **this auto-detects**
- **figma-free-mcp** = auto-connect + 70+ core tools + 12 enhanced tools = **82+ tools, zero friction**

## Features

### Core (from ClaudeTalkToFigma)
- Create/modify frames, text, shapes, components
- Auto layout, effects, gradients, images, SVG
- Variables, styles, FigJam elements
- 70+ tools total

### Design System Sync (NEW)
| Tool | Description |
|------|-------------|
| `sync_css_to_figma` | Read CSS variables and create Figma variable collections |
| `sync_figma_to_css` | Export Figma variables to CSS custom properties file |
| `compare_design_tokens` | Diff CSS vs Figma variables, report mismatches |
| `apply_design_system` | Parse a design policy markdown and apply to Figma |
| `audit_design_consistency` | Detect policy violations in Figma file |

### Page Manager (NEW)
| Tool | Description |
|------|-------------|
| `list_all_pages_detailed` | List pages with frame counts + duplicate detection |
| `deduplicate_pages` | Auto-merge/remove duplicate pages |
| `organize_pages` | Sort pages by number prefix or alphabetically |
| `cleanup_empty_pages` | Find and remove empty pages |

### Code-to-Figma (NEW)
| Tool | Description |
|------|-------------|
| `react_to_figma` | Analyze React/TSX and auto-create Figma frames |
| `css_class_to_figma_style` | Convert CSS classes to Figma styles |
| `generate_component_variants` | Create hover/active/disabled variants from a component |

## Prerequisites

1. **Figma Desktop App** (free account works)
2. **figma-free-mcp plugin** — our custom plugin (included in this repo, see below)
3. **Node.js** 20+

## Installation

### Option 1: npx (recommended)
```bash
npx figma-free-mcp
```

### Option 2: Global install
```bash
npm install -g figma-free-mcp
figma-free-mcp
```

### Option 3: From source
```bash
git clone https://github.com/haju-xp/figma-free-mcp.git
cd figma-free-mcp
npm install
npm run build
node dist/server.js
```

## Setup (1 command)

```bash
npx figma-free-mcp setup
```

That's it. Auto-registers in Claude Code. No config files to edit.

To uninstall:
```bash
npx figma-free-mcp uninstall
```

## Plugin Install (One-time)

1. Clone this repo: `git clone https://github.com/hajux/figma-free-mcp.git`
2. Open **Figma Desktop**
3. Menu → **Plugins** → **Development** → **Import plugin from manifest...**
4. Select `plugin/manifest.json`
5. Run **"Figma Free MCP"** plugin — it auto-connects to the relay server

> The plugin shows a compact status bar (32px). Click ▼ to expand Connect/Disconnect controls.

## Usage

### 1. Start the WebSocket relay (keep running)

```bash
npx --package figma-free-mcp figma-free-mcp-socket
```

### 2. Open Figma Desktop + run the **Figma Free MCP** plugin

### 3. Talk to Claude (no channel ID needed!)
```
Figma 연결해줘
```
Auto-connect detects the active plugin and connects automatically.
No more copying channel IDs!

If multiple Figma files are open, it will ask which one to connect to.

### Example Commands

**Sync CSS to Figma:**
```
Use sync_css_to_figma with cssFilePath: "./src/styles/globals.css"
```

**Find duplicate pages:**
```
Use list_all_pages_detailed to check for duplicates
```

**Clean up duplicates:**
```
Use deduplicate_pages with dryRun: false
```

**Convert React component to Figma:**
```
Use react_to_figma with filePath: "./src/components/Button.tsx"
```

**Audit design consistency:**
```
Use audit_design_consistency to check for policy violations
```

## Architecture

```
Claude Code <--(stdio/MCP)--> MCP Server <--(WebSocket)--> Figma Plugin
                                  |
                           82+ registered tools
                           ├── Core (70+)
                           ├── Design Sync (5)
                           ├── Page Manager (4)
                           └── Code-to-Figma (3)
```

## Development

```bash
npm install
npm run dev          # Watch mode
npm run build        # Production build
npm test             # Run tests
```

## License

MIT

## Credits

Built on top of [ClaudeTalkToFigma](https://github.com/arinspunk/claude-talk-to-figma-mcp) by Xulio Ze (MIT License).
