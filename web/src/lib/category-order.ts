/** 구독 목록 칩 순서. 전체·기타는 배열에 넣지 않고 UI에서 앞·뒤를 고정한다. */

export type CategoryChipSurface = 'app' | 'web';

export type OrderableCategory = {
  id: string;
  key: string | null;
  is_system: boolean;
  created_at: string;
};

export const APP_SYSTEM_CHIP_ORDER = [
  'entertainment',
  'music',
  'work',
  'health',
  'education',
  'cloud',
] as const;

function systemChipIndex(key: string | null): number {
  const index = APP_SYSTEM_CHIP_ORDER.indexOf(key as (typeof APP_SYSTEM_CHIP_ORDER)[number]);
  return index < 0 ? APP_SYSTEM_CHIP_ORDER.length : index;
}

export function parseCategoryIdList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return ids.length > 0 ? ids : null;
}

export function defaultMovableCategoryIds(
  visible: OrderableCategory[],
  surface: CategoryChipSurface
): string[] {
  const movable = visible.filter((item) => item.key !== 'etc');
  if (surface === 'web') {
    return [...movable]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((item) => item.id);
  }

  return [...movable]
    .sort((a, b) => {
      if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
      if (a.is_system && b.is_system) {
        return systemChipIndex(a.key) - systemChipIndex(b.key);
      }
      return a.created_at.localeCompare(b.created_at);
    })
    .map((item) => item.id);
}

export function applyCategoryChipOrder<T extends OrderableCategory>(
  visible: T[],
  storedIds: string[] | null,
  surface: CategoryChipSurface
): T[] {
  const byId = new Map(visible.map((item) => [item.id, item]));
  const etc = visible.filter((item) => item.key === 'etc');
  const defaultIds = defaultMovableCategoryIds(visible, surface);
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  if (storedIds) {
    for (const id of storedIds) {
      const row = byId.get(id);
      if (!row || row.key === 'etc' || seen.has(id)) continue;
      seen.add(id);
      orderedIds.push(id);
    }
  }

  for (const id of defaultIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  return [...orderedIds.map((id) => byId.get(id)!), ...etc];
}

export function movableCategoryIds<T extends OrderableCategory>(orderedVisible: T[]): string[] {
  return orderedVisible.filter((item) => item.key !== 'etc').map((item) => item.id);
}

export function moveCategoryId(ids: string[], id: string, delta: -1 | 1): string[] | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return moveCategoryIdTo(ids, index, index + delta);
}

export function moveCategoryIdTo(ids: string[], fromIndex: number, toIndex: number): string[] | null {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) return null;
  if (fromIndex === toIndex) return ids;
  const current = ids[fromIndex];
  if (current === undefined) return null;
  const next = [...ids];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, current);
  return next;
}
