import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { WidgetCard } from '@/components/WidgetCard';
import { applyCategoryChipOrder, movableCategoryIds, moveCategoryIdTo } from '@/lib/category-order';
import { getVisibleCategories, isEtcCategory } from '@/lib/categories';
import type { Category } from '@/types';

type CategoryOrderWidgetProps = {
  categories: Category[];
  chipOrderIds: string[] | null;
  saving?: boolean;
  onReorder: (ids: string[]) => void;
};

type DragState = {
  id: string;
  from: number;
  over: number;
  originY: number;
  currentY: number;
  height: number;
};

function shiftY(index: number, drag: DragState | null): number {
  if (!drag) return 0;
  if (index === drag.from) return drag.currentY - drag.originY;
  if (drag.from < drag.over && index > drag.from && index <= drag.over) return -drag.height;
  if (drag.from > drag.over && index >= drag.over && index < drag.from) return drag.height;
  return 0;
}

export function CategoryOrderWidget({
  categories,
  chipOrderIds,
  saving = false,
  onReorder,
}: CategoryOrderWidgetProps) {
  const ordered = applyCategoryChipOrder(getVisibleCategories(categories), chipOrderIds, 'web');
  const movable = ordered.filter((item) => !isEtcCategory(item));
  const etc = ordered.filter((item) => isEtcCategory(item));
  const movableIds = movableCategoryIds(ordered);

  const listRef = useRef<HTMLUListElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  function setDragState(next: DragState | null) {
    dragRef.current = next;
    setDrag(next);
  }

  useEffect(() => {
    if (!editing) setDragState(null);
  }, [editing]);

  function rowHeight(): number {
    const first = listRef.current?.querySelector('[data-order-row]') as HTMLElement | null;
    return first?.offsetHeight ?? 52;
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: string, from: number) {
    if (!editing || saving) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      id,
      from,
      over: from,
      originY: event.clientY,
      currentY: event.clientY,
      height: rowHeight(),
    });
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientY - current.originY;
    const over = Math.max(
      0,
      Math.min(movable.length - 1, current.from + Math.round(delta / current.height))
    );
    setDragState({ ...current, currentY: event.clientY, over });
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const next = moveCategoryIdTo(movableIds, current.from, current.over);
    setDragState(null);
    if (next && next !== movableIds) onReorder(next);
  }

  return (
    <WidgetCard
      title="카테고리 순서"
      className="md:col-span-2 xl:col-span-3"
      actions={
        <button
          type="button"
          onClick={() => setEditing((prev) => !prev)}
          aria-pressed={editing}
          aria-label={editing ? '카테고리 순서 잠그기' : '카테고리 순서 잠금 해제'}
          className={`flex size-9 items-center justify-center rounded-full border ${
            editing
              ? 'border-primary bg-accent text-primary'
              : 'border-border bg-background text-muted hover:text-text'
          }`}
        >
          {editing ? <UnlockIcon /> : <LockIcon />}
        </button>
      }
    >
      <p className="mb-4 text-sm text-muted">
        {editing
          ? '핸들을 드래그해 순서를 바꾸세요. 끝나면 자물쇠로 잠가 주세요. 기타는 맨 뒤에 고정됩니다.'
          : '순서가 잠겨 있습니다. 바꾸려면 오른쪽 자물쇠를 누르세요. 전체는 맨 앞, 기타는 맨 뒤에 고정됩니다.'}
      </p>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted">표시할 카테고리가 없습니다.</p>
      ) : (
        <ul
          ref={listRef}
          className={`flex flex-col overflow-hidden rounded-xl border border-border ${
            editing ? 'select-none' : ''
          }`}
        >
          {movable.map((category, index) => {
            const dragging = drag?.id === category.id;
            const y = shiftY(index, drag);
            return (
              <li
                key={category.id}
                data-order-row=""
                className={`relative flex items-center gap-3 border-b border-border bg-surface px-3 py-2.5 ${
                  dragging ? 'z-10 shadow-lg ring-1 ring-primary/30' : 'z-0'
                }`}
                style={{
                  transform: `translateY(${y}px)${dragging ? ' scale(1.01)' : ''}`,
                  transition: dragging ? 'box-shadow 160ms ease, transform 0ms' : 'transform 180ms ease',
                }}
              >
                {editing ? (
                  <button
                    type="button"
                    aria-label={`${category.name} 순서 옮기기`}
                    disabled={saving}
                    onPointerDown={(event) => beginDrag(event, category.id, index)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-background hover:text-text active:cursor-grabbing disabled:opacity-40"
                  >
                    <GripIcon />
                  </button>
                ) : null}
                <span className="size-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                <p className="min-w-0 flex-1 text-sm font-semibold text-text">{category.name}</p>
              </li>
            );
          })}
          {etc.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-3 bg-background px-3 py-2.5"
            >
              {editing ? (
                <span className="flex size-8 shrink-0 items-center justify-center text-muted/40">
                  <LockIcon />
                </span>
              ) : null}
              <span className="size-2.5 rounded-full" style={{ backgroundColor: category.color }} />
              <p className="min-w-0 flex-1 text-sm font-semibold text-muted">{category.name}</p>
              <span className="text-xs font-bold text-muted">고정</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="8" cy="6" r="1.6" />
      <circle cx="16" cy="6" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <circle cx="16" cy="12" r="1.6" />
      <circle cx="8" cy="18" r="1.6" />
      <circle cx="16" cy="18" r="1.6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
