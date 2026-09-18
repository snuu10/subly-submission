import { useEffect } from 'react';

type DashboardWidgetRemovedToastProps = {
  widgetTitle: string;
  onClose: () => void;
};

export function DashboardWidgetRemovedToast({
  widgetTitle,
  onClose,
}: DashboardWidgetRemovedToastProps) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 6000);
    return () => window.clearTimeout(timeout);
  }, [onClose, widgetTitle]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed left-1/2 top-4 z-[70] flex w-[calc(100%-2rem)] max-w-[770px] -translate-x-1/2 items-start gap-4 rounded-lg bg-[#DF3F49] px-5 py-5 text-white shadow-[0_12px_35px_rgba(124,22,28,0.28)] sm:px-8"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/65 text-base font-black text-[#DF3F49]">
        !
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-extrabold leading-7">위젯 삭제</p>
        <p className="mt-0.5 break-keep text-base font-semibold leading-7">
          [{widgetTitle}] 위젯이 삭제되었습니다.
          <br />
          [+ 위젯 추가] 버튼을 클릭해 위젯을 다시 추가하실 수 있습니다.
        </p>
      </div>
      <button
        type="button"
        aria-label="위젯 삭제 알림 닫기"
        onClick={onClose}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
