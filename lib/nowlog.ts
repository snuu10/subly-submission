import { formatCurrency, formatShortDate } from '@/stores/subscription-store';
import type { WeeklyDigest } from '@/lib/ai-briefings';
import type { BriefingEvent } from '@/types/briefing-event';
import type { LifecycleAlert, Subscription } from '@/types/subscription';

/**
 * 나우 로그 홈 카드의 우선순위 큐.
 * 결정 문서: docs/nowlog-topic-priority-decisions.md
 */
export type NowLogKind =
  | 'end_confirm'
  | 'trial_ending'
  | 'today_payment'
  | 'ending_soon'
  | 'usage_checkin'
  | 'weekly_briefing'
  | 'quiet';

export type NowLogCard = {
  kind: NowLogKind;
  title: string;
  subtitle: string;
  primaryLabel?: string;
  alerts?: LifecycleAlert[];
  subscriptions?: Subscription[];
  event?: BriefingEvent;
  digest?: WeeklyDigest;
};

const MAX_CARDS = 3;

function groupNames(items: { name: string }[]): string {
  const shown = items.slice(0, 2);
  const rest = items.length - shown.length;
  const lines = shown.map((item) => item.name);
  if (rest > 0) lines.push(`외 ${rest}개`);
  return lines.join(' · ');
}

function groupWithAmount(items: { name: string; amount: number }[]): string {
  const shown = items.slice(0, 2);
  const rest = items.length - shown.length;
  const lines = shown.map((item) => `${item.name} · ${formatCurrency(item.amount)}`);
  if (rest > 0) lines.push(`외 ${rest}개`);
  return lines.join(' · ');
}

function endConfirmCard(alerts: LifecycleAlert[]): NowLogCard {
  if (alerts.length === 1) {
    const alert = alerts[0];
    return {
      kind: 'end_confirm',
      title: `${alert.name}, 종료됐는지 확인해 주세요`,
      subtitle: '종료되면 목록에서 비활성화하고, 아직 결제되면 이용 중으로 돌려요.',
      alerts,
    };
  }
  return {
    kind: 'end_confirm',
    title: `구독 ${alerts.length}개 종료 확인이 필요해요`,
    subtitle: groupNames(alerts),
    alerts,
  };
}

/** ending_soon의 lifecycle_status별 권장 버튼. docs/nowlog-topic-priority-decisions.md 참고. */
export function endingSoonLabel(status: LifecycleAlert['lifecycle_status']): string {
  if (status === 'guide_reviewed') return '해지 계속하기';
  if (status === 'cancel_requested') return '진행 상태 확인';
  return '구독 확인하기';
}

function endingSoonCard(alerts: LifecycleAlert[]): NowLogCard {
  if (alerts.length === 1) {
    const alert = alerts[0];
    const when =
      alert.days_until <= 0 ? '오늘' : alert.days_until === 1 ? '내일' : `${alert.days_until}일 뒤`;
    const subtitle = alert.service_end_date
      ? `종료일 ${formatShortDate(alert.service_end_date)} · 해지 시 월 ${formatCurrency(alert.monthly_save)}`
      : `해지 시 월 ${formatCurrency(alert.monthly_save)}`;
    return {
      kind: 'ending_soon',
      title: `${alert.name} 이용이 ${when} 끝나요`,
      subtitle,
      primaryLabel: endingSoonLabel(alert.lifecycle_status),
      alerts,
    };
  }
  return {
    kind: 'ending_soon',
    title: `구독 ${alerts.length}개가 곧 끝나요`,
    subtitle: groupNames(alerts),
    primaryLabel: '구독 확인하기',
    alerts,
  };
}

function trialEndingCard(subscriptions: Subscription[]): NowLogCard {
  if (subscriptions.length === 1) {
    const sub = subscriptions[0];
    return {
      kind: 'trial_ending',
      title: `${sub.name} 무료 체험이 오늘 끝나요`,
      subtitle: `오늘부터 ${formatCurrency(sub.amount)}이 결제될 수 있어요`,
      primaryLabel: '구독 확인하기',
      subscriptions,
    };
  }
  return {
    kind: 'trial_ending',
    title: `무료 체험 ${subscriptions.length}개가 오늘 끝나요`,
    subtitle: groupWithAmount(subscriptions),
    primaryLabel: `${subscriptions.length}개 구독 확인하기`,
    subscriptions,
  };
}

