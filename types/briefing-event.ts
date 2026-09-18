import type { BillingCycle } from '@/types/subscription';

export type BriefingEventKind = 'usage_prompt';

export type BriefingEventStatus =
  | 'pending'
  | 'displayed'
  | 'answered'
  | 'snoozed'
  | 'dismissed'
  | 'expired';

export type BriefingEventSource = 'home' | 'assistant' | 'push';

export type BriefingExpiredReason = 'subscription_inactive' | 'period_elapsed';

/** 사용 여부만 담는다. 유지 결정(keep)과 나중에 보기(review_later)는 여기 없다 */
export type UsageCheckinResponse = 'used_recently' | 'occasionally' | 'not_used' | 'unsure';

export type UsageHistoryKind = 'checkin' | 'snooze';

/** 설정 목록용. later는 스누즈이며 usage_checkins.response가 아니다 */
export type UsageHistoryResponse = UsageCheckinResponse | 'later';

export interface UsageHistoryItem {
  id: string;
  kind: UsageHistoryKind;
  subscription_id: string;
  name: string;
  response: UsageHistoryResponse;
  source: BriefingEventSource;
  at: string;
  next_check_at: string | null;
  snoozed_until: string | null;
}

export type UsageHistoryBillingCycle = 'monthly' | 'yearly' | 'one_time';

export interface UsageHistoryUnusedItem {
  subscription_id: string;
  name: string;
  amount: number;
  billing_cycle: UsageHistoryBillingCycle;
  at: string;
}

export interface UsageHistoryLatestItem {
  subscription_id: string;
  name: string;
  response: UsageHistoryResponse;
  at: string;
}

export interface UsageHistorySummary {
  response_counts: Record<UsageHistoryResponse, number>;
  unused: UsageHistoryUnusedItem[];
  latest_by_subscription: UsageHistoryLatestItem[];
}

export interface UsageHistoryQuery {
  limit?: number;
  subscriptionId?: string | null;
  response?: UsageHistoryResponse | null;
  from?: string | null;
  to?: string | null;
}

export interface UsageHistoryResult {
  ok: boolean;
  code: string;
  items: UsageHistoryItem[];
  summary: UsageHistorySummary;
  message: string;
}

/**
 * 서버가 현재 subscriptions 행으로만 만드는 표시용 스냅샷.
 * 허용 키는 정확히 이 6개다: name, amount, billing_cycle, kind, period_start, period_end.
 * 최대 2048바이트이며 클라이언트가 만든 값은 저장되지 않는다.
 * 실제 작업 대상은 payload가 아니라 subscription_id로 다시 조회한다.
 */
export type BriefingEventPayload = {
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  kind: BriefingEventKind;
  /** 'yyyy-MM-dd' KST */
  period_start: string;
  /** 'yyyy-MM-dd' KST */
  period_end: string;
};

export interface BriefingEvent {
  id: string;
  user_id: string;
  subscription_id: string;
  kind: BriefingEventKind;
  status: BriefingEventStatus;
  dedupe_key: string;
  period_start: string;
  period_end: string;
  payload: BriefingEventPayload;
  source: BriefingEventSource;
  snoozed_until: string | null;
  expires_at: string;
  expired_reason: BriefingExpiredReason | null;
  displayed_at: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageCheckin {
  id: string;
  user_id: string;
  subscription_id: string;
  briefing_event_id: string | null;
  idempotency_key?: string | null;
  response: UsageCheckinResponse;
  source: BriefingEventSource;
  /** 'yyyy-MM-dd' KST. used_recently +30, occasionally +14, not_used +7, unsure +7 */
  next_check_at: string;
  created_at: string;
}

/** 서버가 정상 흐름에서 돌려주는 코드. 예외는 예상 못한 DB 오류일 때만 발생한다 */
export type BriefingResultCode =
  | 'created'
  | 'reused'
  | 'found'
  | 'none'
  | 'displayed'
  | 'answered'
  | 'already_answered'
  | 'snoozed'
  | 'dismissed'
  | 'unauthenticated'
  | 'event_not_found'
  | 'event_closed'
  | 'still_snoozed'
  | 'subscription_missing'
  | 'subscription_inactive'
  | 'invalid_response'
  | 'invalid_kind'
  | 'invalid_source'
  | 'invalid_idempotency_key'
  | 'prompt_not_due'
  /** 클라이언트 전용. 네트워크·권한 등으로 RPC 자체가 실패한 경우 */
  | 'rpc_failed';

/** 모든 브리핑 RPC가 같은 모양으로 답한다 */
export interface BriefingResult {
  ok: boolean;
  code: BriefingResultCode;
  event: BriefingEvent | null;
  checkin: UsageCheckin | null;
  message: string;
}
