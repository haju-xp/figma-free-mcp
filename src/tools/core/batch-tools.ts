import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../../utils/websocket";
import { text } from "../../schemas/common";
import { hexToRgba } from "../../utils/css-parser";

/**
 * batch 도구.
 *
 * 화면 하나를 만들 때 create/set 호출이 수백 번 발생하고, 개별 호출마다
 * tool_use + tool_result 쌍이 컨텍스트에 영구 누적된다. batch는 여러 명령을
 * 한 번의 왕복으로 순차 실행하고, 응답을 한두 줄로 압축해 돌려준다.
 *
 * opsFile: 명령 목록을 로컬 JSON 파일로 받는다. 수백 개 명령을 도구 인자로
 * 직접 쓰면 그 자체가 출력 토큰이라 화면 하나 그리는 시간의 대부분이 된다.
 * 스크립트가 파일을 만들고 batch는 경로만 받는다.
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

interface Op {
  command: string;
  params?: Record<string, unknown>;
}

const opSchema = z.object({
  command: z
    .string()
    .describe("any figma tool name (e.g. create_frame, set_fill_color)"),
  params: z.record(z.any()).optional().describe("that tool's arguments"),
});

/** 플러그인 한 번에 보내는 최대 개수 (플러그인 BATCH_MAX_OPS 와 같아야 한다). */
const CHUNK = 100;
/** 파일 입력 시 허용하는 전체 개수. */
const MAX_TOTAL = 5000;

/** 구 버전 플러그인은 batch 핸들러가 없어 "Unknown command: batch"를 던진다. */
const LEGACY_PLUGIN_HINT =
  "batch requires plugin v1.1+; re-run 'npx -y figma-free-mcp install' to update the plugin, or call tools individually";

function isUnknownCommandError(message: string): boolean {
  return /unknown command/i.test(message) && /batch/i.test(message);
}

/**
 * batch 는 개별 도구를 거치지 않고 플러그인에 바로 가므로, 개별 도구가 하던
 * hex → RGBA 변환이 빠져 있었다 (hex 를 주면 검정이 되거나 오류). 여기서 맞춘다.
 */
const COLOR_KEYS = new Set(["fillColor", "strokeColor", "fontColor", "color"]);
const HEX = /^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function normalizeParams(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!params) return params;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = COLOR_KEYS.has(k) && typeof v === "string" && HEX.test(v) ? hexToRgba(v) : v;
  }
  return out;
}

/**
 * "$N" 참조는 전체 목록 기준 인덱스다. 청크로 나눠 보낼 때
 * - 이전 청크를 가리키면 서버가 이미 받은 id 로 바꾸고
 * - 같은 청크를 가리키면 청크 안 인덱스로 다시 매긴다 (플러그인이 해석).
 */
const REF = /^\$(\d+)$/;

export function remapRefs(value: unknown, start: number, ids: Map<number, string>): unknown {
  if (typeof value === "string") {
    const m = REF.exec(value);
    if (!m) return value;
    const n = Number(m[1]);
    if (n >= start) return `$${n - start}`;
    const id = ids.get(n);
    if (!id) throw new Error(`reference ${value} has no id (op ${n} failed or returned no id)`);
    return id;
  }
  if (Array.isArray(value)) return value.map(v => remapRefs(v, start, ids));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapRefs(v, start, ids);
    return out;
  }
  return value;
}

function loadOps(opsFile: string): Op[] {
  const raw = JSON.parse(readFileSync(opsFile, "utf-8"));
  const list = Array.isArray(raw) ? raw : raw?.ops;
  if (!Array.isArray(list)) throw new Error("opsFile must contain a JSON array of ops (or { ops: [...] })");
  return list as Op[];
}

/**
 * Register the batch tool.
 * @param server - The MCP server instance
 */
export function registerBatchTools(server: McpServer): void {
  server.tool(
    "batch",
    "Run many Figma commands sequentially in ONE call. Prefer opsFile (a local JSON array written by a script) for large screens: no op limit (auto-chunked), hex colors accepted, \"$N\" in any param = id from op N (e.g. parentId: \"$0\"). With idsFile the full id map is written to disk and only a one-line summary is returned.",
    {
      ops: z
        .array(opSchema)
        .min(1)
        .max(CHUNK)
        .optional()
        .describe("inline ops (max 100). Use opsFile for more"),
      opsFile: z.string().optional().describe("absolute path to a JSON array of {command, params}"),
      idsFile: z.string().optional().describe("write {index: id} map here instead of returning it"),
      stopOnError: z.boolean().optional().describe("abort at first failure (default true)"),
    },
    async ({ ops, opsFile, idsFile, stopOnError }) => {
      let list: Op[];
      try {
        if (opsFile && ops) return text("pass either ops or opsFile, not both");
        list = opsFile ? loadOps(opsFile) : (ops as Op[] | undefined) ?? [];
      } catch (error) {
        return text(`batch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (list.length === 0) return text("batch needs ops or opsFile");
      if (list.length > MAX_TOTAL) return text(`batch supports at most ${MAX_TOTAL} ops; received ${list.length}`);

      // 중첩 batch는 플러그인에 보내기 전에 서버에서 거부한다.
      const nested = list.findIndex(op => op.command === "batch");
      if (nested >= 0) {
        return text(`nested batch not allowed (op #${nested}); flatten the ops array`);
      }

      const stop = stopOnError !== false;
      const ids = new Map<number, string>();
      const failures: string[] = [];
      let okCount = 0;
      let sent = 0;

      try {
        for (let start = 0; start < list.length; start += CHUNK) {
          const slice = list.slice(start, start + CHUNK);
          const chunk = slice.map(op => ({
            command: op.command,
            params: remapRefs(normalizeParams(op.params), start, ids) as Record<string, unknown> | undefined,
          }));
          const raw = (await sendCommandToFigma(
            "batch",
            { ops: chunk, stopOnError: stop },
            Math.max(30000, chunk.length * 1500)
          )) as BatchResult;
          const results = Array.isArray(raw?.results) ? raw.results : [];
          sent += results.length;
          for (const r of results) {
            const gi = start + r.i;
            if (r.ok) {
              okCount++;
              if (r.id) ids.set(gi, r.id);
            } else {
              failures.push(`#${gi} ${list[gi]?.command ?? "?"}: ${r.error ?? "failed"}`);
            }
          }
          if (stop && failures.length > 0) break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isUnknownCommandError(message)) return text(LEGACY_PLUGIN_HINT);
        return text(`batch failed after ${sent}/${list.length} ops: ${message}`);
      }

      const lines = [`batch ${okCount}/${list.length} ok`];
      lines.push(...failures);
      if (idsFile) {
        writeFileSync(idsFile, JSON.stringify(Object.fromEntries(ids), null, 0), "utf-8");
        lines.push(`ids → ${idsFile}`);
      } else if (ids.size > 0) {
        lines.push([...ids].map(([i, id]) => `${i}=${id}`).join(" "));
      }
      return text(lines.join("\n"));
    }
  );
}
