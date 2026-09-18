import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { useThemeColors } from '@/constants/colors';
import { CHART } from '@/constants/chart';
import { fonts } from '@/constants/fonts';
import { formatCurrency } from '@/stores/subscription-store';
import type { Category } from '@/types/category';

type Slice = { category: Category; amount: number };

type CategoryDonutProps = {
  data: Slice[];
  total: number;
};

export function CategoryDonut({ data, total }: CategoryDonutProps) {
  const colors = useThemeColors();
  const size = CHART.donutSize;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - CHART.donutStroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const slices = data
    .filter((item) => item.amount > 0 && total > 0)
    .map((item) => {
      const length = (item.amount / total) * circumference;
      const dash = Math.max(length - CHART.donutGap, 0);
      const slice = {
        key: item.category.id,
        color: item.category.color,
        dasharray: `${dash} ${circumference}`,
        dashoffset: -offset,
      };
      offset += length;
      return slice;
    });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={colors.border}
          strokeWidth={CHART.donutStroke}
        />
        <G transform={`rotate(-90 ${cx} ${cy})`}>
          {slices.map((slice) => (
            <Circle
              key={slice.key}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={CHART.donutStroke}
              strokeDasharray={slice.dasharray}
              strokeDashoffset={slice.dashoffset}
              strokeLinecap="butt"
            />
          ))}
        </G>
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.centerLabel, { color: colors.muted }]}>월 합계</Text>
        <Text style={[styles.centerValue, { color: colors.text }]} numberOfLines={1}>
          {formatCurrency(total)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  centerLabel: {
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  centerValue: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
    textAlign: 'center',
  },
});
