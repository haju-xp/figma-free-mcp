# 🎨 Figma MCP for Free Plan
https://smithery.ai/servers/haju-xp/figma-free-mcp

> Connect Claude to Figma with zero friction.
> No paid plan. No channel ID copy-paste. Just works.

[![npm](https://img.shields.io/npm/v/figma-free-mcp)](https://www.npmjs.com/package/figma-free-mcp)
[![smithery](https://img.shields.io/badge/smithery-figma--free--mcp-orange)](https://smithery.ai/server/haju-xp/figma-free-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

---

## ✨ Why this exists

| | Figma Official MCP | ClaudeTalkToFigma | **figma-free-mcp** |
|---|---|---|---|
| Free plan | ❌ Paid only | ✅ | ✅ |
| Auto-connect | ✅ | ❌ Manual channel ID | ✅ **Auto-detect** |
| Tools | Many | 70+ | **100+** |
| One-line install | ❌ | ❌ | ✅ |

---

## 🚀 Quick Start (3 steps)

### Step 1 — Install MCP + download plugin

```bash
npx figma-free-mcp@latest setup
```

This will:
- ✅ Register MCP in Claude Desktop automatically
- ✅ Download the Figma plugin to `~/.figma-free-mcp/plugin/`
- ✅ Show you the exact manifest path

### Step 2 — Install the Figma plugin (one-time)

1. Open **Figma Desktop**
2. Menu → **Plugins** → **Development** → **Import plugin from manifest...**
3. Select the path shown in Step 1:
   ```
   C:\Users\[YourName]\.figma-free-mcp\plugin\manifest.json
   ```
4. Run **"Figma Free MCP"** plugin in Figma — it auto-connects!

### Step 3 — Start the relay server

Open a terminal and keep it running:

```bash
npx --package figma-free-mcp figma-free-mcp-socket
```

> ⚠️ Keep this terminal open while using Claude with Figma.

---

## 💬 Usage

Once everything is running, just talk to Claude naturally:

```
"Figma에 버튼 컴포넌트 만들어줘"
"중복 페이지 찾아서 정리해줘"
"globals.css 색상 토큰을 Figma 변수로 싱크해줘"
"이 React 컴포넌트를 Figma 프레임으로 변환해줘"
```

Claude automatically detects your open Figma file — **no channel ID needed!**

---

## 🛠️ All Tools (100+)

### 🔌 Auto-Connect
| Tool | Description |
|------|-------------|
| `auto_connect` | Auto-detect active Figma sessions and connect |
| `list_active_channels` | List all open Figma plugin sessions |

### 📄 Document & Pages
`get_document_info`, `get_pages`, `get_selection`, `get_node_info`, `get_nodes_info`, `scan_text_nodes`, `get_styles`, `get_local_components`, `get_remote_components`, `get_variables` and more

### 🖼️ Creation
`create_frame`, `create_rectangle`, `create_ellipse`, `create_text`, `create_page`, `create_component_from_node`, `create_component_instance`, `create_component_set` and more

### ✏️ Modification
`set_fill_color`, `set_stroke_color`, `set_text_content`, `set_font_size`, `set_corner_radius`, `set_auto_layout`, `move_node`, `resize_node`, `delete_node`, `clone_node` and more

### 🎨 Design System Sync
| Tool | Description |
|------|-------------|
| `sync_css_to_figma` | CSS variables → Figma variable collections |
| `sync_figma_to_css` | Figma variables → CSS custom properties |
| `compare_design_tokens` | Diff report between CSS and Figma |
| `apply_design_system` | Apply design policy doc to Figma |
| `audit_design_consistency` | Find policy violations in Figma file |

### 📋 Page Manager
| Tool | Description |
|------|-------------|
| `list_all_pages_detailed` | All pages + frame count + duplicate detection |
| `deduplicate_pages` | Auto-merge/remove duplicate pages |
| `organize_pages` | Sort pages by number or alphabetically |
| `cleanup_empty_pages` | Remove empty pages |

### ⚡ Code to Figma
| Tool | Description |
|------|-------------|
| `react_to_figma` | React/TSX component → Figma frame |
| `css_class_to_figma_style` | CSS classes → Figma local styles |
| `generate_component_variants` | Generate hover/active/disabled variants |

---

## 🏗️ Architecture

```
Claude Desktop
    │
    │ stdio (MCP)
    ▼
figma-free-mcp server (100+ tools)
    │
    │ WebSocket (port 3055)
    ▼
Figma Plugin (auto-connect)
    │
    │ Figma API
    ▼
Your Figma File ✨
```

---

## ⚙️ Commands Reference

```bash
# Install & register MCP
npx figma-free-mcp@latest setup

# Start WebSocket relay server
npx --package figma-free-mcp figma-free-mcp-socket

# Uninstall
npx figma-free-mcp@latest uninstall
```

---

## ❓ FAQ

**Q. Do I need a paid Figma plan?**
A. No. Works with free Figma accounts.

**Q. Do I need Claude Pro?**
A. Any Claude Desktop plan works.

**Q. The plugin shows "Disconnected"**
A. Make sure the relay server is running: `npx --package figma-free-mcp figma-free-mcp-socket`

**Q. Multiple Figma files are open**
A. Claude will ask which file to connect to.

**Q. Port 3055 is already in use**
A. Kill the existing process: `netstat -ano | findstr :3055` then `taskkill /PID [number] /F`

---

## ⚠️ License & Usage

MIT License — free to use and modify.

✅ Personal & commercial use allowed
✅ Modification allowed
❌ Claiming as your own work prohibited
❌ Removing author credit prohibited

© 2026 [haju-xp](https://github.com/haju-xp)

---

## 🙏 Credits

Built on top of [claude-talk-to-figma-mcp](https://github.com/arinspunk/claude-talk-to-figma-mcp) by arinspunk (MIT License).
