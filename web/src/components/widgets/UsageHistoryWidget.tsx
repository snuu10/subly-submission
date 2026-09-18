import { useEffect, useMemo, useState } from 'react';

import { WidgetCard } from '@/components/WidgetCard';
import { formatCurrency } from '@/lib/calc';
import { listMyUsageHistory } from '@/lib/briefing-events';
import {
  formatUsageHistoryAt,
  formatUsageHistorySnooze,
  kstTodayIso,
  toKstRangeEnd,
  toKstRangeStart,
  USAGE_HISTORY_LABEL,
  USAGE_HISTORY_SOURCE_LABEL,
  usageHistoryMonthlyAmount,
} from '@/lib/usage-checkin';
import type {
  UsageHistoryItem,
  UsageHistoryQuery,
  UsageHistoryResponse,
  UsageHistorySummary,
} from '@/types/briefing-event';

const RESPONSE_FILTERS: { value: UsageHistoryResponse | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'used_recently', label: USAGE_HISTORY_LABEL.used_recently },
  { value: 'occasionally', label: USAGE_HISTORY_LABEL.occasionally },
  { value: 'not_used', label: USAGE_HISTORY_LABEL.not_used },
  { value: 'unsure', label: USAGE_HISTORY_LABEL.unsure },
  { value: 'later', label: USAGE_HISTORY_LABEL.later },
];

function emptySummary(): UsageHistorySummary {
  return {
    response_counts: {
      used_recently: 0,
      occasionally: 0,
      not_used: 0,
      unsure: 0,
      later: 0,
    },
    unused: [],
    latest_by_subscription: [],
  };
}

function historyHint(item: UsageHistoryItem): string {
  const source = USAGE_HISTORY_SOURCE_LABEL[item.source];
  const when = formatUsageHistoryAt(item.at);
  if (item.snoozed_until) {
    return `${source} · ${when} · 나중까지 ${formatUsageHistorySnooze(item.snoozed_until)}`;
  }
  if (item.next_check_at) {
    return `${source} · ${when} · 다음 질문 ${formatUsageHistorySnooze(`${item.next_check_at}T00:00:00+09:00`)}`;
  }
  return `${source} · ${when}`;
}

type UsageHistoryWidgetProps = {
  subscriptions: { id: string; name: string }[];
  onOpenSubscription: (id: string) => void;
};

export function UsageHistoryWidget({ subscriptions, onOpenSubscription }: UsageHistoryWidgetProps) {
  const [items, setItems] = useState<UsageHistoryItem[]>([]);
  const [summary, setSummary] = useState<UsageHistorySummary>(emptySummary());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState('');
  const [responseFilter, setResponseFilter] = useState<UsageHistoryResponse | 'all'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const query = useMemo((): UsageHistoryQuery => {
    return {
      limit: 100,
      subscriptionId: subscriptionId || null,
      response: responseFilter === 'all' ? null : responseFilter,
      from: fromDate ? toKstRangeStart(fromDate) : null,
      to: toDate ? toKstRangeEnd(toDate) : null,
    };
  }, [fromDate, responseFilter, subscriptionId, toDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listMyUsageHistory(query).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setItems([]);
        setSummary(emptySummary());
        setError(result.message || '기록을 불러오지 못했습니다.');
        setLoading(false);
        return;
      }
      setError(null);
      setItems(result.items);
      setSummary(result.summary);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const unusedMonthlyTotal = summary.unused.reduce(
    (sum, item) => sum + usageHistoryMonthlyAmount(item.amount, item.billing_cycle),
    0
  );

  return (
    <div className="flex flex-col gap-4">
      <WidgetCard title="요약">
        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(USAGE_HISTORY_LABEL) as UsageHistoryResponse[]).map((key) => (
            <span key={key} className="rounded-xl bg-background px-3 py-2 text-xs text-muted">
              {USAGE_HISTORY_LABEL[key]}{' '}
              <span className="font-extrabold text-text">{summary.response_counts[key]}</span>
            </span>
          ))}
        </div>
        <p className="mb-2 text-sm font-extrabold text-text">안 쓰는 구독</p>
        {summary.unused.length === 0 ? (
          <p className="text-sm text-muted">최근 체크인이 ‘사용 안 했어요’인 활성 구독이 없어요.</p>
        ) : (
          <>
            <p className="mb-2 text-sm font-bold text-primary">월 {formatCurrency(unusedMonthlyTotal)}</p>
            <ul className="flex flex-col divide-y divide-border">
              {summary.unused.map((item) => (
                <li key={item.subscription_id}>
                  <button
                    type="button"
                    onClick={() => onOpenSubscription(item.subscription_id)}
                    className="w-full py-2 text-left"
                  >
                    <p className="text-sm font-bold text-text">{item.name}</p>
                    <p className="text-xs text-muted">
                      {formatCurrency(usageHistoryMonthlyAmount(item.amount, item.billing_cycle))}/월
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mb-2 mt-4 text-sm font-extrabold text-text">구독별 최근</p>
        {summary.latest_by_subscription.length === 0 ? (
          <p className="text-sm text-muted">아직 기록이 없어요.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {summary.latest_by_subscription.map((item) => (
              <li key={item.subscription_id}>
                <button
                  type="button"
                  onClick={() => onOpenSubscription(item.subscription_id)}
                  className="w-full py-2 text-left"
                >
                  <p className="text-sm font-bold text-text">{item.name}</p>
                  <p className="text-sm font-bold text-primary">{USAGE_HISTORY_LABEL[item.response]}</p>
                  <p className="text-xs text-muted">{formatUsageHistoryAt(item.at)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </WidgetCard>

      <WidgetCard title="사용 기록">
        <p className="mb-4 text-sm text-muted">
          홈과 비서에서 답한 사용 여부입니다. 구독을 삭제하면 그 기록도 함께 사라집니다.
        </p>
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            구독
            <select
              value={subscriptionId}
              onChange={(event) => setSubscriptionId(event.target.value)}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-text"
            >
              <option value="">전체</option>
              {subscriptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            응답
            <select
              value={responseFilter}
              onChange={(event) => setResponseFilter(event.target.value as UsageHistoryResponse | 'all')}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-text"
            >
              {RESPONSE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            시작
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => setFromDate(event.target.value)}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            종료
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              max={kstTodayIso()}
              onChange={(event) => setToDate(event.target.value)}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-text"
            />
          </label>
        </div>
        {loading ? <p className="text-sm text-muted">불러오는 중…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="text-sm text-muted">조건에 맞는 사용 기록이 없어요.</p>
        ) : null}
        {!loading && items.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenSubscription(item.subscription_id)}
                  className="w-full py-3 text-left first:pt-0 last:pb-0"
                >
                  <p className="text-sm font-bold text-text">{item.name}</p>
                  <p className="text-sm font-bold text-primary">{USAGE_HISTORY_LABEL[item.response]}</p>
                  <p className="mt-0.5 text-xs text-muted">{historyHint(item)}</p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </WidgetCard>
    </div>
  );
}
