# Changelog

## 1.1.0

Token and latency optimization. `tools/list` was 65,257 chars (~16,300 tokens)
for 100 tools, 73% of it `inputSchema`, and clients that do not defer tool
loading carry that in the system prompt on every request.

### Added

- **`batch`** — runs up to 100 Figma commands over a single websocket round
  trip. Building a screen otherwise means hundreds of create/set calls, each
  leaving a `tool_use` plus `tool_result` in context permanently. Ops run in
  order; the response is compressed to `batch 42/42 ok` plus the created ids.
  There is no rollback: on failure, nodes created by earlier ops remain.
- **Toolset gating** — `--toolsets=core,text` or the `FIGMA_MCP_TOOLSETS`
  environment variable selects which of the 14 toolsets to expose. Default is
  `all`, so existing setups are unaffected. `--toolsets=core` gives 71 tools /
  37,937 chars (−41.9%); `--toolsets=text` gives 17 tools / 8,048 chars.
- **`enable_toolset`** — turns a toolset on mid-session.
- `depth`, `childLimit` and `fields` on `get_node_info` / `get_nodes_info`.
- `maxChars` on `get_svg` (default 20,000). The write side already had a 500KB
  cap; the read side had none.
- `highlight` on `scan_text_nodes` and `set_multiple_text_contents`.

Plugin-side truncation is opt-in: with no `depth`/`childLimit` the plugin
returns the full subtree as before. The plugin ships from GitHub `main` and the
server from npm, so the two update at different times; defaulting to `depth 1`
in the plugin would have left a new plugin paired with an old server quietly
returning shallow data. The new server always sends both values explicitly.

### Changed — breaking

- **Color parameters take a hex string** instead of an `{ r, g, b, a }` object.
  `set_fill_color`, `set_stroke_color` and `set_selection_colors` take a single
  `color` instead of four flat `r`/`g`/`b`/`a` params. 18 parameters in total.
  The format sent to the plugin is unchanged. These tools are called by a model
  that re-reads the schema every turn, so there is no migration to do — and
  `"#ee6112"` is cheaper to emit than four floats.
- **`get_node_info` returns `depth 1` by default** instead of the entire
  subtree. Previously the plugin serialized every descendant with every
  property — hundreds of KB for one screen frame — and the server's filter
  recursed without limit. On a synthetic 5-level, 341-node tree the filtered
  payload drops from 113,529 to 3,225 bytes. Pass a larger `depth` when you
  need more; the response says when it truncated.
- **Node highlighting during text scan and replace is off by default.** It was
  the entire cost of those operations: 200 text nodes took ~22s chunked and
  ~100s unchunked, and 100 replacements spent ~29s in `delay()` alone. Pass
  `highlight: true` for the old behavior.
- `export_node_as_image` caps `scale` at 2. Inline images are expensive.
- Creation tools return just the node id (`rect 1:23`) instead of echoing the
  full result JSON.
- `scan_text_nodes` chunk size 10 → 50; `set_multiple_text_contents` chunk
  size 5 → 25.

### Removed

- **`connect_to_file` and `run_on_file`** — these shipped in 1.0.14–1.0.17 but
  their source was never committed, and they cannot work as published: both
  match channels on `fileName`, and no plugin ever reports one. `plugin/ui.html`
  sends `{ type: "join", channel }` with no file identity, and the plugin never
  reads `figma.fileKey` or `figma.root.name`, so `/channels` returns
  `fileName: undefined` and the match set is always empty. They always answered
  "No open file matching ...". Removing them also drops 1,872 chars from
  `tools/list`.

  Editing several files in one session is still a reasonable feature. Doing it
  properly needs the plugin to report `figma.root.name` / `figma.fileKey` /
  `figma.currentPage.name` on join, the socket server to keep that per channel
  and return it from `/channels`, and `sendCommandToFigma` to accept a target
  channel. Tracked separately.

### Fixed

- Node responses are cached for 15s, invalidated in `sendCommandToFigma` rather
  than per write tool. With over 100 tools, missing one invalidation means
  stale node info for the full TTL, so only the 21 read-only commands are
  allowlisted and everything else — including anything unrecognized — counts as
  a write. Writes invalidate both on send and on resolve, since a concurrent
  read finishing mid-write would otherwise re-cache the pre-write value.
- `filterFigmaNode` now passes the plugin's truncation markers through
  untouched. They are not in its key whitelist, so `truncated` / `omitted` /
  `childCount` were being stripped and the model could not tell anything had
  been cut.
- `FigmaCommand` gained `get_nodes_info` and `set_text_align`, which the plugin
  does handle.
- Removed `src/tools/core/core-index.ts`. It duplicated `src/tools/index.ts`'s
  registration and nothing imported it; importing it by accident would have
  registered every tool twice.

### Known issues

- Six commands are sent to the plugin that it has no handler for, so five tools
  fail at runtime with `Unknown command`: `create_paint_style` and
  `create_text_style` (`css_class_to_figma_style`), `set_opacity`
  (`react_to_figma`), `create_style` (`apply_design_system`),
  `get_node_children` (`audit_design_consistency`) and `move_page`
  (`organize_pages`). These are the remaining `tsc` errors — they are flagging
  real bugs and should not be silenced by adding the names to `FigmaCommand`.
  `tsup` sets `dts: false` and skips type checking, so the build passes anyway.
- `get_document_info`, `get_pages`, `get_styles`, `get_local_components` and
  `get_selection` do not go through `filterFigmaNode` and are still unbounded.
- `get_node_info` prunes *after* `exportAsync` has already serialized the whole
  subtree, so it saves tokens but not the time Figma spends on the export.
  Shallow depths should skip `exportAsync` and walk the plugin API directly.
