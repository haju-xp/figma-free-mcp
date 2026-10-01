import { spawn } from "child_process";
import { existsSync, openSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { serverUrl, defaultPort } from "../config/config";
import { logger } from "./logger";

/**
 * 중계 서버(socket.js) 자동 기동.
 *
 * 예전에는 사용자가 터미널에서 직접 켜거나, 스킬이 `npx -y figma-free-mcp-socket`
 * (npm 에 없는 패키지명)으로 띄웠다. 전역 설치가 있는 PC 에서만 우연히 동작했고,
 * 그 경우에도 전역 구버전이 떠서 서버와 버전이 어긋났다.
 * 이제 MCP 서버가 같은 패키지 안의 socket.js 를 직접 띄운다.
 */

async function isRelayUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/channels`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function socketScriptPath(): string | null {
  // 빌드 결과에서 server.js 와 socket.js 는 같은 dist 폴더에 있다.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, "socket.js");
  return existsSync(candidate) ? candidate : null;
}

export const RELAY_LOG = join(tmpdir(), "figma-free-mcp-socket.log");

/**
 * 중계 서버가 없으면 백그라운드로 띄우고 뜰 때까지 기다린다.
 * @returns 결과 한 줄 (이미 떠 있음 / 새로 띄움 / 실패 사유)
 */
export async function ensureRelay(port: number = defaultPort): Promise<string> {
  if (serverUrl !== "localhost") return "remote relay — not managed";
  if (await isRelayUp(port)) return "relay already running";

  const script = socketScriptPath();
  if (!script) return "relay script not found next to server";

  try {
    const out = openSync(RELAY_LOG, "a");
    const child = spawn(process.execPath, [script, `--port=${port}`], {
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
  } catch (error) {
    return `relay start failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await isRelayUp(port)) {
      logger.info(`Started relay server on port ${port} (log: ${RELAY_LOG})`);
      return "relay started";
    }
  }
  return `relay did not come up on port ${port} — see ${RELAY_LOG}`;
}
