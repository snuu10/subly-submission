import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/DateField';
import { OptionChips } from '@/components/OptionChips';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { listMyUsageHistory } from '@/lib/briefing-events';
import { notify } from '@/lib/confirm';
import {
  formatUsageHistoryAt,
  formatUsageHistorySnooze,
  kstTodayIso,
  toKstRangeEnd,
  toKstRangeStart,
  USAGE_HISTORY_LABEL,
  USAGE_HISTORY_SOURCE_LABEL,
  usageHistoryMonthlyAmount,
} from '@/lib/usage-checkin';
import { formatCurrency, useSubscriptionStore } from '@/stores/subscription-store';
import type {
  UsageHistoryItem,
  UsageHistoryQuery,
  UsageHistoryResponse,
  UsageHistorySummary,
} from '@/types/briefing-event';

const RESPONSE_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'used_recently', label: USAGE_HISTORY_LABEL.used_recently },
  { value: 'occasionally', label: USAGE_HISTORY_LABEL.occasionally },
  { value: 'not_used', label: USAGE_HISTORY_LABEL.not_used },
  { value: 'unsure', label: USAGE_HISTORY_LABEL.unsure },
  { value: 'later', label: USAGE_HISTORY_LABEL.later },
] as const;

type ResponseFilter = (typeof RESPONSE_FILTERS)[number]['value'];

function emptySummary(): UsageHistorySummary {
  return {
    response_counts: {
      used_recently: 0,
      occasionally: 0,
      not_used: 0,
      unsure: 0,
      later: 0,
    },
    unused: [],
    latest_by_subscription: [],
  };
}

function historyHint(item: UsageHistoryItem): string {
  const source = USAGE_HISTORY_SOURCE_LABEL[item.source];
  const when = formatUsageHistoryAt(item.at);
  if (item.snoozed_until) {
    return `${source} · ${when} · 나중까지 ${formatUsageHistorySnooze(item.snoozed_until)}`;
  }
  if (item.next_check_at) {
    return `${source} · ${when} · 다음 질문 ${formatUsageHistorySnooze(`${item.next_check_at}T00:00:00+09:00`)}`;
  }
  return `${source} · ${when}`;
}

