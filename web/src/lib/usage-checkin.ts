import { normalizeClaudeUsageCheckin } from '@/lib/extract';
import type { ClaudeUsageCheckin } from '@/types/extract';
import type {
  BriefingEventSource,
  UsageCheckinResponse,
  UsageHistoryResponse,
} from '@/types/briefing-event';

export const USAGE_CHECKIN_LABEL: Record<UsageCheckinResponse, string> = {
  used_recently: '최근 사용했어요',
  occasionally: '가끔 써요',
  not_used: '사용 안 했어요',
  unsure: '잘 모르겠어요',
};

export const USAGE_HISTORY_LABEL: Record<UsageHistoryResponse, string> = {
  ...USAGE_CHECKIN_LABEL,
  later: '나중에',
};

export const USAGE_HISTORY_SOURCE_LABEL: Record<BriefingEventSource, string> = {
  home: '홈',
  assistant: '비서',
  push: '알림',
};

export function formatUsageHistoryAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatUsageHistorySnooze(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function kstTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function toKstRangeStart(date: string): string {
  return `${date}T00:00:00.000+09:00`;
}

export function toKstRangeEnd(date: string): string {
  return `${date}T23:59:59.999+09:00`;
}

export function usageHistoryMonthlyAmount(amount: number, cycle: string): number {
  if (cycle === 'yearly') return Math.round(amount / 12);
  if (cycle === 'one_time') return 0;
  return amount;
}

const USAGE_PHRASE =
  /안\s*썼|안\s*써|안써|안씀|안\s*사용|사용\s*안|자주\s*써|자주\s*사용|가끔\s*써|가끔\s*사용|최근\s*사용|잘\s*안|안\s*보|안봐|쓰고\s*있|사용했|사용중|사용\s*중|안\s*쓰고|모르겠어|잘\s*몰라/;

export function looksLikeUsageCheckinUtterance(text: string): boolean {
  return USAGE_PHRASE.test(text);
}

export function normalizeServiceName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

export function subscriptionNamedInText(text: string, name: string): boolean {
  const needle = normalizeServiceName(name);
  if (needle.length < 2) return false;
  return normalizeServiceName(text).includes(needle);
}

function inferUsageResponse(text: string): UsageCheckinResponse | null {
  if (/모르|모르겠|잘\s*몰라/.test(text)) return 'unsure';
  if (/가끔/.test(text)) return 'occasionally';
  if (/안\s*썼|안\s*써|안써|안씀|안\s*사용|사용\s*안|잘\s*안|안\s*보|안봐|안\s*쓰고/.test(text)) {
    return 'not_used';
  }
  if (/자주|최근\s*사용|잘\s*써|쓰고\s*있|사용했|사용\s*중|사용중/.test(text)) {
    return 'used_recently';
  }
  return null;
}

/** 서비스명과 사용 상태가 한 문장에 명확할 때만 카드를 만든다. 추측하지 않는다. */
export function inferUsageCheckinFromUtterance(
  text: string,
  subscriptions: { id: string; name: string }[]
): ClaudeUsageCheckin | null {
  if (!looksLikeUsageCheckinUtterance(text)) return null;
  const named = subscriptions.filter((item) => subscriptionNamedInText(text, item.name));
  if (named.length !== 1) return null;
  const response = inferUsageResponse(text);
  if (!response) return null;
  return { subscription_id: named[0].id, response };
}

/** Claude 추출은 사용자가 말한 서비스·사용 상태와 맞을 때만 채택한다. */
export function resolveAssistantUsageCheckin(
  raw: unknown,
  userText: string,
  subscriptions: { id: string; name: string }[]
): ClaudeUsageCheckin | null {
  const inferred = inferUsageCheckinFromUtterance(userText, subscriptions);
  const fromClaude = normalizeClaudeUsageCheckin(raw);
  if (!fromClaude) return inferred;
  const target = subscriptions.find((item) => item.id === fromClaude.subscription_id);
  if (!target) return inferred;
  if (!looksLikeUsageCheckinUtterance(userText)) return null;
  if (!subscriptionNamedInText(userText, target.name)) return inferred;
  return fromClaude;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
