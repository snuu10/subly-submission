import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { addMonths } from 'date-fns';

import { AppHeader } from '@/components/AppHeader';
import { AiBriefingCard } from '@/components/AiBriefingCard';
import { CategoryBarChart } from '@/components/CategoryBarChart';
import { GradientHeroCard } from '@/components/GradientHeroCard';
import { SpendInsightChips } from '@/components/SpendInsightChips';
import { SubscriptionRow } from '@/components/SubscriptionRow';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { useCategoryStore } from '@/stores/category-store';
import {
  getCategoryTotals,
  getCurrentMonthPaymentBreakdown,
  getMonthPaymentBreakdown,
  getMonthlyTotal,
  getSpendInsights,
  getUpcomingSubscriptions,
  useSubscriptionStore,
} from '@/stores/subscription-store';

export default function HomeScreen() {
  const colors = useThemeColors();
  const { openEdit } = useSubscriptionModal();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const categories = useCategoryStore((state) => state.categories);
  const monthlyTotal = getMonthlyTotal(subscriptions);
  const monthPayment = getCurrentMonthPaymentBreakdown(subscriptions);
  const nextMonth = addMonths(new Date(), 1);
  const nextMonthPayment = getMonthPaymentBreakdown(
    subscriptions,
    nextMonth.getFullYear(),
    nextMonth.getMonth() + 1
  );
  const upcomingSoon = getUpcomingSubscriptions(subscriptions, 7);
  const categoryData = getCategoryTotals(subscriptions, categories);
  const insights = getSpendInsights(subscriptions, categories);
  const firstFocus = useRef(true);
  const [briefingEpoch, setBriefingEpoch] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setBriefingEpoch((value) => value + 1);
    }, [])
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GradientHeroCard
          monthlyTotal={monthlyTotal}
          monthPaymentTotal={monthPayment.expectedTotal}
          nextMonthTotal={nextMonthPayment.expectedTotal}
        />

        <AiBriefingCard refreshKey={briefingEpoch} />

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>다가오는 결제</Text>
            {upcomingSoon.length > 0 ? (
              <View style={[styles.countBadge, { backgroundColor: colors.roseBg }]}>
                <Text style={[styles.countBadgeLabel, { color: colors.rose }]}>
                  7일 이내 {upcomingSoon.length}건
                </Text>
              </View>
            ) : null}
          </View>

          {upcomingSoon.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.successBg, borderColor: colors.success }]}>
              <Text style={styles.emptyEmoji}>✅</Text>
              <View>
                <Text style={[styles.emptyTitle, { color: colors.success }]}>이번 주 결제 없음</Text>
                <Text style={[styles.emptyHint, { color: colors.success }]}>
                  7일 이내 예정된 결제가 없어요
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.list}>
              {upcomingSoon.map((item) => (
                <SubscriptionRow
                  key={item.id}
                  subscription={item}
                  onPress={() => openEdit(item.id)}
                />
              ))}
            </View>
          )}
        </View>

        {categoryData.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>카테고리별 월 지출</Text>
            <CategoryBarChart
              data={categoryData}
              onPressCategory={(categoryId) =>
                router.push(`/(tabs)/subscriptions?category=${encodeURIComponent(categoryId)}` as Href)
              }
            />
            <SpendInsightChips insights={insights} />
          </View>
        ) : null}
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
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  countBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countBadgeLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 24,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  emptyHint: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: fonts.sans,
    opacity: 0.85,
  },
  list: {
    gap: 8,
  },
});
