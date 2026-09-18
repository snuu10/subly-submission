import { Pressable, StyleSheet, Text, View } from 'react-native';

import { categoryBg, useThemeColors } from '@/constants/colors';
import { CHART, sharePercent } from '@/constants/chart';
import { fonts } from '@/constants/fonts';
import { formatCurrency } from '@/stores/subscription-store';
import type { Category } from '@/types/category';

type CategoryBarChartProps = {
  data: { category: Category; amount: number }[];
  onPressCategory?: (categoryId: string) => void;
};

export function CategoryBarChart({ data, onPressCategory }: CategoryBarChartProps) {
  const colors = useThemeColors();
  const maxAmount = Math.max(...data.map((item) => item.amount), 1);
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  const topId = data[0]?.category.id;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {data.map((item) => {
        const emphasis = item.category.id === topId;
        const width = Math.max(8, (item.amount / maxAmount) * 100);
        const percent = sharePercent(item.amount, total);

        return (
          <Pressable
            key={item.category.id}
            onPress={() => onPressCategory?.(item.category.id)}
            disabled={!onPressCategory}
            style={styles.row}>
            <View style={styles.meta}>
              <Text
                style={[
                  styles.name,
                  { color: colors.text, fontFamily: emphasis ? fonts.sansBold : fonts.sansMedium },
                ]}
                numberOfLines={1}>
                {item.category.name}
              </Text>
              <Text style={[styles.amount, { color: colors.muted }]} numberOfLines={1}>
                {formatCurrency(item.amount)} · {percent}%
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: categoryBg(item.category.color) }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${width}%`,
                    backgroundColor: item.category.color,
                    opacity: emphasis ? CHART.barFillEmphasis : CHART.barFillOpacity,
                  },
                ]}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: CHART.cardRadius,
    borderWidth: 1,
    padding: CHART.cardPadding,
    gap: CHART.cardGap,
  },
  row: {
    gap: 8,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 13,
  },
  amount: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  track: {
    height: CHART.barHeight,
    borderRadius: CHART.barRadius,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: CHART.barRadius,
  },
});
