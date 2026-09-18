import { useEffect, useRef } from 'react';

type DashboardWidgetResetDialogProps = {
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onReset: () => void;
};

export function DashboardWidgetResetDialog({
  open,
  saving = false,
  onClose,
  onReset,
}: DashboardWidgetResetDialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose, open, saving]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-reset-title"
        aria-describedby="widget-reset-description"
        className="w-full max-w-[800px] bg-surface shadow-[0_18px_55px_rgba(17,24,39,0.24)]"
      >
        <header className="relative flex min-h-24 items-center justify-center border-b border-border px-16">
          <h2
            id="widget-reset-title"
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-2xl font-extrabold text-text"
          >
            위젯 초기화
          </h2>
          <button
            type="button"
            aria-label="위젯 초기화 닫기"
            disabled={saving}
            onClick={onClose}
            className="absolute right-5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-45"
          >
            <CloseIcon />
          </button>
        </header>

        <div id="widget-reset-description" className="px-7 py-10 text-base font-medium leading-8 text-text sm:px-10 sm:text-lg">
          <p>대시보드의 위젯과 레이아웃을 기본 상태로 초기화하시겠습니까?</p>
          <p>초기화하시면 설정하신 내용이 사라집니다.</p>
        </div>

        <footer className="flex min-h-28 items-center justify-end gap-3 border-t border-border px-7 sm:px-10">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={saving}
            onClick={onClose}
            className="min-h-12 px-4 text-base font-bold text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-45"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onReset}
            className="min-h-12 rounded-lg bg-primary px-6 text-base font-extrabold text-white hover:bg-[#4338CA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-55"
          >
            {saving ? '초기화 중…' : '초기화'}
          </button>
        </footer>
      </section>
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
