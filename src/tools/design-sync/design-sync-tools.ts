/**
 * 디자인 시스템 동기화를 위한 MCP 도구 모듈.
 * CSS 변수와 Figma 변수 간의 양방향 동기화, 비교, 정책 적용, 일관성 감사를 제공한다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";
import { sendCommandToFigma } from "../../utils/websocket.js";
import {
  parseCSSVariables,
  cssTokensToFigmaVariables,
  figmaVariablesToCSS,
  hexToRgba,
  type CSSToken,
  type FigmaVariable,
} from "../../utils/css-parser.js";

// --- 카테고리별 컬렉션 이름 매핑 ---

const CATEGORY_COLLECTION_NAMES: Record<CSSToken["category"], string> = {
  color: "Colors",
  shadow: "Shadows",
  spacing: "Spacing",
  radius: "Radius",
  font: "Typography",
  other: "Other",
};

// --- 헬퍼 함수 ---

/**
 * FigmaVariable 배열을 카테고리별로 그룹화한다.
 * @param variables - Figma 변수 배열
 * @returns 카테고리별로 그룹화된 Map
 */
function groupByCategory(
  variables: FigmaVariable[]
): Map<string, FigmaVariable[]> {
  const groups = new Map<string, FigmaVariable[]>();

  for (const variable of variables) {
    const collectionName =
      CATEGORY_COLLECTION_NAMES[variable.category] || "Other";
    const existing = groups.get(collectionName) || [];
    existing.push(variable);
    groups.set(collectionName, existing);
  }

  return groups;
}

/**
 * 마크다운 정책 파일에서 디자인 토큰 정보를 추출한다.
 * 색상, 타이포그래피, 간격 섹션에서 이름-값 쌍을 파싱한다.
 * @param content - 마크다운 파일 전체 문자열
 * @returns 추출된 스타일 정보 배열
 */
function parsePolicyMarkdown(content: string): Array<{
  type: "color" | "typography" | "spacing";
  name: string;
  value: string;
}> {
  const styles: Array<{
    type: "color" | "typography" | "spacing";
    name: string;
    value: string;
  }> = [];

  let currentSection: "color" | "typography" | "spacing" | null = null;

  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    // 섹션 헤더 감지
    if (/^#{1,3}\s.*color/i.test(line)) {
      currentSection = "color";
      continue;
    }
    if (/^#{1,3}\s.*(typography|font|text)/i.test(line)) {
      currentSection = "typography";
      continue;
    }
    if (/^#{1,3}\s.*(spacing|space|gap|margin|padding)/i.test(line)) {
      currentSection = "spacing";
      continue;
    }

    // 다른 헤더가 나오면 섹션 리셋
    if (/^#{1,3}\s/.test(line) && currentSection !== null) {
      currentSection = null;
      continue;
    }

    if (!currentSection) continue;

    // "- name: value" 또는 "- **name**: value" 패턴 파싱
    const kvMatch = line.match(
      /^[-*]\s+\*{0,2}([\w\s-]+?)\*{0,2}\s*[:=]\s*(.+)/
    );
    if (kvMatch) {
      styles.push({
        type: currentSection,
        name: kvMatch[1].trim(),
        value: kvMatch[2].trim(),
      });
      continue;
    }

    // "| name | value |" 테이블 행 파싱
    const tableMatch = line.match(
      /^\|\s*([\w\s-]+?)\s*\|\s*(.+?)\s*\|/
    );
    if (tableMatch && !tableMatch[1].includes("---")) {
      styles.push({
        type: currentSection,
        name: tableMatch[1].trim(),
        value: tableMatch[2].trim(),
      });
    }
  }

  return styles;
}

// --- MCP 도구 등록 ---

/**
 * 디자인 시스템 동기화 관련 MCP 도구 5종을 서버에 등록한다.
 * @param server - McpServer 인스턴스
 */
