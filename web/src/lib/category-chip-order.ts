import { parseCategoryIdList, type CategoryChipSurface } from '@/lib/category-order';
import { supabase } from '@/lib/supabase';

export type CategoryChipOrderResult = {
  ok: boolean;
  code: string;
  appIds: string[] | null;
  webIds: string[] | null;
  message: string;
};

function failedOrder(message: string): CategoryChipOrderResult {
  return { ok: false, code: 'rpc_failed', appIds: null, webIds: null, message };
}

function parseOrderPayload(data: unknown): CategoryChipOrderResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return failedOrder('알 수 없는 응답입니다.');
  }
  const row = data as Record<string, unknown>;
  return {
    ok: row.ok === true,
    code: typeof row.code === 'string' ? row.code : 'rpc_failed',
    appIds: parseCategoryIdList(row.app_ids),
    webIds: parseCategoryIdList(row.web_ids),
    message: typeof row.message === 'string' ? row.message : '',
  };
}

export async function getMyCategoryChipOrder(): Promise<CategoryChipOrderResult> {
  const { data, error } = await supabase.rpc('get_my_category_chip_order');
  if (error) return failedOrder(error.message);
  return parseOrderPayload(data);
}

export async function reorderCategoryChips(
  surface: CategoryChipSurface,
  orderedIds: string[]
): Promise<CategoryChipOrderResult> {
  const { data, error } = await supabase.rpc('reorder_category_chips', {
    p_surface: surface,
    p_ordered_ids: orderedIds,
  });
  if (error) return failedOrder(error.message);
  return parseOrderPayload(data);
}
