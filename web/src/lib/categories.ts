import type { Category, SystemCategoryKey } from '@/types';

export function getVisibleCategories(categories: Category[]): Category[] {
  return categories.filter((item) => !item.is_hidden);
}

export function findCategory(categories: Category[], id: string | null | undefined): Category | undefined {
  if (!id) return undefined;
  return categories.find((item) => item.id === id);
}

export function findByKey(categories: Category[], key: SystemCategoryKey): Category | undefined {
  return categories.find((item) => item.key === key);
}

export function isEtcCategory(category: { key: string | null }): boolean {
  return category.key === 'etc';
}