function todayPaymentCard(subscriptions: Subscription[]): NowLogCard {
  if (subscriptions.length === 1) {
    const sub = subscriptions[0];
    return {
      kind: 'today_payment',
      title: `${sub.name} 결제가 오늘이에요`,
      subtitle: `오늘 ${formatCurrency(sub.amount)}이 결제돼요`,
      primaryLabel: '구독 확인하기',
      subscriptions,
    };
  }
  return {
    kind: 'today_payment',
    title: `오늘 결제 ${subscriptions.length}건`,
    subtitle: groupWithAmount(subscriptions),
    primaryLabel: `${subscriptions.length}개 구독 확인하기`,
    subscriptions,
  };
}

function usageCheckinCard(event: BriefingEvent): NowLogCard {
  return {
    kind: 'usage_checkin',
    title: `${event.payload.name}, 최근 30일 동안 쓰셨나요?`,
    subtitle: '자동으로는 알 수 없어서, 직접 확인해 볼게요.',
    event,
  };
}

function weeklyBriefingCard(digest: WeeklyDigest, today: string): NowLogCard {
  const todayCount = digest.charges.filter((charge) => charge.chargeDate === today).length;
  const totalCount = digest.charges.length;
  const subtitle =
    totalCount > 0
      ? `오늘 결제 ${todayCount}건 포함 · 이번 주 총 ${totalCount}건`
      : '이번 주 예정된 결제가 없어요';
  return {
    kind: 'weekly_briefing',
    title: `이번 주 ${formatCurrency(digest.thisWeek)} 결제 예정`,
    subtitle,
    digest,
  };
}

function quietCard(active: Subscription[]): NowLogCard {
  const next = [...active].sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date))[0];
  return {
    kind: 'quiet',
    title: '이번 주 결제 없어요',
    subtitle: next
      ? `다음 결제는 ${formatShortDate(next.next_payment_date)} ${next.name}`
      : '등록한 구독이 있으면 여기서 알려 드려요',
    primaryLabel: '구독 목록 보기',
  };
}

/**
 * 우선순위: 종료 확인 → 무료 체험 D0 → 오늘 결제 → 종료 예정 → 사용 여부 확인 → 주간 브리핑.
 * 같은 구독이 여러 후보에 걸리면 상위 우선순위 카드만 남기고 하위는 제외한다.
 * 후보가 하나도 없으면(주간 브리핑 포함) 조용한 안내 카드를 대신 보여준다.
 * 최종 결과는 최대 3장으로 자른다.
 */
export function buildNowLogCards(input: {
  alerts: LifecycleAlert[];
  activeSubscriptions: Subscription[];
  usageEvent: BriefingEvent | null;
  digest: WeeklyDigest | null;
  today: string;
}): NowLogCard[] {
  const used = new Set<string>();
  const cards: NowLogCard[] = [];

  const endConfirmAlerts = input.alerts.filter((item) => item.kind === 'end_confirm');
  if (endConfirmAlerts.length > 0) {
    cards.push(endConfirmCard(endConfirmAlerts));
    endConfirmAlerts.forEach((item) => used.add(item.subscription_id));
  }

  const trialSubs = input.activeSubscriptions.filter(
    (item) => item.is_trial && item.trial_ends_at === input.today && !used.has(item.id)
  );
  if (trialSubs.length > 0) {
    cards.push(trialEndingCard(trialSubs));
    trialSubs.forEach((item) => used.add(item.id));
  }

  const todaySubs = input.activeSubscriptions.filter(
    (item) => item.next_payment_date === input.today && !used.has(item.id)
  );
  if (todaySubs.length > 0) {
    cards.push(todayPaymentCard(todaySubs));
    todaySubs.forEach((item) => used.add(item.id));
  }

  const endingSoonAlerts = input.alerts.filter(
    (item) => item.kind === 'ending_soon' && !used.has(item.subscription_id)
  );
  if (endingSoonAlerts.length > 0) {
    cards.push(endingSoonCard(endingSoonAlerts));
    endingSoonAlerts.forEach((item) => used.add(item.subscription_id));
  }

  if (input.usageEvent && !used.has(input.usageEvent.subscription_id)) {
    cards.push(usageCheckinCard(input.usageEvent));
    used.add(input.usageEvent.subscription_id);
  }

  if (input.digest) {
    cards.push(weeklyBriefingCard(input.digest, input.today));
  }

  if (cards.length === 0) {
    cards.push(quietCard(input.activeSubscriptions));
  }

  return cards.slice(0, MAX_CARDS);
}
