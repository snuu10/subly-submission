import { StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';
import { CHART } from '@/constants/chart';
import { fonts } from '@/constants/fonts';
import type { SpendInsight } from '@/stores/subscription-store';

type SpendInsightChipsProps = {
  insights: SpendInsight[];
};

export function SpendInsightChips({ insights }: SpendInsightChipsProps) {
  const colors = useThemeColors();
  if (insights.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {insights.map((item) => (
        <View
          key={item.kind}
          style={[styles.chip, { backgroundColor: colors.accent, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.primary }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: CHART.insightRadius,
    borderWidth: 1,
    paddingHorizontal: CHART.insightPadX,
    paddingVertical: CHART.insightPadY,
  },
  label: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    fontWeight: '700',
  },
});
