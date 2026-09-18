import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ServiceIcon } from '@/components/ServiceIcon';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { USAGE_CHECKIN_LABEL } from '@/lib/usage-checkin';
import { findCategory, useCategoryStore } from '@/stores/category-store';
import { formatCurrency } from '@/stores/subscription-store';
import type { UsageCheckinResponse } from '@/types/briefing-event';
import type { Subscription } from '@/types/subscription';

type UsageCheckinCardProps = {
  subscription: Subscription;
  response: UsageCheckinResponse;
  confirmed?: boolean;
  saving?: boolean;
  onConfirm: () => void;
  onSkip: () => void;
};

export function UsageCheckinCard({
  subscription,
  response,
  confirmed,
  saving,
  onConfirm,
  onSkip,
}: UsageCheckinCardProps) {
  const colors = useThemeColors();
  const categories = useCategoryStore((state) => state.categories);
  const category = findCategory(categories, subscription.category_id);

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <ServiceIcon
          presetId={subscription.preset_id}
          name={subscription.name}
          color={category?.color}
          emoji={subscription.emoji}
          categoryKey={category?.key}
          size={32}
        />
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {subscription.name}
        </Text>
        <Text style={[styles.amount, { color: colors.text }]}>{formatCurrency(subscription.amount)}</Text>
      </View>
      <Text style={[styles.summary, { color: colors.muted }]}>
        {USAGE_CHECKIN_LABEL[response]}로 기록할까요?
      </Text>
      <Pressable
        onPress={onConfirm}
        disabled={confirmed || saving}
        style={[
          styles.confirm,
          { backgroundColor: colors.primary, opacity: confirmed || saving ? 0.5 : 1 },
        ]}>
        <Text style={[styles.confirmLabel, { color: colors.primaryText }]}>
          {confirmed ? '저장됨' : '맞아요, 저장하기'}
        </Text>
      </Pressable>
      {confirmed ? null : (
        <Pressable onPress={onSkip} hitSlop={8}>
          <Text style={[styles.skipLabel, { color: colors.muted }]}>대화 이어가기</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  summary: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  confirm: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  confirmLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  skipLabel: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});
