import { z } from "zod";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find(arg => arg.startsWith('--server='));
const portArg = args.find(arg => arg.startsWith('--port='));
const reconnectArg = args.find(arg => arg.startsWith('--reconnect-interval='));
const toolsetsArg = args.find(arg => arg.startsWith('--toolsets='));

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split('=')[1] : 'localhost';
export const defaultPort = portArg ? parseInt(portArg.split('=')[1], 10) : 3055;
export const reconnectInterval = reconnectArg ? parseInt(reconnectArg.split('=')[1], 10) : 2000;

// URL de WebSocket basada en el servidor (WS para localhost, WSS para remoto)
export const WS_URL = serverUrl === 'localhost' ? `ws://${serverUrl}` : `wss://${serverUrl}`;

// Configuración del servidor MCP
export const SERVER_CONFIG = {
  name: "FigmaFreeMCP",
  description: "Enhanced MCP for Figma Free — Design Sync, Page Manager, Code-to-Figma",
  version: "1.0.0",
};

/* ------------------------------------------------------------------ *
 * 툴셋 게이팅 (tools/list 페이로드 축소)
 *
 * 100개 도구를 모두 등록하면 tools/list 가 ~65KB(약 16k 토큰)다.
 * 대부분 세션에서 figjam / image / variable / code-to-figma 는 쓰이지 않는다.
 * 등록은 그대로 하되(하위호환), 비활성 툴셋은 disable() 해서 목록에서 뺀다.
 * ------------------------------------------------------------------ */

/** 툴셋 이름. 등록 함수 1개 = 툴셋 1개. */
export const TOOLSET_NAMES = [
  "autoconnect",
  "document",
  "creation",
  "modification",
  "text",
  "component",
  "image",
  "svg",
  "variable",
  "figjam",
  "batch",
  "designsync",
  "pagemanager",
  "codetofigma",
] as const;

export type ToolsetName = (typeof TOOLSET_NAMES)[number];

/**
 * 항상 활성인 툴셋. autoconnect 가 없으면 어떤 채널에도 붙을 수 없어
 * 서버가 사실상 무용지물이 된다. 어떤 설정에서도 강제로 켠다.
 */
export const ALWAYS_ON_TOOLSETS: readonly ToolsetName[] = ["autoconnect"];

/** 편의 별칭. */
const TOOLSET_ALIASES: Record<string, readonly ToolsetName[]> = {
  // 일상 UI 작업 최소 구성
  core: ["autoconnect", "document", "creation", "modification", "text", "svg", "batch"],
  all: TOOLSET_NAMES,
};

/** `--toolsets=` (우선) 또는 `FIGMA_MCP_TOOLSETS` 환경변수 원문. 미지정이면 undefined. */
const rawToolsets: string | undefined = toolsetsArg
  ? toolsetsArg.slice("--toolsets=".length)
  : process.env.FIGMA_MCP_TOOLSETS;

/**
 * 활성 툴셋 집합을 계산한다.
 * 기본값은 `all` — 지정하지 않은 사용자는 기존과 동일하게 동작해야 한다.
 * 알 수 없는 이름은 stderr 경고 후 무시한다(크래시 금지).
 */
function resolveToolsets(raw: string | undefined): Set<ToolsetName> {
  const active = new Set<ToolsetName>(ALWAYS_ON_TOOLSETS);

  const tokens = (raw ?? "all")
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);

  if (tokens.length === 0) {
    for (const n of TOOLSET_NAMES) active.add(n);
    return active;
  }

  const unknown: string[] = [];
  let hadValid = false;
  for (const token of tokens) {
    const alias = TOOLSET_ALIASES[token];
    if (alias) {
      for (const n of alias) active.add(n);
      hadValid = true;
      continue;
    }
    if ((TOOLSET_NAMES as readonly string[]).includes(token)) {
      active.add(token as ToolsetName);
      hadValid = true;
      continue;
    }
    unknown.push(token);
  }

  if (unknown.length > 0) {
    // logger를 import하면 config -> utils 순환 의존이 생길 수 있어 직접 stderr에 쓴다.
    // stdout은 stdio 트랜스포트 전용이므로 절대 쓰지 않는다.
    process.stderr.write(
      `[WARN] Unknown toolset(s) ignored: ${unknown.join(", ")}. ` +
        `Valid: ${TOOLSET_NAMES.join(", ")}, core, all\n`
    );
  }

  // 유효한 이름이 하나도 없었다면(전부 오타) 하위호환을 위해 전부 켠다.
  if (!hadValid) {
    process.stderr.write(`[WARN] No valid toolset specified; falling back to "all"\n`);
    for (const n of TOOLSET_NAMES) active.add(n);
  }

  return active;
}

/** 시작 시 활성화할 툴셋 집합. */
export const ACTIVE_TOOLSETS: Set<ToolsetName> = resolveToolsets(rawToolsets);

/** 사용자가 명시적으로 툴셋을 지정했는지(로깅용). */
export const toolsetsSpecified = rawToolsets !== undefined;