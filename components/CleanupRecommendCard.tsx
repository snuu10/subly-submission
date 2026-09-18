import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { formatCurrency } from '@/stores/subscription-store';
import type { CleanupRecommendation } from '@/types/assistant-turn';

const CONFIDENCE_LABEL = {
  high: '신뢰 높음',
  medium: '신뢰 보통',
  low: '신뢰 낮음',
} as const;

type CleanupRecommendCardProps = {
  item: CleanupRecommendation;
  onAskGuide?: () => void;
};

export function CleanupRecommendCard({ item, onAskGuide }: CleanupRecommendCardProps) {
  const colors = useThemeColors();

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.badgeLabel, { color: colors.primary }]}>
            {CONFIDENCE_LABEL[item.confidence]}
          </Text>
        </View>
      </View>
      {item.reasons.map((reason) => (
        <Text key={`${reason.code}-${reason.evidence}`} style={[styles.reason, { color: colors.muted }]}>
          {reason.evidence}
        </Text>
      ))}
      <Text style={[styles.save, { color: colors.text }]}>
        해지 시 월 {formatCurrency(item.monthly_save)} · 연 {formatCurrency(item.yearly_save)}
      </Text>
      {onAskGuide ? (
        <Pressable onPress={onAskGuide} style={[styles.action, { backgroundColor: colors.primary }]}>
          <Text style={[styles.actionLabel, { color: colors.primaryText }]}>해지 방법 보기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  reason: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  save: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  action: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
