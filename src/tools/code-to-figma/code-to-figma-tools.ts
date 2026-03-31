import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../../utils/websocket.js";
import { readFileSync } from "fs";

/**
 * CSS 색상 문자열(hex, rgb)을 Figma RGBA 객체(0-1 범위)로 변환한다.
 */
function parseCssColor(
  color: string
): { r: number; g: number; b: number; a: number } | null {
  // hex (#RGB, #RRGGBB)
  const hexMatch = color.match(
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
  );
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  // rgb / rgba
  const rgbMatch = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/
  );
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 16) / 255,
      g: parseInt(rgbMatch[2], 16) / 255,
      b: parseInt(rgbMatch[3], 16) / 255,
      a: rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  return null;
}

/**
 * CSS font-size 문자열에서 px 숫자 값을 추출한다.
 */
function parseFontSize(value: string): number | null {
  const match = value.match(/([\d.]+)\s*px/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * CSS font-weight 문자열을 Figma에서 사용 가능한 font style 이름으로 매핑한다.
 */
function mapFontWeight(value: string): string {
  const num = parseInt(value, 10);
  if (!isNaN(num)) {
    if (num <= 300) return "Light";
    if (num <= 400) return "Regular";
    if (num <= 500) return "Medium";
    if (num <= 600) return "Semi Bold";
    if (num <= 700) return "Bold";
    return "Extra Bold";
  }
  if (value === "bold") return "Bold";
  if (value === "lighter") return "Light";
  return "Regular";
}

interface ExtractedElement {
  type: "frame" | "text" | "button" | "input" | "image";
  tag: string;
  content?: string;
  className?: string;
}

/**
 * Register code-to-figma tools to the MCP server.
 * Provides utilities to convert React/TSX components and CSS into Figma designs.
 * @param server - The MCP server instance
 */
export function registerCodeToFigmaTools(server: McpServer): void {
  // React to Figma Tool
  server.tool(
    "react_to_figma",
    "Analyze a React/TSX component file and create corresponding Figma frames and elements",
    {
      filePath: z.string().describe("Absolute path to the React/TSX component file"),
      pageId: z
        .string()
        .optional()
        .describe("Optional Figma page ID to create elements in"),
    },
    async ({ filePath, pageId }) => {
      try {
        const source = readFileSync(filePath, "utf-8");

        // 대상 페이지로 전환
        if (pageId) {
          await sendCommandToFigma("set_current_page", { pageId });
        }

        const elements: ExtractedElement[] = [];

        // div with className -> frame
        const divRegex =
          /<div\s+(?:[^>]*?)className=["']([^"']*)["'][^>]*>/g;
        let match: RegExpExecArray | null;
        while ((match = divRegex.exec(source)) !== null) {
          elements.push({
            type: "frame",
            tag: "div",
            className: match[1],
          });
        }

        // heading / paragraph / span -> text
        const textRegex =
          /<(h[1-6]|p|span)(?:\s+[^>]*)?>([^<]*)<\/\1>/g;
        while ((match = textRegex.exec(source)) !== null) {
          elements.push({
            type: "text",
            tag: match[1],
            content: match[2].trim(),
          });
        }

        // button -> button frame
        const buttonRegex =
          /<button(?:\s+[^>]*)?>([^<]*)<\/button>/g;
        while ((match = buttonRegex.exec(source)) !== null) {
          elements.push({
            type: "button",
            tag: "button",
            content: match[1].trim(),
          });
        }

        // input / select / textarea -> input frame
        const inputRegex =
          /<(input|select|textarea)(?:\s+[^>]*?)(?:placeholder=["']([^"']*)["'])?[^>]*\/?>/g;
        while ((match = inputRegex.exec(source)) !== null) {
          elements.push({
            type: "input",
            tag: match[1],
            content: match[2] || match[1],
          });
        }

        // img -> placeholder rectangle
        const imgRegex = /<img(?:\s+[^>]*?)(?:alt=["']([^"']*)["'])?[^>]*\/?>/g;
        while ((match = imgRegex.exec(source)) !== null) {
          elements.push({
            type: "image",
            tag: "img",
            content: match[1] || "image",
          });
        }

        // Figma 요소 생성
        const created: { type: string; name: string; id?: string }[] = [];
        let yOffset = 0;
        const SPACING = 20;

        for (const el of elements) {
          try {
            switch (el.type) {
              case "frame": {
                const result = (await sendCommandToFigma("create_frame", {
                  x: 0,
                  y: yOffset,
                  width: 800,
                  height: 200,
                  name: el.className || "Frame",
                })) as { id?: string };
                created.push({
                  type: "frame",
                  name: el.className || "Frame",
                  id: result?.id,
                });
                yOffset += 200 + SPACING;
                break;
              }
              case "text": {
                // 태그에 따라 폰트 크기 결정
                const fontSizeMap: Record<string, number> = {
                  h1: 48,
                  h2: 36,
                  h3: 28,
                  h4: 24,
                  h5: 20,
                  h6: 16,
                  p: 16,
                  span: 14,
                };
                const fontSize = fontSizeMap[el.tag] || 16;
                const result = (await sendCommandToFigma("create_text", {
                  x: 0,
                  y: yOffset,
                  text: el.content || el.tag,
                  fontSize,
                  name: `${el.tag}: ${(el.content || "").substring(0, 30)}`,
                })) as { id?: string };
                created.push({
                  type: "text",
                  name: `${el.tag}: ${(el.content || "").substring(0, 30)}`,
                  id: result?.id,
                });
                yOffset += fontSize + SPACING;
                break;
              }
              case "button": {
                // 버튼은 배경 프레임 + 텍스트로 생성
                const btnResult = (await sendCommandToFigma("create_frame", {
                  x: 0,
                  y: yOffset,
                  width: 200,
                  height: 48,
                  name: `Button: ${(el.content || "").substring(0, 20)}`,
                  fillColor: { r: 0.2, g: 0.4, b: 0.9, a: 1 },
                  cornerRadius: 8,
                })) as { id?: string };
                if (btnResult?.id) {
                  await sendCommandToFigma("create_text", {
                    x: 16,
                    y: 12,
                    text: el.content || "Button",
                    fontSize: 16,
                    parentId: btnResult.id,
                    color: { r: 1, g: 1, b: 1 },
                  });
                }
                created.push({
                  type: "button",
                  name: `Button: ${(el.content || "").substring(0, 20)}`,
                  id: btnResult?.id,
                });
                yOffset += 48 + SPACING;
                break;
              }
              case "input": {
                // 입력 필드를 프레임 + placeholder 텍스트로 생성
                const inputResult = (await sendCommandToFigma("create_frame", {
                  x: 0,
                  y: yOffset,
                  width: 320,
                  height: 44,
                  name: `Input: ${el.tag}`,
                  fillColor: { r: 1, g: 1, b: 1, a: 1 },
                  strokeColor: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
                  strokeWeight: 1,
                  cornerRadius: 6,
                })) as { id?: string };
                if (inputResult?.id) {
                  await sendCommandToFigma("create_text", {
                    x: 12,
                    y: 12,
                    text: el.content || "Placeholder",
                    fontSize: 14,
                    parentId: inputResult.id,
                    color: { r: 0.6, g: 0.6, b: 0.6 },
                  });
                }
                created.push({
                  type: "input",
                  name: `Input: ${el.tag}`,
                  id: inputResult?.id,
                });
                yOffset += 44 + SPACING;
                break;
              }
              case "image": {
                // 이미지를 placeholder 사각형으로 생성
                const imgResult = (await sendCommandToFigma(
                  "create_rectangle",
                  {
                    x: 0,
                    y: yOffset,
                    width: 400,
                    height: 300,
                    name: `Image: ${(el.content || "image").substring(0, 30)}`,
                    fillColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
                  }
                )) as { id?: string };
                created.push({
                  type: "image",
                  name: `Image: ${(el.content || "image").substring(0, 30)}`,
                  id: imgResult?.id,
                });
                yOffset += 300 + SPACING;
                break;
              }
            }
          } catch (elementError) {
            created.push({
              type: el.type,
              name: `[FAILED] ${el.tag}: ${elementError instanceof Error ? elementError.message : String(elementError)}`,
            });
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Processed ${elements.length} JSX element(s) from ${filePath}`,
                  created,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error converting React to Figma: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // CSS Class to Figma Style Tool
  server.tool(
    "css_class_to_figma_style",
    "Convert CSS class definitions to Figma local paint/text styles",
    {
      cssFilePath: z.string().describe("Absolute path to the CSS file"),
      classNames: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of specific class names to convert. If omitted, all classes are processed."
        ),
    },
    async ({ cssFilePath, classNames }) => {
      try {
        const cssSource = readFileSync(cssFilePath, "utf-8");

        // CSS 클래스 블록 파싱
        const classBlockRegex = /\.([a-zA-Z_][\w-]*)\s*\{([^}]*)\}/g;
        const createdStyles: {
          className: string;
          styleType: string;
          styleName: string;
        }[] = [];

        let match: RegExpExecArray | null;
        while ((match = classBlockRegex.exec(cssSource)) !== null) {
          const className = match[1];
          const body = match[2];

          // 특정 클래스만 필터링
          if (classNames && classNames.length > 0 && !classNames.includes(className)) {
            continue;
          }

          // 속성 추출
          const props: Record<string, string> = {};
          const propRegex = /([\w-]+)\s*:\s*([^;]+)/g;
          let propMatch: RegExpExecArray | null;
          while ((propMatch = propRegex.exec(body)) !== null) {
            props[propMatch[1].trim()] = propMatch[2].trim();
          }

          // color 또는 background-color가 있으면 paint style 생성
          const bgColor = props["background-color"] || props["background"];
          if (bgColor) {
            const parsed = parseCssColor(bgColor);
            if (parsed) {
              try {
                await sendCommandToFigma("create_paint_style", {
                  name: `CSS/${className}/background`,
                  color: parsed,
                });
                createdStyles.push({
                  className,
                  styleType: "paint",
                  styleName: `CSS/${className}/background`,
                });
              } catch (styleError) {
                createdStyles.push({
                  className,
                  styleType: "paint",
                  styleName: `[FAILED] CSS/${className}/background: ${styleError instanceof Error ? styleError.message : String(styleError)}`,
                });
              }
            }
          }

          const textColor = props["color"];
          if (textColor) {
            const parsed = parseCssColor(textColor);
            if (parsed) {
              try {
                await sendCommandToFigma("create_paint_style", {
                  name: `CSS/${className}/color`,
                  color: parsed,
                });
                createdStyles.push({
                  className,
                  styleType: "paint",
                  styleName: `CSS/${className}/color`,
                });
              } catch (styleError) {
                createdStyles.push({
                  className,
                  styleType: "paint",
                  styleName: `[FAILED] CSS/${className}/color: ${styleError instanceof Error ? styleError.message : String(styleError)}`,
                });
              }
            }
          }

          // font-size / font-weight가 있으면 text style 생성
          const fontSize = props["font-size"];
          const fontWeight = props["font-weight"];
          if (fontSize || fontWeight) {
            try {
              const textStyleProps: Record<string, unknown> = {
                name: `CSS/${className}/text`,
              };
              if (fontSize) {
                const size = parseFontSize(fontSize);
                if (size) textStyleProps.fontSize = size;
              }
              if (fontWeight) {
                textStyleProps.fontStyle = mapFontWeight(fontWeight);
              }
              await sendCommandToFigma("create_text_style", textStyleProps);
              createdStyles.push({
                className,
                styleType: "text",
                styleName: `CSS/${className}/text`,
              });
            } catch (styleError) {
              createdStyles.push({
                className,
                styleType: "text",
                styleName: `[FAILED] CSS/${className}/text: ${styleError instanceof Error ? styleError.message : String(styleError)}`,
              });
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Processed CSS file: ${cssFilePath}. Created ${createdStyles.length} style(s).`,
                  styles: createdStyles,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error converting CSS to Figma styles: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Generate Component Variants Tool
  server.tool(
    "generate_component_variants",
    "Generate Figma component variants (default, hover, active, disabled) from a base component",
    {
      componentNodeId: z
        .string()
        .describe("The node ID of the base Figma component"),
      states: z
        .array(z.string())
        .optional()
        .describe(
          'Optional list of states to generate (default: ["hover", "active", "disabled"])'
        ),
    },
    async ({ componentNodeId, states }) => {
      try {
        const targetStates = states ?? ["hover", "active", "disabled"];

        // 기본 컴포넌트 정보 조회
        const baseInfo = (await sendCommandToFigma("get_node_info", {
          nodeId: componentNodeId,
        })) as {
          id: string;
          name: string;
          width?: number;
          height?: number;
          fills?: Array<{ color?: { r: number; g: number; b: number; a?: number } }>;
          absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
        };

        const baseName = baseInfo.name || "Component";
        const baseWidth = baseInfo.width ?? baseInfo.absoluteBoundingBox?.width ?? 200;
        const baseHeight = baseInfo.height ?? baseInfo.absoluteBoundingBox?.height ?? 48;

        // 기본 fill 색상 추출
        const baseFill = baseInfo.fills?.[0]?.color ?? {
          r: 0.2,
          g: 0.4,
          b: 0.9,
        };

        const variants: {
          state: string;
          nodeId?: string;
          status: string;
        }[] = [];

        // default 상태 기록
        variants.push({
          state: "default",
          nodeId: componentNodeId,
          status: "original",
        });

        // 각 상태별 variant 생성
        for (let i = 0; i < targetStates.length; i++) {
          const state = targetStates[i];
          const xOffset = (i + 1) * (baseWidth + 40);

          try {
            // 클론 생성
            const cloneResult = (await sendCommandToFigma("clone_node", {
              nodeId: componentNodeId,
            })) as { id: string };

            const cloneId = cloneResult.id;

            // 이름 변경 (variant 속성 포함)
            await sendCommandToFigma("rename_node", {
              nodeId: cloneId,
              name: `${baseName} / State=${state}`,
            });

            // 위치 이동 (수평 배치)
            await sendCommandToFigma("move_node", {
              nodeId: cloneId,
              x: xOffset,
              y: 0,
            });

            // 상태별 스타일 적용
            switch (state) {
              case "hover": {
                // hover: 약간 어두운 fill
                const darkerFill = {
                  r: Math.max(0, baseFill.r - 0.1),
                  g: Math.max(0, baseFill.g - 0.1),
                  b: Math.max(0, baseFill.b - 0.1),
                  a: 1,
                };
                await sendCommandToFigma("set_fill_color", {
                  nodeId: cloneId,
                  color: darkerFill,
                });
                break;
              }
              case "active": {
                // active: 더 어두운 fill
                const activeFill = {
                  r: Math.max(0, baseFill.r - 0.2),
                  g: Math.max(0, baseFill.g - 0.2),
                  b: Math.max(0, baseFill.b - 0.2),
                  a: 1,
                };
                await sendCommandToFigma("set_fill_color", {
                  nodeId: cloneId,
                  color: activeFill,
                });
                break;
              }
              case "disabled": {
                // disabled: opacity 0.4
                await sendCommandToFigma("set_opacity", {
                  nodeId: cloneId,
                  opacity: 0.4,
                });
                break;
              }
              default: {
                // 알 수 없는 상태: 이름만 변경하고 스타일은 유지
                break;
              }
            }

            variants.push({
              state,
              nodeId: cloneId,
              status: "created",
            });
          } catch (variantError) {
            variants.push({
              state,
              status: `failed: ${variantError instanceof Error ? variantError.message : String(variantError)}`,
            });
          }
        }

        // 컴포넌트 세트 생성 시도
        let componentSetId: string | undefined;
        try {
          const allVariantIds = variants
            .filter((v) => v.nodeId)
            .map((v) => v.nodeId!);
          const setResult = (await sendCommandToFigma(
            "create_component_set",
            {
              nodeIds: allVariantIds,
              name: baseName,
            }
          )) as { id?: string };
          componentSetId = setResult?.id;
        } catch {
          // 컴포넌트 세트 생성 실패 시 개별 variant는 유지
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Generated ${variants.length} variant(s) for "${baseName}"`,
                  componentSetId: componentSetId ?? null,
                  variants,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating component variants: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
