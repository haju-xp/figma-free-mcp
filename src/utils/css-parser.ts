/**
 * CSS 커스텀 프로퍼티(변수) 파싱 및 Figma 변수 변환 유틸리티.
 * :root 블록에서 CSS 변수를 추출하고, Figma 변수 형식으로 변환하거나
 * 그 반대 방향의 변환을 수행한다.
 */

// --- 타입 정의 ---

/** CSS 변수를 파싱한 결과 토큰 */
export interface CSSToken {
  /** 변수 이름 (예: "--color-primary") */
  name: string;
  /** 변수 값 (예: "#2563EB") */
  value: string;
  /** 자동 분류된 카테고리 */
  category: "color" | "spacing" | "radius" | "shadow" | "font" | "other";
  /** 원본 CSS 라인 */
  rawLine: string;
}

/** Figma 변수 생성에 필요한 구조체 */
export interface FigmaVariable {
  /** 변수 이름 (슬래시 구분 경로, 예: "Colors/color-primary") */
  name: string;
  /** Figma 변수 타입 */
  resolvedType: "COLOR" | "FLOAT" | "STRING";
  /** 변수 값 (색상은 RGBA 객체, 수치는 number, 기타는 string) */
  value: { r: number; g: number; b: number; a: number } | number | string;
  /** 원본 CSS 변수 이름 */
  cssName: string;
  /** 카테고리 */
  category: CSSToken["category"];
}

// --- 카테고리 분류 매핑 ---

/** 변수 이름 접두사에 따른 카테고리 분류 규칙 */
const CATEGORY_RULES: Array<{
  prefixes: string[];
  category: CSSToken["category"];
}> = [
  { prefixes: ["--color-"], category: "color" },
  { prefixes: ["--shadow-"], category: "shadow" },
  { prefixes: ["--space-"], category: "spacing" },
  { prefixes: ["--radius-"], category: "radius" },
  { prefixes: ["--font-", "--text-"], category: "font" },
];

/**
 * 변수 이름으로부터 카테고리를 자동 분류한다.
 * @param name - CSS 변수 이름 (예: "--color-primary")
 * @returns 분류된 카테고리
 */
function categorize(name: string): CSSToken["category"] {
  for (const rule of CATEGORY_RULES) {
    if (rule.prefixes.some((prefix) => name.startsWith(prefix))) {
      return rule.category;
    }
  }
  return "other";
}

// --- 카테고리-Figma 컬렉션명 매핑 ---

const CATEGORY_COLLECTION_MAP: Record<CSSToken["category"], string> = {
  color: "Colors",
  shadow: "Shadows",
  spacing: "Spacing",
  radius: "Radius",
  font: "Typography",
  other: "Other",
};

// --- 핵심 함수 ---

/**
 * 16진수 색상 코드를 0-1 범위의 RGBA 객체로 변환한다.
 * 3자리(#RGB), 4자리(#RGBA), 6자리(#RRGGBB), 8자리(#RRGGBBAA)를 지원한다.
 * @param hex - 16진수 색상 문자열 (예: "#2563EB", "#fff", "#2563EB80")
 * @returns 0-1 범위의 RGBA 객체
 */
export function hexToRgba(hex: string): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  let cleaned = hex.replace(/^#/, "");

  // 3자리 -> 6자리 확장 (예: "abc" -> "aabbcc")
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }

  // 4자리 -> 8자리 확장 (예: "abcd" -> "aabbccdd")
  if (cleaned.length === 4) {
    cleaned = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }

  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;

  // 8자리인 경우 알파 채널 파싱
  const a = cleaned.length === 8 ? parseInt(cleaned.slice(6, 8), 16) / 255 : 1;

  return {
    r: Math.round(r * 1000) / 1000,
    g: Math.round(g * 1000) / 1000,
    b: Math.round(b * 1000) / 1000,
    a: Math.round(a * 1000) / 1000,
  };
}

/**
 * CSS 문자열에서 :root 블록 내 CSS 커스텀 프로퍼티(변수)를 파싱하여 CSSToken 배열로 반환한다.
 * 여러 개의 :root 블록이 있을 경우 모두 파싱한다.
 * @param cssContent - CSS 파일 전체 문자열
 * @returns 파싱된 CSSToken 배열
 */
export function parseCSSVariables(cssContent: string): CSSToken[] {
  const tokens: CSSToken[] = [];

  // :root { ... } 블록 추출 (중첩 중괄호 미지원, 일반적인 경우만 처리)
  const rootBlockRegex = /:root\s*\{([^}]*)\}/g;
  let rootMatch: RegExpExecArray | null;

  while ((rootMatch = rootBlockRegex.exec(cssContent)) !== null) {
    const blockContent = rootMatch[1];

    // 각 줄에서 CSS 변수 선언 추출
    const variableRegex = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/gm;
    let varMatch: RegExpExecArray | null;

    while ((varMatch = variableRegex.exec(blockContent)) !== null) {
      const name = varMatch[1];
      const value = varMatch[2].trim();
      const rawLine = varMatch[0].trim();

      tokens.push({
        name,
        value,
        category: categorize(name),
        rawLine,
      });
    }
  }

  return tokens;
}

