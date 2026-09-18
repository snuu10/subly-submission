import { router, useLocalSearchParams, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionChips } from '@/components/OptionChips';
import { findInstitution, institutionsFor } from '@/constants/financial-institutions';
import { useThemeColors, type ThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { confirmAction, notify } from '@/lib/confirm';
import { formatLast4, last4FromNumber } from '@/lib/payment-instrument';
import {
  findInstrument,
  instrumentsOfKind,
  usePaymentInstrumentStore,
} from '@/stores/payment-instrument-store';
import type {
  PaymentCardType,
  PaymentClassification,
  PaymentInstrument,
  PaymentInstrumentKind,
  PaymentInstrumentStatus,
} from '@/types/payment-instrument';
import {
  PAYMENT_CARD_TYPE_LABEL,
  PAYMENT_CARD_TYPE_OPTIONS,
  PAYMENT_CLASSIFICATION_LABEL,
  PAYMENT_CLASSIFICATION_OPTIONS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_OPTIONS,
} from '@/types/payment-instrument';

type Step = 'list' | 'picker' | 'form';
type StatusFilter = 'all' | PaymentInstrumentStatus;
type ClassFilter = 'all' | PaymentClassification;
type TypeFilter = 'all' | PaymentCardType;

const STATUS_CHIP: Record<PaymentInstrumentStatus, { bg: string; text: string }> = {
  in_use: { bg: '#ECFDF5', text: '#059669' },
  unused: { bg: '#F3F4F6', text: '#6B7280' },
  undecided: { bg: '#FFFBEB', text: '#D97706' },
  expired: { bg: '#FFF1F2', text: '#E11D48' },
};

const CLASS_CHIP: Record<PaymentClassification, { bg: string; text: string }> = {
  personal: { bg: '#FDF2F8', text: '#DB2777' },
  corporate: { bg: '#EFF6FF', text: '#2563EB' },
};

const TYPE_CHIP: Record<PaymentCardType, { bg: string; text: string }> = {
  credit: { bg: '#FDF2F8', text: '#DB2777' },
  check: { bg: '#EFF6FF', text: '#2563EB' },
};

export default function PaymentMethodsScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const instruments = usePaymentInstrumentStore((state) => state.instruments);
  const addInstrument = usePaymentInstrumentStore((state) => state.addInstrument);
  const updateInstrument = usePaymentInstrumentStore((state) => state.updateInstrument);
  const deleteInstrument = usePaymentInstrumentStore((state) => state.deleteInstrument);

  const params = useLocalSearchParams<{ autoAdd?: string; kind?: string; cardType?: string }>();
  const [kind, setKind] = useState<PaymentInstrumentKind>(params.kind === 'card' ? 'card' : 'bank');
  const [step, setStep] = useState<Step>(params.autoAdd ? 'picker' : 'list');
  const [defaultCardType, setDefaultCardType] = useState<PaymentCardType | null>(
    params.cardType === 'credit' || params.cardType === 'check' ? params.cardType : null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [institutionKey, setInstitutionKey] = useState<string | null>(null);
  const [classification, setClassification] = useState<PaymentClassification>('personal');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');

  const editing = findInstrument(instruments, editingId);
  const list = useMemo(() => {
    return instrumentsOfKind(instruments, kind).filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (classFilter !== 'all' && item.classification !== classFilter) return false;
      if (kind === 'card' && typeFilter !== 'all' && item.card_type !== typeFilter) return false;
      if (query.trim()) {
        const institution = findInstitution(item.kind, item.institution_key);
        const hay = `${item.name} ${institution?.name ?? ''} ${item.number_last4}`.toLowerCase();
        if (!hay.includes(query.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [classFilter, instruments, kind, query, statusFilter, typeFilter]);

  const title = kind === 'bank' ? '은행 계좌' : '카드 계좌';

  const openAdd = () => {
    setEditingId(null);
    setInstitutionKey(null);
    setClassification('personal');
    setStep('picker');
  };

  const openEdit = (item: PaymentInstrument) => {
    setEditingId(item.id);
    setInstitutionKey(item.institution_key);
    setClassification(item.classification);
    setKind(item.kind);
    setStep('form');
  };

  const handleBack = () => {
    if (step === 'form') {
      setStep(editingId ? 'list' : 'picker');
      return;
    }
    if (step === 'picker') {
      setStep('list');
      return;
    }
    router.back();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={handleBack} style={styles.headerBtn}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {step === 'picker' ? '자산 연결' : step === 'form' ? (editingId ? '결제수단 수정' : '자산 추가') : '결제수단'}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {step === 'list' ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.kindRow}>
            {(['bank', 'card'] as const).map((value) => {
              const selected = kind === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    setKind(value);
                    setTypeFilter('all');
                  }}
                  style={[
                    styles.kindChip,
                    {
                      backgroundColor: selected ? colors.primary : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}>
                  <Text style={[styles.kindLabel, { color: selected ? colors.primaryText : colors.muted }]}>
                    {value === 'bank' ? '은행' : '카드'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.listHead}>
            <Text style={[styles.pageTitle, { color: colors.text }]}>{title}</Text>
            <Pressable onPress={openAdd} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.addBtnLabel, { color: colors.primaryText }]}>+ 자산 추가</Text>
            </Pressable>
          </View>

          <OptionChips
            options={[{ value: 'all', label: '전체' }, ...PAYMENT_STATUS_OPTIONS]}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <OptionChips
            options={[{ value: 'all', label: '전체 구분' }, ...PAYMENT_CLASSIFICATION_OPTIONS]}
            value={classFilter}
            onChange={setClassFilter}
          />
          {kind === 'card' ? (
            <OptionChips
              options={[{ value: 'all', label: '전체 종류' }, ...PAYMENT_CARD_TYPE_OPTIONS]}
              value={typeFilter}
              onChange={setTypeFilter}
            />
          ) : null}

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="검색어를 입력해주세요"
            placeholderTextColor={colors.muted}
            style={[
              styles.search,
              { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          />

          {list.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={[styles.emptyTitle, { color: colors.muted }]}>조회된 결제수단이 없어요.</Text>
              <Pressable onPress={openAdd} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.addBtnLabel, { color: colors.primaryText }]}>+ 자산 추가</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.cards}>
              {list.map((item) => {
                const institution = findInstitution(item.kind, item.institution_key);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => openEdit(item)}
                    style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {institution ? <Image source={institution.icon} style={styles.cardLogo} /> : null}
                    <View style={styles.cardBody}>
                      <Text style={[styles.cardName, { color: colors.text }]}>{item.name}</Text>
                      <Text style={[styles.cardMeta, { color: colors.muted }]}>
                        {institution?.name ?? item.institution_key} · {formatLast4(item.number_last4)}
                      </Text>
                      <View style={styles.badgeRow}>
                        <Badge colors={STATUS_CHIP[item.status]} label={PAYMENT_STATUS_LABEL[item.status]} />
                        <Badge
                          colors={CLASS_CHIP[item.classification]}
                          label={PAYMENT_CLASSIFICATION_LABEL[item.classification]}
                        />
                        {item.card_type ? (
                          <Badge colors={TYPE_CHIP[item.card_type]} label={PAYMENT_CARD_TYPE_LABEL[item.card_type]} />
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : null}

      {step === 'picker' ? (
        <InstitutionPicker
          colors={colors}
          bottom={insets.bottom}
          classification={classification}
          onClassification={setClassification}
          onSelect={(nextKind, key) => {
            setKind(nextKind);
            setInstitutionKey(key);
            setStep('form');
          }}
        />
      ) : null}

      {step === 'form' && institutionKey ? (
        <InstrumentEditor
          colors={colors}
          bottom={insets.bottom}
          kind={kind}
          institutionKey={institutionKey}
          classification={classification}
          editing={editing ?? null}
          defaultCardType={defaultCardType}
          onChangeInstitution={() => setStep('picker')}
          onClassification={setClassification}
          onSave={async (input) => {
            const ok = editing
              ? await updateInstrument(editing.id, input)
              : Boolean(await addInstrument(input));
            if (!ok) {
              notify('저장 실패', usePaymentInstrumentStore.getState().error ?? '다시 시도해 주세요.');
              return;
            }
            if (params.autoAdd && !editing) {
              // AI 비서에서 넘어온 등록이면 채팅으로 돌아가 결과를 카드로 보여준다.
              const institution = findInstitution(input.kind, input.institution_key);
              const query = new URLSearchParams({
                pmSaved: input.name,
                pmKind: input.kind,
                pmLast4: input.number_last4,
                pmInstitution: institution?.name ?? input.institution_key,
              });
              if (input.card_type) query.set('pmCardType', input.card_type);
              router.replace(`/(tabs)/assistant?${query.toString()}` as Href);
              return;
            }
            setStep('list');
            setEditingId(null);
          }}
          onDelete={
            editing
              ? async () => {
                  const confirmed = await confirmAction({
                    title: editing.name,
                    message: '이 결제수단을 삭제할까요? 연결된 구독에서는 선택이 해제됩니다.',
                    confirmLabel: '삭제',
                    destructive: true,
                  });
                  if (!confirmed) return;
                  const ok = await deleteInstrument(editing.id);
                  if (!ok) {
                    notify('삭제 실패', usePaymentInstrumentStore.getState().error ?? '다시 시도해 주세요.');
                    return;
                  }
                  setStep('list');
                  setEditingId(null);
                }
              : undefined
          }
        />
      ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

function Badge({ colors, label }: { colors: { bg: string; text: string }; label: string }) {
  return (
    <Text style={[styles.badge, { backgroundColor: colors.bg, color: colors.text }]}>{label}</Text>
  );
}

function InstitutionPicker({
  colors,
  bottom,
  classification,
  onClassification,
  onSelect,
}: {
  colors: ThemeColors;
  bottom: number;
  classification: PaymentClassification;
  onClassification: (value: PaymentClassification) => void;
  onSelect: (kind: PaymentInstrumentKind, key: string) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottom + 32 }]}
      showsVerticalScrollIndicator={false}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>어떤 자산을 연결할까요?</Text>
      <Text style={[styles.hint, { color: colors.muted }]}>
        개인 또는 법인을 고른 뒤 은행·카드사를 선택하세요.
      </Text>
      <View style={styles.customerRow}>
        {PAYMENT_CLASSIFICATION_OPTIONS.map((option) => {
          const selected = classification === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onClassification(option.value)}
              style={[
                styles.customerBtn,
                {
                  backgroundColor: selected ? colors.accent : colors.surface,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}>
              <View
                style={[
                  styles.radio,
                  { borderColor: selected ? colors.primary : colors.border },
                ]}>
                {selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
              </View>
              <Text style={[styles.customerLabel, { color: colors.text }]}>
                {option.value === 'corporate' ? '기업고객 (법인)' : '개인고객 (개인)'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>은행</Text>
      <View style={styles.grid}>
        {institutionsFor('bank').map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onSelect('bank', item.key)}
            style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Image source={item.icon} style={styles.tileLogo} />
            <Text numberOfLines={1} style={[styles.tileName, { color: colors.text }]}>
              {item.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 8 }]}>카드</Text>
      <View style={styles.grid}>
        {institutionsFor('card').map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onSelect('card', item.key)}
            style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Image source={item.icon} style={styles.tileLogo} />
            <Text numberOfLines={1} style={[styles.tileName, { color: colors.text }]}>
              {item.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function InstrumentEditor({
  colors,
  bottom,
  kind,
  institutionKey,
  classification,
  editing,
  defaultCardType,
  onChangeInstitution,
  onClassification,
  onSave,
  onDelete,
}: {
  colors: ThemeColors;
  bottom: number;
  kind: PaymentInstrumentKind;
  institutionKey: string;
  classification: PaymentClassification;
  editing: PaymentInstrument | null;
  defaultCardType?: PaymentCardType | null;
  onChangeInstitution: () => void;
  onClassification: (value: PaymentClassification) => void;
  onSave: (input: {
    kind: PaymentInstrumentKind;
    institution_key: string;
    name: string;
    number_last4: string;
    status: PaymentInstrumentStatus;
    classification: PaymentClassification;
    card_type?: PaymentCardType | null;
    expiry_month?: number | null;
    expiry_year?: number | null;
    memo?: string | null;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const institution = findInstitution(kind, institutionKey);
  const [name, setName] = useState(editing?.name ?? '');
  const [number, setNumber] = useState(editing ? editing.number_last4 : '');
  const [parts, setParts] = useState(['', '', '', editing?.number_last4 ?? '']);
  const [status, setStatus] = useState<PaymentInstrumentStatus>(editing?.status ?? 'in_use');
  const [cardType, setCardType] = useState<PaymentCardType>(editing?.card_type ?? defaultCardType ?? 'credit');
  const [expiryMonth, setExpiryMonth] = useState<number | null>(editing?.expiry_month ?? null);
  const [expiryYear, setExpiryYear] = useState<number | null>(editing?.expiry_year ?? null);
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [saving, setSaving] = useState(false);
  const part0 = useRef<TextInputType>(null);
  const part1 = useRef<TextInputType>(null);
  const part2 = useRef<TextInputType>(null);
  const part3 = useRef<TextInputType>(null);
  const partRefs = [part0, part1, part2, part3];

  const yearOptions = useMemo(() => {
    const start = new Date().getFullYear();
    return Array.from({ length: 16 }, (_, index) => start + index);
  }, []);

  const handleSave = async () => {
    const trimmed = name.trim();
    const last4 = last4FromNumber(kind === 'card' ? parts.join('') : number);
    if (!trimmed) {
      notify('입력 확인', kind === 'bank' ? '계좌 이름을 입력해 주세요.' : '카드 이름을 입력해 주세요.');
      return;
    }
    if (!last4) {
      notify('입력 확인', '번호 뒤 4자리가 필요합니다.');
      return;
    }
    setSaving(true);
    await onSave({
      kind,
      institution_key: institutionKey,
      name: trimmed,
      number_last4: last4,
      status,
      classification,
      card_type: kind === 'card' ? cardType : null,
      expiry_month: kind === 'card' ? expiryMonth : null,
      expiry_year: kind === 'card' ? expiryYear : null,
      memo: memo.trim() || null,
    });
    setSaving(false);
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.selectedRow}>
        <Text style={[styles.selectedLabel, { color: colors.muted }]}>
          선택된 {kind === 'bank' ? '은행' : '카드사'}: {institution?.name ?? institutionKey}
        </Text>
        <Pressable onPress={onChangeInstitution} style={[styles.changeBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.changeBtnLabel, { color: colors.primaryText }]}>변경하기</Text>
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>필수정보</Text>
      <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <FormRow label={kind === 'bank' ? '계좌 이름' : '카드 이름'} required colors={colors}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="이름"
            placeholderTextColor={colors.muted}
            style={[styles.formInput, { color: colors.text, backgroundColor: colors.background }]}
          />
        </FormRow>
        <FormRow label={kind === 'bank' ? '계좌 번호' : '카드 번호'} required colors={colors}>
          {kind === 'card' ? (
            <View style={styles.cardNumberRow}>
              {parts.map((part, index) => (
                <TextInput
                  key={index}
                  ref={partRefs[index]}
                  value={part}
                  keyboardType="number-pad"
                  maxLength={4}
                  onChangeText={(value) => {
                    const digits = value.replace(/\D/g, '').slice(0, 4);
                    setParts((prev) => prev.map((item, i) => (i === index ? digits : item)));
                    if (digits.length === 4 && index < 3) partRefs[index + 1]?.current?.focus();
                  }}
                  style={[styles.cardPart, { color: colors.text, backgroundColor: colors.background }]}
                />
              ))}
            </View>
          ) : (
            <TextInput
              value={number}
              onChangeText={(value) => setNumber(value.replace(/[^\d- ]/g, ''))}
              keyboardType="number-pad"
              placeholder={editing ? editing.number_last4 : '숫자만 입력'}
              placeholderTextColor={colors.muted}
              style={[styles.formInput, { color: colors.text, backgroundColor: colors.background }]}
            />
          )}
        </FormRow>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>선택정보</Text>
      <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <FormBlock label="사용상태" colors={colors}>
          <ChoiceGrid
            value={status}
            options={PAYMENT_STATUS_OPTIONS}
            chip={STATUS_CHIP}
            colors={colors}
            onChange={setStatus}
          />
        </FormBlock>
        <FormBlock label="구분" colors={colors}>
          <ChoiceGrid
            value={classification}
            options={PAYMENT_CLASSIFICATION_OPTIONS}
            chip={CLASS_CHIP}
            colors={colors}
            onChange={onClassification}
          />
        </FormBlock>
        {kind === 'card' ? (
          <>
            <FormBlock label="종류" colors={colors}>
              <ChoiceGrid
                value={cardType}
                options={PAYMENT_CARD_TYPE_OPTIONS}
                chip={TYPE_CHIP}
                colors={colors}
                onChange={setCardType}
              />
            </FormBlock>
            <FormBlock label="유효기간" colors={colors}>
              <View style={styles.expiryRow}>
                <SelectBox
                  value={expiryYear == null ? '' : String(expiryYear)}
                  placeholder="년"
                  options={[
                    { value: '', label: '년' },
                    ...yearOptions.map((year) => ({ value: String(year), label: String(year) })),
                  ]}
                  colors={colors}
                  onChange={(value) => setExpiryYear(value ? Number(value) : null)}
                />
                <Text style={{ color: colors.muted }}>/</Text>
                <SelectBox
                  value={expiryMonth == null ? '' : String(expiryMonth)}
                  placeholder="월"
                  options={[
                    { value: '', label: '월' },
                    ...Array.from({ length: 12 }, (_, index) => {
                      const month = index + 1;
                      return { value: String(month), label: String(month).padStart(2, '0') };
                    }),
                  ]}
                  colors={colors}
                  onChange={(value) => setExpiryMonth(value ? Number(value) : null)}
                />
              </View>
            </FormBlock>
          </>
        ) : null}
        <FormBlock label="비고" colors={colors} last>
          <TextInput
            value={memo}
            onChangeText={setMemo}
            placeholder="선택"
            placeholderTextColor={colors.muted}
            style={[styles.formInput, { color: colors.text, backgroundColor: colors.background }]}
          />
        </FormBlock>
      </View>

      <Pressable
        onPress={() => void handleSave()}
        disabled={saving}
        style={[styles.submit, { backgroundColor: saving ? colors.chip : colors.primary }]}>
        <Text style={[styles.submitLabel, { color: saving ? colors.muted : colors.primaryText }]}>
          {saving ? '저장 중…' : editing ? '저장하기' : '추가하기'}
        </Text>
      </Pressable>
      {onDelete ? (
        <Pressable onPress={() => void onDelete()} style={styles.deleteBtn}>
          <Text style={[styles.deleteLabel, { color: colors.danger }]}>삭제</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function FormRow({
  label,
  required,
  colors,
  last,
  children,
}: {
  label: string;
  required?: boolean;
  colors: ThemeColors;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.formRow, last ? null : { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Text style={[styles.formLabel, { color: colors.text }]}>
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      <View style={styles.formField}>{children}</View>
    </View>
  );
}

function FormBlock({
  label,
  colors,
  last,
  children,
}: {
  label: string;
  colors: ThemeColors;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.formBlock, last ? null : { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Text style={[styles.formBlockLabel, { color: colors.text }]}>{label}</Text>
      {children}
    </View>
  );
}

function ChoiceGrid<T extends string>({
  value,
  options,
  chip,
  colors,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  chip: Record<T, { bg: string; text: string }>;
  colors: ThemeColors;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choiceGrid}>
      {options.map((option) => {
        const selected = option.value === value;
        const tone = chip[option.value];
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.choiceBox,
              {
                width: '48.5%',
                backgroundColor: selected ? tone.bg : colors.background,
                borderColor: selected ? tone.text : colors.border,
              },
            ]}>
            <Text style={[styles.choiceLabel, { color: selected ? tone.text : colors.muted }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SelectBox<T extends string>({
  value,
  options,
  placeholder,
  colors,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  placeholder?: string;
  colors: ThemeColors;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((item) => item.value === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.selectBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Text
          style={[
            styles.selectValue,
            { color: current && current.value ? colors.text : colors.muted },
          ]}>
          {current?.label ?? placeholder ?? '선택'}
        </Text>
        <SymbolView
          name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
          tintColor={colors.muted}
          size={14}
        />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}>
        <View style={styles.selectOverlay}>
          <Pressable style={styles.selectBackdrop} onPress={() => setOpen(false)} />
          <View style={[styles.selectSheet, { backgroundColor: colors.surface }]}>
            <View style={styles.selectHandleWrap}>
              <View style={[styles.selectHandle, { backgroundColor: colors.border }]} />
            </View>
            <ScrollView style={styles.selectList} bounces={false}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={option.value || 'empty'}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={[
                      styles.selectOption,
                      { backgroundColor: selected ? colors.accent : colors.surface },
                    ]}>
                    <Text
                      style={[
                        styles.selectOptionLabel,
                        { color: option.value ? (selected ? colors.primary : colors.text) : colors.muted },
                      ]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', fontFamily: fonts.sansExtraBold },
  content: { padding: 20, gap: 14 },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  kindLabel: { fontSize: 13, fontWeight: '700', fontFamily: fonts.sansBold },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pageTitle: { fontSize: 22, fontWeight: '800', fontFamily: fonts.sansExtraBold },
  addBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  addBtnLabel: { fontSize: 13, fontWeight: '800', fontFamily: fonts.sansExtraBold },
  search: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { fontSize: 14, fontFamily: fonts.sans },
  cards: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  cardLogo: { width: 36, height: 36 },
  cardBody: { flex: 1, gap: 4 },
  cardName: { fontSize: 15, fontWeight: '700', fontFamily: fonts.sansBold },
  cardMeta: { fontSize: 12, fontFamily: fonts.sans },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  hint: { fontSize: 13, lineHeight: 20, fontFamily: fonts.sans },
  customerRow: { gap: 10 },
  customerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  customerLabel: { fontSize: 14, fontWeight: '700', fontFamily: fonts.sansBold },
  sectionTitle: { fontSize: 16, fontWeight: '800', fontFamily: fonts.sansExtraBold, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31.5%',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 8,
  },
  tileLogo: { width: 36, height: 36 },
  tileName: { fontSize: 11, fontWeight: '700', fontFamily: fonts.sansBold },
  selectedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selectedLabel: { flex: 1, fontSize: 13, fontFamily: fonts.sansMedium },
  changeBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  changeBtnLabel: { fontSize: 12, fontWeight: '700', fontFamily: fonts.sansBold },
  formCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  formRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 56, gap: 12 },
  formLabel: { width: 78, fontSize: 13, fontWeight: '700', fontFamily: fonts.sansBold },
  formField: { flex: 1 },
  formBlock: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  formBlockLabel: { fontSize: 13, fontWeight: '700', fontFamily: fonts.sansBold },
  formInput: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, fontFamily: fonts.sans },
  cardNumberRow: { flexDirection: 'row', gap: 6 },
  cardPart: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    textAlign: 'center',
    fontSize: 13,
    fontFamily: fonts.mono,
  },
  expiryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceBox: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  choiceLabel: { fontSize: 13, fontWeight: '700', fontFamily: fonts.sansBold },
  selectBox: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  selectValue: { flex: 1, fontSize: 14, fontFamily: fonts.sans },
  selectOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  selectBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  selectSheet: {
    maxHeight: '46%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  selectHandleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  selectHandle: { width: 36, height: 4, borderRadius: 2 },
  selectList: { maxHeight: 280 },
  selectOption: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  selectOptionLabel: { fontSize: 16, fontWeight: '600', fontFamily: fonts.sansMedium },
  submit: { borderRadius: 14, alignItems: 'center', paddingVertical: 15 },
  submitLabel: { fontSize: 15, fontWeight: '800', fontFamily: fonts.sansExtraBold },
  deleteBtn: { alignItems: 'center', paddingVertical: 8 },
  deleteLabel: { fontSize: 14, fontWeight: '700', fontFamily: fonts.sansBold },
});
