import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

// 신규 강화 도구
import { registerDesignSyncTools } from "./design-sync/design-sync-tools";
import { registerPageManagerTools } from "./page-manager/page-manager-tools";
import { registerCodeToFigmaTools } from "./code-to-figma/code-to-figma-tools";

/**
 * 모든 도구를 MCP 서버에 등록
 */
export function registerTools(server: McpServer): void {
  // 코어 도구 (ClaudeTalkToFigma fork)
  registerDocumentTools(server);
  registerCreationTools(server);
  registerModificationTools(server);
  registerTextTools(server);
  registerComponentTools(server);
  registerImageTools(server);
  registerSvgTools(server);
  registerVariableTools(server);
  registerFigJamTools(server);
  registerAutoConnectTools(server);

  // 강화 도구 (figma-free-mcp 신규)
  registerDesignSyncTools(server);
  registerPageManagerTools(server);
  registerCodeToFigmaTools(server);
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
  // 강화
  registerDesignSyncTools,
  registerPageManagerTools,
  registerCodeToFigmaTools,
};
