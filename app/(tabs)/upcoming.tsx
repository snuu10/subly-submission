import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { SubscriptionRow } from '@/components/SubscriptionRow';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import {
  formatCurrency,
  getDaysUntil,
  getUpcomingSubscriptions,
  useSubscriptionStore,
} from '@/stores/subscription-store';
import type { Subscription } from '@/types/subscription';

type Section = {
  label: string;
  items: Subscription[];
};

export default function UpcomingScreen() {
  const colors = useThemeColors();
  const { openEdit } = useSubscriptionModal();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const upcoming30 = getUpcomingSubscriptions(subscriptions, 30);

  const sections = useMemo<Section[]>(() => {
    const thisWeek = upcoming30.filter((item) => getDaysUntil(item.next_payment_date) <= 7);
    const nextWeek = upcoming30.filter((item) => {
      const days = getDaysUntil(item.next_payment_date);
      return days > 7 && days <= 14;
    });
    const later = upcoming30.filter((item) => getDaysUntil(item.next_payment_date) > 14);

    return [
      { label: '이번 주', items: thisWeek },
      { label: '다음 주', items: nextWeek },
      { label: '이후 30일', items: later },
    ].filter((section) => section.items.length > 0);
  }, [upcoming30]);

  const totalAmount = upcoming30.reduce((sum, item) => sum + item.amount, 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {upcoming30.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🎉</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>30일 이내 결제 없음</Text>
            <Text style={[styles.emptyHint, { color: colors.muted }]}>
              모든 구독이 잘 관리되고 있어요!
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.summary, { backgroundColor: colors.amberBg, borderColor: colors.amber }]}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.amberBg }]}>
                <Text style={styles.summaryEmoji}>📅</Text>
              </View>
              <View style={styles.summaryMain}>
                <Text style={[styles.summaryLabel, { color: colors.amber }]}>30일 내 총 결제 예정</Text>
                <Text style={[styles.summaryAmount, { color: colors.amber }]}>
                  {formatCurrency(totalAmount)}
                </Text>
              </View>
              <View style={styles.summaryCount}>
                <Text style={[styles.summaryCountValue, { color: colors.amber }]}>
                  {upcoming30.length}
                </Text>
                <Text style={[styles.summaryCountLabel, { color: colors.amber }]}>건</Text>
              </View>
            </View>

            {sections.map((section) => (
              <View key={section.label} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.muted }]}>{section.label}</Text>
                  <View style={[styles.sectionLine, { backgroundColor: colors.border }]} />
                </View>
                <View style={styles.list}>
                  {section.items.map((item) => (
                    <SubscriptionRow
                      key={item.id}
                      subscription={item}
                      variant="upcoming"
                      onPress={() => openEdit(item.id)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 32,
    gap: 24,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 64,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  emptyHint: {
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  summary: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryEmoji: {
    fontSize: 24,
  },
  summaryMain: {
    flex: 1,
    gap: 2,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  summaryAmount: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: fonts.monoBold,
  },
  summaryCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  summaryCountValue: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
    fontFamily: fonts.sansExtraBold,
  },
  summaryCountLabel: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 24,
    fontFamily: fonts.sansMedium,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    fontFamily: fonts.sansExtraBold,
    textTransform: 'uppercase',
  },
  sectionLine: {
    flex: 1,
    height: 1,
  },
  list: {
    gap: 8,
  },
});
