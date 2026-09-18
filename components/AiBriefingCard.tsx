import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { router, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { fetchWeeklyDigest, type WeeklyDigest } from '@/lib/ai-briefings';
import {
  answerBriefingCheckin,
  markBriefingEventDisplayed,
  selectUsagePromptCandidate,
  snoozeBriefingEvent,
} from '@/lib/briefing-events';
import { kstISODate } from '@/lib/briefing';
import { advanceSubscriptionLifecycle, listLifecycleAlerts } from '@/lib/lifecycle';
import { buildNowLogCards, type NowLogCard } from '@/lib/nowlog';
import { formatCurrency, getActiveSubscriptions, useSubscriptionStore } from '@/stores/subscription-store';
import type { BriefingEvent } from '@/types/briefing-event';
import type { LifecycleAlert, Subscription } from '@/types/subscription';

function openAssistant(options?: {
  prompt?: string;
  eventId?: string;
  subscriptionId?: string;
  intent?: string;
  entrySource?: string;
}) {
  const params = new URLSearchParams();
  if (options?.prompt) params.set('prompt', options.prompt);
  if (options?.eventId) params.set('eventId', options.eventId);
  if (options?.subscriptionId) params.set('subscriptionId', options.subscriptionId);
  if (options?.intent) params.set('intent', options.intent);
  if (options?.entrySource) params.set('entrySource', options.entrySource);
  const query = params.toString();
  router.push((query ? `/(tabs)/assistant?${query}` : '/(tabs)/assistant') as Href);
}

type AiBriefingCardProps = {
  refreshKey?: number;
};

const AUTO_ROTATE_MS = 7000;

function shortPeriod(start: string, end: string): string {
  const [, startMonth, startDay] = start.split('-').map(Number);
  const [, endMonth, endDay] = end.split('-').map(Number);
  return startMonth === endMonth
    ? `${startMonth}월 ${startDay}일–${endDay}일`
    : `${startMonth}월 ${startDay}일–${endMonth}월 ${endDay}일`;
}

function comparison(digest: WeeklyDigest): string {
  if (digest.thisWeek === 0) return '이번 주 예정된 구독 결제가 없어요';
  if (digest.lastWeek === 0) return '이번 주 결제 예정이 새로 있어요';
  if (digest.delta === 0) return '지난주와 같은 금액이에요';
  return `지난주보다 ${formatCurrency(Math.abs(digest.delta))} ${digest.delta > 0 ? '많아요' : '적어요'}`;
}

function assistantPrompt(digest: WeeklyDigest): string {
  const services = digest.charges.map((item) => item.name).filter(Boolean);
  const serviceContext = services.length > 0 ? ` 관련 구독: ${services.join(', ')}.` : '';
  return `이번 주 결제 예정 금액 ${formatCurrency(digest.thisWeek)}이 어떤 구독으로 구성됐는지 구독별로 알려줘.${serviceContext}`;
}

export function AiBriefingCard({ refreshKey = 0 }: AiBriefingCardProps) {
  const colors = useThemeColors();
  const { width: windowWidth } = useWindowDimensions();
  const slideWidth = Math.max(0, windowWidth - 40);
  const { openEdit } = useSubscriptionModal();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const fetchSubscriptions = useSubscriptionStore((state) => state.fetchSubscriptions);
  const updateSubscription = useSubscriptionStore((state) => state.updateSubscription);
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [usageEvent, setUsageEvent] = useState<BriefingEvent | null>(null);
  const [alerts, setAlerts] = useState<LifecycleAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoRotateAllowed, setAutoRotateAllowed] = useState(true);
  const [restartToken, setRestartToken] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const appStateRef = useRef(AppState.currentState);

  const loadUsage = useCallback(async () => {
    const result = await selectUsagePromptCandidate('home');
    const event = result.ok && result.event && result.event.status !== 'answered' ? result.event : null;
    if (event && event.status === 'pending') {
      const shown = await markBriefingEventDisplayed(event.id);
      setUsageEvent(shown.event ?? event);
      return;
    }
    setUsageEvent(event);
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      setAlerts(await listLifecycleAlerts());
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchWeeklyDigest().then((text) => {
      if (!cancelled) setDigest(text);
    });
    void loadUsage().catch(() => {
      if (!cancelled) setUsageEvent(null);
    });
    void loadAlerts();
    return () => {
      cancelled = true;
    };
  }, [loadAlerts, loadUsage, refreshKey]);

  // 동작 줄이기 / 스크린리더가 켜져 있으면 자동 전환을 완전히 끈다(스와이프는 항상 가능).
  useEffect(() => {
    let cancelled = false;
    async function checkAccessibility() {
      const [reduceMotion, screenReader] = await Promise.all([
        AccessibilityInfo.isReduceMotionEnabled(),
        AccessibilityInfo.isScreenReaderEnabled(),
      ]);
      if (!cancelled) setAutoRotateAllowed(!reduceMotion && !screenReader);
    }
    void checkAccessibility();
    const reduceMotionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (enabled) setAutoRotateAllowed(false);
      else void checkAccessibility();
    });
    const screenReaderSub = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      if (enabled) setAutoRotateAllowed(false);
      else void checkAccessibility();
    });
    return () => {
      cancelled = true;
      reduceMotionSub.remove();
      screenReaderSub.remove();
    };
  }, []);

  // 백그라운드로 가면 자동 전환을 멈추고, 포그라운드로 돌아와도 다시 켜지 않는다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
      if (state !== 'active') setAutoRotateAllowed(false);
    });
    return () => sub.remove();
  }, []);

  async function onUsedRecently() {
    if (!usageEvent || busy) return;
    setBusy(true);
    try {
      await answerBriefingCheckin(usageEvent.id, 'used_recently', 'home');
      setUsageEvent(null);
    } finally {
      setBusy(false);
    }
  }

  async function onNotUsed() {
    if (!usageEvent || busy) return;
    setBusy(true);
    try {
      const result = await answerBriefingCheckin(usageEvent.id, 'not_used', 'home');
      const event = result.event ?? usageEvent;
      setUsageEvent(null);
      openAssistant({
        prompt: `${event.payload.name} 해지 방법 알려줘`,
        eventId: event.id,
        subscriptionId: event.subscription_id,
        intent: 'not_used',
        entrySource: 'home',
      });
    } finally {
      setBusy(false);
    }
  }

  async function onLater() {
    if (!usageEvent || busy) return;
    setBusy(true);
    try {
      await snoozeBriefingEvent(usageEvent.id);
      setUsageEvent(null);
    } finally {
      setBusy(false);
    }
  }

  async function onEndConfirm(alerts: LifecycleAlert[], to: 'ended' | 'active') {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all(alerts.map((alert) => advanceSubscriptionLifecycle(alert.subscription_id, to)));
      await fetchSubscriptions();
      await loadAlerts();
    } finally {
      setBusy(false);
    }
  }

  function onEndingSoonAction(alert: LifecycleAlert) {
    if (alert.lifecycle_status === 'ending_scheduled') {
      openEdit(alert.subscription_id);
      return;
    }
    openAssistant({
      prompt: `${alert.name} 해지 방법 알려줘`,
      subscriptionId: alert.subscription_id,
      intent: 'cancel_guide',
      entrySource: 'home',
    });
  }

  // 무료 체험 D0: [그대로 이용]은 is_trial을 꺼서 유료 전환을 반영하고, [결제 전 해지]는 해지 안내로 보낸다.
  async function onTrialKeep(trialSubs: Subscription[]) {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all(
        trialSubs.map((sub) =>
          updateSubscription(sub.id, {
            name: sub.name,
            amount: sub.amount,
            billing_cycle: sub.billing_cycle,
            category_id: sub.category_id,
            anchor_date: sub.anchor_date,
            next_payment_date: sub.next_payment_date,
            preset_id: sub.preset_id,
            is_active: sub.is_active,
            memo: sub.memo,
            emoji: sub.emoji,
            account_id: sub.account_id,
            billing_channel: sub.billing_channel,
            payment_instrument_id: sub.payment_instrument_id,
            is_trial: false,
            trial_ends_at: null,
          })
        )
      );
      await fetchSubscriptions();
    } finally {
      setBusy(false);
    }
  }

  function onTrialCancel(trialSubs: Subscription[]) {
    if (trialSubs.length === 1) {
      const sub = trialSubs[0];
      openAssistant({
        prompt: `${sub.name} 해지 방법 알려줘`,
        subscriptionId: sub.id,
        intent: 'cancel_guide',
        entrySource: 'home',
      });
      return;
    }
    openAssistant({
      prompt: `${trialSubs.map((sub) => sub.name).join(', ')} 해지 방법 알려줘`,
      intent: 'cancel_guide',
      entrySource: 'home',
    });
  }

  const cards = useMemo<NowLogCard[]>(
    () =>
      buildNowLogCards({
        alerts,
        activeSubscriptions: getActiveSubscriptions(subscriptions),
        usageEvent,
        digest,
        today: kstISODate(),
      }),
    [alerts, digest, subscriptions, usageEvent]
  );

  useEffect(() => {
    if (activeSlide >= cards.length) setActiveSlide(0);
  }, [activeSlide, cards.length]);

  // 카드가 1장이면 자동 전환하지 않는다. 2장 이상이면 7초마다 다음 카드로 넘어간다.
  // 사용자가 직접 스와이프하면(터치 시작) 그 시점부터 7초를 다시 세어 일시정지 효과를 준다.
  useEffect(() => {
    if (cards.length <= 1) return;
    if (!autoRotateAllowed) return;
    const timer = setTimeout(() => {
      if (appStateRef.current !== 'active') return;
      const next = (activeSlide + 1) % cards.length;
      scrollRef.current?.scrollTo({ x: slideWidth * next, animated: true });
      setActiveSlide(next);
    }, AUTO_ROTATE_MS);
    return () => clearTimeout(timer);
  }, [activeSlide, autoRotateAllowed, cards.length, slideWidth, restartToken]);

  function onCarouselEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (slideWidth <= 0) return;
    setActiveSlide(Math.round(event.nativeEvent.contentOffset.x / slideWidth));
  }

  function onCarouselTouch() {
    setRestartToken((value) => value + 1);
  }

  function primaryAction(card: NowLogCard) {
    if (card.kind === 'ending_soon' && card.alerts?.length === 1) {
      onEndingSoonAction(card.alerts[0]);
      return;
    }
    router.push('/(tabs)/subscriptions' as Href);
  }

  function renderCard(card: NowLogCard) {
    if (card.kind === 'end_confirm') {
      return (
        <View style={[styles.card, { backgroundColor: colors.roseBg }]}>
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: colors.primary }]}>
              <SymbolView
                name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
                tintColor="#FFFFFF"
                size={16}
              />
            </View>
            <Text style={[styles.kicker, { color: colors.primary }]}>종료 확인</Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{card.title}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={2}>
            {card.subtitle}
          </Text>
          <View style={styles.chips}>
            <Pressable disabled={busy} onPress={() => void onEndConfirm(card.alerts!, 'ended')} style={styles.chip}>
              <Text style={[styles.chipLabel, { color: colors.primary }]}>종료됐어요</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => void onEndConfirm(card.alerts!, 'active')} style={styles.chip}>
              <Text style={[styles.chipLabel, { color: colors.primary }]}>아직 결제돼요</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (card.kind === 'ending_soon') {
      return (
        <View style={[styles.card, { backgroundColor: colors.roseBg }]}>
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: colors.primary }]}>
              <SymbolView
                name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
                tintColor="#FFFFFF"
                size={16}
              />
            </View>
            <Text style={[styles.kicker, { color: colors.primary }]}>종료 예정</Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{card.title}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={2}>
            {card.subtitle}
          </Text>
          <View style={styles.chips}>
            <Pressable onPress={() => primaryAction(card)} style={styles.chip}>
              <Text style={[styles.chipLabel, { color: colors.primary }]}>{card.primaryLabel}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (card.kind === 'weekly_briefing' && card.digest) {
      const weeklyDigest = card.digest;
      return (
        <Pressable
          onPress={() => openAssistant({ prompt: assistantPrompt(weeklyDigest), entrySource: 'weekly_digest' })}
          accessibilityRole="button"
          accessibilityLabel="이번 주 결제 브리핑, AI 비서에게 구성 구독 물어보기"
          style={[styles.card, styles.digestCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}
        >
          <View style={styles.digestHead}>
            <View style={styles.head}>
              <View style={[styles.icon, { backgroundColor: colors.primary }]}>
                <SymbolView
                  name={{ ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' }}
                  tintColor="#FFFFFF"
                  size={16}
                />
              </View>
              <Text style={[styles.kicker, { color: colors.primary }]}>나우 로그</Text>
            </View>
            <Text style={[styles.period, { color: colors.muted }]}>
              {shortPeriod(weeklyDigest.weekStart, weeklyDigest.weekEnd)}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{card.title}</Text>
          <Text style={[styles.comparison, { color: colors.text }]}>{card.subtitle}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={2}>
            {comparison(weeklyDigest)} · {weeklyDigest.reason}
          </Text>
          <View style={styles.digestAction}>
            <Text style={[styles.digestActionLabel, { color: colors.primary }]}>
              어떤 구독 때문인지 AI에게 물어보기
            </Text>
            <SymbolView
              name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              tintColor={colors.primary}
              size={18}
            />
          </View>
        </Pressable>
      );
    }

    // trial_ending / today_payment / usage_checkin / quiet: 공용 "나우 로그" 카드 레이아웃
    return (
      <View style={[styles.card, { backgroundColor: colors.accent }]}>
        <View style={styles.head}>
          <View style={[styles.icon, { backgroundColor: colors.primary }]}>
            <SymbolView
              name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
              tintColor="#FFFFFF"
              size={16}
            />
          </View>
          <Text style={[styles.kicker, { color: colors.primary }]}>나우 로그</Text>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>{card.title}</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={2}>
          {card.subtitle}
        </Text>
        <View style={styles.chips}>
          {card.kind === 'usage_checkin' ? (
            <>
              <Pressable disabled={busy} onPress={() => void onUsedRecently()} style={styles.chip}>
                <Text style={[styles.chipLabel, { color: colors.primary }]}>최근 사용했어요</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => void onNotUsed()} style={styles.chip}>
                <Text style={[styles.chipLabel, { color: colors.primary }]}>사용 안 했어요</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => void onLater()} style={styles.chip}>
                <Text style={[styles.chipLabel, { color: colors.primary }]}>나중에</Text>
              </Pressable>
            </>
          ) : card.kind === 'trial_ending' ? (
            <>
              <Pressable disabled={busy} onPress={() => void onTrialKeep(card.subscriptions!)} style={styles.chip}>
                <Text style={[styles.chipLabel, { color: colors.primary }]}>그대로 이용</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => onTrialCancel(card.subscriptions!)} style={styles.chip}>
                <Text style={[styles.chipLabel, { color: colors.primary }]}>결제 전 해지</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => primaryAction(card)} style={styles.chip}>
              <Text style={[styles.chipLabel, { color: colors.primary }]}>{card.primaryLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View accessible={false}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onCarouselEnd}
          onScrollBeginDrag={onCarouselTouch}
          accessibilityRole="adjustable"
          accessibilityLabel="홈 나우 로그 카드"
        >
          {cards.map((card, index) => (
            <View key={`${card.kind}-${index}`} style={[styles.slide, { width: slideWidth }]}>
              {renderCard(card)}
            </View>
          ))}
        </ScrollView>
        {cards.length > 1 ? (
          <View style={styles.pagination} accessibilityLabel={`${activeSlide + 1}/${cards.length} 페이지`}>
            {cards.map((card, index) => (
              <View
                key={`${card.kind}-dot-${index}`}
                style={[
                  styles.dot,
                  { backgroundColor: index === activeSlide ? colors.primary : colors.border },
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  slide: {
    paddingHorizontal: 1,
  },
  card: {
    borderRadius: 20,
    padding: 18,
    gap: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  digestCard: {
    borderWidth: 1,
  },
  digestHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  period: {
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  comparison: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  digestAction: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(99,102,241,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  digestActionLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  pagination: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
