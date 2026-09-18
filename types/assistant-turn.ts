import type { CancelGuideRequest, CancelGuideResponse } from '@/types/cancel-guide';
import type { ClaudeAction, ClaudeExtract, ClaudeProxyResponse, ParsedSubscription } from '@/types/extract';

export type AssistantPendingKind = 'create' | 'update' | 'delete' | 'pause' | 'resume';

export type AssistantPendingAction = {
  id: string;
  kind: AssistantPendingKind;
  subscription_id: string | null;
  extract: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
};

export type AssistantSession = {
  version: number;
  last_intent: string | null;
  ranked_subscription_ids: string[];
  selected_subscription_id: string | null;
  candidate_ids: string[];
  pending_action: AssistantPendingAction | null;
  pending_action_status: 'none' | 'pending' | 'completed' | 'expired' | 'cancelled';
};

export type CleanupReason = {
  code: 'unused' | 'duplicate' | 'price_hike';
  evidence: string;
};

export type CleanupRecommendation = {
  id: string;
  name: string;
  amount: number;
  monthly_amount: number;
  monthly_save: number;
  yearly_save: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: CleanupReason[];
};

export type LifecycleUpdatePayload = {
  subscription_id: string;
  to: string;
  service_end_date: string | null;
};

export type AssistantTurnResponse = ClaudeProxyResponse & {
  intent: string;
  ranked_subscription_ids: string[];
  pending_action_id: string | null;
  resolved_pending_action_id: string | null;
  expires_at: string | null;
  cancel_guide: CancelGuideResponse | null;
  cancel_guide_request: CancelGuideRequest | null;
  cleanup_recommendations: CleanupRecommendation[] | null;
  lifecycle_update: LifecycleUpdatePayload | null;
  category_candidates: string[] | null;
  session_version: number;
  payment_instrument_request?: boolean | null;
  name_needs_review?: boolean | null;
};

export type AssistantRpcResult = {
  ok: boolean;
  code: string;
  session: AssistantSession | null;
  message: string;
};

export function isAssistantActionExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts <= Date.now();
}

export function parseAssistantPending(raw: unknown): AssistantPendingAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const kind = row.kind;
  if (
    kind !== 'create' &&
    kind !== 'update' &&
    kind !== 'delete' &&
    kind !== 'pause' &&
    kind !== 'resume'
  ) {
    return null;
  }
  if (typeof row.id !== 'string' || !row.id) return null;
  return {
    id: row.id,
    kind,
    subscription_id: typeof row.subscription_id === 'string' ? row.subscription_id : null,
    extract: row.extract && typeof row.extract === 'object' && !Array.isArray(row.extract)
      ? (row.extract as Record<string, unknown>)
      : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : '',
  };
}

export function parseAssistantSession(raw: unknown): AssistantSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const status = row.pending_action_status;
  return {
    version: typeof row.version === 'number' ? row.version : 0,
    last_intent: typeof row.last_intent === 'string' ? row.last_intent : null,
    ranked_subscription_ids: Array.isArray(row.ranked_subscription_ids)
      ? row.ranked_subscription_ids.filter((item): item is string => typeof item === 'string')
      : [],
    selected_subscription_id:
      typeof row.selected_subscription_id === 'string' ? row.selected_subscription_id : null,
    candidate_ids: Array.isArray(row.candidate_ids)
      ? row.candidate_ids.filter((item): item is string => typeof item === 'string')
      : [],
    pending_action: parseAssistantPending(row.pending_action),
    pending_action_status:
      status === 'pending' || status === 'completed' || status === 'expired' || status === 'cancelled'
        ? status
        : 'none',
  };
}

