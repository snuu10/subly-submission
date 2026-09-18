import { useMemo, useRef, useState } from 'react';

import {
  formatCurrency,
  getCurrentMonthPaymentBreakdown,
  monthChargeSplit,
  paymentKindLabel,
  yearChargeSplit,
} from '@/lib/calc';
import { findInstitution } from '@/lib/financial-institutions';
import { formatLast4 } from '@/lib/payment-instrument';
import {
  MONTHLY_EQUIVALENT_HELP,
  MONTH_PAYMENT_TOTAL_LABEL,
  ONE_TIME_PAYMENT_LABEL,
  RECURRING_PAYMENT_LABEL,
  REFUND_LABEL,
  SCHEDULED_PAYMENT_LABEL,
} from '@/lib/spend-metrics';
import type { PaymentInstrument } from '@/types/payment-instrument';
import type { Subscription } from '@/types';

type Mode = 'month' | 'year';

type ChargeSplit = { actual: number; scheduled: number };

type PaymentStatusWidgetProps = {
  subscriptions: Subscription[];
  instruments: PaymentInstrument[];
};

function instrumentLabel(subscription: Subscription, instruments: PaymentInstrument[]): string {
  const item = instruments.find((row) => row.id === subscription.payment_instrument_id);
  if (!item) return '미연결';
  const institution = findInstitution(item.kind, item.institution_key);
  return `${institution?.name ?? item.name} ${formatLast4(item.number_last4)}`;
}

function money(amount: number): string {
  if (amount <= 0) return '-';
  return formatCurrency(amount);
}

