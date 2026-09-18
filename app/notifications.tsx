import { router, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { kstISODate, weekEndKst, weekStartKst } from '@/lib/briefing';
import { formatLongDate } from '@/stores/subscription-store';
import { useNotificationStore, type AppNotification } from '@/stores/notification-store';
// ChatGPT 수정: 화면에서도 삭제/계정 전환 후의 구독 경로를 검증한다.
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

function relativeLabel(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return formatLongDate(createdAt);
}

type Section = { label: string; items: AppNotification[] };

/** 유튜브 앱 알림함처럼 중요/오늘/이번 주/이전으로 나눈다. */
function groupNotifications(items: AppNotification[]): Section[] {
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

export default function NotificationsScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const notifications = useNotificationStore((state) => state.notifications);
  const loading = useNotificationStore((state) => state.loading);
  const error = useNotificationStore((state) => state.error);
  const fetchNotifications = useNotificationStore((state) => state.fetchNotifications);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const deleteNotification = useNotificationStore((state) => state.deleteNotification);

  useFocusEffect(
    useCallback(() => {
      void fetchNotifications();
    }, [fetchNotifications])
  );

  // ChatGPT 수정: 전체 미확인 수는 목록의 페이지 제한과 독립적이다.
  const unreadCount = useNotificationStore((state) => state.unreadCount);

  async function handlePress(item: AppNotification) {
    // ChatGPT 수정: 실패를 숨기거나 임의 target_path/삭제된 구독 경로로 이동하지 않는다.
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;
    try {
      if (!item.read_at) await markRead(item.id);
      if (!item.subscription_id) return;
      const { data: subscription, error: queryError } = await supabase.from('subscriptions')
        .select('id').eq('id', item.subscription_id).eq('user_id', userId).maybeSingle();
      if (queryError) throw new Error(queryError.message);
      if (!subscription || useAuthStore.getState().session?.user.id !== userId) return;
      router.push(`/subscription/${subscription.id}` as Href);
    } catch {
      Alert.alert('알림', '알림을 열지 못했습니다. 다시 시도해주세요.');
    }
  }

  // 길게 누르기 메뉴의 "읽음"은 화면 이동 없이 읽음 처리만 한다 — 탭(handlePress)과는 의도가 다르다.
  async function handleMarkReadOnly(item: AppNotification) {
    if (item.read_at) return;
    try {
      await markRead(item.id);
    } catch {
      Alert.alert('알림', '읽음 처리에 실패했습니다. 다시 시도해주세요.');
    }
  }

  async function handleDelete(item: AppNotification) {
    try {
      await deleteNotification(item.id);
    } catch {
      Alert.alert('알림', '삭제하지 못했습니다. 다시 시도해주세요.');
    }
  }

  function handleLongPress(item: AppNotification) {
    Alert.alert(item.title, undefined, [
      { text: '읽음', onPress: () => void handleMarkReadOnly(item) },
      { text: '삭제', style: 'destructive', onPress: () => void handleDelete(item) },
      { text: '취소', style: 'cancel' },
    ]);
  }

  const sections = useMemo(() => groupNotifications(notifications), [notifications]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>알림</Text>
        {/* ChatGPT 수정: 읽음 처리 실패를 사용자에게 알린다. */}
        {unreadCount > 0 ? (
          <Pressable onPress={() => void markAllRead().catch(() => Alert.alert('알림', '읽음 처리에 실패했습니다. 다시 시도해주세요.'))} style={styles.markAllButton}>
            <Text style={[styles.markAllLabel, { color: colors.primary }]}>모두 읽음</Text>
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}>
        {/* ChatGPT 수정: 집계/목록 조회 실패를 빈 알림함으로 오인하지 않게 표시한다. */}
        {error ? <Text style={[styles.empty, { color: colors.danger }]}>{error}</Text> : null}
        {!loading && notifications.length === 0 ? (
          <Text style={[styles.empty, { color: colors.muted }]}>새로운 알림이 없어요</Text>
        ) : (
          sections.map((section) => (
            <View key={section.label} style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.muted }]}>{section.label}</Text>
              {section.items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => void handlePress(item)}
                  onLongPress={() => handleLongPress(item)}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surface,
                      borderColor: item.read_at ? colors.border : colors.danger,
                      borderWidth: item.read_at ? 1 : 2,
                    },
                  ]}>
                  <View style={styles.cardTop}>
                    {!item.read_at ? (
                      <View style={[styles.unreadDot, { backgroundColor: colors.danger }]} />
                    ) : null}
                    <Text
                      style={[
                        styles.title,
                        { color: colors.text },
                        item.read_at ? styles.titleRead : null,
                      ]}
                      numberOfLines={1}>
                      {item.title}
                    </Text>
                  </View>
                  <Text style={[styles.body, { color: colors.muted }]} numberOfLines={2}>
                    {item.body}
                  </Text>
                  <Text style={[styles.time, { color: colors.muted }]}>{relativeLabel(item.created_at)}</Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  markAllButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  markAllLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 18,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  empty: {
    marginTop: 48,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: fonts.sansMedium,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    flexShrink: 1,
  },
  titleRead: {
    fontWeight: '600',
  },
  body: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  time: {
    fontSize: 11,
    marginTop: 2,
  },
});
