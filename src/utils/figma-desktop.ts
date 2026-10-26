import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger";
import { getActiveChannels, joinChannel, type ActiveChannel } from "./websocket";

const exec = promisify(execFile);

/** Figma file keys are alphanumeric; anything else never reaches `open`. */
const FILE_KEY_RE = /^[A-Za-z0-9]{10,}$/;

/** Menu labels differ per UI language, so every lookup tries each spelling. */
const PLUGINS_MENU = ["플러그인", "Plugins"];
const RUN_LAST_PLUGIN = ["최근 사용한 플러그인 실행", "Run last plugin"];

/** Figma greys the run item out on browser tabs and hides the menu on view-only files. */
const VIEW_ONLY_MARKER = "view-only";

export type PluginMenuState =
  | { kind: "ready" }
  | { kind: "view-only" }
  | { kind: "disabled" }
  | { kind: "unavailable"; detail: string };

export function isMacOS(): boolean {
  return process.platform === "darwin";
}

async function osascript(script: string, timeoutMs = 15000): Promise<string> {
  const { stdout } = await exec("osascript", ["-e", script], { timeout: timeoutMs });
  return String(stdout).trim();
}

/**
 * Menu clicks are swallowed when Figma is not frontmost — no error, no effect.
 * Every menu interaction below activates the app first.
 */
async function activateFigma(): Promise<void> {
  await osascript('tell application "Figma" to activate\ndelay 1.2');
}

/** AppleScript list literal of the candidate labels for one menu. */
function labelList(labels: string[]): string {
  return "{" + labels.map((l) => `"${l.replace(/"/g, '\\"')}"`).join(", ") + "}";
}

/**
 * Ask Figma whether the plugin can be launched on the tab that is active right now.
 * The window title lags behind tab switches, so it is never used as a signal.
 */
export async function readPluginMenuState(): Promise<PluginMenuState> {
  const script = `
tell application "System Events" to tell process "Figma"
  set menuNames to ${labelList(PLUGINS_MENU)}
  set runNames to ${labelList(RUN_LAST_PLUGIN)}
  repeat with m in menuNames
    try
      set itemNames to name of menu items of menu 1 of menu bar item (m as text) of menu bar 1
      set joined to ""
      repeat with i in itemNames
        try
          set joined to joined & (i as text) & "|"
        end try
      end repeat
      if joined contains "${VIEW_ONLY_MARKER}" then return "view-only"
      repeat with r in runNames
        try
          set mi to menu item (r as text) of menu 1 of menu bar item (m as text) of menu bar 1
          if enabled of mi then
            return "ready"
          else
            return "disabled"
          end if
        end try
      end repeat
      return "unavailable:no run item in " & joined
    end try
  end repeat
  return "unavailable:no plugins menu"
end tell`;
  const out = await osascript(script);
  if (out === "ready") return { kind: "ready" };
  if (out === "view-only") return { kind: "view-only" };
  if (out === "disabled") return { kind: "disabled" };
  return { kind: "unavailable", detail: out.replace(/^unavailable:/, "") };
}

/**
 * The Plugins menu fills in only once the tab has finished loading, so a single read
 * right after the deep link can miss the run item. Poll until it settles.
 */
