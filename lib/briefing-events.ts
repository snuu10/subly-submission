import { supabase } from '@/lib/supabase';
import type {
  BriefingEvent,
  BriefingEventSource,
  BriefingResult,
  BriefingResultCode,
  UsageCheckin,
  UsageCheckinResponse,
  UsageHistoryBillingCycle,
  UsageHistoryItem,
  UsageHistoryKind,
  UsageHistoryLatestItem,
  UsageHistoryQuery,
  UsageHistoryResponse,
  UsageHistoryResult,
  UsageHistorySummary,
  UsageHistoryUnusedItem,
} from '@/types/briefing-event';

/**
 * 브리핑 이벤트와 사용 체크인 계약.
 *
 * 쓰기는 전부 RPC다. 두 테이블은 클라이언트에 SELECT 권한만 있고, user_id·기간·
 * dedupe_key·payload는 서버가 auth.uid()와 현재 subscriptions 행으로 만든다.
 *
 * 직접 SELECT는 상태를 바꾸지 못한다. 만료는 RPC 진입 시에만 일어나므로,
 * 아래 SELECT 헬퍼는 expires_at이 지난 행을 활성 이벤트로 취급하지 않는다.
 */

const OPEN_STATUSES = ['pending', 'displayed', 'snoozed'] as const;

function toResult(data: unknown): BriefingResult | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.ok !== 'boolean' || typeof row.code !== 'string') return null;
  return {
    ok: row.ok,
    code: row.code as BriefingResultCode,
    event: (row.event as BriefingEvent | null) ?? null,
    checkin: (row.checkin as UsageCheckin | null) ?? null,
    message: typeof row.message === 'string' ? row.message : '',
  };
}

function failed(message: string): BriefingResult {
  return { ok: false, code: 'rpc_failed', event: null, checkin: null, message };
}

async function callBriefingRpc(
  name: string,
  args: Record<string, unknown> = {}
): Promise<BriefingResult> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return failed(error.message);
  return toResult(data) ?? failed('알 수 없는 응답입니다.');
}

/** 이 구독에 대해 물어볼 질문을 만들거나, 이미 열려 있는 질문을 그대로 돌려준다 */
export async function upsertUsagePrompt(
  subscriptionId: string,
  source: BriefingEventSource = 'home'
): Promise<BriefingResult> {
  return callBriefingRpc('upsert_briefing_event', {
    p_subscription_id: subscriptionId,
    p_kind: 'usage_prompt',
    p_source: source,
  });
}

/** 만료 정리 후 지금 보여줄 질문 하나를 가져온다 */
export async function fetchOpenBriefingEvent(): Promise<BriefingResult> {
  return callBriefingRpc('list_my_briefing_events');
}

export async function markBriefingEventDisplayed(eventId: string): Promise<BriefingResult> {
  return callBriefingRpc('mark_briefing_event_displayed', { p_event_id: eventId });
}

/** 체크인 저장과 answered 전환이 한 트랜잭션에서 끝난다 */
export async function answerBriefingCheckin(
  eventId: string,
  response: UsageCheckinResponse,
  source: BriefingEventSource = 'home'
): Promise<BriefingResult> {
  return callBriefingRpc('answer_briefing_checkin', {
    p_event_id: eventId,
    p_response: response,
    p_source: source,
  });
}

/** 나중에 보기. 기간은 서버가 7일로 정한다 */
export async function snoozeBriefingEvent(eventId: string): Promise<BriefingResult> {
  return callBriefingRpc('snooze_briefing_event', { p_event_id: eventId });
}

export async function dismissBriefingEvent(eventId: string): Promise<BriefingResult> {
  return callBriefingRpc('dismiss_briefing_event', { p_event_id: eventId });
}

/** 서버가 사용 여부 질문 후보를 고르고 필요하면 이벤트를 만든다. last_checked_at은 쓰지 않는다 */
export async function selectUsagePromptCandidate(
  source: BriefingEventSource = 'home'
): Promise<BriefingResult> {
  return callBriefingRpc('select_usage_prompt_candidate', { p_source: source });
}

/** 비서 확인 버튼 전용. 확인 전에는 호출하지 않는다 */
export async function recordAssistantCheckin(
  subscriptionId: string,
  response: UsageCheckinResponse,
  idempotencyKey: string,
  source: BriefingEventSource = 'assistant'
): Promise<BriefingResult> {
  return callBriefingRpc('record_assistant_checkin', {
    p_subscription_id: subscriptionId,
    p_response: response,
    p_idempotency_key: idempotencyKey,
    p_source: source,
  });
}

/**
 * 읽기 전용 조회. 상태를 바꾸지 않으므로 만료된 행을 직접 걸러낸다.
 * 상태를 정리하면서 읽어야 하면 fetchOpenBriefingEvent를 쓴다.
 */
export async function selectOpenBriefingEvents(): Promise<BriefingEvent[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('briefing_events')
    .select('*')
    .in('status', [...OPEN_STATUSES])
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: true });
  if (error) return [];
  return (data ?? []) as BriefingEvent[];
}

