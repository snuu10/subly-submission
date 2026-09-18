import { formatCurrency } from '@/lib/calc';
import { USAGE_CHECKIN_LABEL } from '@/lib/usage-checkin';
import type { UsageCheckinResponse } from '@/types/briefing-event';
import type { Subscription } from '@/types';

type UsageCheckinCardProps = {
  subscription: Subscription;
  response: UsageCheckinResponse;
  confirmed?: boolean;
  saving?: boolean;
  onConfirm: () => void;
  onSkip: () => void;
};

export function UsageCheckinCard({
  subscription,
  response,
  confirmed,
  saving,
  onConfirm,
  onSkip,
}: UsageCheckinCardProps) {
  return (
    <div className="w-[260px] rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-text">{subscription.name}</p>
        <p className="text-sm font-bold tabular-nums">{formatCurrency(subscription.amount)}</p>
      </div>
      <p className="mt-2 text-xs text-muted">{USAGE_CHECKIN_LABEL[response]}로 기록할까요?</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={confirmed || saving}
          onClick={onConfirm}
          className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {confirmed ? '저장됨' : '맞아요, 저장하기'}
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
