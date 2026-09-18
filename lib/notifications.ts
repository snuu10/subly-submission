/**
 * 결제일 D-3 / D-1 푸시 알림.
 * 알림 생성·발송은 서버(Edge Function + Cron)가 담당하고, 이 파일은
 * 권한 요청, Expo Push 토큰 등록/해제, 수신·클릭 처리만 다룬다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
// ChatGPT 수정: 세션 확인과 읽음 처리를 알림 탭 처리에 연결한다.
import { useAuthStore } from '@/stores/auth-store';
import { useNotificationStore } from '@/stores/notification-store';

const DEVICE_TOKEN_KEY = 'subly.notificationDeviceToken';
// ChatGPT 수정: Android 채널은 생성 후 소리 설정을 바꿀 수 없어 일반/무음 ID를 분리한다.
export const PAYMENT_REMINDER_CHANNEL_ID = 'payment-reminders-v2';
export const PAYMENT_REMINDER_SILENT_CHANNEL_ID = 'payment-reminders-silent-v1';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowAlert: true,
    shouldPlaySound: notification.request.content.data?.silent !== true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PAYMENT_REMINDER_CHANNEL_ID, {
    name: '결제 예정 알림',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4F46E5',
  });
  await Notifications.setNotificationChannelAsync(PAYMENT_REMINDER_SILENT_CHANNEL_ID, {
    name: '결제 예정 알림 (매너모드)',
    description: '설정한 매너모드 시간에는 소리와 진동 없이 표시됩니다.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    enableVibrate: false,
    vibrationPattern: null,
    lightColor: '#4F46E5',
  });
}

export async function getNotificationPermissionStatus(): Promise<Notifications.PermissionStatus | 'unsupported'> {
  if (Platform.OS === 'web') return 'unsupported';
  return (await Notifications.getPermissionsAsync()).status;
}

export async function isCurrentDevicePushEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const token = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) return false;
  const { data, error } = await supabase.rpc('is_notification_device_enabled', {
    p_expo_push_token: token,
  });
  // ChatGPT 수정: 마이그레이션 배포 전 앱이 먼저 실행돼도 기존 등록 상태를 잃지 않는다.
  if (error) return true;
  return data === true;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  if (!current.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

async function registerDeviceOnBackend(token: string): Promise<void> {
  const { error } = await supabase.rpc('register_notification_device', {
    p_expo_push_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    p_device_key: null,
  });
  if (error) throw new Error(error.message);
}

/**
 * 권한 요청부터 서버 등록까지 한 번에 처리한다. 이미 등록된 토큰이 있어도
 * upsert이므로 다시 호출해도 안전하다(로그인 직후 재호출 용도).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  await ensureAndroidChannel();

  const granted = await requestNotificationPermissions();
  if (!granted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
  if (!projectId) {
    console.warn(
      '[notifications] EAS projectId가 없습니다. `eas init`으로 프로젝트를 연결한 뒤 다시 시도하세요.'
    );
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerDeviceOnBackend(token);
    await AsyncStorage.setItem(DEVICE_TOKEN_KEY, token);
    return token;
  } catch (err) {
    console.warn('[notifications] 푸시 토큰 등록 실패', err);
    return null;
  }
}

/** 로그아웃 또는 설정 변경 시 현재 기기의 토큰을 비활성화한다. */
export async function disableCurrentDevice(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
    if (!token) return true;
    const { error } = await supabase.rpc('disable_notification_device', { p_expo_push_token: token });
    if (error) throw new Error(error.message);
    await AsyncStorage.removeItem(DEVICE_TOKEN_KEY);
    return true;
  } catch (error) {
    // ChatGPT 수정: 서버 해제 실패 시 토큰을 보존해 설정 화면이 OFF로 오인하지 않게 한다.
    console.warn('[notifications] 현재 기기 푸시 해제 실패', error);
    return false;
  }
}

// ChatGPT 수정: 콜드 스타트와 실시간 탭을 한 큐로 처리하고 처리한 native 응답을 지운다.
const HANDLED_RESPONSE_KEY = 'subly.handledNotificationResponse';
let responseQueue = Promise.resolve();
const handledResponses = new Set<string>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachNotificationResponseListener(userId: string | null): () => void {
  if (Platform.OS === 'web' || !userId) return () => undefined;
  let active = true;
  const isCurrent = () => active && useAuthStore.getState().session?.user.id === userId;

  async function consume(response: Notifications.NotificationResponse) {
    if (!isCurrent()) return;
    const responseId = response.notification.request.identifier;
    const savedId = await AsyncStorage.getItem(HANDLED_RESPONSE_KEY);
    if (!isCurrent()) return;
    if (!handledResponses.has(responseId) && savedId !== responseId) {
      const data = response.notification.request.content.data;
      const id = data?.notificationId;
      let href: Href = '/notifications' as Href;
      // ChatGPT 수정: payload의 경로를 신뢰하지 않고 현재 계정 소유의 DB 알림을 확인한다.
      if (typeof id === 'string' && uuidPattern.test(id)) {
        const { data: notification, error } = await supabase.from('notifications')
          .select('id, subscription_id').eq('id', id).eq('user_id', userId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!isCurrent()) return;
        if (notification) {
          await useNotificationStore.getState().markRead(id);
          if (!isCurrent()) return;
          if (notification.subscription_id) {
            const { data: subscription, error: subError } = await supabase.from('subscriptions')
              .select('id').eq('id', notification.subscription_id).eq('user_id', userId).maybeSingle();
            if (subError) throw new Error(subError.message);
            if (subscription) href = `/subscription/${subscription.id}` as Href;
          }
        }
      }
      if (!isCurrent()) return;
      router.push(href);
      handledResponses.add(responseId);
      if (handledResponses.size > 100) handledResponses.delete(handledResponses.values().next().value!);
      await AsyncStorage.setItem(HANDLED_RESPONSE_KEY, responseId);
    }
    // 새로 들어온 다른 알림의 캐시까지 지우지 않는다.
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last?.notification.request.identifier === responseId) {
      await Notifications.clearLastNotificationResponseAsync();
    }
  }

  function enqueue(response: Notifications.NotificationResponse) {
    responseQueue = responseQueue.then(() => consume(response)).catch((error) => {
      console.warn('[notifications] 알림 탭 처리 실패', error);
    });
  }
  const listener = Notifications.addNotificationResponseReceivedListener(enqueue);
  const retryInitial = () => {
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && isCurrent()) enqueue(response);
    }).catch((error) => console.warn('[notifications] 초기 응답 조회 실패', error));
  };
  retryInitial();
  const foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') retryInitial();
  });
  return () => { active = false; listener.remove(); foreground.remove(); };
}
