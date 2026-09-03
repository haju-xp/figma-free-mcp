import { z } from "zod";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ACTIVE_TOOLSETS,
  ALWAYS_ON_TOOLSETS,
  TOOLSET_NAMES,
  type ToolsetName,
} from "../config/config";
import { text } from "../schemas/common";

// 기존 ClaudeTalkToFigma 코어 도구 (70+)
import { registerDocumentTools } from "./core/document-tools";
import { registerCreationTools } from "./core/creation-tools";
import { registerModificationTools } from "./core/modification-tools";
import { registerTextTools } from "./core/text-tools";
import { registerComponentTools } from "./core/component-tools";
import { registerImageTools } from "./core/image-tools";
import { registerSvgTools } from "./core/svg-tools";
import { registerVariableTools } from "./core/variable-tools";
import { registerFigJamTools } from "./core/figjam-tools";
import { registerAutoConnectTools } from "./core/auto-connect-tools";
import { registerBatchTools } from "./core/batch-tools";

// 신규 강화 도구
import { registerDesignSyncTools } from "./design-sync/design-sync-tools";
import { registerPageManagerTools } from "./page-manager/page-manager-tools";
import { registerCodeToFigmaTools } from "./code-to-figma/code-to-figma-tools";

/* ------------------------------------------------------------------ *
 * 툴셋 레지스트리
 * ------------------------------------------------------------------ */

export interface CapturedTool {
  name: string;
  tool: RegisteredTool;
}

/** 툴셋 이름 → 그 툴셋이 등록한 도구들. registerTools() 호출 후 채워진다. */
export const toolsetRegistry = new Map<ToolsetName, CapturedTool[]>();

/** 현재 활성 상태인 툴셋. enable_toolset 호출로 늘어난다. */
const enabledToolsets = new Set<ToolsetName>();

export interface ToolsetSummary {
  activeTools: number;
  totalTools: number;
  activeToolsets: ToolsetName[];
}

/**
 * 툴셋 하나를 활성화한다.
 * 이미 활성이면 `{ already: true }`. 알 수 없는 이름이면 `{ unknown: true }`.
 * tools/list changed 통지는 호출자(enable_toolset 핸들러)가 보낸다.
 */
export function enableToolset(name: string): {
  already: boolean;
  unknown: boolean;
  count: number;
} {
  if (!(TOOLSET_NAMES as readonly string[]).includes(name)) {
    return { already: false, unknown: true, count: 0 };
  }
  const key = name as ToolsetName;
  const tools = toolsetRegistry.get(key) ?? [];
  if (enabledToolsets.has(key)) {
    return { already: true, unknown: false, count: tools.length };
  }
  for (const { tool } of tools) tool.enable();
  enabledToolsets.add(key);
  return { already: false, unknown: false, count: tools.length };
}

/** 현재 활성 툴셋 목록(정의 순서). */
export function listEnabledToolsets(): ToolsetName[] {
  return TOOLSET_NAMES.filter(n => enabledToolsets.has(n));
}

/**
 * 등록 함수 하나를 실행하면서 그 함수가 만든 RegisteredTool 들을 수집한다.
 *
 * 왜 monkey-patch 인가: 각 `registerXxxTools(server)` 파일은 이 워크스트림의
 * 소유가 아니어서 시그니처를 바꿀 수 없다(다른 에이전트가 동시 작업 중).
 * 그래서 `server.tool` 을 등록 함수 실행 동안만 감싸 반환값을 가로챈다.
 * 반드시 `finally` 로 원복하며, 등록 함수가 throw 해도 원본이 복구된다.
 * 등록은 서버 시작 시 동기적으로 1회만 일어나므로 재진입 위험은 없다.
 */
