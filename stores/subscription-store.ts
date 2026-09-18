import {
  addDays,
  addMonths,
  addYears,
  differenceInDays,
  endOfMonth,
  isBefore,
  parseISO,
  startOfDay,
  startOfMonth,
} from 'date-fns';

import {
  ONE_TIME_PAYMENT_LABEL,
  RECURRING_PAYMENT_LABEL,
} from '@/constants/spend-metrics';
import { create } from 'zustand';

import {
  duplicateAccountIssue,
  duplicateAccountMessage,
  mapSubscriptionWriteError,
  trialRequirementIssue,
  trialRequirementMessage,
} from '@/lib/duplicate-account';
import { advanceSubscriptionLifecycle } from '@/lib/lifecycle';
import { supabase } from '@/lib/supabase';
import { sharePercent } from '@/constants/chart';
import type { Category } from '@/types/category';
import type { BillingCycle, NewSubscriptionInput, Subscription } from '@/types/subscription';

const TABLE = 'subscriptions';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Date.toISOString()은 UTC로 변환하며 KST 기준 하루가 밀리므로 직접 조립한다. */
function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const CYCLE_STEP: Record<Exclude<BillingCycle, 'one_time'>, (date: Date, amount: number) => Date> = {
  monthly: addMonths,
  yearly: addYears,
};

/** 주기 최대 길이. 반복 횟수를 줄이는 하한 추정에만 쓰므로 실제보다 길게 잡는다. */
const CYCLE_MAX_DAYS: Record<Exclude<BillingCycle, 'one_time'>, number> = {
  monthly: 31,
  yearly: 366,
};

/**
 * anchor_date(최초 결제일) 기준으로 오늘 이후 첫 결제일을 구한다.
 *
 * 주기를 직전 결과가 아니라 항상 anchor에 배수로 더한다. 이전 결과에 누적하면
 * date-fns가 clamp한 날짜(1월 31일 -> 2월 28일)가 굳어져 이후 달에도 28일로 밀린다.
 */
export function computeNextPaymentDate(
  anchor: string,
  cycle: BillingCycle,
  from = new Date()
): string {
  if (cycle === 'one_time') return anchor.slice(0, 10);

  const today = startOfDay(from);
  const base = startOfDay(parseISO(anchor));
  const recurring = cycle === 'yearly' ? 'yearly' : 'monthly';
  const step = CYCLE_STEP[recurring];

  const gap = differenceInDays(today, base);
  let periods = gap > 0 ? Math.floor(gap / CYCLE_MAX_DAYS[recurring]) : 0;
  let next = periods === 0 ? base : step(base, periods);

  while (isBefore(next, today)) {
    periods += 1;
    next = step(base, periods);
  }

  return toISODate(next);
}

export function defaultAnchorDate(from = new Date()): string {
  return toISODate(startOfDay(from));
}

export function toMonthlyAmount(subscription: Subscription): number {
  if (subscription.billing_cycle === 'yearly') {
    return Math.round(subscription.amount / 12);
  }
  if (subscription.billing_cycle === 'one_time') {
    return 0;
  }
  return subscription.amount;
}

export function getMonthlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((item) => item.is_active)
    .reduce((sum, item) => sum + toMonthlyAmount(item), 0);
}

export type ChargeKind = 'recurring' | 'one_time';

export type MonthCharge = {
  date: string;
  amount: number;
  kind: ChargeKind;
};

export type MonthPaymentBreakdown = {
  monthlyEquivalent: number;
  /** 오늘까지 일정상 지난 금액. 실제 결제 확인액이 아니다. */
  actualTotal: number;
  /** 해당 월 전체의 등록 일정 기준 예상 결제액. */
  expectedTotal: number;
  recurring: number;
  oneTime: number;
  expectedRecurring: number;
  expectedOneTime: number;
  refunds: number;
  scheduled: number;
};

export function paymentKindLabel(cycle: BillingCycle): typeof RECURRING_PAYMENT_LABEL | typeof ONE_TIME_PAYMENT_LABEL {
  return cycle === 'one_time' ? ONE_TIME_PAYMENT_LABEL : RECURRING_PAYMENT_LABEL;
}

/** 해당 연·월의 청구 건. 이력 테이블이 없어 현재 구독으로 투영한다. */
export function chargesInMonth(subscription: Subscription, year: number, month: number): MonthCharge[] {
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const kind: ChargeKind = subscription.billing_cycle === 'one_time' ? 'one_time' : 'recurring';

  if (subscription.billing_cycle === 'one_time') {
    const date = parseISO(subscription.anchor_date);
    if (date < monthStart || date > monthEnd) return [];
    return [{ date: subscription.anchor_date.slice(0, 10), amount: subscription.amount, kind }];
  }

  const charges: MonthCharge[] = [];
  let cursor = computeNextPaymentDate(subscription.anchor_date, subscription.billing_cycle, monthStart);
  let guard = 0;
  while (guard < 8) {
    const date = parseISO(cursor);
    if (date > monthEnd) break;
    if (date >= monthStart) charges.push({ date: cursor, amount: subscription.amount, kind });
    cursor = computeNextPaymentDate(subscription.anchor_date, subscription.billing_cycle, addDays(date, 1));
    guard += 1;
  }
  return charges;
}

