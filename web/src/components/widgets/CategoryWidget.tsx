import { formatCurrency } from '@/lib/calc';
import { WidgetCard } from '@/components/WidgetCard';
import type { Category } from '@/types';

type CategoryWidgetProps = {
  rows: { category: Category; amount: number; count: number }[];
};

export function CategoryWidget({ rows }: CategoryWidgetProps) {
  if (rows.length === 0) {
    return (
      <WidgetCard title="카테고리">
        <p className="text-sm text-muted">활성 구독이 있는 카테고리가 없습니다.</p>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard title="카테고리">
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.category.id} className="flex items-center gap-3">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.category.color }}
            />
            <span className="flex-1 text-sm font-medium text-text">{row.category.name}</span>
            <span className="text-xs text-muted">{row.count}개</span>
            <span className="min-w-[88px] text-right text-sm font-semibold tabular-nums text-text">
              {formatCurrency(row.amount)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
