import { useEffect, useRef, useState } from 'react';

import {
  DASHBOARD_WIDGETS,
  DELETABLE_DASHBOARD_WIDGET_IDS,
  type DashboardWidgetId,
} from '@/lib/dashboard-widgets';

type DashboardWidgetManagerProps = {
  open: boolean;
  hiddenIds: DashboardWidgetId[];
  saving?: boolean;
  onClose: () => void;
  onApply: (hiddenIds: DashboardWidgetId[]) => void;
};

export function DashboardWidgetManager({
  open,
  hiddenIds,
  saving = false,
  onClose,
  onApply,
}: DashboardWidgetManagerProps) {
  const [draftHiddenIds, setDraftHiddenIds] = useState(hiddenIds);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraftHiddenIds(hiddenIds);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
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
  }, [hiddenIds, onClose, open, saving]);

  if (!open) return null;
  const hidden = new Set(draftHiddenIds);
  const optionalWidgets = DASHBOARD_WIDGETS.filter((widget) =>
    DELETABLE_DASHBOARD_WIDGET_IDS.includes(widget.id)
  );
  const shownCount = optionalWidgets.length - hidden.size;

  function toggle(id: DashboardWidgetId) {
    setDraftHiddenIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="위젯 추가 닫기"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-manager-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[430px] flex-col bg-surface shadow-[-12px_0_36px_rgba(17,24,39,0.14)]"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-5 sm:px-6">
          <div>
            <h2 id="widget-manager-title" className="text-lg font-extrabold text-text">
              위젯 추가
            </h2>
            <p className="mt-1 text-xs font-medium text-muted">대시보드에 표시할 위젯을 선택하세요.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="닫기"
            disabled={saving}
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-xl text-muted hover:bg-background hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-45"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 sm:px-6">
          <p className="py-3 text-xs font-bold text-muted">현재 {shownCount}개 추가됨</p>
          <ul className="divide-y divide-border border-y border-border">
            {optionalWidgets.map((widget) => {
              const checked = !hidden.has(widget.id);
              return (
                <li key={widget.id}>
                  <label className="flex cursor-pointer items-start gap-3 py-4">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={() => toggle(widget.id)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-text">{widget.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted">
                        {widget.description}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-45"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onApply(draftHiddenIds)}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-[#4338CA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-55"
          >
            {saving ? '저장 중…' : '확인'}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