/** 구독별 최근 체크인. 2단계 후보 선정에서 쓴다 */
export async function selectRecentUsageCheckins(limit = 200): Promise<UsageCheckin[]> {
  const { data, error } = await supabase
    .from('usage_checkins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as UsageCheckin[];
}

const HISTORY_KINDS: UsageHistoryKind[] = ['checkin', 'snooze'];
const HISTORY_RESPONSES: UsageHistoryResponse[] = [
  'used_recently',
  'occasionally',
  'not_used',
  'unsure',
  'later',
];
const HISTORY_SOURCES: BriefingEventSource[] = ['home', 'assistant', 'push'];

function asIso(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return '';
}

function parseHistoryItem(raw: unknown): UsageHistoryItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const kind = HISTORY_KINDS.includes(row.kind as UsageHistoryKind)
    ? (row.kind as UsageHistoryKind)
    : null;
  const subscriptionId = typeof row.subscription_id === 'string' ? row.subscription_id : '';
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '구독';
  const response = HISTORY_RESPONSES.includes(row.response as UsageHistoryResponse)
    ? (row.response as UsageHistoryResponse)
    : null;
  const source = HISTORY_SOURCES.includes(row.source as BriefingEventSource)
    ? (row.source as BriefingEventSource)
    : null;
  const at = asIso(row.at);
  if (!id || !kind || !subscriptionId || !response || !source || !at) return null;
  return {
    id,
    kind,
    subscription_id: subscriptionId,
    name,
    response,
    source,
    at,
    next_check_at: typeof row.next_check_at === 'string' ? row.next_check_at : null,
    snoozed_until: typeof row.snoozed_until === 'string' ? row.snoozed_until : null,
  };
}

const HISTORY_CYCLES: UsageHistoryBillingCycle[] = ['monthly', 'yearly', 'one_time'];

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

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseUnusedItem(raw: unknown): UsageHistoryUnusedItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const subscriptionId = typeof row.subscription_id === 'string' ? row.subscription_id : '';
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '구독';
  const amount = typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null;
  const billingCycle = HISTORY_CYCLES.includes(row.billing_cycle as UsageHistoryBillingCycle)
    ? (row.billing_cycle as UsageHistoryBillingCycle)
    : null;
  const at = asIso(row.at);
  if (!subscriptionId || amount === null || !billingCycle || !at) return null;
  return { subscription_id: subscriptionId, name, amount, billing_cycle: billingCycle, at };
}

function parseLatestItem(raw: unknown): UsageHistoryLatestItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const subscriptionId = typeof row.subscription_id === 'string' ? row.subscription_id : '';
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '구독';
  const response = HISTORY_RESPONSES.includes(row.response as UsageHistoryResponse)
    ? (row.response as UsageHistoryResponse)
    : null;
  const at = asIso(row.at);
  if (!subscriptionId || !response || !at) return null;
  return { subscription_id: subscriptionId, name, response, at };
}

function parseSummary(raw: unknown): UsageHistorySummary {
  const empty = emptySummary();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const row = raw as Record<string, unknown>;
  const countsRaw = row.response_counts;
  if (countsRaw && typeof countsRaw === 'object' && !Array.isArray(countsRaw)) {
    const rec = countsRaw as Record<string, unknown>;
    for (const key of HISTORY_RESPONSES) {
      empty.response_counts[key] = asCount(rec[key]);
    }
  }
  const unusedRaw = Array.isArray(row.unused) ? row.unused : [];
  const latestRaw = Array.isArray(row.latest_by_subscription) ? row.latest_by_subscription : [];
  return {
    response_counts: empty.response_counts,
    unused: unusedRaw.map(parseUnusedItem).filter((item): item is UsageHistoryUnusedItem => item !== null),
    latest_by_subscription: latestRaw
      .map(parseLatestItem)
      .filter((item): item is UsageHistoryLatestItem => item !== null),
  };
}

function failedHistory(message: string): UsageHistoryResult {
  return { ok: false, code: 'rpc_failed', items: [], summary: emptySummary(), message };
}

/** 설정 화면용. 체크인 답과 아직 답하지 않은 나중에(스누즈)만 시간순으로 돌려준다 */
export async function listMyUsageHistory(query: UsageHistoryQuery = {}): Promise<UsageHistoryResult> {
  const args: Record<string, unknown> = {
    p_limit: query.limit ?? 100,
  };
  if (query.subscriptionId) args.p_subscription_id = query.subscriptionId;
  if (query.response) args.p_response = query.response;
  if (query.from) args.p_from = query.from;
  if (query.to) args.p_to = query.to;

  const { data, error } = await supabase.rpc('list_my_usage_history', args);
  if (error) return failedHistory(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return failedHistory('알 수 없는 응답입니다.');
  }
  const row = data as Record<string, unknown>;
  const rawItems = Array.isArray(row.items) ? row.items : [];
  return {
    ok: row.ok === true,
    code: typeof row.code === 'string' ? row.code : 'rpc_failed',
    items: rawItems.map(parseHistoryItem).filter((item): item is UsageHistoryItem => item !== null),
    summary: parseSummary(row.summary),
    message: typeof row.message === 'string' ? row.message : '',
  };
}
