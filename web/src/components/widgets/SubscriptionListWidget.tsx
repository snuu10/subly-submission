import { useMemo, useState } from 'react';

import { formatCurrency, formatShortDate } from '@/lib/calc';
import { applyCategoryChipOrder } from '@/lib/category-order';
import { getVisibleCategories } from '@/lib/categories';
import { kstTodayIso } from '@/lib/usage-checkin';
import { WidgetCard } from '@/components/WidgetCard';
import { ServiceIcon } from '@/components/ServiceIcon';
import { isTrialCurrent, LIFECYCLE_LABELS, type Category, type LifecycleStatus, type Subscription } from '@/types';

type SubscriptionListWidgetProps = {
  items: Subscription[];
  categories: Category[];
  chipOrderIds?: string[] | null;
  compact?: boolean;
  onAdd?: () => void;
  onEdit: (item: Subscription) => void;
  onToggle: (item: Subscription) => void;
  onDelete: (item: Subscription) => void;
};

type ListGroup = {
  key: string;
  title: string;
  color: string | null;
  items: Subscription[];
};

type StatusFilter = 'all' | 'active' | 'paused' | 'ending' | 'ended';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '전체 상태' },
  { value: 'active', label: '활성' },
  { value: 'paused', label: '일시정지' },
  { value: 'ending', label: '종료 예정' },
  { value: 'ended', label: '종료' },
];

const ENDING_STATUSES = new Set<LifecycleStatus>([
  'cancel_requested',
  'ending_scheduled',
  'end_confirm_needed',
]);

const BILLING_CYCLE_LABEL: Record<Subscription['billing_cycle'], string> = {
  monthly: '월간',
  yearly: '연간',
  one_time: '일회성',
};

function matchesSearch(item: Subscription, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.account_id ?? '').toLowerCase().includes(needle) ||
    (item.memo ?? '').toLowerCase().includes(needle)
  );
}

function subscriptionStatus(item: Subscription): Exclude<StatusFilter, 'all'> {
  if (item.lifecycle_status === 'ended') return 'ended';
  if (item.lifecycle_status && ENDING_STATUSES.has(item.lifecycle_status)) return 'ending';
  return item.is_active ? 'active' : 'paused';
}

function sortItems(items: Subscription[]): Subscription[] {
  return [...items].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.next_payment_date.localeCompare(b.next_payment_date);
  });
}

