import { useState } from 'react';

import { formatShortDate } from '@/lib/calc';
import { advanceSubscriptionLifecycle, isoDateFromText } from '@/lib/lifecycle';
import type { CancelGuideResponse } from '@/types/cancel-guide';
import type { LifecycleStatus } from '@/types';

type CancelGuideCardProps = {
  guide: CancelGuideResponse;
  subscriptionId?: string | null;
  lifecycleStatus?: LifecycleStatus | null;
  nextPaymentDate?: string | null;
  onChanged?: () => Promise<void> | void;
  onDeleteFromList?: (subscriptionId: string) => void;
};

export function CancelGuideCard({
  guide,
  subscriptionId,
  lifecycleStatus,
  nextPaymentDate,
  onChanged,
  onDeleteFromList,
}: CancelGuideCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notFound = guide.status === 'not_found';
  const statusLabel =
    guide.status === 'verified' ? '검수된 안내' : guide.search_failed ? '검색 실패' : '임시 안내';
  const status = lifecycleStatus ?? 'active';
  const endDate = isoDateFromText(guide.cancellation_effective_at) ?? nextPaymentDate ?? null;

  async function advance(to: LifecycleStatus) {
    if (!subscriptionId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await advanceSubscriptionLifecycle(
        subscriptionId,
        to,
        to === 'cancel_requested' ? endDate : null,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '해지 상태를 바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-[280px] rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-text">{guide.service_name ?? '구독 해지'}</p>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-primary">{statusLabel}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        이 안내는 웹 결제 기준이에요. 앱스토어·플레이스토어·통신사로 결제했다면 해당 앱이나
        고객센터에서 확인해 주세요.
      </p>
      <p className="text-xs text-muted">정보 기준 {formatShortDate(guide.fetched_at.slice(0, 10))}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-text">
        {guide.steps.map((step) => (
          <li key={step.order}>{step.description}</li>
        ))}
      </ol>
      {guide.refund_policy ? <p className="mt-2 text-xs text-text">환불 {guide.refund_policy}</p> : null}
      {guide.warnings.map((warning) => (
        <p key={warning} className="mt-1 text-xs text-amber">
          {warning}
        </p>
      ))}
      {guide.official_support_url ? (
        <a
          href={guide.official_support_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-semibold text-primary"
        >
          공식 고객센터 열기
        </a>
      ) : null}
      <p className="mt-2 text-[11px] text-muted">{guide.disclaimer}</p>
      {notFound && subscriptionId && onDeleteFromList ? (
        <div className="mt-3">
          <p className="text-xs text-muted">
            공식 해지 방법을 못 찾았어요. 실제 해지는 서비스에서 직접 해주셔야 해요 — 일단
            목록에서만 지워드릴까요?
          </p>
          <button
            type="button"
            onClick={() => onDeleteFromList(subscriptionId)}
            className="mt-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white"
          >
            목록에서 삭제
          </button>
        </div>
      ) : null}
      {!notFound && subscriptionId && status !== 'ended' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === 'active' || status === 'guide_reviewed' ? (
            <>
              {status === 'active' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void advance('guide_reviewed')}
                  className="rounded-xl bg-accent px-3 py-2 text-xs font-bold text-primary disabled:opacity-50"
                >
                  안내 확인
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void advance('cancel_requested')}
                className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                해지 신청함
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void advance('ended')}
                className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                종료 확인
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void advance('active')}
                className="rounded-xl bg-accent px-3 py-2 text-xs font-bold text-primary disabled:opacity-50"
              >
                아직 결제됨
              </button>
            </>
          )}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-amber">{error}</p> : null}
    </div>
  );
}
