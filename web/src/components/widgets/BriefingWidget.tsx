import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDashboardDragHandle } from '@/components/dashboard/DashboardDragHandleContext';
import {
  answerBriefingCheckin,
  markBriefingEventDisplayed,
  selectUsagePromptCandidate,
  snoozeBriefingEvent,
} from '@/lib/briefing-events';
import { getActiveSubscriptions } from '@/lib/calc';
import { kstISODate } from '@/lib/briefing';
import { updateSubscription as updateSubscriptionRequest } from '@/lib/data';
import { advanceSubscriptionLifecycle, listLifecycleAlerts } from '@/lib/lifecycle';
import { buildNowLogCards, type NowLogCard } from '@/lib/nowlog';
import type { BriefingEvent } from '@/types/briefing-event';
import type { Category, LifecycleAlert, Subscription } from '@/types';

export type AssistantLaunch = {
  prompt?: string;
  eventId?: string;
  subscriptionId?: string;
  intent?: string;
  entrySource?: string;
};

type BriefingWidgetProps = {
  subscriptions: Subscription[];
  categories: Category[];
  refreshKey?: number;
  onAsk: (launch?: AssistantLaunch) => void;
  onOpenList: () => void;
  onEdit: (item: Subscription) => void;
  onReload?: () => Promise<void> | void;
};

const AUTO_ROTATE_MS = 7000;

