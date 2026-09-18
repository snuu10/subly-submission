import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DateField';
import { OptionChips } from '@/components/OptionChips';
import { ScreenNav, ScreenShell } from '@/components/ScreenNav';
import { ServiceIcon } from '@/components/ServiceIcon';
import { BILLING_CYCLE_OPTIONS, BILLING_CYCLE_SHORT } from '@/constants/billing';
import { categoryBg, useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { notify } from '@/lib/confirm';
import { duplicateAccountIssue, duplicateAccountMessage, sameServiceSubscriptions } from '@/lib/duplicate-account';
import { saveReceiptParse } from '@/lib/receipts';
import { findCategory, getVisibleCategories, useCategoryStore } from '@/stores/category-store';
import { useReceiptStore } from '@/stores/receipt-store';
import {
  computeNextPaymentDate,
  useSubscriptionStore,
} from '@/stores/subscription-store';
import type { BillingCycle } from '@/types/subscription';

export default function ReceiptConfirmScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const parsed = useReceiptStore((state) => state.parsed);
  const uploadId = useReceiptStore((state) => state.uploadId);
  const extract = useReceiptStore((state) => state.extract);
  const categories = useCategoryStore((state) => state.categories);
  const addSubscription = useSubscriptionStore((state) => state.addSubscription);
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);

  const [name, setName] = useState(parsed?.name ?? '');
  const [amount, setAmount] = useState(parsed ? String(parsed.amount) : '');
  const [cycle, setCycle] = useState<BillingCycle>(parsed?.billing_cycle ?? 'monthly');
  const [anchorDate, setAnchorDate] = useState(parsed?.anchor_date ?? '');
  const [categoryId, setCategoryId] = useState(parsed?.category_id ?? '');
  const [accountId, setAccountId] = useState(parsed?.account_id ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!parsed) {
      router.replace('/receipt' as Href);
    }
  }, [parsed]);

  const visibleCategories = useMemo(() => getVisibleCategories(categories), [categories]);
  const category = findCategory(categories, categoryId);
  const parsedAmount = Number(amount.replace(/,/g, ''));
  const canSave =
    name.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(anchorDate) &&
    Boolean(categoryId) &&
    !saving;

  const handleSave = async () => {
    if (!canSave || !parsed) return;
    const accountIssue = duplicateAccountIssue(subscriptions, {
      name: name.trim(),
      account_id: accountId,
      preset_id: parsed.preset_id,
    });
    if (accountIssue) {
      notify('입력 확인', duplicateAccountMessage(accountIssue));
      return;
    }
    setSaving(true);
    const created = await addSubscription({
      name: name.trim(),
      amount: Math.round(parsedAmount),
      billing_cycle: cycle,
      category_id: categoryId,
      anchor_date: anchorDate,
      next_payment_date: computeNextPaymentDate(anchorDate, cycle),
      preset_id: parsed.preset_id,
      is_active: true,
      account_id: accountId.trim() || undefined,
    });
    setSaving(false);

    if (!created) {
      notify('저장 실패', useSubscriptionStore.getState().error ?? '다시 시도해 주세요.');
      return;
    }

    if (uploadId) {
      await saveReceiptParse(uploadId, extract, created.id).catch(() => undefined);
    }
    useReceiptStore.getState().reset();
    router.replace('/(tabs)/home' as Href);
  };

  if (!parsed) return null;

  return (
    <ScreenShell>
      <ScreenNav title="정보를 확인해주세요" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.banner, { backgroundColor: colors.accent }]}>
            <Text style={[styles.bannerText, { color: colors.primary }]}>
              AI가 영수증에서 추출한 정보예요. 내용을 확인하고 저장해주세요
            </Text>
          </View>

          <Field label="서비스명">
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <ServiceIcon
                presetId={parsed.preset_id}
                name={name}
                color={category?.color}
                categoryKey={category?.key}
                size={28}
              />
              <TextInput
                value={name}
                onChangeText={setName}
                style={[styles.input, { color: colors.text }]}
                placeholder="서비스명"
                placeholderTextColor={colors.muted}
              />
              <SymbolView
                name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                tintColor={colors.muted}
                size={14}
              />
            </View>
          </Field>

          <Field label="결제 금액">
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                style={[styles.input, { color: colors.text }]}
                placeholder="0"
                placeholderTextColor={colors.muted}
              />
              <Text style={[styles.unit, { color: colors.text }]}>원</Text>
            </View>
          </Field>

          <Field label="결제 주기">
            <View style={[styles.card, styles.cardStack, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={[styles.chip, { backgroundColor: colors.accent }]}>
                <Text style={[styles.chipLabel, { color: colors.primary }]}>{BILLING_CYCLE_SHORT[cycle]}</Text>
              </View>
              <OptionChips options={BILLING_CYCLE_OPTIONS} value={cycle} onChange={setCycle} />
            </View>
          </Field>

          <Field label="결제일">
            <DateField value={anchorDate} onChange={setAnchorDate} />
          </Field>

          <Field label="카테고리">
            <View style={[styles.card, styles.cardStack, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {category ? (
                <View style={[styles.chip, { backgroundColor: categoryBg(category.color) }]}>
                  <Text style={[styles.chipLabel, { color: category.color }]}>{category.name}</Text>
                </View>
              ) : null}
              <OptionChips
                options={visibleCategories.map((item) => ({ value: item.id, label: item.name }))}
                value={categoryId}
                onChange={setCategoryId}
              />
            </View>
          </Field>

          <Field
            label={
              sameServiceSubscriptions(subscriptions, name, parsed.preset_id).length > 0
                ? '가입 계정 (필수)'
                : '가입 계정 (선택)'
            }>
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <TextInput
                value={accountId}
                onChangeText={setAccountId}
                style={[styles.input, { color: accountId ? colors.text : colors.muted }]}
                placeholder="이메일 또는 아이디. 다른 서비스와는 같아도 됩니다"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
            </View>
          </Field>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: colors.surface }]}>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[
              styles.save,
              { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.5 },
            ]}>
            <Text style={[styles.saveLabel, { color: colors.primaryText }]}>
              {saving ? '저장 중…' : '저장하기'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 16,
  },
  banner: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.sansMedium,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  card: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardStack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
    paddingVertical: 12,
  },
  unit: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  save: {
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
