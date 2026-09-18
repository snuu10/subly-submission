import { formatCurrency, formatShortDate } from '@/lib/calc';
import { findCategory } from '@/lib/categories';
import { withInferredCategory } from '@/lib/extract';
import type { Category } from '@/types';
import type { ClaudeManageAction, ParsedSubscription } from '@/types/extract';

const ACTION_LABEL: Record<ClaudeManageAction, { confirm: string; done: string }> = {
  update: { confirm: '변경하기', done: '변경됨' },
  delete: { confirm: '삭제하기', done: '삭제됨' },
  pause: { confirm: '일시정지', done: '일시정지됨' },
  resume: { confirm: '다시 시작', done: '다시 시작됨' },
};

const CYCLE: Record<string, string> = { monthly: '매월', yearly: '매년', one_time: '일회성' };

type ChatActionCardProps = {
  action: ClaudeManageAction;
  parsed: ParsedSubscription;
  categories: Category[];
  previousAmount?: number;
  confirmed?: boolean;
  expired?: boolean;
  onConfirm: () => void;
  onSkip: () => void;
};

export function ChatActionCard({
  action,
  parsed,
  categories,
  previousAmount,
  confirmed,
  expired,
  onConfirm,
  onSkip,
}: ChatActionCardProps) {
  if (!parsed) return null;
  const display = withInferredCategory(parsed, categories);
  const category = findCategory(categories, display.category_id);
  const labels = ACTION_LABEL[action];

  return (
    <div className="w-[260px] rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-text">{display.name}</p>
        <p className="text-sm font-bold tabular-nums">
          {action === 'update' && previousAmount != null && previousAmount !== display.amount
            ? `${formatCurrency(previousAmount)} → ${formatCurrency(display.amount)}`
            : formatCurrency(display.amount)}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted">결제일 {formatShortDate(display.anchor_date)}</p>
      {display.account_id ? (
        <p className="truncate text-xs text-muted">계정 {display.account_id}</p>
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={confirmed || expired}
          onClick={onConfirm}
          className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {expired ? '만료됨' : confirmed ? labels.done : labels.confirm}
        </button>
        {confirmed ? null : (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-semibold text-muted hover:text-text"
          >
            대화 이어가기
          </button>
        )}
      </div>
    </div>
  );
}
