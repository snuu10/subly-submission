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

import { ONE_TIME_PAYMENT_LABEL, RECURRING_PAYMENT_LABEL } from '@/lib/spend-metrics';
import type {
  BillingCycle,
  Category,
  ProjectedMonth,
  SpendInsight,
  Subscription,
} from '@/types';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const CYCLE_STEP: Record<Exclude<BillingCycle, 'one_time'>, (date: Date, amount: number) => Date> = {
  monthly: addMonths,
  yearly: addYears,
};

const CYCLE_MAX_DAYS: Record<Exclude<BillingCycle, 'one_time'>, number> = {
  monthly: 31,
  yearly: 366,
};

export function defaultAnchorDate(from = new Date()): string {
  return toISODate(startOfDay(from));
}

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

export function withRolledPaymentDates(subscriptions: Subscription[], from = new Date()): Subscription[] {
  return subscriptions.map((row) => {
    const next = computeNextPaymentDate(row.anchor_date, row.billing_cycle, from);
    return next === row.next_payment_date ? row : { ...row, next_payment_date: next };
  });
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
  return getActiveSubscriptions(subscriptions).reduce((sum, item) => sum + toMonthlyAmount(item), 0);
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

export function sharePercent(amount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((amount / total) * 100);
}

export function getCategoryTotals(
  subscriptions: Subscription[],
  categories: Category[]
): { category: Category; amount: number; count: number }[] {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const totals = new Map<string, { amount: number; count: number }>();

  for (const item of getActiveSubscriptions(subscriptions)) {
    const prev = totals.get(item.category_id) ?? { amount: 0, count: 0 };
    totals.set(item.category_id, {
      amount: prev.amount + toMonthlyAmount(item),
      count: prev.count + 1,
    });
  }

  return Array.from(totals.entries())
    .flatMap(([categoryId, stats]) => {
      const category = byId.get(categoryId);
      if (!category || stats.amount <= 0) return [];
      return [{ category, amount: stats.amount, count: stats.count }];
    })
    .sort((a, b) => b.amount - a.amount);
}

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

export type StatusMixRow = {
  key: 'active' | 'paused';
  label: string;
  count: number;
  color: string;
};

export function getStatusMix(subscriptions: Subscription[]): StatusMixRow[] {
  const active = subscriptions.filter((item) => item.is_active).length;
  const paused = subscriptions.length - active;
  return [
    { key: 'active' as const, label: '활성', count: active, color: '#4F46E5' },
    { key: 'paused' as const, label: '비활성', count: paused, color: '#9CA3AF' },
  ].filter((row) => row.count > 0);
}

export function getCycleMix(subscriptions: Subscription[]): { cycle: BillingCycle; label: string; count: number }[] {
  const labels: Record<BillingCycle, string> = {
    monthly: '월간',
    yearly: '연간',
    one_time: '일회성',
  };
  const counts: Record<BillingCycle, number> = { monthly: 0, yearly: 0, one_time: 0 };
  for (const item of getActiveSubscriptions(subscriptions)) {
    counts[item.billing_cycle] += 1;
  }
  return (Object.keys(counts) as BillingCycle[])
    .map((cycle) => ({ cycle, label: labels[cycle], count: counts[cycle] }))
    .filter((row) => row.count > 0);
}

export type ChargeKind = 'recurring' | 'one_time';

export type MonthCharge = {
  date: string;
  amount: number;
  kind: ChargeKind;
};

export type MonthChargeSplit = {
  actual: number;
  scheduled: number;
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

export function monthChargeSplit(
  subscription: Subscription,
  year: number,
  month: number,
  asOf = new Date()
): MonthChargeSplit {
  const asOfDay = startOfDay(asOf);
  let actual = 0;
  let scheduled = 0;
  for (const charge of chargesInMonth(subscription, year, month)) {
    if (parseISO(charge.date) > asOfDay) scheduled += charge.amount;
    else actual += charge.amount;
  }
  return { actual, scheduled };
}

export function yearChargeSplit(
  subscription: Subscription,
  year: number,
  asOf = new Date()
): MonthChargeSplit {
  let actual = 0;
  let scheduled = 0;
  for (let month = 1; month <= 12; month += 1) {
    const split = monthChargeSplit(subscription, year, month, asOf);
    actual += split.actual;
    scheduled += split.scheduled;
  }
  return { actual, scheduled };
}

/** 해당 연·월에 투영되는 청구액(예정 포함). 차트·투영용. */
export function chargeInMonth(subscription: Subscription, year: number, month: number): number {
  return chargesInMonth(subscription, year, month).reduce((sum, item) => sum + item.amount, 0);
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

  for (const item of getActiveSubscriptions(subscriptions)) {
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

export function chargeInYear(subscription: Subscription, year: number): number {
  let amount = 0;
  for (let month = 1; month <= 12; month += 1) {
    amount += chargeInMonth(subscription, year, month);
  }
  return amount;
}

/** 현재 달부터 6개월간 실제 청구 예정액. 이력 테이블이 없어 현재 구독으로 투영한다. */
export function getProjectedMonths(
  subscriptions: Subscription[],
  months = 6,
  from = new Date()
): ProjectedMonth[] {
  const active = getActiveSubscriptions(subscriptions);
  const result: ProjectedMonth[] = [];

  for (let i = 0; i < months; i += 1) {
    const monthStart = startOfMonth(addMonths(from, i));
    const amount = active.reduce(
      (sum, sub) => sum + chargeInMonth(sub, monthStart.getFullYear(), monthStart.getMonth() + 1),
      0
    );
    result.push({
      label: `${monthStart.getMonth() + 1}월`,
      amount,
    });
  }

  return result;
}
