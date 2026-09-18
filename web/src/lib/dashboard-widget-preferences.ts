import { supabase } from '@/lib/supabase';
import {
  DEFAULT_DASHBOARD_HIDDEN_IDS,
  normalizeDashboardWidgetPreferences,
  type DashboardWidgetId,
  type DashboardWidgetPreferences,
} from '@/lib/dashboard-widgets';

export type DashboardWidgetPreferenceResult = DashboardWidgetPreferences & {
  ok: boolean;
  code: string;
  message: string;
};

function failed(message: string): DashboardWidgetPreferenceResult {
  const preferences = normalizeDashboardWidgetPreferences([], DEFAULT_DASHBOARD_HIDDEN_IDS);
  return { ok: false, code: 'rpc_failed', message, ...preferences };
}

function parsePayload(data: unknown): DashboardWidgetPreferenceResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return failed('알 수 없는 응답입니다.');
  }
  const row = data as Record<string, unknown>;
  const preferences = normalizeDashboardWidgetPreferences(row.order_ids, row.hidden_ids);
  return {
    ok: row.ok === true,
    code: typeof row.code === 'string' ? row.code : 'rpc_failed',
    message: typeof row.message === 'string' ? row.message : '',
    ...preferences,
  };
}

export async function getMyDashboardWidgetPreferences(): Promise<DashboardWidgetPreferenceResult> {
  const { data, error } = await supabase.rpc('get_my_dashboard_widget_preferences');
  if (error) return failed(error.message);
  return parsePayload(data);
}

export async function saveMyDashboardWidgetPreferences(
  orderIds: DashboardWidgetId[],
  hiddenIds: DashboardWidgetId[]
): Promise<DashboardWidgetPreferenceResult> {
  const { data, error } = await supabase.rpc('save_my_dashboard_widget_preferences', {
    p_order_ids: orderIds,
    p_hidden_ids: hiddenIds,
  });
  if (error) return failed(error.message);
  return parsePayload(data);
}
