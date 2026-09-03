/**
 * 조회 도구용 초단기 TTL 캐시.
 *
 * 같은 노드를 반복 조회할 때 전체 페이로드가 매번 왕복하는 것을 막는 것이 목적이다.
 * 캐시 히트/미스는 응답 내용을 바꾸지 않는다(완성된 응답 문자열을 그대로 보관한다).
 *
 * !! 중요 !!
 * Figma 문서를 변경하는 **모든 쓰기 도구는 실행 성공 후 invalidateAll() 을 호출해야 한다.**
 * 그렇지 않으면 최대 TTL(15초) 동안 변경 이전의 노드 정보가 반환된다.
 * 현재 호출 지점:
 *   - document-tools.ts: create_page / delete_page / rename_page / duplicate_page / set_current_page
 *   - svg-tools.ts: set_svg
 * 아직 호출하지 않는 파일(각 파일 소유자가 추가해야 한다):
 *   creation-tools.ts, modification-tools.ts, text-tools.ts, image-tools.ts,
 *   figjam-tools.ts, component-tools.ts, variable-tools.ts, page-manager-tools.ts,
 *   design-sync-tools.ts, code-to-figma-tools.ts, batch-tools.ts
 */

const TTL_MS = 15_000;
const MAX_ENTRIES = 100;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/** Map은 삽입 순서를 보존하므로 첫 엔트리가 가장 오래된 것이다. */
const store = new Map<string, CacheEntry>();

/**
 * 조회 옵션을 포함한 캐시 키를 만든다.
 * 같은 노드라도 depth/childLimit/fields가 다르면 다른 응답이므로 키가 달라야 한다.
 */
export function cacheKey(command: string, params: Record<string, unknown>): string {
  const parts = Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      if (value === undefined || value === null) return `${key}=`;
      if (Array.isArray(value)) return `${key}=[${value.join(",")}]`;
      return `${key}=${String(value)}`;
    });
  return `${command}|${parts.join("|")}`;
}

/** 유효한 캐시 값을 반환한다. 없거나 만료되면 undefined. */
export function get(key: string): string | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }

  return entry.value;
}

/** 캐시에 저장한다. MAX_ENTRIES를 넘으면 가장 오래된 엔트리를 제거한다. */
export function set(key: string, value: string): void {
  // 재삽입으로 순서를 갱신한다(최근 것이 뒤로 간다).
  if (store.has(key)) {
    store.delete(key);
  }

  store.set(key, { value, expiresAt: Date.now() + TTL_MS });

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/** 문서를 변경하는 쓰기 도구가 성공한 직후 반드시 호출한다. */
export function invalidateAll(): void {
  store.clear();
}

/** 테스트/디버그용. */
export function size(): number {
  return store.size;
}