function capture(
  server: McpServer,
  setName: ToolsetName,
  fn: (s: McpServer) => void
): void {
  const created: CapturedTool[] = [];
  const orig = server.tool.bind(server) as (...a: unknown[]) => RegisteredTool;
  (server as unknown as { tool: unknown }).tool = (...args: unknown[]) => {
    const t = orig(...args);
    created.push({ name: String(args[0]), tool: t });
    return t;
  };
  try {
    fn(server);
  } finally {
    (server as unknown as { tool: unknown }).tool = orig;
  }

  const existing = toolsetRegistry.get(setName);
  if (existing) existing.push(...created);
  else toolsetRegistry.set(setName, created);
}

/** 툴셋 이름 → 등록 함수. 호출 순서는 기존과 동일하게 유지한다. */
const TOOLSET_REGISTRARS: ReadonlyArray<[ToolsetName, (s: McpServer) => void]> = [
  ["document", registerDocumentTools],
  ["creation", registerCreationTools],
  ["modification", registerModificationTools],
  ["text", registerTextTools],
  ["component", registerComponentTools],
  ["image", registerImageTools],
  ["svg", registerSvgTools],
  ["variable", registerVariableTools],
  ["figjam", registerFigJamTools],
  ["autoconnect", registerAutoConnectTools],
  ["batch", registerBatchTools],
  ["designsync", registerDesignSyncTools],
  ["pagemanager", registerPageManagerTools],
  ["codetofigma", registerCodeToFigmaTools],
];

/** enable_toolset description에 들어가는 한 줄 요약. 길어지면 절감분을 깎는다. */
const TOOLSET_HINT =
  "document(inspect) creation(shapes) modification(layout/style) text component image svg variable figjam batch designsync pagemanager codetofigma; core=document+creation+modification+text+svg+batch";

/**
 * 모든 도구를 MCP 서버에 등록하고, 활성 툴셋에 없는 도구는 disable() 한다.
 * 도구 자체는 전부 등록되므로 enable_toolset 으로 런타임에 되살릴 수 있다.
 */
export function registerTools(server: McpServer): ToolsetSummary {
  toolsetRegistry.clear();
  enabledToolsets.clear();

  for (const [name, fn] of TOOLSET_REGISTRARS) {
    capture(server, name, fn);
  }

  // enable_toolset 은 게이팅 대상이 아니다 — 항상 활성이어야 점진적 노출이 가능하다.
  server.tool(
    "enable_toolset",
    `Enable a currently hidden Figma toolset (adds its tools to tools/list). Toolsets: ${TOOLSET_HINT}`,
    {
      name: z.enum(TOOLSET_NAMES).describe("toolset to enable"),
    },
    async ({ name }) => {
      const r = enableToolset(name);
      if (r.unknown) return text(`unknown toolset: ${name}`);
      if (r.already) return text(`${name} already enabled`);
      server.sendToolListChanged();
      return text(`enabled: ${name} (+${r.count} tools)`);
    }
  );

  // 활성 툴셋만 켜고 나머지는 끈다.
  let totalTools = 0;
  for (const [name, tools] of toolsetRegistry) {
    totalTools += tools.length;
    const on = ACTIVE_TOOLSETS.has(name) || ALWAYS_ON_TOOLSETS.includes(name);
    if (on) {
      enabledToolsets.add(name);
    } else {
      for (const { tool } of tools) tool.disable();
    }
  }

  const activeToolsets = listEnabledToolsets();
  const activeTools = activeToolsets.reduce(
    (a, n) => a + (toolsetRegistry.get(n)?.length ?? 0),
    0
  );

  return {
    // enable_toolset 자체도 목록에 노출되므로 +1.
    activeTools: activeTools + 1,
    totalTools: totalTools + 1,
    activeToolsets,
  };
}

export {
  // 코어
  registerDocumentTools,
  registerCreationTools,
  registerModificationTools,
  registerTextTools,
  registerComponentTools,
  registerImageTools,
  registerSvgTools,
  registerVariableTools,
  registerFigJamTools,
  registerBatchTools,
  // 강화
  registerDesignSyncTools,
  registerPageManagerTools,
  registerCodeToFigmaTools,
};