export function SubscriptionListWidget({
  items,
  categories,
  chipOrderIds = null,
  compact = false,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: SubscriptionListWidgetProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const visible = applyCategoryChipOrder(getVisibleCategories(categories), chipOrderIds, 'web');
  const byId = new Map(categories.map((item) => [item.id, item]));

  const filterOptions = useMemo(
    () => [{ id: 'all', name: '전체', color: null as string | null }, ...visible.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
    }))],
    [visible]
  );

  const filtered = useMemo(() => {
    return sortItems(
      items.filter((item) => {
        const categoryMatches = selectedCategoryId === 'all' || item.category_id === selectedCategoryId;
        const statusMatches = statusFilter === 'all' || subscriptionStatus(item) === statusFilter;
        return categoryMatches && statusMatches && matchesSearch(item, searchQuery);
      })
    );
  }, [items, selectedCategoryId, statusFilter, searchQuery]);

  const groups: ListGroup[] = useMemo(() => {
    if (selectedCategoryId !== 'all') {
      const category = byId.get(selectedCategoryId);
      return [
        {
          key: selectedCategoryId,
          title: category?.name ?? '카테고리',
          color: category?.color ?? null,
          items: filtered,
        },
      ];
    }

    const buckets = new Map<string, Subscription[]>();
    for (const item of filtered) {
      const list = buckets.get(item.category_id) ?? [];
      list.push(item);
      buckets.set(item.category_id, list);
    }

    const ordered: ListGroup[] = [];
    for (const category of visible) {
      const rows = buckets.get(category.id);
      if (!rows?.length) continue;
      ordered.push({
        key: category.id,
        title: category.name,
        color: category.color,
        items: rows,
      });
      buckets.delete(category.id);
    }

    for (const [categoryId, rows] of buckets) {
      const category = byId.get(categoryId);
      ordered.push({
        key: categoryId,
        title: category?.name ?? '기타',
        color: category?.color ?? null,
        items: rows,
      });
    }

    return ordered;
  }, [byId, filtered, selectedCategoryId, visible]);

  return (
    <WidgetCard
      title="구독 목록"
      hint={`${filtered.length}개`}
      className={compact ? '' : 'md:col-span-2 xl:col-span-3'}
    >
      {compact ? null : (
      <div className="mb-3">
        <label className="relative block">
          <span className="sr-only">구독 검색</span>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="서비스명, 계정(이메일/아이디)으로 검색"
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-sm text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            >
              ✕
            </button>
          ) : null}
        </label>
      </div>
      )}

      {compact ? null : (
      <div className="-mx-1 mb-4 flex items-center gap-2 px-1">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {filterOptions.map((option) => {
            const selected = selectedCategoryId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedCategoryId(option.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  selected
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-surface text-muted hover:text-text'
                }`}
              >
                {option.color ? (
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: selected ? '#FFFFFF' : option.color }}
                  />
                ) : null}
                {option.name}
              </button>
            );
          })}
        </div>
        <label className="shrink-0">
          <span className="sr-only">구독 상태</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="h-8 rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      )}

      {filtered.length === 0 ? (
        compact && onAdd ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted">
              {items.length === 0 ? '등록된 구독 리스트가 없어요.' : '활성 구독이 없어요.'}
            </p>
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-white"
            >
              구독 등록
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {items.length === 0 ? '등록된 구독이 없습니다. 헤더의 + 로 추가하세요.' : '선택한 조건에 맞는 구독이 없습니다.'}
          </p>
        )
      ) : (
        <div className={`flex flex-col gap-4 ${compact ? 'max-h-[320px] overflow-y-auto pr-1' : ''}`}>
          {groups.map((group) => (
            <div key={group.key}>
              {selectedCategoryId === 'all' ? (
                <div className="mb-2 flex items-center gap-2">
                  {group.color ? (
                    <span className="size-2 rounded-full" style={{ backgroundColor: group.color }} />
                  ) : null}
                  <p className="text-xs font-extrabold text-muted">{group.title}</p>
                  <p className="text-[11px] text-muted">{group.items.length}</p>
                </div>
              ) : null}
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => {
                  const status = subscriptionStatus(item);
                  const trialActive = isTrialCurrent(item, kstTodayIso());
                  const category = byId.get(item.category_id);
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                    >
                      <ServiceIcon
                        presetId={item.preset_id}
                        name={item.name}
                        color={category?.color}
                        emoji={item.emoji}
                        categoryKey={category?.key}
                        size={30}
                      />
                      <button type="button" onClick={() => onEdit(item)} className="min-w-0 flex-1 text-left">
                        <p className={`truncate text-sm font-semibold ${item.is_active ? 'text-text' : 'text-muted'}`}>
                          {item.name}
                          {item.lifecycle_status &&
                          item.lifecycle_status !== 'active' &&
                          item.lifecycle_status !== 'ended' ? (
                            <span className="ml-2 text-[11px] font-bold text-primary">
                              {LIFECYCLE_LABELS[item.lifecycle_status as LifecycleStatus]}
                            </span>
                          ) : null}
                          {item.lifecycle_status === 'ended' ? (
                            <span className="ml-2 text-[11px] font-bold text-muted">종료</span>
                          ) : item.is_active ? null : (
                            <span className="ml-2 text-[11px] font-bold text-muted">일시정지</span>
                          )}
                        </p>
                        <p className={`truncate text-xs ${trialActive ? 'font-bold text-primary' : 'text-muted'}`}>
                          {trialActive
                            ? `무료 체험 · ${formatShortDate(item.trial_ends_at!)}까지`
                            : `${BILLING_CYCLE_LABEL[item.billing_cycle]} · ${formatShortDate(item.next_payment_date)} 결제`}
                          {item.account_id ? ` · 계정 ${item.account_id}` : ''}
                          {item.memo ? ` · ${item.memo}` : ''}
                        </p>
                      </button>
                      {trialActive ? (
                        <p className="text-right text-sm font-semibold tabular-nums text-muted">
                          <span className="line-through">{formatCurrency(item.amount)}</span>
                          <span className="ml-1 block text-[11px] font-bold text-primary">곧 유료</span>
                        </p>
                      ) : (
                        <p className="text-sm font-semibold tabular-nums text-text">{formatCurrency(item.amount)}</p>
                      )}
                      {compact || (status !== 'active' && status !== 'paused') ? null : (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => onToggle(item)}
                          className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted hover:text-text"
                        >
                          {item.is_active ? '일시정지' : '다시 시작'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted hover:text-text"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(item)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-danger hover:bg-rose-bg"
                        >
                          삭제
                        </button>
                      </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
