import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Settings } from 'lucide-react';

import type { Announcement } from '@/lib/announcements';
import { groupNotifications, type AppNotification } from '@/lib/notifications';

type HeaderIconButtonProps = {
  label: string;
  badge?: number;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

export function HeaderIconButton({
  label,
  badge,
  disabled = false,
  onClick,
  children,
}: HeaderIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-busy={disabled || undefined}
      className="relative flex size-9 items-center justify-center rounded-full text-muted hover:bg-accent hover:text-text disabled:cursor-wait disabled:opacity-60"
    >
      {children}
      {badge && badge > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-extrabold leading-4 text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}

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

type HeaderMenusProps = {
  notifications: AppNotification[];
  // ChatGPT 수정: 목록 페이지와 별개인 전체 미확인 수를 받는다.
  unreadCount: number;
  onSelectNotification: (item: AppNotification) => void;
  announcements: Announcement[];
  announcementUnreadCount: number;
  onSelectAnnouncement: (item: Announcement) => void;
  onViewAllAnnouncements: () => void;
  onOpenSettings: () => void;
  onMarkAllRead: () => void;
  lastUpdated: Date | null;
  refreshing?: boolean;
  onRefresh: () => void;
  onAdd: () => void;
};

export function HeaderMenus({
  notifications,
  unreadCount,
  onSelectNotification,
  announcements,
  announcementUnreadCount,
  onSelectAnnouncement,
  onViewAllAnnouncements,
  onOpenSettings,
  onMarkAllRead,
  lastUpdated,
  refreshing = false,
  onRefresh,
  onAdd,
}: HeaderMenusProps) {
  const [open, setOpen] = useState<'bell' | null>(null);
  const [feedTooltipOpen, setFeedTooltipOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const totalUnread = unreadCount + announcementUnreadCount;

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const updatedLabel = lastUpdated
    ? `최근 업데이트 ${lastUpdated.toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })}`
    : '실시간 대기';

  return (
    <div ref={rootRef} className="flex flex-1 items-center justify-around gap-1 sm:flex-none sm:justify-start">
      <p className="mr-2 hidden text-xs text-muted md:block">{updatedLabel}</p>
      <HeaderIconButton
        label={refreshing ? '새로고침 중' : '새로고침'}
        onClick={onRefresh}
        disabled={refreshing}
      >
        <span className={refreshing ? 'inline-flex animate-spin' : 'inline-flex'}>
          <RefreshIcon />
        </span>
      </HeaderIconButton>
      <HeaderIconButton
        label="추가"
        onClick={() => {
          setOpen(null);
          onAdd();
        }}
      >
        <PlusIcon />
      </HeaderIconButton>
      <div className="relative">
        <HeaderIconButton
          label={`공지사항${totalUnread > 0 ? ` (읽지 않음 ${totalUnread}개)` : ''}`}
          badge={totalUnread}
          onClick={() => {
            setFeedTooltipOpen(false);
            setOpen(open === 'bell' ? null : 'bell');
          }}
        >
          <BellIcon />
        </HeaderIconButton>
        {open === 'bell' ? (
          <div className="fixed inset-x-3 top-3 z-50 flex max-h-[calc(100dvh-1.5rem)] flex-col rounded-xl border border-border bg-surface p-3 text-sm shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:max-h-[32rem] sm:w-80">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <p className="font-semibold text-text">공지사항</p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={totalUnread === 0}
                  onClick={onMarkAllRead}
                  className="text-xs font-semibold text-primary hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
                >
                  모두 읽음으로 표시
                </button>
                <button
                  type="button"
                  aria-label="공지사항 설정"
                  onClick={() => {
                    setOpen(null);
                    onOpenSettings();
                  }}
                  className="flex size-7 items-center justify-center rounded-lg text-muted hover:bg-accent hover:text-text"
                >
                  <Settings size={16} strokeWidth={1.8} aria-hidden />
                </button>
              </div>
            </div>

            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <section className="shrink-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-muted">공지사항</p>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(null);
                      onViewAllAnnouncements();
                    }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    전체 보기 &gt;
                  </button>
                </div>
                {announcements.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">등록된 공지사항이 없어요.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-border">
                    {announcements.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(null);
                            onSelectAnnouncement(item);
                          }}
                          className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
                        >
                          <span className="mt-0.5 shrink-0 text-muted">
                            <DocumentIcon />
                          </span>
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="min-w-0 break-words text-xs font-bold text-text">{item.title}</span>
                            <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
                              {item.tag ? (
                                <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-primary">
                                  {item.tag}
                                </span>
                              ) : null}
                              <span>공지사항</span>
                              <span>|</span>
                              <span>{relativeLabel(item.published_at)}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="shrink-0 border-t border-border pt-3">
                <div className="flex items-center gap-1 text-xs font-bold text-muted">
                  데일리 피드
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      aria-label="데일리 피드 배지 기준 설명"
                      aria-expanded={feedTooltipOpen}
                      onMouseEnter={() => setFeedTooltipOpen(true)}
                      onMouseLeave={() => setFeedTooltipOpen(false)}
                      onFocus={() => setFeedTooltipOpen(true)}
                      onBlur={() => setFeedTooltipOpen(false)}
                      className="flex size-3.5 items-center justify-center rounded-full border border-border text-[9px] font-normal text-muted hover:border-primary hover:text-primary"
                    >
                      i
                    </button>
                    {feedTooltipOpen ? (
                      <div className="absolute left-full top-1/2 z-10 ml-2 w-48 -translate-y-1/2 rounded-lg bg-text px-2.5 py-2 text-[11px] font-normal leading-snug text-white shadow-lg">
                        최근 7일간의 데일리 피드 중 읽지 않은 피드를 표시합니다.
                      </div>
                    ) : null}
                  </span>
                </div>
                {notifications.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">새로운 알림이 없어요.</p>
                ) : (
                  <div className="mt-1 flex flex-col gap-3">
                    {groupNotifications(notifications).map((notifSection) => (
                      <div key={notifSection.label}>
                        <p className="text-[10px] font-bold text-muted">{notifSection.label}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {notifSection.items.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpen(null);
                                  onSelectNotification(item);
                                }}
                                className={`flex w-full flex-col items-start gap-0.5 rounded-lg border px-2 py-2 text-left hover:bg-accent ${
                                  item.read_at ? 'border-transparent' : 'border-danger'
                                }`}
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
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DocumentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 8h9M7.5 12h9M7.5 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.3-5.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 5v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
