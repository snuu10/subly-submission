import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { AddMethodSheet } from '@/components/AddMethodSheet';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { SubscriptionModalProvider } from '@/contexts/SubscriptionModalContext';
import { useColorScheme } from '@/components/useColorScheme';
import { confirmAction } from '@/lib/confirm';
import {
  attachNotificationResponseListener,
  registerForPushNotifications,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { useCategoryStore } from '@/stores/category-store';
import { useNotificationStore } from '@/stores/notification-store';
import { useNotificationPreferencesStore } from '@/stores/notification-preferences-store';
import { usePaymentInstrumentStore } from '@/stores/payment-instrument-store';
import { useSubscriptionStore } from '@/stores/subscription-store';

const NOTIFICATION_PROMPT_KEY_PREFIX = 'subly.notificationPromptShown.';

async function maybePromptForNotifications(userId: string) {
  if (Platform.OS === 'web') return;

  const status = await Notifications.getPermissionsAsync();
  if (status.status === 'granted') {
    // 이미 허용된 기기라면 다시 묻지 않고 토큰만 최신 상태로 갱신한다(재로그인 등).
    void registerForPushNotifications();
    return;
  }
  if (!status.canAskAgain) return;

  const key = `${NOTIFICATION_PROMPT_KEY_PREFIX}${userId}`;
  const alreadyShown = await AsyncStorage.getItem(key);
  if (alreadyShown) return;
  await AsyncStorage.setItem(key, '1');

  const accepted = await confirmAction({
    title: '결제일 알림',
    message: '구독 결제 3일 전, 1일 전에 알려드릴까요?',
    confirmLabel: '알림 받기',
    cancelLabel: '나중에',
  });
  if (accepted) void registerForPushNotifications();
}

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Pretendard: require('../assets/fonts/Pretendard-Regular.otf'),
    PretendardMedium: require('../assets/fonts/Pretendard-Medium.otf'),
    PretendardBold: require('../assets/fonts/Pretendard-Bold.otf'),
    PretendardExtraBold: require('../assets/fonts/Pretendard-ExtraBold.otf'),
    SUIT: require('../assets/fonts/SUIT-Regular.otf'),
    SUITBold: require('../assets/fonts/SUIT-Bold.otf'),
  });
  const authInitialized = useAuthStore((state) => state.initialized);

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    const { setSession, setInitialized } = useAuthStore.getState();

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setInitialized(true);
      })
      .catch(() => {
        setInitialized(true);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      useAuthStore.getState().setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loaded && authInitialized) {
      SplashScreen.hideAsync();
    }
  }, [loaded, authInitialized]);

  if (!loaded || !authInitialized) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const session = useAuthStore((state) => state.session);
  const userId = session?.user?.id ?? null;

  // 세션이 생기는 모든 경로(로그인·가입 직후·토큰 복원)를 이 effect가 커버한다.
  // fetchCategories가 시딩 RPC를 먼저 호출하므로 갓 가입한 유저도 빈 목록을 보지 않는다.
  // 웹 OCR·대시보드에서 넣은 구독은 같은 subscriptions 테이블이므로 realtime으로 앱에도 반영한다.
  useEffect(() => {
    useCategoryStore.getState().fetchCategories();
    useSubscriptionStore.getState().fetchSubscriptions();
    usePaymentInstrumentStore.getState().fetchInstruments();
    useNotificationStore.getState().fetchNotifications();
    if (!userId) return;

    // ChatGPT 수정: 알림을 끈 사용자는 로그인할 때 권한 팝업을 다시 띄우지 않는다.
    void useNotificationPreferencesStore.getState().fetchPreferences().then(() => {
      const preferences = useNotificationPreferencesStore.getState().preferences;
      if (
        preferences?.notifications_enabled !== false &&
        preferences?.payment_due_enabled !== false &&
        preferences?.push_enabled !== false
      ) {
        return maybePromptForNotifications(userId);
      }
    });

    let subTimeout: ReturnType<typeof setTimeout> | undefined;
    let catTimeout: ReturnType<typeof setTimeout> | undefined;
    let payTimeout: ReturnType<typeof setTimeout> | undefined;
    let notifTimeout: ReturnType<typeof setTimeout> | undefined;

    function debounceSubscriptions() {
      if (subTimeout) clearTimeout(subTimeout);
      subTimeout = setTimeout(() => {
        void useSubscriptionStore.getState().fetchSubscriptions();
      }, 200);
    }

    function debounceCategories() {
      if (catTimeout) clearTimeout(catTimeout);
      catTimeout = setTimeout(() => {
        void useCategoryStore.getState().fetchCategories();
      }, 200);
    }

    function debounceInstruments() {
      if (payTimeout) clearTimeout(payTimeout);
      payTimeout = setTimeout(() => {
        void usePaymentInstrumentStore.getState().fetchInstruments();
      }, 200);
    }

    function debounceNotifications() {
      if (notifTimeout) clearTimeout(notifTimeout);
      notifTimeout = setTimeout(() => {
        void useNotificationStore.getState().fetchNotifications();
      }, 200);
    }

    const channel = supabase
      .channel('app-dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, debounceSubscriptions)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, debounceCategories)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_instruments' }, debounceInstruments)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, debounceNotifications)
      // ChatGPT 수정: 재연결 중 놓친 알림과 미확인 수를 다시 조회한다.
      .subscribe((status) => { if (status === 'SUBSCRIBED') debounceNotifications(); });

    return () => {
      if (subTimeout) clearTimeout(subTimeout);
      if (catTimeout) clearTimeout(catTimeout);
      if (payTimeout) clearTimeout(payTimeout);
      if (notifTimeout) clearTimeout(notifTimeout);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    // ChatGPT 수정: 로그인 후 단일 처리기로 시작/실시간 응답을 중복 없이 소비한다.
    return attachNotificationResponseListener(userId);
  }, [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!useAuthStore.getState().session) return;
      void useCategoryStore.getState().fetchCategories();
      void useSubscriptionStore.getState().fetchSubscriptions();
      void usePaymentInstrumentStore.getState().fetchInstruments();
      void useNotificationStore.getState().fetchNotifications();
      void useNotificationPreferencesStore.getState().fetchPreferences();
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SubscriptionModalProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Protected guard={!session}>
              <Stack.Screen name="(onboarding)" />
            </Stack.Protected>
            <Stack.Protected guard={Boolean(session)}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="subscription/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="categories" options={{ headerShown: false }} />
              <Stack.Screen name="payment-methods" options={{ headerShown: false }} />
              <Stack.Screen name="usage-history" options={{ headerShown: false }} />
              <Stack.Screen name="change-password" options={{ headerShown: false }} />
              <Stack.Screen name="chat" options={{ headerShown: false }} />
              <Stack.Screen name="receipt" options={{ headerShown: false }} />
              <Stack.Screen name="notifications" options={{ headerShown: false }} />
              <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
              <Stack.Screen name="announcements" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
          <AddMethodSheet />
          <SubscriptionModal />
        </ThemeProvider>
      </SubscriptionModalProvider>
    </SafeAreaProvider>
  );
}