export function getMonthPaymentBreakdown(
  subscriptions: Subscription[],
  year: number,
  month: number,
  asOf = new Date(),
  refunds = 0
): MonthPaymentBreakdown {
  const asOfDay = startOfDay(asOf);
  let recurring = 0;
  let oneTime = 0;
  let scheduled = 0;
  let scheduledRecurring = 0;
  let scheduledOneTime = 0;

  for (const item of subscriptions.filter((row) => row.is_active)) {
    for (const charge of chargesInMonth(item, year, month)) {
      if (parseISO(charge.date) > asOfDay) {
        scheduled += charge.amount;
        if (charge.kind === 'one_time') scheduledOneTime += charge.amount;
        else scheduledRecurring += charge.amount;
      } else if (charge.kind === 'one_time') {
        oneTime += charge.amount;
      } else {
        recurring += charge.amount;
      }
    }
  }

  const elapsedEstimatedTotal = recurring + oneTime - refunds;
  return {
    monthlyEquivalent: getMonthlyTotal(subscriptions),
    actualTotal: elapsedEstimatedTotal,
    expectedTotal: elapsedEstimatedTotal + scheduled,
    recurring,
    oneTime,
    expectedRecurring: recurring + scheduledRecurring,
    expectedOneTime: oneTime + scheduledOneTime,
    refunds,
    scheduled,
  };
}

export function getCurrentMonthPaymentBreakdown(
  subscriptions: Subscription[],
  asOf = new Date(),
  refunds = 0
): MonthPaymentBreakdown {
  return getMonthPaymentBreakdown(subscriptions, asOf.getFullYear(), asOf.getMonth() + 1, asOf, refunds);
}

export function parseISODate(isoDate: string): Date {
  return parseISO(isoDate);
}

export function getDaysUntil(isoDate: string, from = new Date()): number {
  return differenceInDays(parseISO(isoDate), startOfDay(from));
}

export function getDdayLabel(isoDate: string, from = new Date()): string {
  const diff = getDaysUntil(isoDate, from);
  if (diff === 0) return 'D-DAY';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

export function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

export function formatShortDate(isoDate: string): string {
  const date = parseISO(isoDate);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  if (!year || !month || !day) return isoDate;
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

export function getActiveSubscriptions(subscriptions: Subscription[]): Subscription[] {
  return subscriptions.filter((item) => item.is_active);
}

export function getUpcomingSubscriptions(
  subscriptions: Subscription[],
  withinDays: number,
  from = new Date()
): Subscription[] {
  return getActiveSubscriptions(subscriptions)
    .filter((item) => {
      const days = getDaysUntil(item.next_payment_date, from);
      return days >= 0 && days <= withinDays;
    })
    .sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date));
}

/** 카테고리 라벨·색상이 DB로 옮겨졌으므로 집계에도 카테고리 목록을 함께 넘겨야 한다. */
export function getCategoryTotals(
  subscriptions: Subscription[],
  categories: Category[]
): { category: Category; amount: number }[] {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const totals = new Map<string, number>();

  for (const item of getActiveSubscriptions(subscriptions)) {
    totals.set(item.category_id, (totals.get(item.category_id) ?? 0) + toMonthlyAmount(item));
  }

  return Array.from(totals.entries())
    .flatMap(([categoryId, amount]) => {
      const category = byId.get(categoryId);
      // 카테고리 목록이 아직 안 들어왔거나 삭제된 id면 막대를 그릴 근거가 없어 건너뛴다.
      if (!category || amount <= 0) return [];
      return [{ category, amount }];
    })
    .sort((a, b) => b.amount - a.amount);
}

export type SpendInsight = {
  kind: 'top_category' | 'largest_subscription';
  label: string;
};

export function getLargestSubscription(subscriptions: Subscription[]): Subscription | null {
  const active = getActiveSubscriptions(subscriptions);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => toMonthlyAmount(b) - toMonthlyAmount(a))[0] ?? null;
}