/**
 * 값이 16진수 색상 코드인지 판별한다.
 * @param value - 검사할 문자열
 */
function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

/**
 * px 단위 값에서 숫자만 추출한다.
 * @param value - 예: "16px", "1.5rem"
 * @returns 숫자 값 또는 null (px 단위가 아닌 경우)
 */
function parsePxValue(value: string): number | null {
  const match = value.match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * CSSToken 배열을 Figma 변수 생성에 적합한 FigmaVariable 배열로 변환한다.
 * - 16진수 색상은 0-1 범위 RGBA 객체로 변환
 * - px 값은 숫자로 변환
 * - 그 외는 문자열로 유지
 * @param tokens - parseCSSVariables로 파싱한 CSSToken 배열
 * @returns Figma 변수 생성용 FigmaVariable 배열
 */
export function cssTokensToFigmaVariables(tokens: CSSToken[]): FigmaVariable[] {
  return tokens.map((token) => {
    const collectionPrefix = CATEGORY_COLLECTION_MAP[token.category];
    // "--color-primary" -> "color-primary"
    const cleanName = token.name.replace(/^--/, "");
    const figmaName = `${collectionPrefix}/${cleanName}`;

    // 색상 카테고리이고 hex 값인 경우 COLOR 타입으로 변환
    if (
      (token.category === "color" || token.category === "shadow") &&
      isHexColor(token.value)
    ) {
      return {
        name: figmaName,
        resolvedType: "COLOR" as const,
        value: hexToRgba(token.value),
        cssName: token.name,
        category: token.category,
      };
    }

    // px 값인 경우 FLOAT 타입으로 변환
    const pxValue = parsePxValue(token.value);
    if (pxValue !== null) {
      return {
        name: figmaName,
        resolvedType: "FLOAT" as const,
        value: pxValue,
        cssName: token.name,
        category: token.category,
      };
    }

    // 그 외는 STRING 타입으로 유지
    return {
      name: figmaName,
      resolvedType: "STRING" as const,
      value: token.value,
      cssName: token.name,
      category: token.category,
    };
  });
}

/**
 * RGBA 객체(0-1 범위)를 16진수 색상 코드로 변환한다.
 * @param rgba - 0-1 범위 RGBA 객체
 * @returns 16진수 색상 문자열 (예: "#2563EB")
 */
function rgbaToHex(rgba: {
  r: number;
  g: number;
  b: number;
  a?: number;
}): string {
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");

  const hex = `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`;

  // 알파가 1이 아닌 경우에만 알파 채널 추가
  if (rgba.a !== undefined && rgba.a < 1) {
    return `${hex}${toHex(rgba.a)}`;
  }

  return hex.toUpperCase();
}

/**
 * Figma 변수 배열을 CSS :root { ... } 형식 문자열로 변환한다.
 * @param variables - Figma 변수 배열 (name, resolvedType, value 필수)
 * @returns CSS 문자열
 */
export function figmaVariablesToCSS(
  variables: Array<{ name: string; resolvedType: string; value: any }>
): string {
  if (variables.length === 0) {
    return ":root {\n}\n";
  }

  const lines = variables.map((v) => {
    // Figma 변수 이름에서 CSS 변수 이름 생성
    // "Colors/color-primary" -> "--color-primary"
    const parts = v.name.split("/");
    const varName = parts.length > 1 ? parts.slice(1).join("-") : parts[0];
    const cssVarName = varName.startsWith("--") ? varName : `--${varName}`;

    let cssValue: string;

    if (
      v.resolvedType === "COLOR" &&
      typeof v.value === "object" &&
      v.value !== null &&
      "r" in v.value
    ) {
      // COLOR 타입: RGBA 객체를 hex로 변환
      cssValue = rgbaToHex(v.value);
    } else if (v.resolvedType === "FLOAT" && typeof v.value === "number") {
      // FLOAT 타입: 정수이면 px 단위 추가, 소수이면 그대로
      cssValue = Number.isInteger(v.value) ? `${v.value}px` : `${v.value}`;
    } else {
      // STRING 또는 기타: 문자열 그대로 사용
      cssValue = String(v.value);
    }

    return `  ${cssVarName}: ${cssValue};`;
  });

  return `:root {\n${lines.join("\n")}\n}\n`;
}
