import { StyleSheet, Text, View } from 'react-native';

import { categoryBg, useThemeColors } from '@/constants/colors';
import { CHART } from '@/constants/chart';
import { fonts } from '@/constants/fonts';
import { formatCurrency } from '@/stores/subscription-store';
import type { CashflowWeek } from '@/stores/subscription-store';

type CashflowBarChartProps = {
  weeks: CashflowWeek[];
};

export function CashflowBarChart({ weeks }: CashflowBarChartProps) {
  const colors = useThemeColors();
  const maxAmount = Math.max(...weeks.map((item) => item.amount), 1);
  const hasAny = weeks.some((item) => item.amount > 0);

  if (!hasAny) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.empty, { color: colors.muted }]}>30일 안에 예정된 결제가 없어요</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {weeks.map((week) => {
        const width = week.amount > 0 ? Math.max(8, (week.amount / maxAmount) * 100) : 0;
        return (
          <View key={week.label} style={styles.row}>
            <View style={styles.meta}>
              <Text style={[styles.name, { color: colors.text }]}>{week.label}</Text>
              <Text style={[styles.amount, { color: colors.muted }]}>
                {week.amount > 0 ? formatCurrency(week.amount) : '없음'}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: categoryBg(colors.primary) }]}>
              {width > 0 ? (
                <View
                  style={[
                    styles.fill,
                    { width: `${width}%`, backgroundColor: colors.primary },
                  ]}
                />
              ) : null}
            </View>
          </View>
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
  empty: {
    fontSize: 13,
    fontFamily: fonts.sans,
    textAlign: 'center',
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
    fontSize: 13,
    fontFamily: fonts.sansMedium,
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
    opacity: CHART.barFillOpacity,
  },
});