export function registerDesignSyncTools(server: McpServer): void {
  // --- 1. CSS -> Figma 동기화 ---
  server.tool(
    "sync_css_to_figma",
    "Read a CSS file and sync all CSS variables to Figma variable collections",
    {
      cssFilePath: z.string().describe("CSS 파일의 절대 경로 또는 상대 경로"),
      collectionName: z
        .string()
        .optional()
        .describe(
          "단일 컬렉션으로 묶을 경우의 컬렉션 이름. 미지정 시 카테고리별 자동 그룹화"
        ),
    },
    async ({ cssFilePath, collectionName }) => {
      try {
        // CSS 파일 읽기
        const cssContent = readFileSync(cssFilePath, "utf-8");

        // CSS 변수 파싱
        const tokens = parseCSSVariables(cssContent);

        if (tokens.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "CSS 파일에서 :root 블록 내 CSS 변수를 찾을 수 없습니다.",
              },
            ],
          };
        }

        // Figma 변수 형식으로 변환
        const figmaVariables = cssTokensToFigmaVariables(tokens);

        // 카테고리별 그룹화 또는 단일 컬렉션
        const grouped = collectionName
          ? new Map([[collectionName, figmaVariables]])
          : groupByCategory(figmaVariables);

        let createdCount = 0;
        const errors: string[] = [];

        // 각 그룹별로 Figma에 변수 생성/업데이트
        for (const [groupName, variables] of grouped) {
          for (const variable of variables) {
            try {
              await sendCommandToFigma("set_variable", {
                collection: groupName,
                name: variable.name,
                resolvedType: variable.resolvedType,
                value: variable.value,
              });
              createdCount++;
            } catch (error) {
              const msg =
                error instanceof Error ? error.message : String(error);
              errors.push(`${variable.name}: ${msg}`);
            }
          }
        }

        // 결과 리포트 생성
        const report = [
          `CSS -> Figma 동기화 완료`,
          `- 파싱된 CSS 변수: ${tokens.length}개`,
          `- 생성/업데이트 성공: ${createdCount}개`,
          `- 실패: ${errors.length}개`,
        ];

        if (errors.length > 0) {
          report.push("", "실패 항목:");
          errors.forEach((e) => report.push(`  - ${e}`));
        }

        return {
          content: [{ type: "text" as const, text: report.join("\n") }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `CSS 파일 읽기/파싱 실패: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- 2. Figma -> CSS 동기화 ---
  server.tool(
    "sync_figma_to_css",
    "Read Figma variable collections and generate a CSS file with custom properties",
    {
      outputFilePath: z
        .string()
        .optional()
        .describe(
          "CSS 파일 출력 경로. 미지정 시 텍스트로 반환"
        ),
    },
    async ({ outputFilePath }) => {
      try {
        // Figma에서 변수 목록 가져오기
        const result = (await sendCommandToFigma("get_variables")) as any;

        // 응답에서 변수 배열 추출
        const variables: Array<{
          name: string;
          resolvedType: string;
          value: any;
        }> = Array.isArray(result)
          ? result
          : result?.variables ?? result?.data ?? [];

        if (variables.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Figma에서 변수를 찾을 수 없습니다.",
              },
            ],
          };
        }

        // CSS 형식으로 변환
        const cssOutput = figmaVariablesToCSS(variables);

        // 파일 경로가 지정된 경우 파일로 저장
        if (outputFilePath) {
          writeFileSync(outputFilePath, cssOutput, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `Figma 변수 ${variables.length}개를 CSS 파일로 저장했습니다: ${outputFilePath}`,
              },
            ],
          };
        }

        // 파일 경로 미지정 시 텍스트로 반환
        return {
          content: [
            {
              type: "text" as const,
              text: `Figma 변수 ${variables.length}개를 CSS로 변환:\n\n${cssOutput}`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Figma 변수 읽기 실패: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- 3. 디자인 토큰 비교 ---
  server.tool(
    "compare_design_tokens",
    "Compare CSS variables with Figma variables and report differences",
    {
      cssFilePath: z.string().describe("비교할 CSS 파일 경로"),
    },
    async ({ cssFilePath }) => {
      try {
        // CSS 파일 파싱
        const cssContent = readFileSync(cssFilePath, "utf-8");
        const tokens = parseCSSVariables(cssContent);
        const cssVariables = cssTokensToFigmaVariables(tokens);

        // Figma 변수 가져오기
        const result = (await sendCommandToFigma("get_variables")) as any;
        const figmaVars: Array<{
          name: string;
          resolvedType: string;
          value: any;
        }> = Array.isArray(result)
          ? result
          : result?.variables ?? result?.data ?? [];

        // 이름 기준으로 비교 맵 생성
        const cssMap = new Map(cssVariables.map((v) => [v.name, v]));
        const figmaMap = new Map(figmaVars.map((v) => [v.name, v]));

        const onlyInCSS: string[] = [];
        const onlyInFigma: string[] = [];
        const valueDiffs: Array<{
          name: string;
          cssValue: string;
          figmaValue: string;
        }> = [];

        // CSS에만 있는 변수 찾기
        for (const [name, cssVar] of cssMap) {
          if (!figmaMap.has(name)) {
            onlyInCSS.push(name);
          } else {
            // 양쪽 다 있는 경우 값 비교
            const figmaVar = figmaMap.get(name)!;
            const cssValStr = JSON.stringify(cssVar.value);
            const figmaValStr = JSON.stringify(figmaVar.value);

            if (cssValStr !== figmaValStr) {
              valueDiffs.push({
                name,
                cssValue: cssValStr,
                figmaValue: figmaValStr,
              });
            }
          }
        }

        // Figma에만 있는 변수 찾기
        for (const name of figmaMap.keys()) {
          if (!cssMap.has(name)) {
            onlyInFigma.push(name);
          }
        }

        // 비교 리포트 생성
        const report = [
          "== 디자인 토큰 비교 리포트 ==",
          "",
          `CSS 변수 수: ${cssMap.size}`,
          `Figma 변수 수: ${figmaMap.size}`,
          "",
        ];

        if (
          onlyInCSS.length === 0 &&
          onlyInFigma.length === 0 &&
          valueDiffs.length === 0
        ) {
          report.push("모든 토큰이 동기화 상태입니다.");
        } else {
          if (onlyInCSS.length > 0) {
            report.push(`CSS에만 존재 (${onlyInCSS.length}개):`);
            onlyInCSS.forEach((n) => report.push(`  + ${n}`));
            report.push("");
          }

          if (onlyInFigma.length > 0) {
            report.push(`Figma에만 존재 (${onlyInFigma.length}개):`);
            onlyInFigma.forEach((n) => report.push(`  + ${n}`));
            report.push("");
          }

          if (valueDiffs.length > 0) {
            report.push(`값 불일치 (${valueDiffs.length}개):`);
            valueDiffs.forEach((d) => {
              report.push(`  ~ ${d.name}`);
              report.push(`    CSS:   ${d.cssValue}`);
              report.push(`    Figma: ${d.figmaValue}`);
            });
          }
        }

        return {
          content: [{ type: "text" as const, text: report.join("\n") }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `토큰 비교 실패: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- 4. 디자인 시스템 정책 적용 ---
  server.tool(
    "apply_design_system",
    "Read a design system policy markdown file and apply styles to Figma",
    {
      policyFilePath: z
        .string()
        .describe("디자인 시스템 정책 마크다운 파일 경로"),
    },
    async ({ policyFilePath }) => {
      try {
        // 마크다운 파일 읽기 및 파싱
        const content = readFileSync(policyFilePath, "utf-8");
        const policyStyles = parsePolicyMarkdown(content);

        if (policyStyles.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "정책 파일에서 디자인 토큰을 추출할 수 없습니다. 색상/타이포그래피/간격 섹션이 있는지 확인하세요.",
              },
            ],
          };
        }

        let appliedCount = 0;
        const errors: string[] = [];

        for (const style of policyStyles) {
          try {
            if (style.type === "color") {
              // 색상 스타일 생성
              const isHex = /^#[0-9a-fA-F]{3,8}$/.test(style.value);

              await sendCommandToFigma("create_style", {
                type: "PAINT",
                name: style.name,
                paint: isHex
                  ? {
                      type: "SOLID",
                      color: hexToRgba(style.value),
                    }
                  : {
                      type: "SOLID",
                      color: { r: 0, g: 0, b: 0, a: 1 },
                    },
              });
              appliedCount++;
            } else if (style.type === "typography") {
              // 타이포그래피 스타일 생성
              await sendCommandToFigma("create_style", {
                type: "TEXT",
                name: style.name,
                textStyle: {
                  fontFamily: style.value,
                },
              });
              appliedCount++;
            } else if (style.type === "spacing") {
              // 간격 값은 변수로 저장
              const numericValue = parseFloat(style.value);
              await sendCommandToFigma("set_variable", {
                collection: "Spacing",
                name: `Spacing/${style.name}`,
                resolvedType: "FLOAT",
                value: isNaN(numericValue) ? 0 : numericValue,
              });
              appliedCount++;
            }
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : String(error);
            errors.push(`${style.name}: ${msg}`);
          }
        }

        // 결과 리포트
        const report = [
          "디자인 시스템 정책 적용 완료",
          `- 추출된 스타일: ${policyStyles.length}개`,
          `- 적용 성공: ${appliedCount}개`,
          `- 실패: ${errors.length}개`,
        ];

        if (errors.length > 0) {
          report.push("", "실패 항목:");
          errors.forEach((e) => report.push(`  - ${e}`));
        }

        return {
          content: [{ type: "text" as const, text: report.join("\n") }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `정책 파일 처리 실패: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- 5. 디자인 일관성 감사 ---
  server.tool(
    "audit_design_consistency",
    "Audit a Figma file for design system policy violations",
    {
      pageId: z
        .string()
        .optional()
        .describe("감사할 페이지 ID. 미지정 시 현재 페이지"),
    },
    async ({ pageId }) => {
      try {
        // Figma에서 디자인 토큰(변수) 가져오기
        const variablesResult = (await sendCommandToFigma(
          "get_variables"
        )) as any;
        const variables: Array<{
          name: string;
          resolvedType: string;
          value: any;
        }> = Array.isArray(variablesResult)
          ? variablesResult
          : variablesResult?.variables ?? variablesResult?.data ?? [];

        // 허용된 토큰 값 수집 (색상, 수치)
        const allowedColors = new Set<string>();
        const allowedSizes = new Set<number>();

        for (const v of variables) {
          if (
            v.resolvedType === "COLOR" &&
            typeof v.value === "object" &&
            v.value !== null
          ) {
            // 색상을 비교 가능한 키로 변환
            const key = `${Math.round(v.value.r * 255)},${Math.round(v.value.g * 255)},${Math.round(v.value.b * 255)}`;
            allowedColors.add(key);
          } else if (v.resolvedType === "FLOAT" && typeof v.value === "number") {
            allowedSizes.add(v.value);
          }
        }

        // 페이지의 노드 목록 가져오기
        const nodesParams: Record<string, unknown> = {};
        if (pageId) {
          nodesParams.nodeId = pageId;
        }

        const nodesResult = (await sendCommandToFigma(
          "get_node_children",
          nodesParams
        )) as any;
        const nodes: any[] = Array.isArray(nodesResult)
          ? nodesResult
          : nodesResult?.children ?? nodesResult?.nodes ?? [];

        // 위반 사항 수집
        const violations: Array<{
          nodeId: string;
          nodeName: string;
          type: string;
          detail: string;
        }> = [];

        /**
         * 노드 트리를 재귀 탐색하며 디자인 토큰 위반을 검사한다.
         */
        function auditNode(node: any): void {
          const nodeId = node.id || "unknown";
          const nodeName = node.name || "Unnamed";

          // 채움색 검사
          if (node.fills && Array.isArray(node.fills)) {
            for (const fill of node.fills) {
              if (
                fill.type === "SOLID" &&
                fill.color &&
                fill.visible !== false
              ) {
                const colorKey = `${Math.round(fill.color.r * 255)},${Math.round(fill.color.g * 255)},${Math.round(fill.color.b * 255)}`;
                if (allowedColors.size > 0 && !allowedColors.has(colorKey)) {
                  violations.push({
                    nodeId,
                    nodeName,
                    type: "color",
                    detail: `정의되지 않은 색상 사용: rgb(${colorKey})`,
                  });
                }
              }
            }
          }

          // 폰트 크기 검사
          if (node.type === "TEXT" && node.fontSize) {
            if (allowedSizes.size > 0 && !allowedSizes.has(node.fontSize)) {
              violations.push({
                nodeId,
                nodeName,
                type: "font-size",
                detail: `정의되지 않은 폰트 크기: ${node.fontSize}px`,
              });
            }
          }

          // 둥글기 검사
          if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
            if (
              allowedSizes.size > 0 &&
              !allowedSizes.has(node.cornerRadius)
            ) {
              violations.push({
                nodeId,
                nodeName,
                type: "border-radius",
                detail: `정의되지 않은 둥글기: ${node.cornerRadius}px`,
              });
            }
          }

          // 자식 노드 재귀 탐색
          if (node.children && Array.isArray(node.children)) {
            for (const child of node.children) {
              auditNode(child);
            }
          }
        }

        // 모든 노드 감사 실행
        for (const node of nodes) {
          auditNode(node);
        }

        // 감사 리포트 생성
        const report = [
          "== 디자인 일관성 감사 리포트 ==",
          "",
          `검사 기준 토큰: 색상 ${allowedColors.size}개, 수치 ${allowedSizes.size}개`,
          `검사된 노드 수: ${nodes.length}개 (최상위)`,
          `발견된 위반: ${violations.length}개`,
          "",
        ];

        if (variables.length === 0) {
          report.push(
            "경고: Figma에 정의된 변수가 없어 비교 기준이 없습니다.",
            "먼저 sync_css_to_figma 또는 apply_design_system으로 토큰을 등록하세요."
          );
        } else if (violations.length === 0) {
          report.push("위반 사항 없음. 디자인 시스템과 일관성이 유지되고 있습니다.");
        } else {
          // 유형별 그룹화
          const byType = new Map<string, typeof violations>();
          for (const v of violations) {
            const existing = byType.get(v.type) || [];
            existing.push(v);
            byType.set(v.type, existing);
          }

          for (const [type, items] of byType) {
            report.push(`[${type}] 위반 ${items.length}개:`);
            // 최대 20개까지만 표시 (너무 많으면 가독성 저하)
            const displayItems = items.slice(0, 20);
            for (const item of displayItems) {
              report.push(`  - ${item.nodeName} (${item.nodeId}): ${item.detail}`);
            }
            if (items.length > 20) {
              report.push(`  ... 외 ${items.length - 20}개`);
            }
            report.push("");
          }
        }

        return {
          content: [{ type: "text" as const, text: report.join("\n") }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `디자인 감사 실패: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
