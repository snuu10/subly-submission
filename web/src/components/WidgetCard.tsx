import type { ReactNode } from 'react';

import {
  useDashboardDragHandle,
  useDashboardWidgetMenu,
} from '@/components/dashboard/DashboardDragHandleContext';

type WidgetCardProps = {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function WidgetCard({ title, hint, actions, children, className = '' }: WidgetCardProps) {
  const dragHandle = useDashboardDragHandle();
  const widgetMenu = useDashboardWidgetMenu();
  const isDashboardWidget = Boolean(dragHandle);

  return (
    <section
      className={`flex min-h-[260px] flex-col rounded-2xl border border-border bg-surface p-5 ${
        isDashboardWidget ? 'h-full overflow-hidden' : ''
      } ${className}`}
    >
      <header className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {dragHandle}
          <h2 className="min-w-0 text-[15px] font-semibold text-text">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions ?? (hint ? <p className="text-xs font-medium text-muted">{hint}</p> : null)}
          {widgetMenu}
        </div>
      </header>
      <div
        className={`min-h-0 flex-1 ${
          isDashboardWidget
            ? 'dashboard-widget-scroll overflow-y-auto overscroll-contain pr-1'
            : ''
        }`}
      >
        {children}
      </div>
    </section>
  );
}
