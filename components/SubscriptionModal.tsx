import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DateField';
import { OptionChips } from '@/components/OptionChips';
import { ServiceIcon } from '@/components/ServiceIcon';
import { BILLING_CHANNEL_OPTIONS, BILLING_CYCLE_OPTIONS } from '@/constants/billing';
import { useThemeColors, type ThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { PRESET_SERVICES, type PresetService } from '@/constants/services';
import {
  encodeServiceIcon,
  isServiceIconKey,
  SERVICE_ICON_OPTIONS,
  type ServiceIconKey,
} from '@/constants/service-icons';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { confirmAction, notify } from '@/lib/confirm';
import { suggestCategory } from '@/lib/ai-briefings';
import { findByKey, findCategory, getVisibleCategories, useCategoryStore } from '@/stores/category-store';
import { findInstrument, usePaymentInstrumentStore } from '@/stores/payment-instrument-store';
import { findInstitution } from '@/constants/financial-institutions';
import { formatLast4 } from '@/lib/payment-instrument';
import {
  duplicateAccountIssue,
  duplicateAccountMessage,
  sameServiceSubscriptions,
  trialRequirementIssue,
  trialRequirementMessage,
} from '@/lib/duplicate-account';
import { useRouter } from 'expo-router';
import {
  computeNextPaymentDate,
  defaultAnchorDate,
  formatShortDate,
  useSubscriptionStore,
} from '@/stores/subscription-store';
import type { BillingChannel } from '@/types/cancel-guide';
import type { BillingCycle } from '@/types/subscription';
import type { SystemCategoryKey } from '@/types/category';

const GRID_COLUMNS = 4;
const GRID_GAP = 10;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 콤마가 섞인 입력도 허용한다. 유효하지 않으면 null. */
function parseAmount(raw: string): number | null {
  const parsed = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

type FormState = {
  name: string;
  amount: string;
  billingCycle: BillingCycle;
  categoryId: string;
  anchorDate: string;
  presetId: string | null;
  emoji: string;
  memo: string;
  accountId: string;
  billingChannel: BillingChannel | null;
  paymentInstrumentId: string | null;
  isActive: boolean;
  isTrial: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  amount: '',
  billingCycle: 'monthly',
  categoryId: '',
  anchorDate: defaultAnchorDate(),
  presetId: null,
  emoji: '',
  memo: '',
  accountId: '',
  billingChannel: null,
  paymentInstrumentId: null,
  isActive: true,
  isTrial: false,
};

export function SubscriptionModal() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { visible, editingId, draft, onSavedCallback, close } = useSubscriptionModal();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const addSubscription = useSubscriptionStore((state) => state.addSubscription);
  const updateSubscription = useSubscriptionStore((state) => state.updateSubscription);
  const removeSubscription = useSubscriptionStore((state) => state.removeSubscription);
  const { width } = useWindowDimensions();
  const tileWidth = (width - 48 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  const allCategories = useCategoryStore((state) => state.categories);
  const instruments = usePaymentInstrumentStore((state) => state.instruments);

  const editing = subscriptions.find((item) => item.id === editingId);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const categoryLocked = useRef(false);
  const router = useRouter();

  /**
   * 숨긴 카테고리는 목록에서 빠지지만, 이미 그 카테고리로 저장된 구독을 수정할 때는
   * 현재 값이 사라지면 안 되므로 선택된 항목만 예외로 되살린다.
   */
  const categoryOptions = useMemo(() => {
    const visible = getVisibleCategories(allCategories);
    const selected = findCategory(allCategories, form.categoryId);
    if (selected && !visible.some((item) => item.id === selected.id)) {
      return [...visible, selected];
    }
    return visible;
  }, [allCategories, form.categoryId]);

  useEffect(() => {
    if (!visible) {
      setIconPickerOpen(false);
      return;
    }

    if (editing) {
      setForm({
        name: editing.name,
        amount: String(editing.amount),
        billingCycle: editing.billing_cycle,
        categoryId: editing.category_id,
        anchorDate: editing.anchor_date,
        presetId: editing.preset_id,
        emoji: editing.preset_id ? '' : (editing.emoji ?? ''),
        memo: editing.memo ?? '',
        accountId: editing.account_id ?? '',
        billingChannel: editing.billing_channel ?? null,
        paymentInstrumentId: editing.payment_instrument_id ?? null,
        isActive: editing.is_active,
        isTrial: editing.is_trial ?? false,
      });
      setFilterCategoryId(editing.category_id);
      categoryLocked.current = true;
      return;
    }

    const fallbackId = getVisibleCategories(allCategories)[0]?.id ?? '';
    setForm({
      ...EMPTY_FORM,
      name: draft?.name ?? '',
      amount: draft?.amount != null ? String(draft.amount) : '',
      billingCycle: draft?.billing_cycle ?? 'monthly',
      categoryId: draft?.category_id ?? fallbackId,
      anchorDate: draft?.anchor_date ?? defaultAnchorDate(),
      presetId: draft?.preset_id ?? null,
      accountId: draft?.account_id ?? '',
    });
    setFilterCategoryId(draft?.category_id ?? fallbackId);
    categoryLocked.current = Boolean(draft?.category_id);
  }, [allCategories, draft, editing, visible]);

  useEffect(() => {
    if (!visible || editing || form.presetId || categoryLocked.current) return;
    const name = form.name.trim();
    if (name.length < 2) return;

    const handle = setTimeout(() => {
      void suggestCategory(name).then((result) => {
        if (!result || categoryLocked.current) return;
        const key = result.category_key as SystemCategoryKey;
        const mapped = findByKey(useCategoryStore.getState().categories, key);
        const suggestedIcon = isServiceIconKey(result.icon_key)
          ? encodeServiceIcon(result.icon_key)
          : '';
        if (!mapped && !suggestedIcon) return;
        setForm((prev) => {
          if (prev.name.trim() !== name || prev.presetId) return prev;
          return {
            ...prev,
            categoryId: mapped?.id ?? prev.categoryId,
            emoji: suggestedIcon || prev.emoji,
            presetId: null,
          };
        });
        if (mapped) setFilterCategoryId(mapped.id);
      });
    }, 400);

    return () => clearTimeout(handle);
  }, [editing, form.name, form.presetId, visible]);

  const filterCategory = findCategory(allCategories, filterCategoryId);
  const visiblePresets = filterCategory?.key
    ? PRESET_SERVICES.filter((service) => service.category === filterCategory.key)
    : [];

  const selectPreset = (service: PresetService) => {
    if (form.presetId === service.id) {
      setForm((prev) => ({ ...prev, presetId: null, name: '', emoji: '' }));
      return;
    }

    // 프리셋은 시스템 카테고리 키를 들고 있으므로 유저의 해당 카테고리 row로 옮겨준다.
    const mapped = findByKey(allCategories, service.category);

    categoryLocked.current = true;
    setForm((prev) => ({
      ...prev,
      presetId: service.id,
      name: service.name,
      categoryId: mapped?.id ?? prev.categoryId,
      emoji: '',
    }));
    if (mapped) setFilterCategoryId(mapped.id);
  };

  const selectIcon = (iconKey: ServiceIconKey) => {
    setForm((prev) => ({ ...prev, emoji: encodeServiceIcon(iconKey), presetId: null }));
    setIconPickerOpen(false);
  };

  const buildInput = () => {
    const trimmedName = form.name.trim();
    const parsedAmount = parseAmount(form.amount);

    if (!trimmedName) {
      notify('입력 확인', '서비스명을 입력해 주세요.');
      return null;
    }

    if (parsedAmount === null) {
      notify('입력 확인', '0보다 큰 금액을 입력해 주세요.');
      return null;
    }

    if (!ISO_DATE_PATTERN.test(form.anchorDate)) {
      notify('입력 확인', '최초 결제일을 YYYY-MM-DD 형식으로 입력해 주세요.');
      return null;
    }

    if (!form.categoryId) {
      notify('입력 확인', '카테고리를 선택해 주세요.');
      return null;
    }

    if (form.isTrial && form.billingCycle === 'one_time') {
      notify('입력 확인', '일회성 결제는 무료 체험으로 등록할 수 없어요.');
      return null;
    }

    const accountIssue = duplicateAccountIssue(subscriptions, {
      id: editingId,
      name: trimmedName,
      account_id: form.accountId,
      preset_id: form.presetId,
    });
    if (accountIssue) {
      notify('입력 확인', duplicateAccountMessage(accountIssue));
      return null;
    }

    const trialIssue = trialRequirementIssue({
      is_trial: form.isTrial,
      account_id: form.accountId,
      payment_instrument_id: form.paymentInstrumentId,
    });
    if (trialIssue) {
      notify('입력 확인', trialRequirementMessage(trialIssue));
      return null;
    }

    return {
      name: trimmedName,
      amount: parsedAmount,
      billing_cycle: form.billingCycle,
      category_id: form.categoryId,
      anchor_date: form.anchorDate,
      next_payment_date: computeNextPaymentDate(form.anchorDate, form.billingCycle),
      preset_id: form.presetId,
      is_active: form.isActive,
      memo: form.memo.trim() || undefined,
      emoji: form.presetId ? undefined : form.emoji || undefined,
      account_id: form.accountId.trim() || undefined,
      billing_channel: form.billingChannel,
      payment_instrument_id: form.paymentInstrumentId,
      is_trial: form.isTrial,
      trial_ends_at: form.isTrial ? form.anchorDate : null,
    };
  };

  const handleSave = async () => {
    const input = buildInput();
    if (!input) return;

    setSaving(true);
    const result = editingId
      ? await updateSubscription(editingId, input)
      : await addSubscription(input);
    setSaving(false);

    if (!result) {
      notify('저장 실패', useSubscriptionStore.getState().error ?? '다시 시도해 주세요.');
      return;
    }

    onSavedCallback?.(result);
    close();
  };

  const handleDelete = async () => {
    if (!editingId) return;

    const confirmed = await confirmAction({
      title: '구독 삭제',
      message: '이 구독을 삭제할까요?',
      confirmLabel: '삭제',
      destructive: true,
    });
    if (!confirmed) return;

    await removeSubscription(editingId);
    close();
  };

  const isValid =
    form.name.trim().length > 0 &&
    parseAmount(form.amount) !== null &&
    ISO_DATE_PATTERN.test(form.anchorDate) &&
    form.categoryId.length > 0;
  const canSubmit = isValid && !saving;
  const previewNextPayment = ISO_DATE_PATTERN.test(form.anchorDate)
    ? computeNextPaymentDate(form.anchorDate, form.billingCycle)
    : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: insets.bottom + 24 },
          ]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: colors.text }]}>
                {editingId ? '구독 수정' : '구독 추가'}
              </Text>
              <Pressable onPress={close} style={styles.closeButton}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  tintColor={colors.muted}
                  size={18}
                />
              </Pressable>
            </View>

            <Field label="서비스" colors={colors}>
              <OptionChips
                options={categoryOptions.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                value={filterCategoryId}
                onChange={(value) => {
                  categoryLocked.current = true;
                  setFilterCategoryId(value);
                  setForm((prev) => ({ ...prev, categoryId: value }));
                }}
              />
              {visiblePresets.length === 0 ? (
                <Text style={[styles.presetHint, { color: colors.muted }]}>
                  이 카테고리에는 등록된 서비스가 없어요. 아래에서 직접 입력해 주세요.
                </Text>
              ) : (
                <View style={styles.grid}>
                  {visiblePresets.map((service) => {
                    const selected = form.presetId === service.id;
                    return (
                      <Pressable
                        key={service.id}
                        onPress={() => selectPreset(service)}
                        style={[
                          styles.tile,
                          {
                            width: tileWidth,
                            backgroundColor: selected ? colors.accent : colors.chip,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}>
                        <ServiceIcon
                          presetId={service.id}
                          name={service.name}
                          color={filterCategory?.color}
                          size={40}
                        />
                        <Text
                          numberOfLines={2}
                          style={[styles.tileLabel, { color: colors.text }]}>
                          {service.shortName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <View style={styles.nameRow}>
                <Pressable
                  onPress={() => {
                    if (form.presetId) return;
                    setIconPickerOpen(true);
                  }}
                  disabled={Boolean(form.presetId)}
                  accessibilityRole="button"
                  accessibilityLabel="아이콘 선택"
                  accessibilityState={{ disabled: Boolean(form.presetId) }}
                  style={[
                    styles.iconPickerButton,
                    {
                      backgroundColor: colors.chip,
                      borderColor: colors.border,
                    },
                  ]}>
                  {form.presetId ? (
                    <ServiceIcon
                      presetId={form.presetId}
                      name={form.name}
                      color={findCategory(allCategories, form.categoryId)?.color}
                      size={28}
                    />
                  ) : form.emoji ? (
                    <ServiceIcon
                      presetId={null}
                      name={form.name}
                      color={findCategory(allCategories, form.categoryId)?.color}
                      emoji={form.emoji}
                      categoryKey={findCategory(allCategories, form.categoryId)?.key}
                      size={28}
                    />
                  ) : (
                    <Text style={[styles.iconPickerPlaceholder, { color: colors.muted }]}>+</Text>
                  )}
                  <Text style={[styles.iconPickerCaption, { color: colors.muted }]}>
                    {form.presetId ? '로고' : '아이콘'}
                  </Text>
                </Pressable>
                <TextInput
                  value={form.name}
                  onChangeText={(value) =>
                    setForm((prev) => {
                      const detached = Boolean(prev.presetId && value !== prev.name);
                      return {
                        ...prev,
                        name: value,
                        presetId: detached ? null : prev.presetId,
                        emoji: detached ? '' : prev.emoji,
                      };
                    })
                  }
                  placeholder="서비스명 (예: Netflix)"
                  placeholderTextColor={colors.muted}
                  style={[
                    styles.input,
                    styles.nameInput,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.chip },
                  ]}
                />
              </View>
            </Field>

            <Field label="금액" colors={colors}>
              <View style={styles.amountRow}>
                <TextInput
                  value={form.amount}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, amount: value }))}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  style={[
                    styles.input,
                    styles.amountInput,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.chip },
                  ]}
                />
                <Text style={[styles.amountSuffix, { color: colors.muted }]}>원</Text>
              </View>
            </Field>

            <Field label="결제 주기" colors={colors}>
              <OptionChips
                options={BILLING_CYCLE_OPTIONS}
                value={form.billingCycle}
                onChange={(value) => setForm((prev) => ({ ...prev, billingCycle: value }))}
                disabledValues={form.isTrial ? ['one_time'] : undefined}
                onPressDisabled={() =>
                  notify('입력 확인', '무료 체험은 월간 또는 연간 구독만 등록할 수 있어요.')
                }
              />
              <View
                style={[
                  styles.trialSwitchRow,
                  { borderColor: colors.border, backgroundColor: colors.chip },
                ]}>
                <Text style={[styles.trialSwitchLabel, { color: colors.text }]}>무료 체험</Text>
                <View style={styles.trialSwitchControl}>
                  <Text
                    style={[
                      styles.trialSwitchState,
                      { color: form.isTrial ? colors.primary : colors.muted },
                    ]}>
                    {form.isTrial ? 'ON' : 'OFF'}
                  </Text>
                  <Switch
                    value={form.isTrial}
                    onValueChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        isTrial: !prev.isTrial,
                        // 체험은 일회성 결제와 조합할 수 없다 — 켜는 순간 월간으로 바꿔 둔다.
                        // 끌 때는 그대로 둔다(사용자가 고른 주기를 임의로 되돌리지 않음).
                        billingCycle:
                          !prev.isTrial && prev.billingCycle === 'one_time'
                            ? 'monthly'
                            : prev.billingCycle,
                      }))
                    }
                    accessibilityLabel="무료 체험"
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.surface}
                    ios_backgroundColor={colors.border}
                  />
                </View>
              </View>
            </Field>

            <Field label={form.isTrial ? '첫 유료 결제일' : '최초 결제일'} colors={colors}>
              <DateField
                value={form.anchorDate}
                onChange={(value) => setForm((prev) => ({ ...prev, anchorDate: value }))}
              />
              {form.isTrial ? (
                <Text style={[styles.derivedHint, { color: colors.primary }]}>
                  이날부터 {form.billingCycle === 'yearly' ? '매년' : '매달'} 자동 결제돼요.
                </Text>
              ) : previewNextPayment ? (
                <Text style={[styles.derivedHint, { color: colors.muted }]}>
                  다음 결제일 {formatShortDate(previewNextPayment)}
                </Text>
              ) : null}
            </Field>

            <Field label="카테고리" colors={colors}>
              <View style={styles.categoryGrid}>
                {categoryOptions.map((option) => {
                  const selected = form.categoryId === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => {
                        categoryLocked.current = true;
                        setForm((prev) => ({ ...prev, categoryId: option.id }));
                        setFilterCategoryId(option.id);
                      }}
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor: selected ? colors.accent : colors.chip,
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}>
                      <View style={[styles.categoryDot, { backgroundColor: option.color }]} />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.categoryChipLabel,
                          { color: selected ? colors.primary : colors.muted },
                        ]}>
                        {option.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field
              label={
                sameServiceSubscriptions(subscriptions, form.name, form.presetId, editingId).length > 0 ||
                form.isTrial
                  ? '가입 계정 (필수)'
                  : '가입 계정 (선택)'
              }
              colors={colors}>
              <TextInput
                value={form.accountId}
                onChangeText={(value) => setForm((prev) => ({ ...prev, accountId: value }))}
                placeholder="이메일 또는 아이디. 다른 서비스와는 같아도 됩니다"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.chip },
                ]}
              />
              <Text style={[styles.derivedHint, { color: colors.muted }]}>
                비밀번호는 저장하지 않습니다.
              </Text>
            </Field>

            <Field label={form.isTrial ? '결제수단 (필수)' : '결제수단 (선택)'} colors={colors}>
              {(() => {
                const current = form.paymentInstrumentId
                  ? findInstrument(instruments, form.paymentInstrumentId)
                  : null;
                const institution = current ? findInstitution(current.kind, current.institution_key) : null;
                const selectedLabel = current
                  ? `${institution?.name ?? ''} ${formatLast4(current.number_last4)}`.trim()
                  : '결제수단을 선택하세요';
                return (
                  <Pressable
                    onPress={() => setPaymentSheetOpen(true)}
                    style={[
                      styles.selectorField,
                      { borderColor: colors.border, backgroundColor: colors.chip },
                    ]}>
                    <Text
                      numberOfLines={1}
                      style={[styles.selectorFieldLabel, { color: current ? colors.text : colors.muted }]}>
                      {selectedLabel}
                    </Text>
                    <Text style={{ color: colors.muted }}>▾</Text>
                  </Pressable>
                );
              })()}
            </Field>

            <Modal
              visible={paymentSheetOpen}
              transparent
              animationType="slide"
              onRequestClose={() => setPaymentSheetOpen(false)}>
              <Pressable
                style={styles.instrumentSheetBackdrop}
                onPress={() => setPaymentSheetOpen(false)}
              />
              <View style={[styles.instrumentSheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 16 }]}>
                <View style={[styles.instrumentSheetHandle, { backgroundColor: colors.border }]} />
                <Text style={[styles.instrumentSheetTitle, { color: colors.muted }]}>결제수단 선택</Text>
                {instruments.length === 0 ? (
                  <View style={[styles.instrumentSheetEmpty, { borderColor: colors.primary, backgroundColor: colors.chip }]}>
                    <Text style={[styles.instrumentSheetEmptyText, { color: colors.text }]}>
                      등록된 카드/계좌가 없어요.{form.isTrial ? ' 무료 체험을 등록하려면 결제수단을 먼저 등록해야 해요.' : ''}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setPaymentSheetOpen(false);
                        router.push('/payment-methods');
                      }}
                      style={[styles.instrumentSheetAddButton, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.instrumentSheetAddButtonLabel, { color: colors.primary }]}>
                        계좌/카드 등록하기
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <ScrollView style={{ maxHeight: 360 }}>
                    {instruments.map((item) => {
                      const selected = form.paymentInstrumentId === item.id;
                      const institution = findInstitution(item.kind, item.institution_key);
                      const label = `${institution?.name ?? item.kind} ${formatLast4(item.number_last4)}`;
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => {
                            setForm((prev) => ({
                              ...prev,
                              paymentInstrumentId: selected ? null : item.id,
                            }));
                            setPaymentSheetOpen(false);
                          }}
                          style={[styles.instrumentSheetRow, { borderTopColor: colors.border }]}>
                          <Text style={[styles.instrumentSheetRowLabel, { color: colors.text }]}>{label}</Text>
                          <View
                            style={[
                              styles.radio,
                              { borderColor: selected ? colors.primary : colors.border },
                            ]}>
                            {selected ? (
                              <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      onPress={() => {
                        setPaymentSheetOpen(false);
                        router.push('/payment-methods');
                      }}
                      style={[styles.instrumentSheetRow, { borderTopColor: colors.border }]}>
                      <Text style={[styles.instrumentSheetRowLabel, { color: colors.primary, fontWeight: '700' }]}>
                        ＋ 계좌/카드 추가
                      </Text>
                    </Pressable>
                  </ScrollView>
                )}
              </View>
            </Modal>

            <Field label="결제 경로 (선택)" colors={colors}>
              <View style={styles.categoryGrid}>
                {BILLING_CHANNEL_OPTIONS.filter((option) => option.value !== 'unknown').map((option) => {
                  const selected = form.billingChannel === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() =>
                        setForm((prev) => ({
                          ...prev,
                          billingChannel: selected ? null : option.value,
                        }))
                      }
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor: selected ? colors.accent : colors.chip,
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.categoryChipLabel,
                          { color: selected ? colors.primary : colors.muted },
                        ]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.derivedHint, { color: colors.muted }]}>
                해지 경로가 스토어/웹마다 다를 때 안내가 정확해집니다.
              </Text>
            </Field>

            <Field label="메모 (선택)" colors={colors}>
              <TextInput
                value={form.memo}
                onChangeText={(value) => setForm((prev) => ({ ...prev, memo: value }))}
                placeholder="메모를 입력하세요..."
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.chip },
                ]}
              />
            </Field>

            <Pressable
              onPress={handleSave}
              disabled={!canSubmit}
              style={[
                styles.saveButton,
                { backgroundColor: canSubmit ? colors.primary : colors.chip },
              ]}>
              <Text
                style={[
                  styles.saveLabel,
                  { color: canSubmit ? colors.primaryText : colors.muted },
                ]}>
                {saving ? '저장 중...' : editingId ? '수정 완료' : '구독 추가하기'}
              </Text>
            </Pressable>

            {editingId ? (
              <Pressable
                onPress={handleDelete}
                style={[styles.deleteButton, { borderColor: colors.danger }]}>
                <Text style={[styles.deleteLabel, { color: colors.danger }]}>삭제</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={iconPickerOpen}
        animationType="fade"
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setIconPickerOpen(false)}>
        <View style={styles.pickerOverlay}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setIconPickerOpen(false)} />
          <View
            style={[
              styles.pickerSheet,
              { backgroundColor: colors.surface, paddingBottom: insets.bottom + 20 },
            ]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.pickerTitle, { color: colors.text }]}>아이콘 선택</Text>
            <View style={styles.pickerGrid}>
              {SERVICE_ICON_OPTIONS.map((option) => {
                const encoded = encodeServiceIcon(option.key);
                const selected = form.emoji === encoded && !form.presetId;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => selectIcon(option.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} 아이콘`}
                    accessibilityState={{ selected }}
                    style={[
                      styles.pickerChip,
                      {
                        width: tileWidth,
                        height: tileWidth,
                        backgroundColor: selected ? colors.accent : colors.chip,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}>
                    <ServiceIcon
                      presetId={null}
                      name=""
                      color={filterCategory?.color}
                      emoji={encoded}
                      size={40}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function Field({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ThemeColors;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '92%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  closeButton: {
    padding: 8,
    borderRadius: 999,
  },
  field: {
    gap: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    fontFamily: fonts.sansExtraBold,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  tile: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: fonts.sansMedium,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconPickerButton: {
    width: 64,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 2,
  },
  iconPickerCaption: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  iconPickerPlaceholder: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 26,
  },
  nameInput: {
    flex: 1,
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
    marginBottom: 16,
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  pickerChip: {
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.sans,
  },
  amountRow: {
    position: 'relative',
  },
  amountInput: {
    fontFamily: fonts.mono,
    paddingRight: 36,
  },
  amountSuffix: {
    position: 'absolute',
    right: 14,
    top: 14,
    fontSize: 14,
    fontFamily: fonts.sansMedium,
  },
  derivedHint: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  trialSwitchRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    minHeight: 40,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  trialSwitchLabel: {
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  trialSwitchControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trialSwitchState: {
    minWidth: 24,
    fontSize: 10,
    textAlign: 'right',
    fontFamily: fonts.sansBold,
  },
  selectorField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  selectorFieldLabel: {
    fontSize: 13.5,
    fontFamily: fonts.sansMedium,
    flex: 1,
  },
  instrumentSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  instrumentSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 4,
  },
  instrumentSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  instrumentSheetTitle: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  instrumentSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  instrumentSheetRowLabel: {
    fontSize: 13.5,
    fontFamily: fonts.sansMedium,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  instrumentSheetEmpty: {
    margin: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  instrumentSheetEmptyText: {
    fontSize: 12.5,
    fontFamily: fonts.sansMedium,
    lineHeight: 18,
    marginBottom: 12,
  },
  instrumentSheetAddButton: {
    borderRadius: 11,
    paddingVertical: 11,
    alignItems: 'center',
  },
  instrumentSheetAddButtonLabel: {
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  chips: {
    gap: 8,
    paddingVertical: 2,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    minWidth: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  categoryChipLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
    flexShrink: 1,
  },
  presetHint: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    paddingVertical: 4,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 4,
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  deleteButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
  },
  deleteLabel: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
