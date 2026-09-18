import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ServiceIcon } from '@/components/ServiceIcon';
import { BILLING_CYCLE_SHORT } from '@/constants/billing';
import { categoryBg, useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { findCategory, useCategoryStore } from '@/stores/category-store';
import { withInferredCategory } from '@/lib/extract';
import { formatCurrency, formatLongDate } from '@/stores/subscription-store';
import type { BillingCycle } from '@/types/subscription';
import type { ParsedSubscription } from '@/types/extract';

function billingDayLabel(cycle: BillingCycle, anchor: string): string {
  if (cycle === 'yearly') {
    return `매년 ${Number(anchor.slice(5, 7))}월 ${Number(anchor.slice(8, 10))}일 결제`;
  }
  if (cycle === 'one_time') {
    return `${Number(anchor.slice(5, 7))}월 ${Number(anchor.slice(8, 10))}일 결제`;
  }
  return `매월 ${Number(anchor.slice(8, 10))}일 결제`;
}

type ChatInlineCardProps = {
  parsed: ParsedSubscription;
  registered?: boolean;
  editedViaModal?: boolean;
  nameNeedsReview?: boolean;
  onRegister: () => void;
  onEdit: () => void;
  onDismiss: () => void;
};

export function ChatInlineCard({
  parsed,
  registered,
  editedViaModal,
  nameNeedsReview,
  onRegister,
  onEdit,
  onDismiss,
}: ChatInlineCardProps) {
  const colors = useThemeColors();
  const categories = useCategoryStore((state) => state.categories);
  if (!parsed) return null;
  const display = withInferredCategory(parsed, categories);
  const category = findCategory(categories, display.category_id);

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
        <Text style={[styles.amount, { color: colors.text }]}>{formatCurrency(display.amount)}</Text>
      </View>

      {nameNeedsReview ? (
        <View style={[styles.warning, { backgroundColor: colors.amberBg }]}>
          <Text style={[styles.warningLabel, { color: colors.amber }]}>
            ⚠️ 이름이 정확한지 확인해 주세요. 체험·전환 관련 표현이 섞였을 수 있어요.
          </Text>
        </View>
      ) : null}

      <View style={styles.detailBlock}>
        <Text style={[styles.detailText, { color: colors.muted }]}>
          {display.billing_cycle === 'yearly'
            ? `연 ${formatCurrency(display.amount)}`
            : display.billing_cycle === 'one_time'
            ? `일회 ${formatCurrency(display.amount)}`
            : `월 ${formatCurrency(display.amount)}`}
        </Text>
        {display.billing_cycle === 'yearly' ? (
          <Text style={[styles.detailText, { color: colors.muted }]}>
            월 환산 {formatCurrency(Math.round(display.amount / 12))}
          </Text>
        ) : null}
        <Text style={[styles.detailText, { color: colors.muted }]}>
          {billingDayLabel(display.billing_cycle, display.anchor_date)}
        </Text>
        {display.next_payment_date ? (
          <Text style={[styles.detailText, { color: colors.muted }]}>
            다음 결제 예정일 {formatLongDate(display.next_payment_date)}
          </Text>
        ) : null}
        {display.account_id ? (
          <Text style={[styles.detailText, { color: colors.muted }]} numberOfLines={1}>
            계정 {display.account_id}
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
          onPress={onRegister}
          disabled={registered}
          style={[
            styles.register,
            { backgroundColor: colors.primary, opacity: registered ? 0.5 : 1 },
          ]}>
          <Text style={[styles.registerLabel, { color: colors.primaryText }]}>
            {registered ? '등록됨' : '등록'}
          </Text>
        </Pressable>
        <Pressable onPress={onEdit} style={styles.edit}>
          <Text style={[styles.editLabel, { color: colors.muted }]}>
            {editedViaModal ? '구독 수정' : '수정'}
          </Text>
        </Pressable>
        {registered ? null : (
          <Pressable onPress={onDismiss} style={styles.edit}>
            <Text style={[styles.editLabel, { color: colors.muted }]}>대화 이어가기</Text>
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
  warning: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  warningLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: fonts.sansMedium,
    lineHeight: 15,
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
  register: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  registerLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  edit: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  editLabel: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});
