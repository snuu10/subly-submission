import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { formatCurrency, sharePercent, type StatusMixRow } from '@/lib/calc';
import { WidgetCard } from '@/components/WidgetCard';
import type { Category } from '@/types';

const FALLBACK = '#6B7280';

type MixMode = 'category' | 'status';

type MixWidgetProps = {
  rows: { category: Category; amount: number; count: number }[];
  statusRows: StatusMixRow[];
};

export function MixWidget({ rows, statusRows }: MixWidgetProps) {
  const [mode, setMode] = useState<MixMode>('category');

  const categoryTotal = rows.reduce((sum, row) => sum + row.amount, 0);
  const categoryChart = rows.map((row) => ({
    id: row.category.id,
    name: row.category.name,
    value: row.amount,
    percent: sharePercent(row.amount, categoryTotal),
    color: row.category.color || FALLBACK,
    detail: formatCurrency(row.amount),
  }));

  const statusTotal = statusRows.reduce((sum, row) => sum + row.count, 0);
  const statusChart = statusRows.map((row) => ({
    id: row.key,
    name: row.label,
    value: row.count,
    percent: sharePercent(row.count, statusTotal),
    color: row.color,
    detail: `${row.count}개`,
  }));

  const chartRows = mode === 'category' ? categoryChart : statusChart;
  const emptyLabel =
    mode === 'category' ? '표시할 활성 구독이 없습니다.' : '표시할 구독이 없습니다.';

  return (
    <WidgetCard
      title={mode === 'category' ? '카테고리 비율' : '활성/비활성'}
      actions={
        <div className="flex rounded-lg bg-background p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode('category')}
            className={`rounded-md px-2.5 py-1 ${
              mode === 'category' ? 'bg-surface text-text shadow-sm' : 'text-muted'
            }`}
          >
            카테고리
          </button>
          <button
            type="button"
            onClick={() => setMode('status')}
            className={`rounded-md px-2.5 py-1 ${
              mode === 'status' ? 'bg-surface text-text shadow-sm' : 'text-muted'
            }`}
          >
            활성/비활성
          </button>
        </div>
      }
    >
      {chartRows.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="flex h-full items-center gap-4">
          <div className="h-[148px] w-[148px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartRows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={44}
                  outerRadius={68}
                  paddingAngle={2}
                  stroke="none"
                >
                  {chartRows.map((row) => (
                    <Cell key={row.id} fill={row.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    mode === 'category'
                      ? formatCurrency(Number(value ?? 0))
                      : `${Number(value ?? 0)}개`,
                    String(name ?? ''),
                  ]}
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.06)',
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-2">
            {chartRows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="min-w-0 flex-1 truncate font-medium text-text">{row.name}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {row.percent}% · {row.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}
