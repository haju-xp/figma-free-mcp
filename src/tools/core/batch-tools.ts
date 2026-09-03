import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { text } from "../../schemas/common";

/**
 * batch 도구.
 *
 * 화면 하나를 만들 때 create/set 호출이 수백 번 발생하고, 개별 호출마다
 * tool_use + tool_result 쌍이 컨텍스트에 영구 누적된다. batch는 여러 명령을
 * 한 번의 왕복으로 순차 실행하고, 응답을 한두 줄로 압축해 돌려준다.
 */

/** 플러그인 → 서버 응답 계약 (와이어 프로토콜 확정본). */
interface BatchOpResult {
  i: number;
  ok: boolean;
  id?: string;
  error?: string;
}

interface BatchResult {
  total: number;
  ok: number;
  failed: number;
  results: BatchOpResult[];
}

const opSchema = z.object({
  command: z
    .string()
    .describe("any figma tool name (e.g. create_frame, set_fill_color)"),
  params: z.record(z.any()).optional().describe("that tool's arguments"),
});

/** 구 버전 플러그인은 batch 핸들러가 없어 "Unknown command: batch"를 던진다. */
const LEGACY_PLUGIN_HINT =
  "batch requires plugin v1.1+; re-run 'npx figma-free-mcp setup' to update the plugin, or call tools individually";

function isUnknownCommandError(message: string): boolean {
  return /unknown command/i.test(message) && /batch/i.test(message);
}

/**
 * 결과를 압축한다. JSON 전체를 그대로 넣으면 이 도구의 존재 이유가 사라진다.
 * - 전부 성공: `batch 42/42 ok` + `0=1:23 1=1:24 ...`
 * - 실패 포함: `batch 40/42 ok` + 실패 목록 + 성공 id 목록
 */
function formatBatchResult(result: BatchResult, ops: { command: string }[]): string {
  const results = Array.isArray(result?.results) ? result.results : [];
  const total = typeof result?.total === "number" ? result.total : ops.length;
  const okCount =
    typeof result?.ok === "number" ? result.ok : results.filter(r => r.ok).length;

  const ids = results
    .filter(r => r.ok && r.id)
    .map(r => `${r.i}=${r.id}`)
    .join(" ");

  const lines = [`batch ${okCount}/${total} ok`];

  const failures = results.filter(r => !r.ok);
  if (failures.length > 0) {
    for (const f of failures) {
      const cmd = ops[f.i]?.command ?? "?";
      lines.push(`#${f.i} ${cmd}: ${f.error ?? "failed"}`);
    }
  }

  if (ids) lines.push(ids);

  return lines.join("\n");
}

/**
 * Register the batch tool.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch",
    "Run many Figma commands sequentially in ONE round trip. Use this instead of calling create_*/set_* tools one by one when building a screen — it collapses hundreds of tool calls into one and returns a compact id map.",
    {
      ops: z
        .array(opSchema)
        .min(1)
        .max(100)
        .describe("ops to run in order; command is any figma tool name, params is that tool's arguments"),
      stopOnError: z.boolean().optional().describe("abort at first failure (default true)"),
    },
    async ({ ops, stopOnError }) => {
      // 중첩 batch는 플러그인에 보내기 전에 서버에서 거부한다.
      const nested = ops.findIndex(op => op.command === "batch");
      if (nested >= 0) {
        return text(`nested batch not allowed (op #${nested}); flatten the ops array`);
      }

      const timeoutMs = Math.max(30000, ops.length * 1500);

      try {
        const raw = await sendCommandToFigma(
          "batch",
          { ops, stopOnError: stopOnError !== false },
          timeoutMs
        );
        return text(formatBatchResult(raw as BatchResult, ops));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isUnknownCommandError(message)) {
          return text(LEGACY_PLUGIN_HINT);
        }
        return text(`batch failed: ${message}`);
      }
    }
  );
}
