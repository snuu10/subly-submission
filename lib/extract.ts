import { matchPresetByName } from '@/constants/services';
import { findByKey, findCategory, getVisibleCategories } from '@/stores/category-store';
import { defaultAnchorDate } from '@/stores/subscription-store';
import type { Category, SystemCategoryKey } from '@/types/category';
import type { UsageCheckinResponse } from '@/types/briefing-event';
import {
  CLAUDE_ACTIONS,
  type ClaudeAction,
  type ClaudeExtract,
  type ClaudeUsageCheckin,
  type ParsedSubscription,
} from '@/types/extract';
import type { BillingCycle, Subscription } from '@/types/subscription';

const CYCLES: BillingCycle[] = ['monthly', 'yearly', 'one_time'];
const KEYS: SystemCategoryKey[] = [
  'entertainment',
  'music',
  'work',
  'health',
  'education',
  'cloud',
  'etc',
];

function asCycle(value: unknown): BillingCycle | null {
  return typeof value === 'string' && CYCLES.includes(value as BillingCycle)
    ? (value as BillingCycle)
    : null;
}

function asKey(value: unknown): SystemCategoryKey | null {
  return typeof value === 'string' && KEYS.includes(value as SystemCategoryKey)
    ? (value as SystemCategoryKey)
    : null;
}

export function normalizeClaudeAction(raw: unknown): ClaudeAction | null {
  return typeof raw === 'string' && (CLAUDE_ACTIONS as readonly string[]).includes(raw)
    ? (raw as ClaudeAction)
    : null;
}

export function normalizeClaudeSubscriptionId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function normalizeClaudeCandidateIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return ids.length > 0 ? ids : null;
}

const USAGE_RESPONSES: UsageCheckinResponse[] = [
  'used_recently',
  'occasionally',
  'not_used',
  'unsure',
];

export function normalizeClaudeUsageCheckin(raw: unknown): ClaudeUsageCheckin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const subscriptionId =
    typeof data.subscription_id === 'string' && data.subscription_id.trim()
      ? data.subscription_id.trim()
      : '';
  const response = data.response;
  if (!subscriptionId) return null;
  if (typeof response !== 'string' || !USAGE_RESPONSES.includes(response as UsageCheckinResponse)) {
    return null;
  }
  return { subscription_id: subscriptionId, response: response as UsageCheckinResponse };
}

export function normalizeClaudeExtract(raw: unknown): ClaudeExtract | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  const amountRaw = data.amount;
  const amount =
    typeof amountRaw === 'number' && Number.isFinite(amountRaw)
      ? Math.round(amountRaw)
      : typeof amountRaw === 'string'
        ? Math.round(Number(String(amountRaw).replace(/,/g, '')))
        : null;

  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
    amount: amount != null && Number.isFinite(amount) && amount > 0 ? amount : null,
    billing_cycle: asCycle(data.billing_cycle),
    anchor_date: typeof data.anchor_date === 'string' ? data.anchor_date : null,
    next_payment_date: typeof data.next_payment_date === 'string' ? data.next_payment_date : null,
    category_key: asKey(data.category_key),
    category_name: typeof data.category_name === 'string' ? data.category_name.trim() : null,
    account_id: typeof data.account_id === 'string' && data.account_id.trim() ? data.account_id.trim() : null,
    is_trial: typeof data.is_trial === 'boolean' ? data.is_trial : null,
    trial_ends_at:
      typeof data.trial_ends_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.trial_ends_at)
        ? data.trial_ends_at
        : null,
  };
}

export function subscriptionToParsed(subscription: Subscription): ParsedSubscription {
  return {
    name: subscription.name,
    amount: subscription.amount,
    billing_cycle: subscription.billing_cycle,
    anchor_date: subscription.anchor_date,
    category_id: subscription.category_id,
    account_id: subscription.account_id,
    memo: subscription.memo,
    preset_id: subscription.preset_id,
    is_trial: subscription.is_trial,
    trial_ends_at: subscription.trial_ends_at,
  };
}

function categoryLooksSpecified(extract: ClaudeExtract | null): boolean {
  if (!extract) return false;
  if (extract.category_key && extract.category_key !== 'etc') return true;
  if (extract.category_name && extract.category_name !== '기타') return true;
  return false;
}

