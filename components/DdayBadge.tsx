import { StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { getDaysUntil } from '@/stores/subscription-store';

type DdayBadgeProps = {
  isoDate: string;
  variant?: 'badge' | 'box';
};

type DdayTone = { text: string; background: string; border: string };

export function getDdayStyles(days: number, colors: ReturnType<typeof useThemeColors>): DdayTone {
  if (days <= 3) {
    return {
      text: colors.rose,
      background: colors.roseBg,
      border: colors.roseBg,
    };
  }
  if (days <= 7) {
    return {
      text: colors.amber,
      background: colors.amberBg,
      border: colors.amberBg,
    };
  }
  return {
    text: colors.muted,
    background: colors.chip,
    border: colors.border,
  };
}

export function ddayLabel(days: number): string {
  if (days < 0) return `D+${Math.abs(days)}`;
  if (days === 0) return 'D-DAY';
  return `D-${days}`;
}

export function DdayBadge({ isoDate, variant = 'badge' }: DdayBadgeProps) {
  const colors = useThemeColors();
  const days = getDaysUntil(isoDate);
  const tone = getDdayStyles(days, colors);

  if (variant === 'box') {
    return <DdayBox days={days} tone={tone} />;
  }

  // Text의 overflow/borderRadius는 Android에서 무시되므로 래퍼 View로 배경을 그린다.
  return (
    <View style={[styles.badge, { backgroundColor: tone.background }]}>
      <Text style={[styles.badgeLabel, { color: tone.text }]}>{ddayLabel(days)}</Text>
    </View>
  );
}

function DdayBox({ days, tone }: { days: number; tone: DdayTone }) {
  return (
    <View
      style={[styles.box, { backgroundColor: tone.background, borderColor: tone.border }]}>
      {days <= 0 ? (
        <Text style={[styles.boxWord, { color: tone.text }]}>오늘</Text>
      ) : days === 1 ? (
        <Text style={[styles.boxWord, { color: tone.text }]}>내일</Text>
      ) : (
        <>
          <Text style={[styles.boxPrefix, { color: tone.text }]}>D-</Text>
          <Text
            style={[styles.boxDays, { color: tone.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit>
            {days}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  box: {
    width: 56,
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    borderWidth: 1,
  },
  boxWord: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  boxPrefix: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    fontFamily: fonts.sansBold,
  },
  boxDays: {
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 20,
    fontFamily: fonts.monoBold,
  },
});