export default function UsageHistoryScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { openEdit } = useSubscriptionModal();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);

  const [items, setItems] = useState<UsageHistoryItem[]>([]);
  const [summary, setSummary] = useState<UsageHistorySummary>(emptySummary());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all');
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);

  const query = useMemo((): UsageHistoryQuery => {
    return {
      limit: 100,
      subscriptionId,
      response: responseFilter === 'all' ? null : (responseFilter as UsageHistoryResponse),
      from: fromDate ? toKstRangeStart(fromDate) : null,
      to: toDate ? toKstRangeEnd(toDate) : null,
    };
  }, [fromDate, responseFilter, subscriptionId, toDate]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listMyUsageHistory(query);
    if (!result.ok) {
      setItems([]);
      setSummary(emptySummary());
      setError(result.message || '기록을 불러오지 못했습니다.');
      setLoading(false);
      return;
    }
    setError(null);
    setItems(result.items);
    setSummary(result.summary);
    setLoading(false);
  }, [query]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const unusedMonthlyTotal = summary.unused.reduce(
    (sum, item) => sum + usageHistoryMonthlyAmount(item.amount, item.billing_cycle),
    0
  );

  const openSubscription = (id: string) => {
    if (!subscriptions.some((item) => item.id === id)) {
      notify('구독을 찾을 수 없어요', '이 구독은 목록에 없거나 삭제되었습니다.');
      return;
    }
    openEdit(id);
  };

  const subscriptionOptions = [
    { value: 'all', label: '전체' },
    ...subscriptions.map((item) => ({ value: item.id, label: item.name })),
  ];

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>사용 기록</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.hint, { color: colors.muted }]}>
          홈과 비서에서 답한 사용 여부입니다. 구독을 삭제하면 그 기록도 함께 사라집니다.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>응답 비율</Text>
          <View style={styles.countWrap}>
            {(Object.keys(USAGE_HISTORY_LABEL) as UsageHistoryResponse[]).map((key) => (
              <View key={key} style={[styles.countChip, { backgroundColor: colors.chip }]}>
                <Text style={[styles.countLabel, { color: colors.muted }]}>{USAGE_HISTORY_LABEL[key]}</Text>
                <Text style={[styles.countValue, { color: colors.text }]}>
                  {summary.response_counts[key]}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>안 쓰는 구독</Text>
          {summary.unused.length === 0 ? (
            <Text style={[styles.meta, { color: colors.muted }]}>최근 체크인이 ‘사용 안 했어요’인 활성 구독이 없어요.</Text>
          ) : (
            <>
              <Text style={[styles.unusedTotal, { color: colors.primary }]}>
                월 {formatCurrency(unusedMonthlyTotal)}
              </Text>
              {summary.unused.map((item) => (
                <Pressable key={item.subscription_id} onPress={() => openSubscription(item.subscription_id)} style={styles.compactRow}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {formatCurrency(usageHistoryMonthlyAmount(item.amount, item.billing_cycle))}/월
                  </Text>
                </Pressable>
              ))}
            </>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>구독별 최근</Text>
          {summary.latest_by_subscription.length === 0 ? (
            <Text style={[styles.meta, { color: colors.muted }]}>아직 기록이 없어요.</Text>
          ) : (
            summary.latest_by_subscription.map((item) => (
              <Pressable
                key={item.subscription_id}
                onPress={() => openSubscription(item.subscription_id)}
                style={styles.compactRow}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.response, { color: colors.primary }]}>
                  {USAGE_HISTORY_LABEL[item.response]}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>{formatUsageHistoryAt(item.at)}</Text>
              </Pressable>
            ))
          )}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>필터</Text>
        <Text style={[styles.filterLabel, { color: colors.muted }]}>구독</Text>
        <OptionChips
          options={subscriptionOptions}
          value={subscriptionId ?? 'all'}
          onChange={(value) => setSubscriptionId(value === 'all' ? null : value)}
        />
        <Text style={[styles.filterLabel, { color: colors.muted }]}>응답</Text>
        <OptionChips
          options={[...RESPONSE_FILTERS]}
          value={responseFilter}
          onChange={setResponseFilter}
        />
        <Text style={[styles.filterLabel, { color: colors.muted }]}>기간</Text>
        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <Text style={[styles.meta, { color: colors.muted }]}>시작</Text>
            {fromDate ? (
              <DateField value={fromDate} onChange={setFromDate} />
            ) : (
              <Pressable
                onPress={() => setFromDate(kstTodayIso())}
                style={[styles.datePlaceholder, { borderColor: colors.border, backgroundColor: colors.chip }]}>
                <Text style={[styles.meta, { color: colors.muted }]}>전체</Text>
              </Pressable>
            )}
            {fromDate ? (
              <Pressable onPress={() => setFromDate(null)}>
                <Text style={[styles.clearDate, { color: colors.primary }]}>지우기</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.dateCol}>
            <Text style={[styles.meta, { color: colors.muted }]}>종료</Text>
            {toDate ? (
              <DateField value={toDate} onChange={setToDate} />
            ) : (
              <Pressable
                onPress={() => setToDate(kstTodayIso())}
                style={[styles.datePlaceholder, { borderColor: colors.border, backgroundColor: colors.chip }]}>
                <Text style={[styles.meta, { color: colors.muted }]}>전체</Text>
              </Pressable>
            )}
            {toDate ? (
              <Pressable onPress={() => setToDate(null)}>
                <Text style={[styles.clearDate, { color: colors.primary }]}>지우기</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {loading ? (
          <Text style={[styles.empty, { color: colors.muted }]}>불러오는 중…</Text>
        ) : null}
        {error ? <Text style={[styles.empty, { color: colors.danger }]}>{error}</Text> : null}

        {!loading && !error && items.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.empty, { color: colors.muted }]}>조건에 맞는 사용 기록이 없어요.</Text>
          </View>
        ) : null}

        {!loading && items.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {items.map((item, index) => (
              <Pressable
                key={item.id}
                onPress={() => openSubscription(item.subscription_id)}
                style={[
                  styles.row,
                  index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
                ]}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.response, { color: colors.primary }]}>
                  {USAGE_HISTORY_LABEL[item.response]}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>{historyHint(item)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
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
    gap: 16,
  },
  hint: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fonts.sans,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  countWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  countChip: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  countLabel: {
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  countValue: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  unusedTotal: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  compactRow: {
    gap: 2,
    paddingVertical: 6,
  },
  filterLabel: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateCol: {
    flex: 1,
    gap: 6,
  },
  datePlaceholder: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  clearDate: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  row: {
    paddingVertical: 14,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  response: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  meta: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  empty: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.sans,
    padding: 4,
  },
});
