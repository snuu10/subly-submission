import { formatCurrency, formatLongDate } from '@/lib/calc';
import { findCategory } from '@/lib/categories';
import { withInferredCategory } from '@/lib/extract';
import type { BillingCycle, Category } from '@/types';
import type { ParsedSubscription } from '@/types/extract';

function billingDayLabel(cycle: BillingCycle, anchor: string): string {
  if (cycle === 'yearly') {
    return `매년 ${Number(anchor.slice(5, 7))}월 ${Number(anchor.slice(8, 10))}일 결제`;
  }
  if (cycle === 'one_time') {
    return `${Number(anchor.slice(5, 7))}월 ${Number(anchor.slice(8, 10))}일 결제`;
  }
  return `매월 ${Number(anchor.slice(8, 10))}일 결제`;
}

const CYCLE: Record<string, string> = { monthly: '매월', yearly: '매년', one_time: '일회성' };

type ChatInlineCardProps = {
  parsed: ParsedSubscription;
  categories: Category[];
  registered?: boolean;
  editedViaModal?: boolean;
  nameNeedsReview?: boolean;
  onRegister: () => void;
  onEdit: () => void;
  onDismiss: () => void;
};

export function ChatInlineCard({
  parsed,
  categories,
  registered,
  editedViaModal,
  nameNeedsReview,
  onRegister,
  onEdit,
  onDismiss,
}: ChatInlineCardProps) {
  if (!parsed) return null;
  const display = withInferredCategory(parsed, categories);
  const category = findCategory(categories, display.category_id);

  return (
    <div className="w-[260px] rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-text">{display.name}</p>
        <p className="text-sm font-bold tabular-nums">{formatCurrency(display.amount)}</p>
      </div>
      {nameNeedsReview ? (
        <p className="mt-1 rounded-lg bg-amber-bg px-2 py-1 text-[11px] font-semibold text-amber">
          ⚠️ 이름이 정확한지 확인해 주세요. 체험·전환 관련 표현이 섞였을 수 있어요.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-bold text-primary">
          {CYCLE[display.billing_cycle] ?? display.billing_cycle}
        </span>
        {category ? (
          <span className="rounded-full bg-background px-2 py-1 text-[11px] font-bold text-muted">
            {category.name}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted">
        {display.billing_cycle === 'yearly'
          ? `연 ${formatCurrency(display.amount)}`
          : display.billing_cycle === 'one_time'
            ? `일회 ${formatCurrency(display.amount)}`
            : `월 ${formatCurrency(display.amount)}`}
      </p>
      {display.billing_cycle === 'yearly' ? (
        <p className="text-xs text-muted">월 환산 {formatCurrency(Math.round(display.amount / 12))}</p>
      ) : null}
      <p className="text-xs text-muted">{billingDayLabel(display.billing_cycle, display.anchor_date)}</p>
      {display.next_payment_date ? (
        <p className="text-xs text-muted">다음 결제 예정일 {formatLongDate(display.next_payment_date)}</p>
      ) : null}
      {display.account_id ? (
        <p className="truncate text-xs text-muted">계정 {display.account_id}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={registered}
          onClick={onRegister}
          className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {registered ? '등록됨' : '등록'}
        </button>
        <button type="button" onClick={onEdit} className="text-xs font-semibold text-muted hover:text-text">
          {editedViaModal ? '구독 수정' : '수정'}
        </button>
        {registered ? null : (
          <button type="button" onClick={onDismiss} className="text-xs font-semibold text-muted hover:text-text">
            대화 이어가기
          </button>
        )}
      </div>
    </div>
  );
}
