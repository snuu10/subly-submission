import { WidgetCard } from '@/components/WidgetCard';
import type { AppNotification } from '@/lib/notifications';

type NotificationWidgetProps = {
  notifications: AppNotification[];
  onSelect: (item: AppNotification) => void;
  onMarkAllRead: () => void;
};

const VISIBLE_COUNT = 6;

function relativeLabel(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export function NotificationWidget({ notifications, onSelect, onMarkAllRead }: NotificationWidgetProps) {
  const hasUnread = notifications.some((item) => !item.read_at);
  const visible = notifications.slice(0, VISIBLE_COUNT);

  return (
    <WidgetCard
      title="알림"
      actions={
        hasUnread ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs font-semibold text-primary hover:underline"
          >
            모두 읽음
          </button>
        ) : undefined
      }
      hint={hasUnread ? undefined : '새 알림 없음'}
    >
      {visible.length === 0 ? (
        <div className="flex h-full flex-col justify-center rounded-xl bg-background px-4 py-6">
          <p className="text-sm font-semibold text-text">새로운 알림이 없어요</p>
          <p className="mt-1 text-xs text-muted">결제·해지 알림이 오면 여기 표시돼요</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-background"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {!item.read_at ? <span className="size-1.5 rounded-full bg-danger" /> : null}
                  <span
                    className={`min-w-0 break-words text-xs ${item.read_at ? 'font-medium text-muted' : 'font-bold text-text'}`}
                  >
                    {item.title}
                  </span>
                </span>
                <span className="break-words text-[11px] text-muted">{item.body}</span>
                <span className="text-[10px] text-muted">{relativeLabel(item.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
