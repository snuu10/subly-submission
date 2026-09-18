import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ServiceIcon } from '@/components/ServiceIcon';
import { BILLING_CYCLE_SHORT } from '@/constants/billing';
import { categoryBg, useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { findCategory, useCategoryStore } from '@/stores/category-store';
import { withInferredCategory } from '@/lib/extract';
import { formatCurrency, formatShortDate } from '@/stores/subscription-store';
import type { ClaudeManageAction, ParsedSubscription } from '@/types/extract';

const ACTION_LABEL: Record<ClaudeManageAction, { confirm: string; done: string }> = {
  update: { confirm: '변경하기', done: '변경됨' },
  delete: { confirm: '삭제하기', done: '삭제됨' },
  pause: { confirm: '일시정지', done: '일시정지됨' },
  resume: { confirm: '다시 시작', done: '다시 시작됨' },
};

type ChatActionCardProps = {
  action: ClaudeManageAction;
  parsed: ParsedSubscription;
  previousAmount?: number;
  confirmed?: boolean;
  expired?: boolean;
  onConfirm: () => void;
  onSkip: () => void;
};

export function ChatActionCard({
  action,
  parsed,
  previousAmount,
  confirmed,
  expired,
  onConfirm,
  onSkip,
}: ChatActionCardProps) {
  const colors = useThemeColors();
  const categories = useCategoryStore((state) => state.categories);
  if (!parsed) return null;
  const display = withInferredCategory(parsed, categories);
  const category = findCategory(categories, display.category_id);
  const labels = ACTION_LABEL[action];

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <ServiceIcon
          presetId={display.preset_id}
          name={display.name}
          color={category?.color}
          categoryKey={category?.key}
          size={32}
        />
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {display.name}
        </Text>
        <Text style={[styles.amount, { color: colors.text }]}>
          {action === 'update' && previousAmount != null && previousAmount !== display.amount
            ? `${formatCurrency(previousAmount)} → ${formatCurrency(display.amount)}`
            : formatCurrency(display.amount)}
        </Text>
      </View>

      <View style={styles.detailBlock}>
        <Text style={[styles.detailText, { color: colors.muted }]} numberOfLines={1}>
          결제일 {formatShortDate(display.anchor_date)}
        </Text>
        {display.account_id ? (
          <Text style={[styles.detailText, { color: colors.muted }]} numberOfLines={1}>
            계정 {display.account_id}
          </Text>
        ) : null}
        {display.memo ? (
          <Text style={[styles.detailText, { color: colors.muted }]} numberOfLines={1}>
            메모 {display.memo}
          </Text>
        ) : null}
      </View>

      <View style={styles.meta}>
        <View style={[styles.chip, { backgroundColor: colors.accent }]}>
          <Text style={[styles.chipLabel, { color: colors.primary }]}>
            {BILLING_CYCLE_SHORT[display.billing_cycle]}
          </Text>
        </View>
        {category ? (
          <View style={[styles.chip, { backgroundColor: categoryBg(category.color) }]}>
            <Text style={[styles.chipLabel, { color: category.color }]}>{category.name}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onConfirm}
          disabled={confirmed || expired}
          style={[
            styles.confirm,
            { backgroundColor: colors.primary, opacity: confirmed || expired ? 0.5 : 1 },
          ]}>
          <Text style={[styles.confirmLabel, { color: colors.primaryText }]}>
            {expired ? '만료됨' : confirmed ? labels.done : labels.confirm}
          </Text>
        </Pressable>
        {confirmed ? null : (
          <Pressable onPress={onSkip} style={styles.skip}>
            <Text style={[styles.skipLabel, { color: colors.muted }]}>대화 이어가기</Text>
          </Pressable>
        )}
      </View>
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
  detailBlock: {
    gap: 2,
  },
  detailText: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  confirm: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  confirmLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  skip: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  skipLabel: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});
