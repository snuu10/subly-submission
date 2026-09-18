import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';

import { useThemeColors, type ThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import {
  applyCategoryChipOrder,
  movableCategoryIds,
  moveCategoryIdTo,
} from '@/lib/category-order';
import { notify } from '@/lib/confirm';
import {
  getVisibleCategories,
  isEtcCategory,
  useCategoryStore,
} from '@/stores/category-store';
import type { Category } from '@/types/category';

const ROW_HEIGHT = 52;

type CategoryOrderSectionProps = {
  onDraggingChange: (dragging: boolean) => void;
};

export function CategoryOrderSection({ onDraggingChange }: CategoryOrderSectionProps) {
  const colors = useThemeColors();
  const categories = useCategoryStore((state) => state.categories);
  const chipOrderIds = useCategoryStore((state) => state.chipOrderIds);
  const reorderChipOrder = useCategoryStore((state) => state.reorderChipOrder);

  const ordered = applyCategoryChipOrder(getVisibleCategories(categories), chipOrderIds, 'app');
  const movable = ordered.filter((item) => !isEtcCategory(item));
  const etc = ordered.find((item) => isEtcCategory(item));
  const movableIds = movableCategoryIds(ordered);
  const movableIdsRef = useRef(movableIds);
  movableIdsRef.current = movableIds;

  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const activeIndex = useSharedValue(-1);
  const hoverIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);

  const setDraggingState = useCallback(
    (next: boolean) => {
      setDragging(next);
      onDraggingChange(next);
    },
    [onDraggingChange]
  );

  const persist = useCallback(
    (from: number, to: number) => {
      const next = moveCategoryIdTo(movableIdsRef.current, from, to);
      if (!next || next === movableIdsRef.current) return;
      void reorderChipOrder(next).then((ok) => {
        if (!ok) notify('순서 저장 실패', useCategoryStore.getState().error ?? '다시 시도해 주세요.');
      });
    },
    [reorderChipOrder]
  );

  const resetDrag = useCallback(() => {
    dragY.value = 0;
    activeIndex.value = -1;
    hoverIndex.value = -1;
    setDraggingState(false);
  }, [activeIndex, dragY, hoverIndex, setDraggingState]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>구독 목록 순서</Text>
        <Pressable
          onPress={() => {
            if (editing) resetDrag();
            setEditing((prev) => !prev);
          }}
          accessibilityRole="button"
          accessibilityLabel={editing ? '카테고리 순서 잠그기' : '카테고리 순서 잠금 해제'}
          hitSlop={6}
          style={[
            styles.lockButton,
            {
              backgroundColor: editing ? colors.accent : colors.surface,
              borderColor: editing ? colors.primary : colors.border,
            },
          ]}>
          <SymbolView
            name={
              editing
                ? { ios: 'lock.open.fill', android: 'lock_open', web: 'lock_open' }
                : { ios: 'lock.fill', android: 'lock', web: 'lock' }
            }
            tintColor={editing ? colors.primary : colors.muted}
            size={16}
          />
        </Pressable>
      </View>
      <Text style={[styles.sectionHint, { color: colors.muted }]}>
        {editing
          ? '왼쪽 핸들을 드래그해 순서를 바꾸세요. 끝나면 자물쇠로 잠가 주세요. 기타는 맨 뒤에 고정됩니다.'
          : '구독 목록 칩 순서입니다. 바꾸려면 오른쪽 자물쇠를 누르세요. 전체는 맨 앞, 기타는 맨 뒤에 고정됩니다.'}
      </Text>

      {ordered.length === 0 ? (
        <View style={[styles.card, styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionHint, { color: colors.muted }]}>표시할 카테고리가 없습니다.</Text>
        </View>
      ) : (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              overflow: dragging ? 'visible' : 'hidden',
            },
          ]}>
          {movable.map((category, index) => (
            <OrderRow
              key={category.id}
              category={category}
              index={index}
              count={movable.length}
              editing={editing}
              colors={colors}
              activeIndex={activeIndex}
              hoverIndex={hoverIndex}
              dragY={dragY}
              onDraggingChange={setDraggingState}
              onDrop={persist}
            />
          ))}
          {etc ? (
            <View
              style={[
                styles.row,
                movable.length > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
                { backgroundColor: colors.background },
              ]}>
              {editing ? (
                <View style={styles.grip}>
                  <SymbolView
                    name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
                    tintColor={colors.muted}
                    size={14}
                  />
                </View>
              ) : null}
              <View style={[styles.dot, { backgroundColor: etc.color }]} />
              <Text style={[styles.rowName, { color: colors.muted }]}>{etc.name}</Text>
              <Text style={[styles.badge, { color: colors.muted }]}>고정</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

type OrderRowProps = {
  category: Category;
  index: number;
  count: number;
  editing: boolean;
  colors: ThemeColors;
  activeIndex: SharedValue<number>;
  hoverIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  onDraggingChange: (dragging: boolean) => void;
  onDrop: (from: number, to: number) => void;
};

function OrderRow({
  category,
  index,
  count,
  editing,
  colors,
  activeIndex,
  hoverIndex,
  dragY,
  onDraggingChange,
  onDrop,
}: OrderRowProps) {
  const shiftY = useSharedValue(0);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onDropRef = useRef(onDrop);
  const onDraggingChangeRef = useRef(onDraggingChange);
  indexRef.current = index;
  countRef.current = count;
  onDropRef.current = onDrop;
  onDraggingChangeRef.current = onDraggingChange;

  useAnimatedReaction(
    () => {
      const from = activeIndex.value;
      const over = hoverIndex.value;
      if (from < 0 || index === from) return 0;
      if (from < over && index > from && index <= over) return -ROW_HEIGHT;
      if (from > over && index >= over && index < from) return ROW_HEIGHT;
      return 0;
    },
    (next) => {
      if (activeIndex.value < 0) {
        shiftY.value = 0;
        return;
      }
      shiftY.value = withTiming(next, { duration: 180 });
    }
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: (_, gesture) => editing && Math.abs(gesture.dy) > 2,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          const from = indexRef.current;
          activeIndex.value = from;
          hoverIndex.value = from;
          dragY.value = 0;
          onDraggingChangeRef.current(true);
        },
        onPanResponderMove: (_, gesture) => {
          dragY.value = gesture.dy;
          const from = indexRef.current;
          const next = Math.max(
            0,
            Math.min(countRef.current - 1, from + Math.round(gesture.dy / ROW_HEIGHT))
          );
          hoverIndex.value = next;
        },
        onPanResponderRelease: () => {
          const from = activeIndex.value;
          const to = hoverIndex.value;
          dragY.value = 0;
          activeIndex.value = -1;
          hoverIndex.value = -1;
          onDraggingChangeRef.current(false);
          if (from >= 0 && to >= 0 && from !== to) onDropRef.current(from, to);
        },
        onPanResponderTerminate: () => {
          dragY.value = 0;
          activeIndex.value = -1;
          hoverIndex.value = -1;
          onDraggingChangeRef.current(false);
        },
      }),
    [activeIndex, dragY, editing, hoverIndex]
  );

  const animatedStyle = useAnimatedStyle(() => {
    const dragging = activeIndex.value === index;
    return {
      transform: [{ translateY: dragging ? dragY.value : shiftY.value }, { scale: dragging ? 1.02 : 1 }],
      zIndex: dragging ? 20 : 0,
      elevation: dragging ? 8 : 0,
      shadowOpacity: dragging ? 0.16 : 0,
    };
  });

  return (
    <Animated.View
      style={[
        styles.row,
        index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
        {
          height: ROW_HEIGHT,
          backgroundColor: colors.surface,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowRadius: 10,
        },
        animatedStyle,
      ]}>
      {editing ? (
        <View
          {...pan.panHandlers}
          collapsable={false}
          style={styles.grip}
          accessibilityLabel={`${category.name} 순서 옮기기`}>
          <SymbolView
            name={{ ios: 'line.3.horizontal', android: 'drag_handle', web: 'drag_handle' }}
            tintColor={colors.muted}
            size={16}
          />
        </View>
      ) : null}
      <View style={[styles.dot, { backgroundColor: category.color }]} />
      <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
        {category.name}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  lockButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    height: ROW_HEIGHT,
  },
  grip: {
    width: 28,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