export function BriefingWidget({
  subscriptions,
  refreshKey = 0,
  onAsk,
  onOpenList,
  onEdit,
  onReload,
}: BriefingWidgetProps) {
  const dragHandle = useDashboardDragHandle();
  const [usageEvent, setUsageEvent] = useState<BriefingEvent | null>(null);
  const [alerts, setAlerts] = useState<LifecycleAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoRotateAllowed, setAutoRotateAllowed] = useState(true);

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
    void loadUsage().catch(() => {
      if (!cancelled) setUsageEvent(null);
    });
    void loadAlerts();
    return () => {
      cancelled = true;
    };
  }, [loadAlerts, loadUsage, refreshKey]);

  // 동작 줄이기 설정이면 자동 전환을 끈다(점 클릭/스와이프는 항상 가능).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setAutoRotateAllowed(!query.matches);
    const onChange = (event: MediaQueryListEvent) => setAutoRotateAllowed(!event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // 탭이 백그라운드로 가면 자동 전환을 멈추고, 다시 돌아와도 재개하지 않는다.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        setAutoRotateAllowed(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
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
      onAsk({
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

  async function onEndConfirm(targetAlerts: LifecycleAlert[], to: 'ended' | 'active') {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all(targetAlerts.map((alert) => advanceSubscriptionLifecycle(alert.subscription_id, to)));
      await onReload?.();
      await loadAlerts();
    } finally {
      setBusy(false);
    }
  }

  function onEndingSoonAction(alert: LifecycleAlert) {
    if (alert.lifecycle_status === 'ending_scheduled') {
      const target = subscriptions.find((item) => item.id === alert.subscription_id);
      if (target) {
        onEdit(target);
        return;
      }
    }
    onAsk({
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
          updateSubscriptionRequest(
            sub.id,
            {
              name: sub.name,
              amount: sub.amount,
              billing_cycle: sub.billing_cycle,
              category_id: sub.category_id,
              anchor_date: sub.anchor_date,
              is_active: sub.is_active,
              memo: sub.memo,
              preset_id: sub.preset_id,
              emoji: sub.emoji,
              account_id: sub.account_id,
              billing_channel: sub.billing_channel,
              payment_instrument_id: sub.payment_instrument_id,
              is_trial: false,
              trial_ends_at: null,
            },
            subscriptions
          )
        )
      );
      await onReload?.();
    } finally {
      setBusy(false);
    }
  }

  function onTrialCancel(trialSubs: Subscription[]) {
    if (trialSubs.length === 1) {
      const sub = trialSubs[0];
      onAsk({
        prompt: `${sub.name} 해지 방법 알려줘`,
        subscriptionId: sub.id,
        intent: 'cancel_guide',
        entrySource: 'home',
      });
      return;
    }
    onAsk({
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
        // 웹은 인사이트 위젯이 이미 주간 브리핑을 따로 보여주므로 나우 로그 큐에서는 뺀다.
        digest: null,
        today: kstISODate(),
      }),
    [alerts, subscriptions, usageEvent]
  );

  useEffect(() => {
    if (activeIndex >= cards.length) setActiveIndex(0);
  }, [activeIndex, cards.length]);

  useEffect(() => {
    if (cards.length <= 1) return;
    if (!autoRotateAllowed) return;
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      setActiveIndex((value) => (value + 1) % cards.length);
    }, AUTO_ROTATE_MS);
    return () => clearTimeout(timer);
  }, [activeIndex, autoRotateAllowed, cards.length]);

  function primaryAction(card: NowLogCard) {
    if (card.kind === 'ending_soon' && card.alerts?.length === 1) {
      onEndingSoonAction(card.alerts[0]);
      return;
    }
    onOpenList();
  }

  const card = cards[activeIndex] ?? cards[0];
  if (!card) return null;

  return (
    <div className="dashboard-widget-scroll flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
      {card.kind === 'end_confirm' ? (
        <section className="rounded-2xl bg-[#FCE7F3] p-5">
          <div className="flex items-center gap-1">
            {dragHandle}
            <p className="text-xs font-extrabold text-primary">종료 확인</p>
          </div>
          <h2 className="mt-1 text-lg font-extrabold text-text">{card.title}</h2>
          <p className="mt-1 text-sm text-muted">{card.subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onEndConfirm(card.alerts!, 'ended')}
              className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
            >
              종료됐어요
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onEndConfirm(card.alerts!, 'active')}
              className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
            >
              아직 결제돼요
            </button>
          </div>
        </section>
      ) : card.kind === 'ending_soon' ? (
        <section className="rounded-2xl bg-[#FCE7F3] p-5">
          <div className="flex items-center gap-1">
            {dragHandle}
            <p className="text-xs font-extrabold text-primary">종료 예정</p>
          </div>
          <h2 className="mt-1 text-lg font-extrabold text-text">{card.title}</h2>
          <p className="mt-1 text-sm text-muted">{card.subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => primaryAction(card)}
              className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
            >
              {card.primaryLabel}
            </button>
          </div>
        </section>
      ) : (
        <section className="flex flex-1 flex-col rounded-2xl bg-[#EDE9FE] p-5">
          <div className="mb-2 flex items-center gap-1">
            {dragHandle}
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[10px] font-extrabold text-white">
              AI
            </span>
            <p className="text-xs font-extrabold text-primary">나우 로그</p>
          </div>
          <h2 className="text-lg font-extrabold text-text">{card.title}</h2>
          <p className="mt-1 text-sm text-muted">{card.subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {card.kind === 'usage_checkin' ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onUsedRecently()}
                  className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
                >
                  최근 사용했어요
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onNotUsed()}
                  className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
                >
                  사용 안 했어요
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onLater()}
                  className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
                >
                  나중에
                </button>
              </>
            ) : card.kind === 'trial_ending' ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onTrialKeep(card.subscriptions!)}
                  className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
                >
                  그대로 이용
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onTrialCancel(card.subscriptions!)}
                  className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
                >
                  결제 전 해지
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => primaryAction(card)}
                className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-primary"
              >
                {card.primaryLabel}
              </button>
            )}
          </div>
        </section>
      )}
      {cards.length > 1 ? (
        <div className="flex items-center justify-center gap-1.5" aria-label={`${activeIndex + 1}/${cards.length} 페이지`}>
          {cards.map((item, index) => (
            <button
              key={`${item.kind}-${index}`}
              type="button"
              aria-label={`${index + 1}번째 카드로 이동`}
              onClick={() => setActiveIndex(index)}
              className={`size-1.5 rounded-full transition-colors ${
                index === activeIndex ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
