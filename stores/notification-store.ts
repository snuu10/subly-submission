import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

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

// ChatGPT 수정: 목록(최대 50개)과 전체 미확인 수를 분리하고 오래된 요청의 덮어쓰기를 방지한다.
let requestVersion = 0;
let badgeQueue = Promise.resolve();
const currentUserId = () => useAuthStore.getState().session?.user.id ?? null;
function syncBadge(unreadCount: number) {
  if (Platform.OS === 'web') return;
  badgeQueue = badgeQueue.then(async () => {
    await Notifications.setBadgeCountAsync(unreadCount);
  }).catch(() => undefined);
}

type NotificationState = {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  fetchNotifications: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [], unreadCount: 0, loading: false, error: null,

  fetchNotifications: async () => {
    const version = ++requestVersion;
    const userId = currentUserId();
    if (!userId) {
      set({ notifications: [], unreadCount: 0, loading: false, error: null });
      syncBadge(0);
      return;
    }
    set({ loading: get().notifications.length === 0, error: null });
    try {
      const [list, count] = await Promise.all([
        supabase.from(TABLE)
          .select('id, subscription_id, kind, payment_date, reminder_offset, title, body, target_path, read_at, created_at')
          .eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
        supabase.from(TABLE).select('id', { count: 'exact', head: true })
          .eq('user_id', userId).is('read_at', null),
      ]);
      if (version !== requestVersion || currentUserId() !== userId) return;
      if (list.error || count.error) throw new Error((list.error ?? count.error)!.message);
      if (count.count === null) throw new Error('미확인 알림 수를 가져오지 못했습니다.');
      set({ notifications: (list.data ?? []) as AppNotification[], unreadCount: count.count, loading: false });
      syncBadge(count.count);
    } catch (error) {
      if (version === requestVersion && currentUserId() === userId) {
        set({ loading: false, error: error instanceof Error ? error.message : '알림 조회 실패' });
      }
    }
  },

  // ChatGPT 수정: 목록 밖의 알림도 읽음 처리하며, DB 성공 후 전체 수를 다시 조회한다.
  markRead: async (id) => {
    const userId = currentUserId();
    if (!userId) return;
    ++requestVersion;
    const { error } = await supabase.from(TABLE).update({ read_at: new Date().toISOString() })
      .eq('user_id', userId).eq('id', id).is('read_at', null);
    if (currentUserId() !== userId) return;
    if (error) {
      set({ error: error.message, loading: false });
      throw new Error(error.message);
    }
    await get().fetchNotifications();
  },

  markAllRead: async () => {
    const userId = currentUserId();
    if (!userId) return;
    ++requestVersion;
    const { error } = await supabase.from(TABLE).update({ read_at: new Date().toISOString() })
      .eq('user_id', userId).is('read_at', null);
    if (currentUserId() !== userId) return;
    if (error) {
      set({ error: error.message, loading: false });
      throw new Error(error.message);
    }
    await get().fetchNotifications();
  },

  // 낙관적으로 먼저 지우고, 실패하면 재조회로 되돌린다.
  deleteNotification: async (id) => {
    const userId = currentUserId();
    if (!userId) return;
    const previous = get().notifications;
    set({ notifications: previous.filter((item) => item.id !== id) });
    ++requestVersion;
    const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).eq('id', id);
    if (currentUserId() !== userId) return;
    if (error) {
      set({ notifications: previous, error: error.message });
      throw new Error(error.message);
    }
    await get().fetchNotifications();
  },
}));

// ChatGPT 수정: 계정 전환 즉시 이전 계정의 목록/배지를 지운다.
useAuthStore.subscribe((state, previous) => {
  if (state.session?.user.id === previous.session?.user.id) return;
  ++requestVersion;
  useNotificationStore.setState({ notifications: [], unreadCount: 0, loading: false, error: null });
  syncBadge(0);
});

export function subscribeNotifications(onChange: () => void): () => void {
  const channel = supabase.channel('notifications-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onChange)
    .subscribe((status) => { if (status === 'SUBSCRIBED') onChange(); });
  return () => void supabase.removeChannel(channel);
}