export function parseCleanupRecommendations(raw: unknown): CleanupRecommendation[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: CleanupRecommendation[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.name !== 'string') continue;
    const confidence =
      rec.confidence === 'high' || rec.confidence === 'medium' || rec.confidence === 'low'
        ? rec.confidence
        : 'medium';
    const reasons: CleanupReason[] = Array.isArray(rec.reasons)
      ? rec.reasons.flatMap((reason): CleanupReason[] => {
          if (!reason || typeof reason !== 'object') return [];
          const item = reason as Record<string, unknown>;
          const code = item.code;
          if (code !== 'unused' && code !== 'duplicate' && code !== 'price_hike') return [];
          return [{
            code,
            evidence: typeof item.evidence === 'string' ? item.evidence : '',
          }];
        })
      : [];
    items.push({
      id: rec.id,
      name: rec.name,
      amount: typeof rec.amount === 'number' ? rec.amount : Number(rec.amount) || 0,
      monthly_amount: typeof rec.monthly_amount === 'number' ? rec.monthly_amount : Number(rec.monthly_amount) || 0,
      monthly_save: typeof rec.monthly_save === 'number' ? rec.monthly_save : Number(rec.monthly_save) || 0,
      yearly_save: typeof rec.yearly_save === 'number' ? rec.yearly_save : Number(rec.yearly_save) || 0,
      confidence,
      reasons,
    });
  }
  return items.length > 0 ? items : null;
}

export function parseLifecycleUpdate(raw: unknown): LifecycleUpdatePayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.subscription_id !== 'string' || typeof rec.to !== 'string') return null;
  return {
    subscription_id: rec.subscription_id,
    to: rec.to,
    service_end_date: typeof rec.service_end_date === 'string' ? rec.service_end_date : null,
  };
}

export function pendingKindToAction(kind: AssistantPendingKind): ClaudeAction {
  return kind;
}

export function extractFromPending(pending: AssistantPendingAction | null): ClaudeExtract | null {
  const extract = pending?.extract;
  if (!extract) return null;
  const amountRaw = extract.amount;
  const amount =
    typeof amountRaw === 'number' && Number.isFinite(amountRaw)
      ? Math.round(amountRaw)
      : null;
  return {
    name: typeof extract.name === 'string' ? extract.name : null,
    amount: amount != null && amount > 0 ? amount : null,
    billing_cycle:
      extract.billing_cycle === 'monthly' || extract.billing_cycle === 'yearly' ||
      extract.billing_cycle === 'one_time'
        ? extract.billing_cycle
        : null,
    anchor_date: typeof extract.anchor_date === 'string' ? extract.anchor_date : null,
    next_payment_date: typeof extract.next_payment_date === 'string' ? extract.next_payment_date : null,
    category_key: null,
    category_name: null,
    account_id: typeof extract.account_id === 'string' ? extract.account_id : null,
    is_trial: typeof extract.is_trial === 'boolean' ? extract.is_trial : null,
    trial_ends_at: typeof extract.trial_ends_at === 'string' ? extract.trial_ends_at : null,
  };
}

export function parsedFromPendingExtract(
  extract: Record<string, unknown> | null,
  fallbackCategoryId?: string
): ParsedSubscription | null {
  if (!extract) return null;
  const name = typeof extract.name === 'string' && extract.name.trim() ? extract.name.trim() : null;
  const amountRaw = extract.amount;
  const amount =
    typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw > 0
      ? Math.round(amountRaw)
      : null;
  const cycle =
    extract.billing_cycle === 'monthly' || extract.billing_cycle === 'yearly' ||
    extract.billing_cycle === 'one_time'
      ? extract.billing_cycle
      : null;
  const categoryId =
    typeof extract.category_id === 'string' && extract.category_id
      ? extract.category_id
      : fallbackCategoryId;
  const anchor = typeof extract.anchor_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extract.anchor_date)
    ? extract.anchor_date
    : null;
  if (!name || amount == null || !categoryId || !cycle || !anchor) return null;
  return {
    name,
    amount,
    billing_cycle: cycle,
    anchor_date: anchor,
    next_payment_date: typeof extract.next_payment_date === 'string' ? extract.next_payment_date : null,
    category_id: categoryId,
    account_id: typeof extract.account_id === 'string' ? extract.account_id : undefined,
    memo: typeof extract.memo === 'string' ? extract.memo : undefined,
    preset_id: typeof extract.preset_id === 'string' ? extract.preset_id : null,
    is_trial: typeof extract.is_trial === 'boolean' ? extract.is_trial : undefined,
    trial_ends_at: typeof extract.trial_ends_at === 'string' ? extract.trial_ends_at : null,
  };
}
