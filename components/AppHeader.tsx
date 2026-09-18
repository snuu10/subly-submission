import { router, type Href } from 'expo-router';
import { format } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { useNotificationStore } from '@/stores/notification-store';

export function AppHeader() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { openMethodPicker } = useSubscriptionModal();
  // ChatGPT 수정: 최신 목록 길이가 아닌 DB 전체 미확인 수를 사용한다.
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const todayLabel = format(new Date(), 'yyyy년 M월 d일');

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          paddingTop: insets.top + 12,
        },
      ]}>
      <View>
        <Text style={[styles.title, { color: colors.text }]}>구독 관리</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>{todayLabel}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push('/notifications' as Href)}
          style={styles.iconButton}
          accessibilityLabel={`알림${unreadCount > 0 ? ` (읽지 않음 ${unreadCount}개)` : ''}`}>
          <SymbolView
            name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
            tintColor={colors.muted}
            size={22}
          />
          {unreadCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.danger }]}>
              <Text style={styles.badgeLabel}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          onPress={() => router.push('/(tabs)/settings' as Href)}
          style={styles.iconButton}
          accessibilityLabel="설정">
          <SymbolView
            name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
            tintColor={colors.muted}
            size={22}
          />
        </Pressable>

        <Pressable
          onPress={openMethodPicker}
          style={[styles.addButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.addLabel, { color: colors.primaryText }]}>추가</Text>
          <SymbolView
            name={{ ios: 'plus', android: 'add', web: 'add' }}
            tintColor={colors.primaryText}
            size={16}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeLabel: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
