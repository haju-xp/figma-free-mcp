import { z } from "zod";
import { hexToRgba } from "../utils/css-parser";
import type { ColorWithDefaults } from "../types/color";

/**
 * 공통 스키마 모듈.
 *
 * 목적은 tools/list 페이로드 축소다. 이전에는 색상 파라미터마다
 * { r, g, b, a } 중첩 객체 스키마(약 408자)가 인라인으로 반복되어
 * 12곳에서 약 7.5KB를 차지했다. hex 문자열 한 줄로 대체한다.
 */

/** hex 색상 문자열. #RGB / #RGBA / #RRGGBB / #RRGGBBAA 모두 허용한다. */
export const hexColor = z
  .string()
  .regex(/^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "hex color (e.g. #ee6112)")
  .describe("hex color: #RRGGBB or #RRGGBBAA (alpha)");

/** 옵셔널 hex 색상. */
export const hexColorOptional = hexColor.optional();

/**
 * hex 문자열을 Figma 플러그인이 기대하는 0~1 범위 RGBA 객체로 변환한다.
 * 플러그인 쪽 계약은 그대로 두고 MCP 서버 경계에서만 변환한다.
 */
export function toFigmaColor(hex: string): ColorWithDefaults;
export function toFigmaColor(hex: string | undefined): ColorWithDefaults | undefined;
export function toFigmaColor(hex: string | undefined): ColorWithDefaults | undefined {
  if (hex === undefined) return undefined;
  return hexToRgba(hex);
}

/** 노드 ID. describe는 tool description에서 문맥이 드러나므로 최소로 유지한다. */
export const nodeId = z.string().describe("Target node ID");

/** 조회 도구 공통 페이징/깊이 파라미터. */
export const depth = z
  .number()
  .int()
  .min(0)
  .max(10)
  .optional()
  .describe("Child traversal depth (default 1, 0 = node only)");

export const childLimit = z
  .number()
  .int()
  .min(1)
  .max(500)
  .optional()
  .describe("Max children per level (default 50)");

/** 응답 직렬화. pretty-print 공백은 순수 토큰 낭비이므로 항상 compact. */
export function compact(value: unknown): string {
  return JSON.stringify(value);
}

/** 텍스트 응답 헬퍼. */
export function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/** 에러 응답 헬퍼. 문구를 짧게 통일한다. */
export function fail(prefix: string, error: unknown) {
  return text(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
}