export function getSpendInsights(
  subscriptions: Subscription[],
  categories: Category[]
): SpendInsight[] {
  const totals = getCategoryTotals(subscriptions, categories);
  const monthly = totals.reduce((sum, item) => sum + item.amount, 0);
  const insights: SpendInsight[] = [];
  const top = totals[0];
  if (top && monthly > 0) {
    const percent = sharePercent(top.amount, monthly);
    insights.push({
      kind: 'top_category',
      label: `${top.category.name} 월 지출의 ${percent}%`,
    });
  }
  const largest = getLargestSubscription(subscriptions);
  if (largest) {
    insights.push({
      kind: 'largest_subscription',
      label: `가장 큰 구독 ${largest.name} ${formatCurrency(toMonthlyAmount(largest))}`,
    });
  }
  return insights;
}

export type CashflowWeek = {
  label: string;
  amount: number;
  startDay: number;
  endDay: number;
};

export function getThirtyDayCashflow(
  subscriptions: Subscription[],
  from = new Date()
): CashflowWeek[] {
  const weeks: CashflowWeek[] = [
    { label: '이번 주', startDay: 0, endDay: 6, amount: 0 },
    { label: '2주차', startDay: 7, endDay: 13, amount: 0 },
    { label: '3주차', startDay: 14, endDay: 20, amount: 0 },
    { label: '4주차', startDay: 21, endDay: 29, amount: 0 },
  ];

  for (const item of getActiveSubscriptions(subscriptions)) {
    const days = getDaysUntil(item.next_payment_date, from);
    if (days < 0 || days > 29) continue;
    const week = weeks.find((row) => days >= row.startDay && days <= row.endDay);
    if (week) week.amount += item.amount;
  }

  return weeks;
}

function sortByNextPayment(items: Subscription[]): Subscription[] {
  return [...items].sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date));
}