export function withInferredCategory(
  parsed: ParsedSubscription,
  categories: Category[]
): ParsedSubscription {
  if (!parsed?.name) return parsed;
  const preset = matchPresetByName(parsed.name);
  const current = findCategory(categories, parsed.category_id);
  const presetId = parsed.preset_id ?? preset?.id ?? null;
  if (current?.key && current.key !== 'etc') {
    return { ...parsed, preset_id: presetId };
  }
  if (!preset || preset.category === 'etc') {
    return { ...parsed, preset_id: presetId };
  }
  const mapped = findByKey(categories, preset.category);
  return {
    ...parsed,
    category_id: mapped && !mapped.is_hidden ? mapped.id : parsed.category_id,
    preset_id: presetId,
  };
}

function resolveCategoryId(
  extract: ClaudeExtract,
  categories: Category[],
  fallbackId?: string
): string | null {
  const visible = getVisibleCategories(categories);
  const byKey = extract.category_key && extract.category_key !== 'etc'
    ? findByKey(categories, extract.category_key)
    : undefined;
  const byName = extract.category_name && extract.category_name !== '기타'
    ? categories.find((item) => item.name === extract.category_name)
    : undefined;
  const preset = extract.name ? matchPresetByName(extract.name) : undefined;
  const byPreset = preset && preset.category !== 'etc' ? findByKey(categories, preset.category) : undefined;
  const etc = findByKey(categories, 'etc');
  const fallback = fallbackId ? categories.find((item) => item.id === fallbackId) : undefined;
  const fallbackIsEtc = fallback ? fallback.key === 'etc' : false;

  const category =
    (byKey && !byKey.is_hidden ? byKey : undefined) ??
    (byName && !byName.is_hidden ? byName : undefined) ??
    (byPreset && !byPreset.is_hidden ? byPreset : undefined) ??
    (fallback && !fallbackIsEtc ? fallback : undefined) ??
    visible.find((item) => item.key !== 'etc') ??
    fallback ??
    visible[0] ??
    etc;

  return category?.id ?? null;
}

export function toParsedSubscription(
  extract: ClaudeExtract,
  categories: Category[]
): ParsedSubscription | null {
  if (!extract.name || extract.amount == null) return null;

  const preset = matchPresetByName(extract.name);
  const categoryId = resolveCategoryId(extract, categories);
  if (!categoryId) return null;

  const isTrial = Boolean(extract.is_trial && extract.trial_ends_at);
  const iso = isTrial
    ? extract.trial_ends_at!
    : extract.anchor_date && /^\d{4}-\d{2}-\d{2}$/.test(extract.anchor_date)
      ? extract.anchor_date
      : defaultAnchorDate();

  return withInferredCategory(
    {
      name: extract.name,
      amount: extract.amount,
      billing_cycle: extract.billing_cycle ?? 'monthly',
      anchor_date: iso,
      next_payment_date: extract.next_payment_date,
      category_id: categoryId,
      account_id: extract.account_id ?? undefined,
      preset_id: preset?.id ?? null,
      is_trial: isTrial,
      trial_ends_at: isTrial ? iso : null,
    },
    categories
  );
}

/** 부분 extract를 기존 구독에 얹어 확인 카드용 값으로 만든다. null 필드는 유지. */
export function mergeExtractIntoSubscription(
  current: Subscription,
  extract: ClaudeExtract | null,
  categories: Category[]
): ParsedSubscription {
  if (!extract) return withInferredCategory(subscriptionToParsed(current), categories);

  const name = extract.name ?? current.name;
  const preset = matchPresetByName(name);
  const categoryChanged = categoryLooksSpecified(extract);
  const categoryId = categoryChanged
    ? (resolveCategoryId(extract, categories, current.category_id) ?? current.category_id)
    : current.category_id;

  const isTrial = extract.is_trial != null ? Boolean(extract.is_trial && extract.trial_ends_at) : Boolean(current.is_trial);
  const iso = isTrial && extract.trial_ends_at
    ? extract.trial_ends_at
    : extract.anchor_date && /^\d{4}-\d{2}-\d{2}$/.test(extract.anchor_date)
      ? extract.anchor_date
      : current.anchor_date;

  return withInferredCategory(
    {
      name,
      amount: extract.amount ?? current.amount,
      billing_cycle: extract.billing_cycle ?? current.billing_cycle,
      anchor_date: iso,
      category_id: categoryId,
      account_id: extract.account_id ?? current.account_id,
      memo: current.memo,
      preset_id: extract.name ? (preset?.id ?? current.preset_id) : current.preset_id,
      is_trial: isTrial,
      trial_ends_at: isTrial ? iso : null,
    },
    categories
  );
}