async function waitForPluginMenuReady(timeoutMs: number): Promise<PluginMenuState> {
  const deadline = Date.now() + timeoutMs;
  let last: PluginMenuState = { kind: "unavailable", detail: "not read" };
  while (Date.now() < deadline) {
    last = await readPluginMenuState();
    if (last.kind === "ready" || last.kind === "view-only") return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

/** Click Plugins › Run last plugin. The plugin self-connects ~500ms later. */
export async function clickRunLastPlugin(): Promise<void> {
  const script = `
tell application "Figma" to activate
delay 1.2
tell application "System Events" to tell process "Figma"
  set menuNames to ${labelList(PLUGINS_MENU)}
  set runNames to ${labelList(RUN_LAST_PLUGIN)}
  repeat with m in menuNames
    repeat with r in runNames
      try
        click menu item (r as text) of menu 1 of menu bar item (m as text) of menu bar 1
        return "clicked"
      end try
    end repeat
  end repeat
  return "not-found"
end tell`;
  const out = await osascript(script);
  if (out !== "clicked") throw new Error("Could not click the run-last-plugin menu item");
}

/** Open (or switch to) a file in Figma desktop. Figma must be frontmost for the deep link to land. */
export async function openFileInDesktop(fileKey: string): Promise<void> {
  if (!FILE_KEY_RE.test(fileKey)) throw new Error(`Invalid file key: ${fileKey}`);
  await activateFigma();
  await exec("open", [`figma://file/${fileKey}`]);
}

/**
 * A channel outlives the plugin that created it — the relay keeps listing it while this
 * server is still joined. joinChannel verifies with a ping, so a channel that answers is
 * one with a plugin actually attached.
 */
async function findLiveChannel(fileKey: string, dead: Set<string>): Promise<ActiveChannel | undefined> {
  const candidates = (await getActiveChannels()).filter((c) => c.fileKey === fileKey && !dead.has(c.channel));
  for (const candidate of candidates) {
    try {
      await joinChannel(candidate.channel);
      return candidate;
    } catch {
      // Verification costs a full ping timeout, so never retry the same dead channel in one call.
      dead.add(candidate.channel);
      logger.info(`Channel ${candidate.channel} reports ${fileKey} but has no live plugin; skipping`);
    }
  }
  return undefined;
}

/** Poll the relay until a channel reports the target file, or the budget runs out. */
async function waitForChannel(fileKey: string, timeoutMs: number, dead: Set<string>): Promise<ActiveChannel | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await findLiveChannel(fileKey, dead);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return undefined;
}

export interface EnsureFileOpenResult {
  ok: boolean;
  channel?: ActiveChannel;
  /** Why it stopped, when ok is false. */
  reason?: string;
  /** What the call had to do: nothing, just a tab switch, or a tab switch plus a plugin launch. */
  action: "already-connected" | "opened" | "launched" | "none";
}

/**
 * Make `fileKey` reachable: find its live channel, or open the tab and launch the plugin.
 *
 * Tab targeting is not trusted — the channel's own fileKey is the only proof that the
 * plugin came up in the intended file, so a mismatch fails instead of editing the wrong file.
 */
export async function ensureFileOpen(
  fileKey: string,
  opts: { autoLaunch?: boolean; timeoutMs?: number } = {}
): Promise<EnsureFileOpenResult> {
  const { autoLaunch = true, timeoutMs = 25000 } = opts;

  if (!FILE_KEY_RE.test(fileKey)) {
    return { ok: false, action: "none", reason: `Invalid file key: ${fileKey}` };
  }

  const dead = new Set<string>();
  const existing = await findLiveChannel(fileKey, dead);
  if (existing) return { ok: true, action: "already-connected", channel: existing };

  if (!isMacOS()) {
    return { ok: false, action: "none", reason: "Auto-open is macOS only. Open the file and run the plugin manually." };
  }
  if (!autoLaunch) {
    return { ok: false, action: "none", reason: "No channel for this file and autoLaunch is off." };
  }

  await openFileInDesktop(fileKey);
  // Give the tab time to render before reading the menu.
  await new Promise((r) => setTimeout(r, 3000));

  // The plugin may already be running in that tab from an earlier session.
  const afterOpen = await waitForChannel(fileKey, 3000, dead);
  if (afterOpen) return { ok: true, action: "opened", channel: afterOpen };

  const state = await waitForPluginMenuReady(10000);
  if (state.kind === "view-only") {
    return { ok: false, action: "opened", reason: "File is view-only — plugins cannot run there." };
  }
  if (state.kind === "disabled") {
    return { ok: false, action: "opened", reason: "Run-last-plugin stayed greyed out — the active tab is not an editable design file." };
  }
  if (state.kind === "unavailable") {
    return { ok: false, action: "opened", reason: `Plugins menu never offered a run item (${state.detail}). The tab may still be loading, or Accessibility access is missing for the app running this server.` };
  }

  await clickRunLastPlugin();
  const channel = await waitForChannel(fileKey, timeoutMs, dead);
  if (!channel) {
    const open = (await getActiveChannels()).map((c) => `${c.fileName ?? "?"} (${c.fileKey ?? "?"})`).join(", ") || "none";
    logger.warn(`ensureFileOpen: no channel for ${fileKey} after launch; open channels: ${open}`);
    return {
      ok: false,
      action: "launched",
      reason: `Plugin launched but no channel reported file ${fileKey}. It may have started in another tab. Channels now: ${open}`,
    };
  }
  return { ok: true, action: "launched", channel };
}
