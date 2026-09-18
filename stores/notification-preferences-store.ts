import { create } from 'zustand';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

const TABLE = 'notification_preferences';

// ChatGPT 수정: 서버 설정을 낙관적으로 반영하되 저장 실패 시 직전 값으로 되돌린다.
export type NotificationPreferences = {
  user_id: string;
  notifications_enabled: boolean;
  payment_due_enabled: boolean;
  payment_due_d3_enabled: boolean;
  payment_due_d1_enabled: boolean;
  push_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: 'Asia/Seoul';
  created_at: string;
  updated_at: string;
};

export type NotificationPreferencePatch = Partial<Pick<NotificationPreferences,
  | 'notifications_enabled'
  | 'payment_due_enabled'
  | 'payment_due_d3_enabled'
  | 'payment_due_d1_enabled'
  | 'push_enabled'
  | 'quiet_hours_enabled'
  | 'quiet_start'
  | 'quiet_end'
>>;

type State = {
  preferences: NotificationPreferences | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  fetchPreferences: () => Promise<void>;
  updatePreferences: (patch: NotificationPreferencePatch) => Promise<boolean>;
  resetPreferences: () => Promise<boolean>;
};

let requestVersion = 0;
const userId = () => useAuthStore.getState().session?.user.id ?? null;

function defaults(id: string): Omit<NotificationPreferences, 'created_at' | 'updated_at'> {
  return {
    user_id: id,
    notifications_enabled: true,
    payment_due_enabled: true,
    payment_due_d3_enabled: true,
    payment_due_d1_enabled: true,
    push_enabled: true,
    quiet_hours_enabled: false,
    quiet_start: '21:00:00',
    quiet_end: '08:00:00',
    timezone: 'Asia/Seoul',
  };
}

async function loadOrCreate(id: string): Promise<NotificationPreferences> {
  const found = await supabase.from(TABLE).select('*').eq('user_id', id).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (found.data) return found.data as NotificationPreferences;

  const inserted = await supabase.from(TABLE).insert(defaults(id)).select('*').single();
  if (!inserted.error && inserted.data) return inserted.data as NotificationPreferences;
  // 로그인 직후 여러 화면에서 동시에 만들었을 수 있으므로 중복이면 현재 행을 다시 읽는다.
  if (inserted.error?.code === '23505') {
    const retry = await supabase.from(TABLE).select('*').eq('user_id', id).single();
    if (!retry.error && retry.data) return retry.data as NotificationPreferences;
  }
  throw new Error(inserted.error?.message ?? '알림 설정을 만들지 못했습니다.');
}

export const useNotificationPreferencesStore = create<State>((set, get) => ({
  preferences: null,
  loading: false,
  saving: false,
  error: null,

  fetchPreferences: async () => {
    const id = userId();
    const version = ++requestVersion;
    if (!id) {
      set({ preferences: null, loading: false, saving: false, error: null });
      return;
    }
    set({ loading: !get().preferences, error: null });
    try {
      const preferences = await loadOrCreate(id);
      if (version !== requestVersion || userId() !== id) return;
      set({ preferences, loading: false, error: null });
    } catch (error) {
      if (version === requestVersion && userId() === id) {
        set({ loading: false, error: error instanceof Error ? error.message : '알림 설정 조회 실패' });
      }
    }
  },

  updatePreferences: async (patch) => {
    const id = userId();
    if (!id) return false;
    let current = get().preferences;
    if (!current) {
      try {
        current = await loadOrCreate(id);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '알림 설정 조회 실패' });
        return false;
      }
    }
    const previous = current;
    const optimistic = { ...current, ...patch, updated_at: new Date().toISOString() };
    set({ preferences: optimistic, saving: true, error: null });
    const result = await supabase.from(TABLE).update(patch).eq('user_id', id).select('*').single();
    if (userId() !== id) return false;
    if (result.error || !result.data) {
      set({ preferences: previous, saving: false, error: result.error?.message ?? '설정을 저장하지 못했습니다.' });
      return false;
    }
    set({ preferences: result.data as NotificationPreferences, saving: false, error: null });
    return true;
  },

  resetPreferences: async () => {
    const id = userId();
    if (!id) return false;
    const { user_id: _userId, ...patch } = defaults(id);
    return get().updatePreferences(patch);
  },
}));

useAuthStore.subscribe((state, previous) => {
  if (state.session?.user.id === previous.session?.user.id) return;
  ++requestVersion;
  useNotificationPreferencesStore.setState({
    preferences: null,
    loading: false,
    saving: false,
    error: null,
  });
});
