import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppHeader } from '@/components/AppHeader';
import { SubscriptionRow } from '@/components/SubscriptionRow';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { applyCategoryChipOrder } from '@/lib/category-order';
import { getVisibleCategories, useCategoryStore } from '@/stores/category-store';
import { getDaysUntil, useSubscriptionStore } from '@/stores/subscription-store';
import type { Subscription } from '@/types/subscription';

type StatusFilter = 'all' | 'active' | 'paused' | 'ending' | 'ended';

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: '전체 상태' },
  { id: 'active', label: '활성' },
  { id: 'paused', label: '일시정지' },
  { id: 'ending', label: '종료 예정' },
  { id: 'ended', label: '종료' },
];

const ENDING_STATUSES = new Set([
  'cancel_requested',
  'ending_scheduled',
  'end_confirm_needed',
]);

function getStatus(item: Subscription): Exclude<StatusFilter, 'all'> {
  if (item.lifecycle_status === 'ended') return 'ended';
  if (item.lifecycle_status && ENDING_STATUSES.has(item.lifecycle_status)) return 'ending';
  return item.is_active ? 'active' : 'paused';
}

export default function SubscriptionsScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ category?: string | string[] }>();
  const { openEdit } = useSubscriptionModal();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const toggleActive = useSubscriptionStore((state) => state.toggleActive);
  const removeSubscription = useSubscriptionStore((state) => state.removeSubscription);
  const categories = useCategoryStore((state) => state.categories);
  const chipOrderIds = useCategoryStore((state) => state.chipOrderIds);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('active');
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const orderedVisible = useMemo(
    () => applyCategoryChipOrder(getVisibleCategories(categories), chipOrderIds, 'app'),
    [categories, chipOrderIds]
  );

  useEffect(() => {
    const raw = params.category;
    const categoryId = Array.isArray(raw) ? raw[0] : raw;
    if (categoryId) setSelectedCategoryId(categoryId);
  }, [params.category]);

  const selectCategory = (id: string) => {
    setSelectedCategoryId(id);
    if (params.category) {
      router.setParams({ category: undefined });
    }
  };

  const filterOptions = useMemo(
    () => [
      { id: 'all', name: '전체', color: null as string | null },
      ...orderedVisible.map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color as string | null,
      })),
    ],
    [orderedVisible]
  );

  const filtered = useMemo(() => {
    return subscriptions
      .filter((item) => {
        if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        if (selectedCategoryId !== 'all' && item.category_id !== selectedCategoryId) {
          return false;
        }
        if (selectedStatus !== 'all' && getStatus(item) !== selectedStatus) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return getDaysUntil(a.next_payment_date) - getDaysUntil(b.next_payment_date);
      });
  }, [searchQuery, selectedCategoryId, selectedStatus, subscriptions]);

  const selectedStatusLabel =
    STATUS_OPTIONS.find((option) => option.id === selectedStatus)?.label ?? '전체 상태';

  const grouped = useMemo(() => {
    const asGroups = (
      rows: { id: string; name: string; color: string | null; items: typeof filtered }[]
    ) => rows;

    if (selectedCategoryId !== 'all') {
      return asGroups([{ id: selectedCategoryId, name: '', color: null, items: filtered }]);
    }

    const visible = orderedVisible;
    const buckets = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const list = buckets.get(item.category_id) ?? [];
      list.push(item);
      buckets.set(item.category_id, list);
    }

    const groups = visible.flatMap((category) => {
      const items = buckets.get(category.id);
      if (!items?.length) return [];
      buckets.delete(category.id);
      return [{ id: category.id, name: category.name, color: category.color as string | null, items }];
    });

    for (const [id, items] of buckets) {
      const category = categories.find((row) => row.id === id);
      groups.push({
        id,
        name: category?.name ?? '기타',
        color: category?.color ?? null,
        items,
      });
    }
    return asGroups(groups);
  }, [categories, filtered, orderedVisible, selectedCategoryId]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.searchWrap}>
          <View style={styles.searchIcon}>
            <SymbolView
              name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              tintColor={colors.muted}
              size={16}
            />
          </View>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="구독 검색..."
            placeholderTextColor={colors.muted}
            style={[
              styles.searchInput,
              {
                color: colors.text,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {filterOptions.map((option) => {
            const selected = selectedCategoryId === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => selectCategory(option.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.primary : colors.surface,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}>
                {option.color ? (
                  <View
                    style={[
                      styles.chipDot,
                      { backgroundColor: selected ? colors.primaryText : option.color },
                    ]}
                  />
                ) : null}
                <Text
                  style={[
                    styles.chipLabel,
                    { color: selected ? colors.primaryText : colors.muted },
                  ]}>
                  {option.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[styles.listControls, statusMenuOpen ? styles.listControlsOpen : null]}>
          <Text style={[styles.count, { color: colors.muted }]}>{filtered.length}개의 구독</Text>
          <View style={styles.statusDropdown}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`구독 상태 필터, 현재 ${selectedStatusLabel}`}
              accessibilityState={{ expanded: statusMenuOpen }}
              onPress={() => setStatusMenuOpen((open) => !open)}
              style={[
                styles.statusButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}>
              <Text style={[styles.statusButtonLabel, { color: colors.text }]}>
                {selectedStatusLabel}
              </Text>
              <SymbolView
                name={{
                  ios: statusMenuOpen ? 'chevron.up' : 'chevron.down',
                  android: statusMenuOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
                  web: statusMenuOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
                }}
                tintColor={colors.muted}
                size={16}
              />
            </Pressable>
            {statusMenuOpen ? (
              <View
                style={[
                  styles.statusMenu,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}>
                {STATUS_OPTIONS.map((option) => {
                  const selected = selectedStatus === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        setSelectedStatus(option.id);
                        setStatusMenuOpen(false);
                      }}
                      style={[
                        styles.statusOption,
                        selected ? { backgroundColor: colors.accent } : null,
                      ]}>
                      <Text
                        style={[
                          styles.statusOptionLabel,
                          { color: selected ? colors.primary : colors.text },
                        ]}>
                        {option.label}
                      </Text>
                      {selected ? (
                        <SymbolView
                          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                          tintColor={colors.primary}
                          size={15}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>조건에 맞는 구독이 없어요</Text>
            <Text style={[styles.emptyHint, { color: colors.muted }]}>
              검색어나 카테고리, 상태 필터를 바꿔보세요
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {grouped.map((group) => (
              <View key={group.id} style={styles.group}>
                {selectedCategoryId === 'all' && group.name ? (
                  <View style={styles.groupHead}>
                    {group.color ? (
                      <View style={[styles.groupDot, { backgroundColor: group.color }]} />
                    ) : null}
                    <Text style={[styles.groupTitle, { color: colors.muted }]}>{group.name}</Text>
                    <Text style={[styles.groupCount, { color: colors.muted }]}>{group.items.length}</Text>
                  </View>
                ) : null}
                {group.items.map((item) => {
                  const status = getStatus(item);
                  const canToggleActive = status === 'active' || status === 'paused';
                  return (
                    <View
                    key={item.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        opacity: item.is_active ? 1 : 0.55,
                      },
                    ]}>
                    <SubscriptionRow
                      subscription={item}
                      showCategory
                      embedded
                      onPress={() => openEdit(item.id)}
                    />
                    <View style={[styles.actions, { borderTopColor: colors.border }]}>
                      {canToggleActive ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={status === 'active' ? '구독 일시정지' : '구독 다시 시작'}
                          onPress={() => toggleActive(item.id)}
                          style={[
                            styles.pauseButton,
                            {
                              backgroundColor: status === 'active' ? 'transparent' : colors.accent,
                            },
                          ]}>
                          <SymbolView
                            name={
                              status === 'active'
                                ? { ios: 'pause.fill', android: 'pause', web: 'pause' }
                                : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }
                            }
                            tintColor={status === 'active' ? colors.muted : colors.primary}
                            size={14}
                          />
                          <Text
                            style={[
                              styles.pauseLabel,
                              { color: status === 'active' ? colors.muted : colors.primary },
                            ]}>
                            {status === 'active' ? '일시정지' : '다시 시작'}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={[styles.lifecycleActionLabel, { color: colors.muted }]}>
                          {status === 'ending' ? '종료 예정' : '종료'}
                        </Text>
                      )}
                      <View style={styles.actionRight}>
                        <Pressable onPress={() => openEdit(item.id)} style={styles.iconAction}>
                          <SymbolView
                            name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                            tintColor={colors.muted}
                            size={16}
                          />
                        </Pressable>
                        {deleteConfirmId === item.id ? (
                          <View style={styles.confirmRow}>
                            <Pressable
                              onPress={() => {
                                removeSubscription(item.id);
                                setDeleteConfirmId(null);
                              }}
                              style={[styles.confirmDelete, { backgroundColor: colors.danger }]}>
                              <Text style={styles.confirmDeleteLabel}>삭제</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => setDeleteConfirmId(null)}
                              style={[styles.confirmCancel, { backgroundColor: colors.chip }]}>
                              <Text style={[styles.confirmCancelLabel, { color: colors.muted }]}>
                                취소
                              </Text>
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => setDeleteConfirmId(item.id)}
                            style={styles.iconAction}>
                            <SymbolView
                              name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                              tintColor={colors.muted}
                              size={16}
                            />
                          </Pressable>
                        )}
                      </View>
                    </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 32,
    gap: 14,
  },
  searchWrap: {
    position: 'relative',
  },
  searchIcon: {
    position: 'absolute',
    left: 14,
    top: 14,
    zIndex: 1,
  },
  searchInput: {
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 40,
    paddingRight: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  chips: {
    gap: 8,
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  count: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    paddingHorizontal: 2,
  },
  listControls: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  listControlsOpen: {
    zIndex: 10,
  },
  statusDropdown: {
    position: 'relative',
  },
  statusButton: {
    minWidth: 112,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusButtonLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  statusMenu: {
    position: 'absolute',
    top: 44,
    right: 0,
    width: 148,
    borderRadius: 12,
    borderWidth: 1,
    padding: 5,
    zIndex: 20,
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  statusOption: {
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusOptionLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: fonts.sansMedium,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 6,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  emptyHint: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  list: {
    gap: 16,
  },
  group: {
    gap: 10,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  groupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  groupCount: {
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actions: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pauseButton: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pauseLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  lifecycleActionLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconAction: {
    padding: 8,
    borderRadius: 8,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 6,
  },
  confirmDelete: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  confirmDeleteLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  confirmCancel: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  confirmCancelLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: fonts.sansMedium,
  },
});
