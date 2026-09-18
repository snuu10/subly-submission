import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DdayBadge } from '@/components/DdayBadge';
import { ServiceIcon } from '@/components/ServiceIcon';
import { BILLING_CYCLE_LABELS } from '@/constants/billing';
import { categoryBg, useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { kstTodayIso } from '@/lib/usage-checkin';
import { findCategory, useCategoryStore } from '@/stores/category-store';
import { formatCurrency, formatShortDate } from '@/stores/subscription-store';
import { isTrialCurrent, LIFECYCLE_LABELS, type Subscription } from '@/types/subscription';

type SubscriptionRowProps = {
  subscription: Subscription;
  onPress?: () => void;
  showCategory?: boolean;
  variant?: 'default' | 'upcoming';
  embedded?: boolean;
};

export function SubscriptionRow({
  subscription,
  onPress,
  showCategory = false,
  variant = 'default',
  embedded = false,
}: SubscriptionRowProps) {
  const colors = useThemeColors();
  const categories = useCategoryStore((state) => state.categories);
  const category = findCategory(categories, subscription.category_id);
  const trialActive = isTrialCurrent(subscription, kstTodayIso());

  if (variant === 'upcoming') {
    return (
      <Pressable
        onPress={onPress}
        style={[
          styles.row,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}>
        <DdayBadge isoDate={subscription.next_payment_date} variant="box" />
        <ServiceIcon
          presetId={subscription.preset_id}
          name={subscription.name}
          color={category?.color}
          emoji={subscription.emoji}
          categoryKey={category?.key}
          size={32}
        />
        <View style={styles.main}>
          <Text style={[styles.name, { color: colors.text }]}>{subscription.name}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {formatShortDate(subscription.next_payment_date)} ·{' '}
            {BILLING_CYCLE_LABELS[subscription.billing_cycle]}
          </Text>
        </View>
        <Text style={[styles.amount, { color: colors.text }]}>
          {formatCurrency(subscription.amount)}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={[
        embedded ? styles.embeddedRow : styles.row,
        {
          backgroundColor: embedded ? 'transparent' : colors.surface,
          borderColor: colors.border,
          opacity: subscription.is_active ? 1 : 0.55,
        },
      ]}>
      <ServiceIcon
        presetId={subscription.preset_id}
        name={subscription.name}
        color={category?.color}
        emoji={subscription.emoji}
        categoryKey={category?.key}
        size={44}
      />
      <View style={styles.main}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]}>{subscription.name}</Text>
          {showCategory && category ? (
            <View style={[styles.categoryPill, { backgroundColor: categoryBg(category.color) }]}>
              <Text style={[styles.categoryPillLabel, { color: category.color }]}>
                {category.name}
              </Text>
            </View>
          ) : null}
          {subscription.lifecycle_status &&
          subscription.lifecycle_status !== 'active' &&
          subscription.lifecycle_status !== 'ended' ? (
            <View style={[styles.categoryPill, { backgroundColor: colors.accent }]}>
              <Text style={[styles.categoryPillLabel, { color: colors.primary }]}>
                {LIFECYCLE_LABELS[subscription.lifecycle_status]}
              </Text>
            </View>
          ) : null}
        </View>
        {trialActive ? (
          <Text style={[styles.trialMeta, { color: colors.primary }]}>
            무료 체험 · {formatShortDate(subscription.trial_ends_at!)}까지
          </Text>
        ) : (
          <Text style={[styles.meta, { color: colors.muted }]}>
            {formatShortDate(subscription.next_payment_date)} ·{' '}
            {BILLING_CYCLE_LABELS[subscription.billing_cycle]}
          </Text>
        )}
        {subscription.account_id ? (
          <Text style={[styles.account, { color: colors.muted }]} numberOfLines={1}>
            {subscription.account_id}
          </Text>
        ) : null}
      </View>
      <View style={styles.side}>
        {trialActive ? (
          <>
            <Text style={[styles.amount, styles.amountStruck, { color: colors.muted }]}>
              {formatCurrency(subscription.amount)}
            </Text>
            <Text style={[styles.trialSoon, { color: colors.primary }]}>곧 유료</Text>
          </>
        ) : (
          <Text style={[styles.amount, { color: colors.text }]}>
            {formatCurrency(subscription.amount)}
          </Text>
        )}
        {subscription.lifecycle_status === 'ended' ? (
          <Text style={[styles.paused, { color: colors.muted }]}>종료</Text>
        ) : subscription.is_active ? (
          <DdayBadge isoDate={subscription.next_payment_date} />
        ) : (
          <Text style={[styles.paused, { color: colors.muted }]}>일시정지</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  embeddedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  meta: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  trialMeta: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
  },
  account: {
    fontSize: 11,
    fontFamily: fonts.sans,
    opacity: 0.9,
  },
  side: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.monoBold,
  },
  amountStruck: {
    textDecorationLine: 'line-through',
  },
  trialSoon: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
  },
  categoryPill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  categoryPillLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  paused: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: fonts.sansMedium,
  },
});
