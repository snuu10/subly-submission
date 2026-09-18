import { formatCurrency, formatShortDate, getDdayLabel, getDaysUntil } from '@/lib/calc';
import { WidgetCard } from '@/components/WidgetCard';
import type { Subscription } from '@/types';

type UpcomingWidgetProps = {
  items: Subscription[];
  onSelect?: (item: Subscription) => void;
};

function ddayClass(isoDate: string): string {
  const days = getDaysUntil(isoDate);
  if (days <= 2) return 'bg-rose-bg text-danger';
  return 'bg-amber-bg text-amber';
}

export function UpcomingWidget({ items, onSelect }: UpcomingWidgetProps) {
  return (
    <WidgetCard title="다가오는 결제" hint="7일 이내">
      {items.length === 0 ? (
        <div className="flex h-full flex-col justify-center rounded-xl bg-[#F0FDF4] px-4 py-6">
          <p className="text-sm font-semibold text-success">이번 주 결제 없음</p>
          <p className="mt-1 text-xs text-success">7일 이내 예정된 결제가 없어요</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect?.(item)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-background"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">{item.name}</p>
                  <p className="text-xs text-muted">{formatShortDate(item.next_payment_date)} 결제</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <p className="text-sm font-semibold tabular-nums text-text">
                    {formatCurrency(item.amount)}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ddayClass(item.next_payment_date)}`}
                  >
                    {getDdayLabel(item.next_payment_date)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
