/**
 * Utilidades para el procesamiento de nodos y respuestas de Figma
 */

/**
 * Convierte un color RGBA a formato hexadecimal.
 * @param color - El color en formato RGBA con valores entre 0 y 1
 * @returns El color en formato hexadecimal (#RRGGBBAA)
 */
export function rgbaToHex(color: any): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a === 255 ? '' : a.toString(16).padStart(2, '0')}`;
}

/** filterFigmaNode 옵션. */
export interface FilterNodeOptions {
  /** 자식 순회 깊이. 0 = 노드 자신만(children 생략), 1 = 직속 자식까지 전개(기본값). */
  depth?: number;
  /** 한 레벨당 최대 자식 수. 초과분은 { truncated, omitted } 마커로 대체한다. */
  childLimit?: number;
  /** 유지할 키 화이트리스트. id/name/type/children은 항상 유지된다. */
  fields?: string[];
  /** 내부용 현재 레벨(루트 = 0). 호출자가 지정하지 않는다. */
  _level?: number;
}

const DEFAULT_DEPTH = 1;
const DEFAULT_CHILD_LIMIT = 50;

/** fields 화이트리스트와 무관하게 항상 유지하는 키. */
const ALWAYS_KEEP_FIELDS = new Set(["id", "name", "type", "children", "truncated"]);

/**
 * 플러그인이 붙인 절단 마커인지 판별한다.
 * 루트 문서에 붙는 truncated 플래그와 구분하는 것이 목적이다 —
 * 루트는 실제 노드 속성을 다 들고 있으므로 반드시 필터를 타야 한다.
 */
function isTruncationMarker(node: any): boolean {
  if (node.truncated !== true) return false;
  // childLimit 마커: { truncated, omitted } — 노드 식별자가 없다
  if (typeof node.omitted === "number" && node.id === undefined) return true;
  // depth 경계 스텁: childCount 는 Figma 노드에 없는 합성 키다
  if (typeof node.childCount === "number") return true;
  return false;
}

/** depth 한계에 도달한 자식의 축약 표현. */
function summarizeNode(node: any) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    // 플러그인 스텁은 children 배열이 없고 childCount 만 들고 온다.
    childCount: Array.isArray(node.children)
      ? node.children.length
      : typeof node.childCount === "number"
        ? node.childCount
        : 0,
    truncated: true as const,
  };
}

/**
 * 필터 결과 안에 절단 마커가 있는지 확인한다.
 * 조회 도구가 "더 받으려면 depth를 올려라"는 힌트를 붙일지 판단하는 데 쓴다.
 */
export function hasTruncation(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasTruncation(item));
  if (value.truncated === true) return true;
  return Object.keys(value).some((key) => hasTruncation(value[key]));
}

/**
 * Filtra un nodo de Figma para reducir su complejidad y tamaño.
 * Convierte colores a formato hexadecimal y elimina datos innecesarios.
 *
 * 무한 재귀는 토큰 폭발의 주 원인이므로 기본적으로 depth 1까지만 전개하고,
 * 그 아래는 { id, name, type, childCount, truncated } 로 축약한다.
 *
 * @param node - El nodo de Figma a filtrar
 * @param opts - depth / childLimit / fields 제한
 * @returns El nodo filtrado o null si debe ser ignorado
 */
export function filterFigmaNode(node: any, opts: FilterNodeOptions = {}): any {
  if (!node || typeof node !== "object") {
    return null;
  }

  // 플러그인이 이미 잘라 보낸 절단 마커만 가공 없이 통과시킨다.
  //
  // plugin/code.js 의 getNodeInfo 는 세 곳에 truncated 를 붙인다.
  //   ① depth 경계 스텁   { id, name, type, childCount, truncated }
  //   ② childLimit 마커   { truncated, omitted }
  //   ③ 루트 문서         전체 속성 + truncated  ← 이건 마커가 아니다
  //
  // ①②는 아래 키 화이트리스트를 타면 truncated/omitted/childCount 가 전부
  // 탈락해 "잘렸다"는 사실이 소실되므로 조기 반환한다. 반면 ③까지 조기
  // 반환하면 절단이 일어난 모든 응답에서 필터가 통째로 우회되어, hex 변환도
  // 키 축소도 안 된 raw Figma JSON 이 그대로 나간다(얕은 depth 가 깊은
  // depth 보다 응답이 커지는 역전이 발생). 그래서 마커 모양으로만 판별한다.
  if (isTruncationMarker(node)) {
    return node;
  }

  // Skip VECTOR type nodes
  if (node.type === "VECTOR") {
    return null;
  }

  const depth = opts.depth ?? DEFAULT_DEPTH;
  const childLimit = opts.childLimit ?? DEFAULT_CHILD_LIMIT;
  const level = opts._level ?? 0;

  const filtered: any = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill: any) => {
      const processedFill = { ...fill };

      // Remove boundVariables and imageRef
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      // Process gradientStops if present
      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map((stop: any) => {
          const processedStop = { ...stop };
          // Convert color to hex if present
          if (processedStop.color) {
            processedStop.color = rgbaToHex(processedStop.color);
          }
          // Remove boundVariables
          delete processedStop.boundVariables;
          return processedStop;
        });
      }

      // Convert solid fill colors to hex
      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke: any) => {
      const processedStroke = { ...stroke };
      // Remove boundVariables
      delete processedStroke.boundVariables;
      // Convert color to hex if present
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (node.localPosition) {
    filtered.localPosition = node.localPosition;
  }

  // 플러그인이 루트에 붙인 절단 플래그를 유지한다. 화이트리스트 방식이라
  // 명시하지 않으면 탈락하고, 그러면 hasTruncation 이 절단을 놓친다.
  if (node.truncated === true) {
    filtered.truncated = true;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx
    };
  }

  // depth 0 이면 children 자체를 생략한다.
  if (Array.isArray(node.children) && node.children.length > 0 && depth > 0) {
    // Remove VECTOR nodes before counting/limiting
    const visible = node.children.filter((child: any) => child && child.type !== "VECTOR");
    const kept = visible.slice(0, childLimit);
    const omitted = visible.length - kept.length;

    const children: any[] =
      level >= depth
        ? kept.map((child: any) => summarizeNode(child))
        : kept
            .map((child: any) =>
              filterFigmaNode(child, {
                depth,
                childLimit,
                fields: opts.fields,
                _level: level + 1,
              })
            )
            .filter((child: any) => child !== null);

    if (omitted > 0) {
      children.push({ truncated: true, omitted });
    }

    filtered.children = children;
  }

  if (opts.fields && opts.fields.length > 0) {
    for (const key of Object.keys(filtered)) {
      if (!ALWAYS_KEEP_FIELDS.has(key) && !opts.fields.includes(key)) {
        delete filtered[key];
      }
    }
  }

  return filtered;
}

/**
 * Convert global coordinates to local coordinates relative to a parent
 */
export function globalToLocal(
  globalX: number,
  globalY: number,
  parentGlobalX: number = 0,
  parentGlobalY: number = 0
): { x: number; y: number } {
  return {
    x: globalX - parentGlobalX,
    y: globalY - parentGlobalY
  };
}

/**
 * Convert local coordinates to global coordinates
 */
export function localToGlobal(
  localX: number,
  localY: number,
  parentGlobalX: number = 0,
  parentGlobalY: number = 0
): { x: number; y: number } {
  return {
    x: localX + parentGlobalX,
    y: localY + parentGlobalY
  };
}

/**
 * Procesa un nodo de respuesta de Figma para propósitos de logging.
 * @param result - El resultado a procesar
 * @returns El resultado original sin modificaciones
 */
export function processFigmaNodeResponse(result: unknown): any {
  if (!result || typeof result !== "object") {
    return result;
  }

  // Check if this looks like a node response
  const resultObj = result as Record<string, unknown>;
  if ("id" in resultObj && typeof resultObj.id === "string") {
    // It appears to be a node response, log the details
    console.info(
      `Processed Figma node: ${resultObj.name || "Unknown"} (ID: ${resultObj.id})`
    );

    if ("x" in resultObj && "y" in resultObj) {
      console.debug(`Node position: (${resultObj.x}, ${resultObj.y})`);
    }

    if ("width" in resultObj && "height" in resultObj) {
      console.debug(`Node dimensions: ${resultObj.width}×${resultObj.height}`);
    }
  }

  return result;
}