function downloadCsv(filename: string, rows: string[][]) {
  const body = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvSplit(split: ChargeSplit): string {
  if (split.actual <= 0 && split.scheduled <= 0) return '';
  if (split.scheduled <= 0) return String(split.actual);
  if (split.actual <= 0) return `예정 ${split.scheduled}`;
  return `${split.actual} / 예정 ${split.scheduled}`;
}

export function PaymentStatusWidget({ subscriptions, instruments }: PaymentStatusWidgetProps) {
  const [mode, setMode] = useState<Mode>('month');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [yearStart, setYearStart] = useState(() => new Date().getFullYear());
  const [query, setQuery] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const asOf = useMemo(() => new Date(), []);
  const currentMonth = getCurrentMonthPaymentBreakdown(subscriptions, asOf);

  const years = useMemo(
    () => [yearStart, yearStart + 1, yearStart + 2, yearStart + 3, yearStart + 4],
    [yearStart]
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return subscriptions
      .filter((item) => !needle || item.name.toLowerCase().includes(needle))
      .map((item) => {
        const months = Array.from({ length: 12 }, (_, index) => monthChargeSplit(item, year, index + 1, asOf));
        const monthTotal = months.reduce((sum, value) => sum + value.actual, 0);
        const yearAmounts = years.map((value) => yearChargeSplit(item, value, asOf));
        return {
          id: item.id,
          name: item.name,
          method: instrumentLabel(item, instruments),
          kind: paymentKindLabel(item.billing_cycle),
          months,
          monthTotal,
          monthAverage: Math.round(monthTotal / 12),
          years: yearAmounts,
          yearAverage: Math.round(yearAmounts.reduce((sum, value) => sum + value.actual, 0) / years.length),
        };
      });
  }, [asOf, instruments, query, subscriptions, year, years]);

  function scrollByPage(direction: -1 | 1) {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(240, node.clientWidth * 0.45), behavior: 'smooth' });
  }

  function exportRows() {
    if (mode === 'month') {
      downloadCsv(`결제현황-${year}.csv`, [
        ['서비스명', '결제수단', '구분', '결제 총액', '평균', ...Array.from({ length: 12 }, (_, i) => `${year}년 ${i + 1}월`)],
        ...rows.map((row) => [
          row.name,
          row.method,
          row.kind,
          String(row.monthTotal),
          String(row.monthAverage),
          ...row.months.map(csvSplit),
        ]),
      ]);
      return;
    }
    downloadCsv(`결제현황-연도별-${yearStart}.csv`, [
      ['서비스명', '결제수단', '구분', '평균', ...years.map((value) => `${value}년`)],
      ...rows.map((row) => [
        row.name,
        row.method,
        row.kind,
        String(row.yearAverage),
        ...row.years.map(csvSplit),
      ]),
    ]);
  }

  return (
    <section>
      <p className="text-[11px] font-semibold text-muted sm:text-xs">
        구독 <span className="text-border">›</span> <span className="text-primary">결제 현황</span>
      </p>
      <div className="mt-2.5 flex flex-wrap items-start justify-between gap-3 sm:mt-3">
        <div>
          <h2 className="text-xl font-extrabold text-text sm:text-2xl">결제 현황</h2>
          <p className="mt-0.5 text-xs text-muted sm:mt-1 sm:text-sm">{MONTH_PAYMENT_TOTAL_LABEL}</p>
          {mode === 'month' ? (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                aria-label="이전 해"
                onClick={() => setYear((value) => value - 1)}
                className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-background hover:text-text"
              >
                ‹
              </button>
              <span className="rounded-full border border-primary/20 bg-accent px-3 py-1 text-sm font-semibold text-primary">
                {year}
              </span>
              <button
                type="button"
                aria-label="다음 해"
                onClick={() => setYear((value) => value + 1)}
                className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-background hover:text-text"
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-[auto_2.5rem] items-center justify-between gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
          <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
            <ModeButton active={mode === 'month'} onClick={() => setMode('month')}>
              월별
            </ModeButton>
            <ModeButton active={mode === 'year'} onClick={() => setMode('year')}>
              연도별
            </ModeButton>
          </div>
          <button
            type="button"
            aria-label="내려받기"
            onClick={exportRows}
            disabled={rows.length === 0}
            className="flex size-10 items-center justify-center rounded-lg border border-border text-muted hover:bg-background hover:text-text disabled:opacity-40"
          >
            <DownloadIcon />
          </button>
          <label className="relative col-span-2 w-full sm:min-w-[200px] sm:w-auto">
            <span className="pointer-events-none absolute left-3 top-2.5 text-muted">
              <SearchIcon />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="서비스명 검색"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted focus:border-primary"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 xl:grid-cols-4">
        <SummaryCard label={MONTH_PAYMENT_TOTAL_LABEL} value={currentMonth.expectedTotal} emphasis />
        <SummaryCard label={RECURRING_PAYMENT_LABEL} value={currentMonth.expectedRecurring} />
        <SummaryCard label={ONE_TIME_PAYMENT_LABEL} value={currentMonth.expectedOneTime} />
        {currentMonth.scheduled > 0 ? (
          <SummaryCard label={SCHEDULED_PAYMENT_LABEL} value={currentMonth.scheduled} muted />
        ) : null}
        {currentMonth.refunds > 0 ? (
          <SummaryCard label={REFUND_LABEL} value={currentMonth.refunds} muted />
        ) : null}
      </div>
      <p className="mt-2.5 text-xs leading-5 text-muted sm:mt-3 sm:text-[13px] sm:leading-6">{MONTHLY_EQUIVALENT_HELP}</p>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-border bg-surface sm:mt-5 sm:rounded-2xl">
        <div className="absolute right-3 top-2 z-20 flex gap-1">
          <ArrowButton label="왼쪽" onClick={() => {
            if (mode === 'year') setYearStart((value) => value - 1);
            else scrollByPage(-1);
          }}
          >
            ‹
          </ArrowButton>
          <ArrowButton label="오른쪽" onClick={() => {
            if (mode === 'year') setYearStart((value) => value + 1);
            else scrollByPage(1);
          }}
          >
            ›
          </ArrowButton>
        </div>

        <div ref={scroller} className="overflow-x-auto pt-10">
          <table className="min-w-full border-separate border-spacing-0 text-xs sm:text-sm">
            <thead>
              <tr className="bg-accent/60 text-left text-xs font-semibold text-muted">
                <StickyHead>서비스명</StickyHead>
                <StickyHead offset>결제수단</StickyHead>
                {mode === 'month' ? (
                  <>
                    <th className="whitespace-nowrap px-2.5 py-2 sm:px-4 sm:py-3">구분</th>
                    <th className="whitespace-nowrap px-2.5 py-2 sm:px-4 sm:py-3">결제 총액</th>
                    <th className="whitespace-nowrap px-2.5 py-2 sm:px-4 sm:py-3">평균</th>
                    {Array.from({ length: 12 }, (_, index) => (
                      <th key={index} className="whitespace-nowrap px-2.5 py-2 sm:px-4 sm:py-3">
                        {String(year).slice(-2)}년 {index + 1}월
                      </th>
                    ))}
                  </>
                ) : (
                  <>
                    <th className="whitespace-nowrap px-2.5 py-2 sm:px-4 sm:py-3">구분</th>
                    <th className="whitespace-nowrap px-2.5 py-2 sm:px-4 sm:py-3">평균</th>
                    {years.map((value) => (
                      <th key={value} className="whitespace-nowrap px-2.5 py-2 sm:px-4 sm:py-3">
                        {value}년
                      </th>
                    ))}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={mode === 'month' ? 17 : 9} className="px-4 py-20">
                    <div className="flex flex-col items-center text-muted">
                      <InboxIcon />
                      <p className="mt-3 text-sm">{query.trim() ? '검색 결과가 없어요.' : '데이터가 없습니다.'}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="text-text hover:bg-background/70">
                    <StickyCell>{row.name}</StickyCell>
                    <StickyCell offset muted>
                      {row.method}
                    </StickyCell>
                    {mode === 'month' ? (
                      <>
                        <td className="whitespace-nowrap border-t border-border px-2.5 py-2 text-muted sm:px-4 sm:py-3">
                          {row.kind}
                        </td>
                        <td className="whitespace-nowrap border-t border-border px-2.5 py-2 font-semibold sm:px-4 sm:py-3">
                          {money(row.monthTotal)}
                        </td>
                        <td className="whitespace-nowrap border-t border-border px-2.5 py-2 text-muted sm:px-4 sm:py-3">
                          {money(row.monthAverage)}
                        </td>
                        {row.months.map((value, index) => (
                          <td key={index} className="whitespace-nowrap border-t border-border px-2.5 py-2 sm:px-4 sm:py-3">
                            <SplitCell split={value} />
                          </td>
                        ))}
                      </>
                    ) : (
                      <>
                        <td className="whitespace-nowrap border-t border-border px-2.5 py-2 text-muted sm:px-4 sm:py-3">
                          {row.kind}
                        </td>
                        <td className="whitespace-nowrap border-t border-border px-2.5 py-2 text-muted sm:px-4 sm:py-3">
                          {money(row.yearAverage)}
                        </td>
                        {row.years.map((value, index) => (
                          <td key={index} className="whitespace-nowrap border-t border-border px-2.5 py-2 sm:px-4 sm:py-3">
                            <SplitCell split={value} />
                          </td>
                        ))}
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SplitCell({ split }: { split: ChargeSplit }) {
  if (split.actual <= 0 && split.scheduled <= 0) return <>-</>;
  if (split.scheduled <= 0) return <>{money(split.actual)}</>;
  if (split.actual <= 0) {
    return <span className="text-muted">예정 {formatCurrency(split.scheduled)}</span>;
  }
  return (
    <span>
      {formatCurrency(split.actual)}
      <span className="mt-0.5 block text-xs text-muted">예정 {formatCurrency(split.scheduled)}</span>
    </span>
  );
}

function SummaryCard({
  label,
  value,
  emphasis = false,
  muted = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3 ${emphasis ? 'border-primary/30' : ''}`}>
      <p className="text-[11px] font-semibold leading-4 text-muted sm:text-xs">{label}</p>
      <p className={`mt-0.5 text-base font-extrabold tabular-nums sm:mt-1 sm:text-lg ${muted ? 'text-muted' : 'text-text'}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-md px-3 py-1.5 text-xs font-semibold sm:min-h-0 sm:text-sm ${
        active ? 'bg-text text-white shadow-sm' : 'text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function ArrowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md border border-border bg-surface text-muted hover:text-text"
    >
      {children}
    </button>
  );
}

function StickyHead({ children, offset = false }: { children: string; offset?: boolean }) {
  return (
    <th
      className={`sticky top-0 z-10 w-[108px] min-w-[108px] max-w-[108px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-border bg-accent/80 px-2.5 py-2 sm:w-[140px] sm:min-w-[140px] sm:max-w-[140px] sm:px-4 sm:py-3 ${
        offset ? 'left-[108px] sm:left-[140px]' : 'left-0'
      }`}
    >
      {children}
    </th>
  );
}

function StickyCell({
  children,
  offset = false,
  muted = false,
}: {
  children: string;
  offset?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      title={children}
      className={`sticky z-10 w-[108px] min-w-[108px] max-w-[108px] overflow-hidden text-ellipsis whitespace-nowrap border-t border-border bg-surface px-2.5 py-2 sm:w-[140px] sm:min-w-[140px] sm:max-w-[140px] sm:px-4 sm:py-3 ${
        offset ? 'left-[108px] sm:left-[140px]' : 'left-0 font-semibold'
      } ${muted ? 'text-muted' : ''}`}
    >
      {children}
    </td>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4v10M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 13 6.2 6.4A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.4L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M4 13h5l1 2h4l1-2h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
