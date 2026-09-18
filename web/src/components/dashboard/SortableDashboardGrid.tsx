import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  DashboardDragHandleProvider,
  DashboardWidgetMenuProvider,
} from '@/components/dashboard/DashboardDragHandleContext';
import type { DashboardWidgetId } from '@/lib/dashboard-widgets';

export type SortableDashboardWidget = {
  id: DashboardWidgetId;
  title: string;
  deletable: boolean;
  content: ReactNode;
};

type SortableDashboardGridProps = {
  widgets: SortableDashboardWidget[];
  disabled?: boolean;
  onReorder: (ids: DashboardWidgetId[]) => void;
  onDelete: (id: DashboardWidgetId) => void;
};

export function SortableDashboardGrid({
  widgets,
  disabled = false,
  onReorder,
  onDelete,
}: SortableDashboardGridProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const ids = widgets.map((widget) => widget.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id as DashboardWidgetId);
    const to = ids.indexOf(over.id as DashboardWidgetId);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {widgets.map((widget) => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              disabled={disabled}
              onDelete={onDelete}
              prefersReducedMotion={prefersReducedMotion}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableWidget({
  widget,
  disabled,
  onDelete,
  prefersReducedMotion,
}: {
  widget: SortableDashboardWidget;
  disabled: boolean;
  onDelete: (id: DashboardWidgetId) => void;
  prefersReducedMotion: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled,
    transition: prefersReducedMotion
      ? null
      : { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  });
  const style = {
    // 카드 높이가 달라도 드래그 중 크기는 유지하고 위치만 보간한다.
    transform: CSS.Translate.toString(transform),
    transition,
    willChange: isDragging ? 'transform' : undefined,
  };
  const handle = (
    <button
      type="button"
      aria-label={`${widget.title} 위젯 순서 옮기기`}
      title={`${widget.title} 위젯 순서 옮기기`}
      disabled={disabled}
      className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing disabled:cursor-wait disabled:opacity-45"
      {...attributes}
      {...listeners}
    >
      <GripIcon />
    </button>
  );
  const widgetMenu = widget.deletable ? (
    <DashboardWidgetMenu
      title={widget.title}
      disabled={disabled}
      onDelete={() => onDelete(widget.id)}
    />
  ) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-dashboard-widget={widget.id}
      className={`h-[360px] min-w-0 self-start ${isDragging ? 'z-10 opacity-95' : 'z-0'}`}
    >
      <DashboardDragHandleProvider value={handle}>
        <DashboardWidgetMenuProvider value={widgetMenu}>
          {widget.content}
        </DashboardWidgetMenuProvider>
      </DashboardDragHandleProvider>
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function DashboardWidgetMenu({
  title,
  disabled,
  onDelete,
}: {
  title: string;
  disabled: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${title} 위젯 메뉴`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-45"
      >
        <MoreIcon />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={`${title} 위젯 메뉴`}
          className="absolute right-0 top-10 z-20 min-w-36 rounded-xl border border-border bg-surface p-1.5 shadow-[0_10px_30px_rgba(17,24,39,0.14)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-danger hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <TrashIcon />
            위젯 삭제
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="16" cy="6" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
      <circle cx="8" cy="18" r="1.5" />
      <circle cx="16" cy="18" r="1.5" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
