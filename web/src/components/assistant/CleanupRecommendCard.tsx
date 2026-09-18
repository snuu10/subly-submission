import { formatCurrency } from '@/lib/calc';
import type { CleanupRecommendation } from '@/types/assistant-turn';

const CONFIDENCE_LABEL = {
  high: '신뢰 높음',
  medium: '신뢰 보통',
  low: '신뢰 낮음',
} as const;

type CleanupRecommendCardProps = {
  item: CleanupRecommendation;
  onAskGuide?: () => void;
};

export function CleanupRecommendCard({ item, onAskGuide }: CleanupRecommendCardProps) {
  return (
    <div className="w-[260px] rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-text">{item.name}</p>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-primary">
          {CONFIDENCE_LABEL[item.confidence]}
        </span>
      </div>
      {item.reasons.map((reason) => (
        <p key={`${reason.code}-${reason.evidence}`} className="mt-1 text-xs leading-5 text-muted">
          {reason.evidence}
        </p>
      ))}
      <p className="mt-2 text-xs font-bold text-text">
        해지 시 월 {formatCurrency(item.monthly_save)} · 연 {formatCurrency(item.yearly_save)}
      </p>
      {onAskGuide ? (
        <button
          type="button"
          onClick={onAskGuide}
          className="mt-3 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white"
        >
          해지 방법 보기
        </button>
      ) : null}
    </div>
  );
}
