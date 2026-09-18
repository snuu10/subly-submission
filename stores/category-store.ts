import { create } from 'zustand';

import { nextCategoryColor } from '@/constants/categories';
import { getMyCategoryChipOrder, reorderCategoryChips } from '@/lib/category-chip-order';
import { normalizeCategorySearchKey, validateCategoryName } from '@/lib/category-name';
import { supabase } from '@/lib/supabase';
import { useSubscriptionStore } from '@/stores/subscription-store';
import type { Category, SystemCategoryKey } from '@/types/category';

const TABLE = 'categories';

export const DUPLICATE_CATEGORY_NAME =
  '이미 있는 카테고리입니다. 혹시 숨긴 카테고리 중에 같은 이름이 있는지 확인해 보세요.';
export const MIN_NON_ETC_CATEGORY = '기타를 제외한 카테고리는 최소 1개가 있어야 합니다.';

/** 시딩은 7행을 한 문장으로 넣어 created_at이 같으므로 표시 순서는 여기서 정한다. */
const SYSTEM_ORDER: SystemCategoryKey[] = [
  'entertainment',
  'music',
  'work',
  'health',
  'education',
  'cloud',
  'etc',
];

function sortCategories(rows: Category[]): Category[] {
  return [...rows].sort((a, b) => {
    if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
    if (a.is_system && b.is_system) {
      return SYSTEM_ORDER.indexOf(a.key!) - SYSTEM_ORDER.indexOf(b.key!);
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

export function getVisibleCategories(categories: Category[]): Category[] {
  return categories.filter((item) => !item.is_hidden);
}

export function findCategory(
  categories: Category[],
  id: string | null | undefined
): Category | undefined {
  if (!id) return undefined;
  return categories.find((item) => item.id === id);
}

export function findByKey(
  categories: Category[],
  key: SystemCategoryKey
): Category | undefined {
  return categories.find((item) => item.key === key);
}

export function isEtcCategory(category: Category): boolean {
  return category.key === 'etc';
}

export function countNonEtc(categories: Category[]): number {
  return categories.filter((item) => item.key !== 'etc').length;
}

function hasNameConflict(categories: Category[], name: string, exceptId?: string): boolean {
  // ChatGPT 수정: 공백·대소문자·호환 문자 차이로 중복 카테고리가 생기지 않게 한다.
  const key = normalizeCategorySearchKey(name);
  return categories.some(
    (item) => normalizeCategorySearchKey(item.name) === key && item.id !== exceptId
  );
}

function mapCategoryError(message: string, code?: string): string {
  if (code === '23505' || message.includes('categories_user_name_idx')) {
    return DUPLICATE_CATEGORY_NAME;
  }
  if (message.includes('최소 1개')) {
    return MIN_NON_ETC_CATEGORY;
  }
  if (message.includes('기타 카테고리는 변경') || message.includes('기타 카테고리는 삭제')) {
    return message;
  }
  return message;
}

type CategoryState = {
  categories: Category[];
  chipOrderIds: string[] | null;
  loading: boolean;
  error: string | null;
  fetchCategories: () => Promise<void>;
  reorderChipOrder: (ids: string[]) => Promise<boolean>;
  addCategory: (name: string) => Promise<Category | null>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  hideCategory: (id: string) => Promise<boolean>;
  unhideCategory: (id: string) => Promise<boolean>;
  deleteCustomCategory: (id: string) => Promise<boolean>;
};

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  chipOrderIds: null,
  loading: false,
  error: null,

  fetchCategories: async () => {
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) {
      set({ categories: [], chipOrderIds: null, loading: false, error: null });
      return;
    }

    set({ loading: true, error: null });

    // 카테고리가 없을 때만 7개를 넣는다. 이후 호출은 기타만 없으면 기타만 보정한다.
    const { error: seedError } = await supabase.rpc('ensure_default_categories');
    if (seedError) {
      set({ loading: false, error: seedError.message });
      return;
    }

    const [{ data, error }, order] = await Promise.all([
      supabase.from(TABLE).select('*'),
      getMyCategoryChipOrder(),
    ]);
    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    set({
      categories: sortCategories((data ?? []) as Category[]),
      chipOrderIds: order.ok ? order.appIds : get().chipOrderIds,
      loading: false,
      error: null,
    });
  },

  reorderChipOrder: async (ids) => {
    const previous = get().chipOrderIds;
    set({ chipOrderIds: ids, error: null });
    const result = await reorderCategoryChips('app', ids);
    if (!result.ok) {
      set({
        chipOrderIds: previous,
        error: result.message || '순서를 저장하지 못했습니다.',
      });
      return false;
    }
    set({ chipOrderIds: result.appIds, error: null });
    return true;
  },

  addCategory: async (name) => {
    const validated = validateCategoryName(name);
    if (!validated.name) {
      set({ error: validated.error });
      return null;
    }
    const normalized = validated.name;

    if (hasNameConflict(get().categories, normalized)) {
      set({ error: DUPLICATE_CATEGORY_NAME });
      return null;
    }

    const { data: auth } = await supabase.auth.getSession();
    const userId = auth.session?.user?.id;
    if (!userId) {
      set({ error: '로그인이 필요합니다.' });
      return null;
    }

    const customCount = get().categories.filter((item) => !item.is_system).length;

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_id: userId,
        key: null,
        name: normalized,
        color: nextCategoryColor(customCount),
        emoji: null,
        is_system: false,
        is_hidden: false,
      })
      .select()
      .single();

    if (error || !data) {
      set({
        error: error
          ? mapCategoryError(error.message, error.code)
          : '카테고리를 추가하지 못했습니다.',
      });
      return null;
    }

    const created = data as Category;
    set((state) => ({
      categories: sortCategories([...state.categories, created]),
      error: null,
    }));
    return created;
  },

  renameCategory: async (id, name) => {
    const validated = validateCategoryName(name);
    if (!validated.name) {
      set({ error: validated.error });
      return false;
    }
    const normalized = validated.name;

    const current = get().categories.find((item) => item.id === id);
    if (!current) return false;
    if (isEtcCategory(current)) {
      set({ error: '기타 카테고리는 변경할 수 없습니다.' });
      return false;
    }
    if (hasNameConflict(get().categories, normalized, id)) {
      set({ error: DUPLICATE_CATEGORY_NAME });
      return false;
    }

    const previous = get().categories;
    set({
      categories: previous.map((item) =>
        item.id === id ? { ...item, name: normalized } : item
      ),
      error: null,
    });

    const { error } = await supabase.from(TABLE).update({ name: normalized }).eq('id', id);
    if (error) {
      set({ categories: previous, error: mapCategoryError(error.message, error.code) });
      return false;
    }
    return true;
  },

  hideCategory: async (id) => {
    const { error } = await supabase.rpc('hide_category', { p_category_id: id });
    if (error) {
      set({ error: mapCategoryError(error.message, error.code) });
      return false;
    }

    set((state) => ({
      categories: state.categories.map((item) =>
        item.id === id ? { ...item, is_hidden: true } : item
      ),
      error: null,
    }));

    // 구독이 '기타'로 재배정됐으므로 로컬 목록을 다시 읽어야 화면이 어긋나지 않는다.
    await useSubscriptionStore.getState().fetchSubscriptions();
    return true;
  },

  unhideCategory: async (id) => {
    const previous = get().categories;
    set({
      categories: previous.map((item) =>
        item.id === id ? { ...item, is_hidden: false } : item
      ),
      error: null,
    });

    const { error } = await supabase.from(TABLE).update({ is_hidden: false }).eq('id', id);
    if (error) {
      set({ categories: previous, error: mapCategoryError(error.message, error.code) });
      return false;
    }
    return true;
  },

  deleteCustomCategory: async (id) => {
    if (countNonEtc(get().categories) <= 1) {
      set({ error: MIN_NON_ETC_CATEGORY });
      return false;
    }

    const { error } = await supabase.rpc('delete_custom_category', { p_category_id: id });
    if (error) {
      set({ error: mapCategoryError(error.message, error.code) });
      return false;
    }

    set((state) => ({
      categories: state.categories.filter((item) => item.id !== id),
      error: null,
    }));

    await useSubscriptionStore.getState().fetchSubscriptions();
    return true;
  },
}));