type SubscriptionState = {
  subscriptions: Subscription[];
  loading: boolean;
  error: string | null;
  fetchSubscriptions: () => Promise<void>;
  addSubscription: (input: NewSubscriptionInput) => Promise<Subscription | null>;
  updateSubscription: (id: string, input: NewSubscriptionInput) => Promise<Subscription | null>;
  removeSubscription: (id: string) => Promise<void>;
  toggleActive: (id: string) => Promise<void>;
  markChecked: (id: string) => Promise<void>;
};

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscriptions: [],
  loading: false,
  error: null,

  fetchSubscriptions: async () => {
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) {
      set({ subscriptions: [], loading: false, error: null });
      return;
    }

    const quiet = get().subscriptions.length > 0;
    if (quiet) {
      set({ error: null });
    } else {
      set({ loading: true, error: null });
    }

    // 일정상 도래한 이번 달 정기 구독 회차를 실제 확인과 구분된 이력으로 남긴다.
    // 아직 마이그레이션이 배포되지 않은 환경에서도 목록 조회는 계속되어야 한다.
    await supabase.rpc('sync_my_automatic_renewals');

    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('next_payment_date', { ascending: true });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    const rows = (data ?? []) as Subscription[];

    // 결제일이 지난 행은 주기만큼 앞으로 굴려 D-day와 정렬이 어긋나지 않게 한다.
    const rolled = rows.map((row) => {
      const next = computeNextPaymentDate(row.anchor_date, row.billing_cycle);
      return next === row.next_payment_date ? row : { ...row, next_payment_date: next };
    });

    const stale = rolled.filter(
      (row, index) => row.next_payment_date !== rows[index].next_payment_date
    );

    set({ subscriptions: sortByNextPayment(rolled), loading: false, error: null });

    if (stale.length > 0) {
      await supabase.from(TABLE).upsert(stale);
    }
  },

  addSubscription: async (input) => {
    const { data: auth } = await supabase.auth.getSession();
    const userId = auth.session?.user?.id;
    if (!userId) {
      set({ error: '로그인이 필요합니다.' });
      return null;
    }

    const createIssue = duplicateAccountIssue(get().subscriptions, {
      name: input.name,
      account_id: input.account_id,
      preset_id: input.preset_id,
    });
    if (createIssue) {
      set({ error: duplicateAccountMessage(createIssue) });
      return null;
    }
    const trialIssue = trialRequirementIssue(input);
    if (trialIssue) {
      set({ error: trialRequirementMessage(trialIssue) });
      return null;
    }

    const nextPaymentDate = computeNextPaymentDate(input.anchor_date, input.billing_cycle);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_id: userId,
        name: input.name.trim(),
        amount: input.amount,
        billing_cycle: input.billing_cycle,
        category_id: input.category_id,
        anchor_date: input.anchor_date,
        next_payment_date: nextPaymentDate,
        preset_id: input.preset_id,
        is_active: input.is_active,
        memo: input.memo ?? null,
        emoji: input.emoji ?? null,
        account_id: input.account_id ?? null,
        billing_channel: input.billing_channel ?? null,
        payment_instrument_id: input.payment_instrument_id ?? null,
        is_trial: input.is_trial ?? false,
        trial_ends_at: input.is_trial ? (input.trial_ends_at ?? null) : null,
      })
      .select()
      .single();

    if (error || !data) {
      set({ error: mapSubscriptionWriteError(error?.message ?? '구독을 추가하지 못했습니다.') });
      return null;
    }

    const created = data as Subscription;
    set((state) => ({
      subscriptions: sortByNextPayment([created, ...state.subscriptions]),
      error: null,
    }));
    return created;
  },

  updateSubscription: async (id, input) => {
    const previous = get().subscriptions;
    const current = previous.find((item) => item.id === id);
    if (!current) return null;

    const updateIssue = duplicateAccountIssue(previous, {
      id,
      name: input.name,
      account_id: input.account_id,
      preset_id: input.preset_id,
    });
    if (updateIssue) {
      set({ error: duplicateAccountMessage(updateIssue) });
      return null;
    }
    const trialIssue = trialRequirementIssue(input);
    if (trialIssue) {
      set({ error: trialRequirementMessage(trialIssue) });
      return null;
    }

    const nextPaymentDate = computeNextPaymentDate(input.anchor_date, input.billing_cycle);
    const updated: Subscription = {
      ...current,
      name: input.name.trim(),
      amount: input.amount,
      billing_cycle: input.billing_cycle,
      category_id: input.category_id,
      anchor_date: input.anchor_date,
      next_payment_date: nextPaymentDate,
      preset_id: input.preset_id,
      is_active: input.is_active,
      memo: input.memo,
      emoji: input.emoji,
      account_id: input.account_id,
      billing_channel: input.billing_channel ?? null,
      payment_instrument_id: input.payment_instrument_id ?? null,
      is_trial: input.is_trial ?? false,
      trial_ends_at: input.is_trial ? (input.trial_ends_at ?? null) : null,
    };

    set({
      subscriptions: sortByNextPayment(
        previous.map((item) => (item.id === id ? updated : item))
      ),
      error: null,
    });

    const { error } = await supabase
      .from(TABLE)
      .update({
        name: updated.name,
        amount: updated.amount,
        billing_cycle: updated.billing_cycle,
        category_id: updated.category_id,
        anchor_date: updated.anchor_date,
        next_payment_date: updated.next_payment_date,
        preset_id: updated.preset_id,
        is_active: updated.is_active,
        memo: updated.memo ?? null,
        emoji: updated.emoji ?? null,
        account_id: updated.account_id ?? null,
        billing_channel: updated.billing_channel ?? null,
        payment_instrument_id: updated.payment_instrument_id ?? null,
        is_trial: updated.is_trial ?? false,
        trial_ends_at: updated.trial_ends_at ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      set({ subscriptions: previous, error: mapSubscriptionWriteError(error.message) });
      return null;
    }

    return updated;
  },

  removeSubscription: async (id) => {
    const previous = get().subscriptions;
    set({ subscriptions: previous.filter((item) => item.id !== id), error: null });

    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) {
      set({ subscriptions: previous, error: error.message });
    }
  },

  toggleActive: async (id) => {
    const previous = get().subscriptions;
    const current = previous.find((item) => item.id === id);
    if (!current) return;

    const nextActive = !current.is_active;
    // 종료/종료 예정 상태에서 "다시 시작"하면 lifecycle_status도 active로 되돌려야
    // 목록의 상태 필터(종료 등)에 계속 남는 문제가 생기지 않는다.
    const needsLifecycleReset =
      nextActive && current.lifecycle_status != null && current.lifecycle_status !== 'active';

    set({
      subscriptions: previous.map((item) =>
        item.id === id
          ? {
              ...item,
              is_active: nextActive,
              ...(needsLifecycleReset
                ? { lifecycle_status: 'active' as const, service_end_date: null }
                : {}),
            }
          : item
      ),
      error: null,
    });

    if (needsLifecycleReset) {
      try {
        const result = await advanceSubscriptionLifecycle(id, 'active');
        if (!result.ok) {
          set({ subscriptions: previous, error: result.message });
        }
      } catch (err) {
        set({ subscriptions: previous, error: err instanceof Error ? err.message : '상태를 바꾸지 못했습니다.' });
      }
      return;
    }

    const { error } = await supabase
      .from(TABLE)
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      set({ subscriptions: previous, error: error.message });
    }
  },

  markChecked: async (id) => {
    const previous = get().subscriptions;
    const current = previous.find((item) => item.id === id);
    if (!current) return;
    const now = new Date().toISOString();
    set({
      subscriptions: previous.map((item) =>
        item.id === id ? { ...item, last_checked_at: now } : item
      ),
      error: null,
    });
    const { error } = await supabase
      .from(TABLE)
      .update({ last_checked_at: now, updated_at: now })
      .eq('id', id);
    if (error) {
      set({ subscriptions: previous, error: error.message });
    }
  },
}));
