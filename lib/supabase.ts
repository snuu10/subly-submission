import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY가 없습니다. .env.example을 참고해 .env를 설정하세요.'
  );
}

// 웹 정적 렌더링(SSR) 중에는 스토리지가 없다. 네이티브에는 window가 아예 없으므로
// window 유무로 판별하면 iOS/Android에서 세션이 저장되지 않는다.
const isServer = Platform.OS === 'web' && typeof window === 'undefined';

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(
  supabaseUrl ?? 'https://unavailable.supabase.co',
  supabaseAnonKey ?? 'public-anon-key-unavailable',
  {
    auth: {
      storage: isServer ? noopStorage : AsyncStorage,
      autoRefreshToken: !isServer,
      persistSession: !isServer,
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  }
);

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
