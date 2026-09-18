import { kstISODate, weekEndKst, weekStartKst } from '@/lib/briefing';
import { supabase } from '@/lib/supabase';

const TABLE = 'notifications';

export type AppNotification = {
  id: string;
  subscription_id: string | null;
  kind: string;
  payment_date: string;
  reminder_offset: number;
  title: string;
  body: string;
  target_path: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationSection = { label: string; items: AppNotification[] };

/** 유튜브 앱 알림함처럼 중요/오늘/이번 주/이전으로 나눈다 — 앱(app/notifications.tsx)과 동일 기준. */
export function groupNotifications(items: AppNotification[]): NotificationSection[] {
  const today = kstISODate();
  const weekStart = weekStartKst();
  const weekEnd = weekEndKst();

  const important = items.filter((item) => item.reminder_offset === 0);
  const importantIds = new Set(important.map((item) => item.id));
  const rest = items.filter((item) => !importantIds.has(item.id));

  const todayItems = rest.filter((item) => kstISODate(new Date(item.created_at)) === today);
  const todayIds = new Set(todayItems.map((item) => item.id));

  const thisWeekItems = rest.filter((item) => {
    if (todayIds.has(item.id)) return false;
    const day = kstISODate(new Date(item.created_at));
    return day >= weekStart && day <= weekEnd;
  });
  const thisWeekIds = new Set(thisWeekItems.map((item) => item.id));

  const earlier = rest.filter((item) => !todayIds.has(item.id) && !thisWeekIds.has(item.id));

  return [
    { label: '중요', items: important },
    { label: '오늘', items: todayItems },
    { label: '이번 주', items: thisWeekItems },
    { label: '이전', items: earlier },
  ].filter((section) => section.items.length > 0);
}

// ChatGPT 수정: 최신 목록과 전체 미확인 수를 별도 조회한다.
export async function fetchNotifications(limit = 50): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return { notifications: [], unreadCount: 0 };
  const userId = auth.session.user.id;

  const [list, count] = await Promise.all([supabase
    .from(TABLE)
    .select(
      'id, subscription_id, kind, payment_date, reminder_offset, title, body, target_path, read_at, created_at'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit),
    supabase.from(TABLE).select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('read_at', null),
  ]);

  if (list.error || count.error) throw new Error((list.error ?? count.error)!.message);
  if (count.count === null) throw new Error('미확인 알림 수를 가져오지 못했습니다.');
  const { data: currentAuth } = await supabase.auth.getSession();
  if (currentAuth.session?.user.id !== userId) return { notifications: [], unreadCount: 0 };
  return { notifications: (list.data ?? []) as AppNotification[], unreadCount: count.count };
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

export function subscribeNotifications(onChange: () => void): () => void {
  const channel = supabase
    .channel('notifications-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onChange)
    // ChatGPT 수정: 재연결 시 누락된 변경을 재조회한다.
    .subscribe((status) => { if (status === 'SUBSCRIBED') onChange(); });

  return () => void supabase.removeChannel(channel);
}
