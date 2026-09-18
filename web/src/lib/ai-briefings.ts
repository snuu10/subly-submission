import { supabase } from '@/lib/supabase';
import { isKstMonday, weekStartKst } from '@/lib/briefing';

export type WeeklyDigestCharge = {
  name: string;
  amount: number;
  billingCycle: string;
  chargeDate: string;
};

export type WeeklyDigest = {
  summary: string;
  weekStart: string;
  weekEnd: string;
  lastWeek: number;
  thisWeek: number;
  delta: number;
  trend: 'up' | 'down' | 'same';
  reason: string;
  charges: WeeklyDigestCharge[];
};

function parseWeeklyDigest(value: unknown): WeeklyDigest | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
  const weekStart = typeof row.week_start === 'string' ? row.week_start : '';
  const weekEnd = typeof row.week_end === 'string' ? row.week_end : '';
  const lastWeek = typeof row.last_week === 'number' ? row.last_week : Number(row.last_week);
  const thisWeek = typeof row.this_week === 'number' ? row.this_week : Number(row.this_week);
  if (!summary || !weekStart || !weekEnd || !Number.isFinite(lastWeek) || !Number.isFinite(thisWeek)) {
    return null;
  }
  const deltaValue = typeof row.delta === 'number' ? row.delta : thisWeek - lastWeek;
  const trend = row.trend === 'up' || row.trend === 'down' || row.trend === 'same'
    ? row.trend
    : deltaValue === 0 ? 'same' : deltaValue > 0 ? 'up' : 'down';
  const charges = Array.isArray(row.charges)
    ? row.charges.flatMap((item): WeeklyDigestCharge[] => {
        if (!item || typeof item !== 'object') return [];
        const charge = item as Record<string, unknown>;
        if (typeof charge.name !== 'string' || typeof charge.charge_date !== 'string') return [];
        const amount = typeof charge.amount === 'number' ? charge.amount : Number(charge.amount);
        if (!Number.isFinite(amount)) return [];
        return [{
          name: charge.name,
          amount,
          billingCycle: typeof charge.billing_cycle === 'string' ? charge.billing_cycle : 'monthly',
          chargeDate: charge.charge_date,
        }];
      })
    : [];
  return {
    summary,
    weekStart,
    weekEnd,
    lastWeek,
    thisWeek,
    delta: deltaValue,
    trend,
    reason: typeof row.reason === 'string' ? row.reason : summary,
    charges,
  };
}

async function readWeeklyDigest(weekStart: string): Promise<WeeklyDigest | null> {
  const { data, error } = await supabase
    .from('ai_briefings')
    .select('payload')
    .eq('kind', 'weekly_digest')
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) return null;
  return parseWeeklyDigest(data?.payload);
}

export async function hasUnusedNudge(weekStart = weekStartKst()): Promise<boolean> {
  const { data, error } = await supabase
    .from('ai_briefings')
    .select('week_start')
    .eq('kind', 'unused_nudge')
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function recordUnusedNudge(
  payload: Record<string, unknown>,
  weekStart = weekStartKst()
): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) return;

  await supabase.from('ai_briefings').upsert(
    {
      user_id: userId,
      kind: 'unused_nudge',
      week_start: weekStart,
      payload,
    },
    { onConflict: 'user_id,kind,week_start' }
  );
}

export async function fetchWeeklyDigest(): Promise<WeeklyDigest | null> {
  const weekStart = weekStartKst();
  if (!isKstMonday()) return readWeeklyDigest(weekStart);
  const { data, error } = await supabase.functions.invoke('weekly-digest', { body: {} });
  if (!error) {
    const digest = parseWeeklyDigest(data);
    if (digest) return digest;
  }
  return readWeeklyDigest(weekStart);
}

export async function suggestCategory(name: string): Promise<{
  category_key: string;
  icon_key: string;
} | null> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;
  const { data, error } = await supabase.functions.invoke('suggest-category', {
    body: { name: trimmed.slice(0, 80) },
  });
  if (error) return null;
  const payload = data as { category_key?: unknown; icon_key?: unknown } | null;
  const key = typeof payload?.category_key === 'string' ? payload.category_key : null;
  const iconKey = typeof payload?.icon_key === 'string' ? payload.icon_key : '';
  if (!key) return null;
  return { category_key: key, icon_key: iconKey };
}
