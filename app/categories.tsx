import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryOrderSection } from '@/components/CategoryOrderSection';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { CATEGORY_NAME_HINT, CATEGORY_NAME_MAX_LENGTH, validateCategoryName } from '@/lib/category-name';
import { confirmAction, notify } from '@/lib/confirm';
import {
  MIN_NON_ETC_CATEGORY,
  countNonEtc,
  isEtcCategory,
  useCategoryStore,
} from '@/stores/category-store';
import { useSubscriptionStore } from '@/stores/subscription-store';
import type { Category } from '@/types/category';

export default function CategoriesScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const categories = useCategoryStore((state) => state.categories);
  const addCategory = useCategoryStore((state) => state.addCategory);
  const renameCategory = useCategoryStore((state) => state.renameCategory);
  const hideCategory = useCategoryStore((state) => state.hideCategory);
  const unhideCategory = useCategoryStore((state) => state.unhideCategory);
  const deleteCustomCategory = useCategoryStore((state) => state.deleteCustomCategory);
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const systemCategories = categories.filter((item) => item.is_system);
  const customCategories = categories.filter((item) => !item.is_system);

  const countIn = (categoryId: string) =>
    subscriptions.filter((item) => item.category_id === categoryId).length;

  const confirmReassign = (category: Category, action: '숨기면' | '삭제하면') => {
    const count = countIn(category.id);
    const detail =
      count > 0
        ? `이 카테고리의 구독 ${count}개가 모두 '기타'로 이동됩니다.`
        : '이 카테고리에 속한 구독은 없습니다.';

    return confirmAction({
      title: category.name,
      message: `${category.name}을(를) ${action} ${detail}\n\n나중에 다시 켜도 이동된 구독은 자동으로 복원되지 않습니다.`,
      confirmLabel: action === '숨기면' ? '숨기기' : '삭제',
      destructive: true,
    });
  };

  const handleToggleHidden = async (category: Category, nextHidden: boolean) => {
    if (busyId) return;

    if (!nextHidden) {
      setBusyId(category.id);
      const ok = await unhideCategory(category.id);
      setBusyId(null);
      if (!ok) notify('변경 실패', useCategoryStore.getState().error ?? '다시 시도해 주세요.');
      return;
    }

    const confirmed = await confirmReassign(category, '숨기면');
    if (!confirmed) return;

    setBusyId(category.id);
    const ok = await hideCategory(category.id);
    setBusyId(null);
    if (!ok) notify('숨기기 실패', useCategoryStore.getState().error ?? '다시 시도해 주세요.');
  };

  const handleDelete = async (category: Category) => {
    if (busyId) return;
    if (isEtcCategory(category)) return;

    if (countNonEtc(categories) <= 1) {
      notify('삭제할 수 없음', MIN_NON_ETC_CATEGORY);
      return;
    }

    const confirmed = await confirmReassign(category, '삭제하면');
    if (!confirmed) return;

    setBusyId(category.id);
    const ok = await deleteCustomCategory(category.id);
    setBusyId(null);
    if (!ok) notify('삭제 실패', useCategoryStore.getState().error ?? '다시 시도해 주세요.');
  };

  const handleAdd = async () => {
    if (adding) return;
    // ChatGPT 수정: 저장 전에 공통 허용 문자와 길이를 검사한다.
    const validation = validateCategoryName(newName);
    if (!validation.name) {
      notify('입력 확인', validation.error ?? CATEGORY_NAME_HINT);
      return;
    }

    setAdding(true);
    const created = await addCategory(newName);
    setAdding(false);

    if (!created) {
      notify('추가 실패', useCategoryStore.getState().error ?? '다시 시도해 주세요.');
      return;
    }
    setNewName('');
  };

  const handleRenameSubmit = async (category: Category) => {
    const validation = validateCategoryName(editingName);
    if (!validation.name) {
      notify('입력 확인', validation.error ?? CATEGORY_NAME_HINT);
      return;
    }
    setEditingId(null);

    if (validation.name === category.name) return;

    const ok = await renameCategory(category.id, validation.name);
    if (!ok) notify('이름 변경 실패', useCategoryStore.getState().error ?? '다시 시도해 주세요.');
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View
        style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>카테고리 관리</Text>
        <View style={styles.backButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!reordering}
        showsVerticalScrollIndicator={false}>
        <CategoryOrderSection onDraggingChange={setReordering} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>기본 카테고리</Text>
          <Text style={[styles.sectionHint, { color: colors.muted }]}>
            이름 변경, 숨기기, 삭제가 가능합니다. 기타는 유지되며, 기타를 제외한 카테고리는 최소
            1개가 있어야 합니다. 숨긴 이름은 계속 쓰이므로 같은 이름으로 새로 만들 수 없습니다.
          </Text>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {systemCategories.map((category, index) => {
              const locked = isEtcCategory(category);
              return (
                <View
                  key={category.id}
                  style={[
                    styles.row,
                    index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
                  ]}>
                  <View style={[styles.dot, { backgroundColor: category.color }]} />

                  {locked ? (
                    <Text style={[styles.rowName, { color: colors.text }]}>{category.name}</Text>
                  ) : editingId === category.id ? (
                    <TextInput
                      value={editingName}
                      onChangeText={setEditingName}
                      onSubmitEditing={() => handleRenameSubmit(category)}
                      onBlur={() => handleRenameSubmit(category)}
                      autoFocus
                      maxLength={CATEGORY_NAME_MAX_LENGTH}
                      returnKeyType="done"
                      style={[
                        styles.renameInput,
                        {
                          color: colors.text,
                          borderColor: colors.primary,
                          backgroundColor: colors.chip,
                        },
                      ]}
                    />
                  ) : (
                    <Pressable
                      style={styles.rowNameWrap}
                      onPress={() => {
                        setEditingId(category.id);
                        setEditingName(category.name);
                      }}>
                      <Text style={[styles.rowName, { color: colors.text }]}>{category.name}</Text>
                    </Pressable>
                  )}

                  {locked ? (
                    <Text style={[styles.rowBadge, { color: colors.muted }]}>기본</Text>
                  ) : (
                    <>
                      <Switch
                        value={!category.is_hidden}
                        disabled={busyId === category.id}
                        onValueChange={(next) => handleToggleHidden(category, !next)}
                        trackColor={{ false: colors.chip, true: colors.primary }}
                      />
                      <Pressable
                        onPress={() => {
                          setEditingId(category.id);
                          setEditingName(category.name);
                        }}
                        style={styles.iconAction}>
                        <SymbolView
                          name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                          tintColor={colors.muted}
                          size={16}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDelete(category)}
                        disabled={busyId === category.id}
                        style={styles.iconAction}>
                        <SymbolView
                          name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                          tintColor={colors.danger}
                          size={16}
                        />
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>내 카테고리</Text>

          {customCategories.length === 0 ? (
            <View style={[styles.card, styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionHint, { color: colors.muted }]}>
                직접 만든 카테고리가 없어요.
              </Text>
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {customCategories.map((category, index) => (
                <View
                  key={category.id}
                  style={[
                    styles.row,
                    index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
                  ]}>
                  <View style={[styles.dot, { backgroundColor: category.color }]} />

                  {editingId === category.id ? (
                    <TextInput
                      value={editingName}
                      onChangeText={setEditingName}
                      onSubmitEditing={() => handleRenameSubmit(category)}
                      onBlur={() => handleRenameSubmit(category)}
                      autoFocus
                      maxLength={CATEGORY_NAME_MAX_LENGTH}
                      returnKeyType="done"
                      style={[
                        styles.renameInput,
                        {
                          color: colors.text,
                          borderColor: colors.primary,
                          backgroundColor: colors.chip,
                        },
                      ]}
                    />
                  ) : (
                    <Pressable
                      style={styles.rowNameWrap}
                      onPress={() => {
                        setEditingId(category.id);
                        setEditingName(category.name);
                      }}>
                      <Text style={[styles.rowName, { color: colors.text }]}>{category.name}</Text>
                    </Pressable>
                  )}

                  <Pressable
                    onPress={() => {
                      setEditingId(category.id);
                      setEditingName(category.name);
                    }}
                    style={styles.iconAction}>
                    <SymbolView
                      name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                      tintColor={colors.muted}
                      size={16}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(category)}
                    disabled={busyId === category.id}
                    style={styles.iconAction}>
                    <SymbolView
                      name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                      tintColor={colors.danger}
                      size={16}
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={styles.addRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={handleAdd}
              placeholder="카테고리 이름"
              maxLength={CATEGORY_NAME_MAX_LENGTH}
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={[
                styles.addInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
            <Pressable
              onPress={handleAdd}
              disabled={adding}
              style={[
                styles.addButton,
                { backgroundColor: adding ? colors.chip : colors.primary },
              ]}>
              <Text
                style={[
                  styles.addButtonLabel,
                  { color: adding ? colors.muted : colors.primaryText },
                ]}>
                {adding ? '추가 중…' : '추가'}
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.sectionHint, { color: colors.muted }]}>
            색상은 자동으로 배정됩니다. {CATEGORY_NAME_HINT}
          </Text>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  content: {
    padding: 20,
    gap: 28,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  emptyCard: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowNameWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  rowBadge: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  renameInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  iconAction: {
    padding: 6,
    borderRadius: 8,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  addButton: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  addButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
});
