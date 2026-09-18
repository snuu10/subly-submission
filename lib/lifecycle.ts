import { supabase } from '@/lib/supabase';
import type { LifecycleAlert, LifecycleStatus } from '@/types/subscription';

export function isoDateFromText(raw?: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export async function syncMyLifecycleDue(): Promise<void> {
  await supabase.rpc('sync_my_lifecycle_due');
}

export async function advanceSubscriptionLifecycle(
  subscriptionId: string,
  to: LifecycleStatus,
  serviceEndDate?: string | null,
): Promise<{ ok: boolean; message: string; lifecycle_status?: string; service_end_date?: string | null }> {
  const { data, error } = await supabase.rpc('advance_subscription_lifecycle', {
    p_subscription_id: subscriptionId,
    p_to: to,
    p_service_end_date: serviceEndDate ?? null,
  });
  if (error) throw new Error(error.message);
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  return {
    ok: row?.ok === true,
    message: typeof row?.message === 'string' ? row.message : row?.ok === true ? '반영했습니다.' : '반영하지 못했습니다.',
    lifecycle_status: typeof row?.lifecycle_status === 'string' ? row.lifecycle_status : undefined,
    service_end_date: typeof row?.service_end_date === 'string' ? row.service_end_date : null,
  };
}

export async function listLifecycleAlerts(): Promise<LifecycleAlert[]> {
  const { data, error } = await supabase.rpc('list_my_lifecycle_alerts');
  if (error) throw new Error(error.message);
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const alerts = Array.isArray(row?.alerts) ? row.alerts : [];
  return alerts.filter((item): item is LifecycleAlert => {
    if (!item || typeof item !== 'object') return false;
    const rec = item as Record<string, unknown>;
    return typeof rec.subscription_id === 'string' && typeof rec.name === 'string';
  }).map((item) => {
    const rec = item as Record<string, unknown>;
    return {
      subscription_id: rec.subscription_id as string,
      name: rec.name as string,
      kind: rec.kind === 'end_confirm' ? 'end_confirm' : 'ending_soon',
      lifecycle_status: (typeof rec.lifecycle_status === 'string' ? rec.lifecycle_status : 'ending_scheduled') as LifecycleStatus,
      service_end_date: typeof rec.service_end_date === 'string' ? rec.service_end_date : null,
      days_until: typeof rec.days_until === 'number' ? rec.days_until : Number(rec.days_until) || 0,
      monthly_save: typeof rec.monthly_save === 'number' ? rec.monthly_save : 0,
      yearly_save: typeof rec.yearly_save === 'number' ? rec.yearly_save : 0,
    };
  });
}
