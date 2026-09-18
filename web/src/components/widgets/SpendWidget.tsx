import { formatCurrency } from '@/lib/calc';
import {
  MONTHLY_EQUIVALENT_LABEL,
  MONTH_PAYMENT_TOTAL_LABEL,
  NEXT_MONTH_PAYMENT_TOTAL_LABEL,
  REGISTERED_SCHEDULE_BASIS_LABEL,
} from '@/lib/spend-metrics';
import { WidgetCard } from '@/components/WidgetCard';

type SpendWidgetProps = {
  monthlyTotal: number;
  monthPaymentTotal: number;
  nextMonthPaymentTotal: number;
};

export function SpendWidget({
  monthlyTotal,
  monthPaymentTotal,
  nextMonthPaymentTotal,
}: SpendWidgetProps) {
  return (
    <WidgetCard title={MONTHLY_EQUIVALENT_LABEL}>
      <p className="text-[32px] font-extrabold leading-none tracking-[-0.03em] text-text tabular-nums">
        {formatCurrency(monthlyTotal)}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-background px-3 py-3">
          <p className="text-[11px] font-semibold leading-4 text-muted">{MONTH_PAYMENT_TOTAL_LABEL}</p>
          <p className="mt-1 text-base font-bold text-text tabular-nums">{formatCurrency(monthPaymentTotal)}</p>
        </div>
        <div className="rounded-xl bg-background px-3 py-3">
          <p className="text-[11px] font-semibold leading-4 text-muted">{NEXT_MONTH_PAYMENT_TOTAL_LABEL}</p>
          <p className="mt-1 text-base font-bold text-text tabular-nums">{formatCurrency(nextMonthPaymentTotal)}</p>
        </div>
      </div>
      <p className="mt-4 text-[11px] font-medium leading-5 text-muted">{REGISTERED_SCHEDULE_BASIS_LABEL}</p>
    </WidgetCard>
  );
}
