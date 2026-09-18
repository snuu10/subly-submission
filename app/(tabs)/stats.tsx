import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';

import { AppHeader } from '@/components/AppHeader';
import { CashflowBarChart } from '@/components/CashflowBarChart';
import { CategoryDonut } from '@/components/CategoryDonut';
import { SpendInsightChips } from '@/components/SpendInsightChips';
import { useThemeColors } from '@/constants/colors';
import { CHART, sharePercent } from '@/constants/chart';
import { fonts } from '@/constants/fonts';
import { useCategoryStore } from '@/stores/category-store';
import {
  formatCurrency,
  getCategoryTotals,
  getSpendInsights,
  getThirtyDayCashflow,
  useSubscriptionStore,
} from '@/stores/subscription-store';

function openCategory(categoryId: string) {
  router.push(`/(tabs)/subscriptions?category=${encodeURIComponent(categoryId)}` as Href);
}

export default function StatsScreen() {
  const colors = useThemeColors();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const categories = useCategoryStore((state) => state.categories);
  const categoryData = getCategoryTotals(subscriptions, categories);
  const chartTotal = categoryData.reduce((sum, item) => sum + item.amount, 0);
  const insights = getSpendInsights(subscriptions, categories);
  const weeks = getThirtyDayCashflow(subscriptions);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {categoryData.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={styles.emptyEmoji}>📊</Text>
            <View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>표시할 지출이 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.muted }]}>
                활성 구독을 등록하면 카테고리 비중이 나타나요
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>카테고리별 월 지출</Text>
              <View
                style={[
                  styles.donutCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}>
                <View style={styles.donutRow}>
                  <CategoryDonut data={categoryData} total={chartTotal} />
                  <View style={styles.legend}>
                    {categoryData.map((item) => (
                      <Pressable
                        key={item.category.id}
                        onPress={() => openCategory(item.category.id)}
                        style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: item.category.color }]} />
                        <View style={styles.legendCopy}>
                          <Text style={[styles.legendName, { color: colors.text }]} numberOfLines={1}>
                            {item.category.name}
                          </Text>
                          <Text style={[styles.legendMeta, { color: colors.muted }]} numberOfLines={1}>
                            {formatCurrency(item.amount)} · {sharePercent(item.amount, chartTotal)}%
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <SpendInsightChips insights={insights} />
            </View>
          </>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>앞으로 30일 결제</Text>
          <CashflowBarChart weeks={weeks} />
        </View>
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  donutCard: {
    borderRadius: CHART.cardRadius,
    borderWidth: 1,
    padding: CHART.cardPadding,
    gap: 16,
  },
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  legend: {
    flex: 1,
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendCopy: {
    flex: 1,
    gap: 1,
  },
  legendName: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  legendMeta: {
    fontSize: 11,
    fontFamily: fonts.sans,
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
  },
});
