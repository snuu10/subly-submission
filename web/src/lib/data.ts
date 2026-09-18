import { getMyCategoryChipOrder } from '@/lib/category-chip-order';
import { getMyDashboardWidgetPreferences } from '@/lib/dashboard-widget-preferences';
import { supabase } from '@/lib/supabase';
import { computeNextPaymentDate, withRolledPaymentDates } from '@/lib/calc';
import {
  duplicateAccountIssue,
  duplicateAccountMessage,
  mapSubscriptionWriteError,
  trialRequirementIssue,
  trialRequirementMessage,
} from '@/lib/duplicate-account';
import type { BillingChannel } from '@/types/cancel-guide';
import type { PaymentInstrument, PaymentInstrumentWrite } from '@/types/payment-instrument';
import type { BillingCycle, Category, Subscription } from '@/types';
import type { DashboardWidgetPreferences } from '@/lib/dashboard-widgets';

export type SubscriptionWriteInput = {
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  category_id: string;
  anchor_date: string;
  is_active: boolean;
  memo?: string | null;
  preset_id?: string | null;
  emoji?: string | null;
  account_id?: string | null;
  billing_channel?: BillingChannel | null;
  payment_instrument_id?: string | null;
  is_trial?: boolean;
  trial_ends_at?: string | null;
};

export async function fetchDashboardData(): Promise<{
  subscriptions: Subscription[];
  categories: Category[];
  paymentInstruments: PaymentInstrument[];
  webChipOrderIds: string[] | null;
  dashboardWidgetPreferences: DashboardWidgetPreferences;
}> {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) {
    const preferences = await getMyDashboardWidgetPreferences();
    return {
      subscriptions: [],
      categories: [],
      paymentInstruments: [],
      webChipOrderIds: null,
      dashboardWidgetPreferences: preferences,
    };
  }

  const { error: seedError } = await supabase.rpc('ensure_default_categories');
  if (seedError) throw new Error(seedError.message);

  // 일정 기준 갱신 이력 동기화 실패가 대시보드 전체를 막지는 않게 한다.
  await supabase.rpc('sync_my_automatic_renewals');

  const [subsResult, catsResult, instrumentsResult, order, widgetPreferences] = await Promise.all([
    supabase.from('subscriptions').select('*').order('next_payment_date', { ascending: true }),
    supabase.from('categories').select('*').eq('is_hidden', false).order('created_at', { ascending: true }),
    supabase.from('payment_instruments').select('*').order('created_at', { ascending: false }),
    getMyCategoryChipOrder(),
    getMyDashboardWidgetPreferences(),
  ]);

  if (subsResult.error) throw new Error(subsResult.error.message);
  if (catsResult.error) throw new Error(catsResult.error.message);
  if (instrumentsResult.error) throw new Error(instrumentsResult.error.message);

  const subscriptions = withRolledPaymentDates((subsResult.data ?? []) as Subscription[]);
  const categories = (catsResult.data ?? []) as Category[];

  return {
    subscriptions,
    categories,
    paymentInstruments: (instrumentsResult.data ?? []) as PaymentInstrument[],
    webChipOrderIds: order.ok ? order.webIds : null,
    dashboardWidgetPreferences: widgetPreferences,
  };
}

export function subscribeDashboard(onChange: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function debounce() {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(onChange, 200);
  }

  const channel = supabase
    .channel('dashboard-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, debounce)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, debounce)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_instruments' }, debounce)
    .subscribe();

  return () => {
    if (timeout) clearTimeout(timeout);
    void supabase.removeChannel(channel);
  };
}

export async function createSubscription(
  input: SubscriptionWriteInput,
  existing: Subscription[] = []
): Promise<Subscription> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error('로그인이 필요합니다.');

  const issue = duplicateAccountIssue(existing, {
    name: input.name,
    account_id: input.account_id,
    preset_id: input.preset_id,
  });
  if (issue) throw new Error(duplicateAccountMessage(issue));
  const trialIssue = trialRequirementIssue(input);
  if (trialIssue) throw new Error(trialRequirementMessage(trialIssue));

  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      name: input.name.trim(),
      amount: input.amount,
      billing_cycle: input.billing_cycle,
      category_id: input.category_id,
      anchor_date: input.anchor_date,
      next_payment_date: computeNextPaymentDate(input.anchor_date, input.billing_cycle),
      is_active: input.is_active,
      memo: input.memo ?? null,
      preset_id: input.preset_id ?? null,
      emoji: input.emoji ?? null,
      account_id: input.account_id ?? null,
      billing_channel: input.billing_channel ?? null,
      payment_instrument_id: input.payment_instrument_id ?? null,
      is_trial: input.is_trial ?? false,
      trial_ends_at: input.is_trial ? (input.trial_ends_at ?? null) : null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(mapSubscriptionWriteError(error?.message ?? '구독을 추가하지 못했습니다.'));
  return data as Subscription;
}

export async function updateSubscription(
  id: string,
  input: SubscriptionWriteInput,
  existing: Subscription[] = []
): Promise<void> {
  const issue = duplicateAccountIssue(existing, {
    id,
    name: input.name,
    account_id: input.account_id,
    preset_id: input.preset_id,
  });
  if (issue) throw new Error(duplicateAccountMessage(issue));
  const trialIssue = trialRequirementIssue(input);
  if (trialIssue) throw new Error(trialRequirementMessage(trialIssue));

  const { error } = await supabase
    .from('subscriptions')
    .update({
      name: input.name.trim(),
      amount: input.amount,
      billing_cycle: input.billing_cycle,
      category_id: input.category_id,
      anchor_date: input.anchor_date,
      next_payment_date: computeNextPaymentDate(input.anchor_date, input.billing_cycle),
      is_active: input.is_active,
      memo: input.memo ?? null,
      preset_id: input.preset_id ?? null,
      emoji: input.emoji ?? null,
      account_id: input.account_id ?? null,
      billing_channel: input.billing_channel ?? null,
      payment_instrument_id: input.payment_instrument_id ?? null,
      is_trial: input.is_trial ?? false,
      trial_ends_at: input.is_trial ? (input.trial_ends_at ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw new Error(mapSubscriptionWriteError(error.message));
}

export async function updateSubscriptionBillingChannel(
  id: string,
  billingChannel: BillingChannel
): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({ billing_channel: billingChannel, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function markSubscriptionChecked(id: string): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({ last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function toggleSubscriptionActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabase.from('subscriptions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

function instrumentRow(input: PaymentInstrumentWrite) {
  const isCard = input.kind === 'card';
  return {
    kind: input.kind,
    institution_key: input.institution_key,
    name: input.name.trim(),
    number_last4: input.number_last4,
    status: input.status,
    classification: input.classification,
    card_type: isCard ? (input.card_type ?? 'credit') : null,
    expiry_month: isCard ? (input.expiry_month ?? null) : null,
    expiry_year: isCard ? (input.expiry_year ?? null) : null,
    memo: input.memo?.trim() || null,
  };
}

export async function createPaymentInstrument(input: PaymentInstrumentWrite): Promise<PaymentInstrument> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase
    .from('payment_instruments')
    .insert({ user_id: userId, ...instrumentRow(input) })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? '결제수단을 추가하지 못했습니다.');
  return data as PaymentInstrument;
}

export async function updatePaymentInstrument(id: string, input: PaymentInstrumentWrite): Promise<void> {
  const { error } = await supabase
    .from('payment_instruments')
    .update({ ...instrumentRow(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deletePaymentInstrument(id: string): Promise<void> {
  const { error } = await supabase.from('payment_instruments').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
