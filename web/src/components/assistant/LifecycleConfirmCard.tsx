import { LIFECYCLE_LABELS, type LifecycleStatus } from '@/types';

const CONFIRM_LABEL: Partial<Record<LifecycleStatus, { confirm: string; done: string }>> = {
  guide_reviewed: { confirm: '안내 확인으로 기록', done: '기록됨' },
  cancel_requested: { confirm: '해지 완료로 기록', done: '기록됨' },
  ending_scheduled: { confirm: '종료 예정으로 기록', done: '기록됨' },
  ended: { confirm: '종료 확인', done: '종료됨' },
  end_confirm_needed: { confirm: '종료 확인 필요로 기록', done: '기록됨' },
  active: { confirm: '아직 결제로 되돌리기', done: '되돌림' },
};

function asStatus(value: string): LifecycleStatus | null {
  return value in LIFECYCLE_LABELS ? (value as LifecycleStatus) : null;
}

type LifecycleConfirmCardProps = {
  name: string;
  to: string;
  serviceEndDate?: string | null;
  confirmed?: boolean;
  saving?: boolean;
  onConfirm: () => void;
  onSkip: () => void;
};

export function LifecycleConfirmCard({
  name,
  to,
  serviceEndDate,
  confirmed,
  saving,
  onConfirm,
  onSkip,
}: LifecycleConfirmCardProps) {
  const status = asStatus(to);
  const labels = status ? CONFIRM_LABEL[status] : undefined;
  const summary = status === 'cancel_requested'
    ? '실제 서비스 해지를 완료한 것으로 기록할까요? 이용 종료일까지 목록에 유지됩니다.'
    : `${status ? LIFECYCLE_LABELS[status] : to}으로 바꿀까요? 앱 목록 삭제와는 다릅니다.`;

  return (
    <div className="w-[260px] rounded-2xl border border-border bg-surface p-3">
      <p className="truncate text-sm font-bold text-text">{name}</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        {summary}
      </p>
      {serviceEndDate ? <p className="mt-1 text-xs text-muted">이용 종료일 {serviceEndDate}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={confirmed || saving || !labels}
          onClick={onConfirm}
          className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {confirmed ? labels?.done ?? '반영됨' : labels?.confirm ?? '반영하기'}
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
