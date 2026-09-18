import { BILLING_CHANNEL_LABELS, BILLING_CYCLE_SHORT } from '@/constants/billing';
import { formatCurrency, formatShortDate } from '@/stores/subscription-store';
import type { Subscription } from '@/types/subscription';

/** 확인 카드·후보 선택·등록 후속에 대한 답이면 대기 작업을 취소하지 않는다. */
export function keepsAssistantFollowup(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (!compact) return false;
  if (
    /^(네|응|맞아|좋아요|확인|확인할게|확인해요|변경해줘|변경할게|바꿔줘|바꿔|등록해줘|등록할게|해줘|적용해줘|추가해줘|ㅇㅋ|ok)$/i
      .test(compact)
  ) {
    return true;
  }
  if (/별도|다른계정|다른결제|다른카드|하나더|추가로등록|새로등록|다른구독|같은구독|기존거/.test(compact)) {
    return true;
  }
  if (/계정|아이디|이메일/.test(compact) || /@/.test(compact)) {
    return true;
  }
  if (/목록에서삭제|목록에서지워|목록에서빼/.test(compact) || /^(삭제|지워|삭제할게|삭제해줘|지워줘)$/.test(compact)) {
    return true;
  }
  if (/^(아니|아니요|아뇨)$/.test(compact) || /취소할게|취소할래|등록하지마|그만할게|그냥둘게|안할래|그대로둬|그대로둘게/.test(compact) || /^(됐어|취소)$/.test(compact)) {
    return true;
  }
  if (/그중|첫번째|두번재|두번째|세번째|\d+번째/.test(compact)) return true;
  return false;
}

export function isListLikeAssistantIntent(intent?: string | null): boolean {
  return intent === 'list_subscriptions' ||
    intent === 'upcoming_payments' ||
    intent === 'expensive_subscriptions';
}

export function pendingExtractHasUpdateValue(
  extract?: { amount?: number | null; anchor_date?: string | null } | null
): boolean {
  return Boolean(extract && (extract.amount != null || Boolean(extract.anchor_date)));
}

/** 동명 구독을 고를 때 금액·결제일·계정으로 구분한다. */
export function candidateDetailLines(item: Subscription): string[] {
  const billing = `결제일 ${formatShortDate(item.anchor_date)}`;
  const next = item.next_payment_date && item.next_payment_date.slice(0, 10) !== item.anchor_date.slice(0, 10)
    ? ` · 다음 ${formatShortDate(item.next_payment_date)}`
    : '';
  const lines = [
    `${formatCurrency(item.amount)} · ${BILLING_CYCLE_SHORT[item.billing_cycle]}`,
    `${billing}${next}`,
  ];
  if (item.account_id) lines.push(`계정 ${item.account_id}`);
  if (item.billing_channel && item.billing_channel !== 'unknown') {
    lines.push(BILLING_CHANNEL_LABELS[item.billing_channel]);
  }
  if (item.memo?.trim()) lines.push(item.memo.trim());
  if (item.created_at) lines.push(`등록 ${formatShortDate(item.created_at)}`);
  if (!item.is_active) lines.push('일시정지');
  return lines;
}

/** 해지 안내 칩에서 '목록에서 삭제'를 골랐을 때 확인 카드에 붙일 구독. */
export function resolveCancelListDeleteTargets(
  item: {
    saveChannelTargetId?: string | null;
    pendingCancel?: { subscription_id?: string | null; service_query?: string | null } | null;
  },
  subscriptions: Subscription[]
): Subscription[] {
  const targetId = item.saveChannelTargetId ?? item.pendingCancel?.subscription_id ?? undefined;
  if (targetId) {
    const hit = subscriptions.find((row) => row.id === targetId);
    if (hit) return [hit];
  }
  const query = item.pendingCancel?.service_query?.trim() ?? '';
  const needle = query.replace(/\s+/g, '').toLowerCase();
  if (needle.length < 2) return [];
  return subscriptions.filter((row) => {
    const name = row.name.replace(/\s+/g, '').toLowerCase();
    return name.length >= 2 && (name.includes(needle) || needle.includes(name));
  });
}

/** 채팅 말풍선은 마크다운을 렌더하지 않으므로 강조 기호만 벗겨 평문으로 만든다. */
export function stripChatMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''))
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

export function breakChatSentences(text: string): string {
  if (text.includes('\n')) return text;
  return text.replace(/[.?] +/g, (match) => `${match.trim()}\n`);
}

export function listReplyCaption(reply: string, count: number): string {
  const first = reply.split('\n').map((line) => line.trim()).find(Boolean);
  if (first && !first.includes(',')) return first.replace(/입니다\.?$/, '');
  return `구독 ${count}개예요.`;
}

export function resolveRankedSubscriptions(
  ids: string[] | undefined,
  subscriptions: Subscription[]
): Subscription[] {
  if (!ids?.length) return [];
  return ids
    .map((id) => subscriptions.find((item) => item.id === id))
    .filter((item): item is Subscription => Boolean(item));
}

/** 등록 확인 직후 세션 id가 없을 때, 방금 만든 행을 이름·금액·주기·결제일로 찾는다. */
export function matchCreatedSubscription(
  subscriptions: Subscription[],
  extract: { name: string; amount: number; billing_cycle: string; anchor_date: string }
): Subscription | undefined {
  const name = extract.name.replace(/\s+/g, '').toLowerCase();
  const anchor = extract.anchor_date.slice(0, 10);
  const hits = subscriptions.filter((row) =>
    row.name.replace(/\s+/g, '').toLowerCase() === name &&
    row.amount === extract.amount &&
    row.billing_cycle === extract.billing_cycle &&
    row.anchor_date.slice(0, 10) === anchor
  );
  if (hits.length === 0) return undefined;
  return hits.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0];
}
