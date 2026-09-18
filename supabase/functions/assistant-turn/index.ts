import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { explainQueryWithClaude } from "./claude-query.ts";
import { explainReply } from "./explain.ts";
import {
  classifyCategoryKey,
  classifyIntent,
  classifyConfirmationDecision,
  calendarDateFromMonthDay,
  createNameFromText,
  cleanServiceName,
  withObjectParticle,
  emptyClassifiedIntent,
  isCorrectionUtterance,
  isDuplicateAffirmativeUtterance,
  isDuplicateSameUtterance,
  isDuplicateSeparateUtterance,
  isDuplicateDeleteUtterance,
  isRejectUtterance,
  invalidBillingDay,
  isFieldLabelName,
  looksLikeDateAttempt,
  looksLikeRiskyNameSource,
  LOW_CONFIDENCE_THRESHOLD,
  parseClassifiedIntent,
  mentionsPriorList,
  parseCreateDayNumber,
  parseCreateMonthNumber,
  parseKoreanDate,
  isNonAnswerAccountUtterance,
  parseAccountFromText,
  parseBillingDate,
  parseSpokenCycle,
  parseUpdateBillingDay,
  parseWonAmount,
  spokenAmountIssue,
  scrubPii,
  type AssistantIntent,
  type ClassifiedIntent,
  type ClassifiedPeriod,
  type ConfirmationDecision,
  type UpdateAwaitingField,
} from "./gemini-intent.ts";
import {
  categoryTotals,
  categorizedSubscriptions,
  cancelSavings,
  cleanupCandidates,
  expensive,
  fetchAmountChanges,
  fetchCategories,
  fetchSnapshots,
  fetchSubscriptions,
  findByName,
  findByNameFuzzy,
  findMentionedCategory,
  mentionsUnresolvedCategory,
  accountTakenByDuplicate,
  listAll,
  listByMonth,
  listByRange,
  listNamed,
  listTrial,
  matchPresetHint,
  monthlyTotal,
  peerCategoryKey,
  periodComparison,
  priceIncreases,
  nextPaymentFromAnchor,
  seoulYmd,
  shiftMonth,
  subscriptionsInPeriod,
  upcoming,
  weekRange,
  resolveCategoryId,
  monthlyAmount,
  monthlyCanonicalAnchor,
  yearlyCanonicalAnchor,
  type CleanupRecommendation,
  type ToolSubscription,
} from "./queries.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CONTEXT_TTL_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const CATEGORY_ICON_KEY: Record<string, string> = {
  entertainment: "film",
  music: "music",
  work: "briefcase-business",
  health: "dumbbell",
  education: "book-open",
  cloud: "cloud",
  etc: "package",
};

function iconValueForCategory(categoryKey: string | null | undefined): string {
  return `lucide:${CATEGORY_ICON_KEY[categoryKey ?? ""] ?? CATEGORY_ICON_KEY.etc}`;
}

const MANAGE_INTENTS = [
  "create_subscription",
  "update_subscription",
  "delete_subscription",
  "pause_subscription",
  "resume_subscription",
] as const;

type ManageKind = "create" | "update" | "delete" | "pause" | "resume";

type PendingAction = {
  id: string;
  kind: ManageKind;
  subscription_id: string | null;
  extract: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
};

type SessionRow = {
  user_id: string;
  version: number;
  last_intent: string | null;
  ranked_subscription_ids: string[] | null;
  selected_subscription_id: string | null;
  query_period: unknown;
  billing_channel: string | null;
  last_result: unknown;
  candidate_ids: string[] | null;
  pending_action: PendingAction | null;
  pending_action_status: string;
  context_expires_at: string | null;
};

type SessionState = {
  version: number;
  last_intent: string | null;
  ranked_subscription_ids: string[];
  selected_subscription_id: string | null;
  query_period: Record<string, unknown> | null;
  billing_channel: string | null;
  last_result: Record<string, unknown> | null;
  candidate_ids: string[];
  pending_action: PendingAction | null;
  pending_action_status: string;
};

type RequestBody = {
  text?: string;
  history?: { role: string; content: string }[];
  categories?: { name: string; key: string | null }[];
  briefing_context?: {
    event_id?: string;
    subscription_id?: string;
    intent?: string;
    entry_source?: string;
  };
  platform?: string;
};

type ClaudeExtract = {
  name: string | null;
  amount: number | null;
  billing_cycle: string | null;
  anchor_date: string | null;
  next_payment_date: string | null;
  category_key: string | null;
  category_name: string | null;
  account_id: string | null;
};

type TurnResponse = {
  reply: string;
  extract: ClaudeExtract | null;
  action: ManageKind | null;
  subscription_id: string | null;
  candidate_ids: string[] | null;
  usage_checkin: { subscription_id: string; response: string } | null;
  intent: AssistantIntent;
  ranked_subscription_ids: string[];
  pending_action_id: string | null;
  resolved_pending_action_id: string | null;
  expires_at: string | null;
  cancel_guide: unknown | null;
  cancel_guide_request: unknown | null;
  cleanup_recommendations: CleanupRecommendation[] | null;
  lifecycle_update: {
    subscription_id: string;
    to: string;
    service_end_date: string | null;
  } | null;
  // 오타 등으로 카테고리 이름을 못 찾았을 때, 대신 짚어볼 수 있는 실제 카테고리 이름 목록.
  category_candidates: string[] | null;
  session_version: number;
  // 결제수단 등록 요청 — 클라이언트가 계좌/신용카드/체크카드 버튼을 보여준다.
  payment_instrument_request: boolean;
  // 체험·전환 관련 표현이 섞여 있던 등록 요청 — 클라이언트가 등록 확인 카드에
  // "이름을 확인해 주세요" 경고를 보여준다.
  name_needs_review: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function asPositiveAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function asCycle(value: unknown): "monthly" | "yearly" | "one_time" | null {
  return value === "monthly" || value === "yearly" || value === "one_time" ? value : null;
}

type CreateDraft = {
  name: string | null;
  amount: number | null;
  billing_cycle: "monthly" | "yearly" | "one_time" | null;
  anchor_date: string | null;
  pending_day: number | null;
  pending_month: number | null;
  awaiting_duplicate: boolean;
  duplicate_ok: boolean;
  account_id: string | null;
  awaiting_account: boolean;
  is_trial: boolean;
  trial_ends_at: string | null;
};

function asDayOfMonth(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

function asMonthNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function readCreateDraft(result: Record<string, unknown> | null): CreateDraft | null {
  if (!result) return null;
  const nested = result.create_draft;
  const row = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : result;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  const amount = asPositiveAmount(row.amount);
  const billing_cycle = asCycle(row.billing_cycle);
  const anchor_date = typeof row.anchor_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.anchor_date)
    ? row.anchor_date
    : null;
  const pending_day = asDayOfMonth(row.pending_day);
  const pending_month = asMonthNumber(row.pending_month);
  const awaiting_duplicate = row.awaiting_duplicate === true;
  const duplicate_ok = row.duplicate_ok === true;
  const account_id = typeof row.account_id === "string" && row.account_id.trim()
    ? row.account_id.trim().slice(0, 80)
    : null;
  const awaiting_account = row.awaiting_account === true;
  const is_trial = row.is_trial === true;
  const trial_ends_at = typeof row.trial_ends_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.trial_ends_at)
    ? row.trial_ends_at
    : null;
  if (!name && amount == null && !billing_cycle && !anchor_date && pending_day == null && pending_month == null &&
    !awaiting_duplicate && !duplicate_ok && !account_id && !awaiting_account && !is_trial) {
    return null;
  }
  return {
    name,
    amount,
    billing_cycle,
    anchor_date,
    pending_day,
    pending_month,
    awaiting_duplicate,
    duplicate_ok,
    account_id,
    awaiting_account,
    is_trial,
    trial_ends_at,
  };
}

function writeCreateDraft(next: SessionState, draft: {
  name: string | null;
  amount: number | null;
  billing_cycle: "monthly" | "yearly" | "one_time" | null;
  anchor_date: string | null;
  pending_day?: number | null;
  pending_month?: number | null;
  awaiting_duplicate?: boolean;
  duplicate_ok?: boolean;
  account_id?: string | null;
  awaiting_account?: boolean;
  is_trial?: boolean;
  trial_ends_at?: string | null;
}) {
  const prior = readCreateDraft(next.last_result);
  const full: CreateDraft = {
    name: draft.name,
    amount: draft.amount,
    billing_cycle: draft.billing_cycle,
    anchor_date: draft.anchor_date,
    pending_day: draft.pending_day ?? null,
    pending_month: draft.pending_month ?? null,
    awaiting_duplicate: draft.awaiting_duplicate ?? false,
    duplicate_ok: draft.duplicate_ok === true,
    account_id: draft.account_id !== undefined ? draft.account_id : prior?.account_id ?? null,
    awaiting_account: draft.awaiting_account === true,
    // 트리거 발화(예: "무료체험")가 이후 "9900원"처럼 금액만 답하는 후속 턴에는 없으므로,
    // 명시적으로 넘기지 않으면 이전 턴의 값을 그대로 이어간다.
    is_trial: draft.is_trial !== undefined ? draft.is_trial : prior?.is_trial ?? false,
    trial_ends_at: draft.trial_ends_at !== undefined ? draft.trial_ends_at : prior?.trial_ends_at ?? null,
  };
  next.last_result = {
    ...full,
    create_draft: full,
  };
}

function assignFacts(next: SessionState, facts: Record<string, unknown>) {
  const draft = readCreateDraft(next.last_result);
  next.last_result = draft ? { ...facts, create_draft: draft } : facts;
}

// 확신도가 낮은 관리형 의도를 실행 전에 한 번 더 확인받기 위해 원본 분류 결과를 통째로
// 들고 있는다. parseClassifiedIntent가 이미 임의 JSON을 안전하게 ClassifiedIntent로
// 복원하는 검증 로직을 갖고 있으므로 그대로 재사용한다.
function readPendingConfidenceCheck(result: Record<string, unknown> | null): ClassifiedIntent | null {
  if (!result) return null;
  const nested = result.confidence_check;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  return parseClassifiedIntent(nested);
}

function writePendingConfidenceCheck(next: SessionState, classified: ClassifiedIntent) {
  next.last_result = { confidence_check: classified };
}

const INTENT_LABELS: Partial<Record<AssistantIntent, string>> = {
  create_subscription: "구독 등록",
  update_subscription: "구독 변경",
  delete_subscription: "목록에서 삭제",
  pause_subscription: "일시정지",
  resume_subscription: "다시 시작",
  cancellation_guide: "해지 방법 안내",
  lifecycle_update: "해지 상태 변경",
  cancel_savings: "해지 시 절약액 확인",
};

function intentLabel(intent: AssistantIntent): string {
  return INTENT_LABELS[intent] ?? "이 작업";
}

type UpdateDraft = {
  awaiting: UpdateAwaitingField | null;
  subscription_id: string | null;
  amount: number | null;
  pending_day: number | null;
  pending_month: number | null;
};

function asUpdateAwaiting(value: unknown): UpdateAwaitingField | null {
  return value === "amount" || value === "billing_day" || value === "billing_month" || value === "weekday"
    ? value
    : null;
}

function readUpdateDraft(result: Record<string, unknown> | null): UpdateDraft | null {
  if (!result) return null;
  const nested = result.update_draft;
  const row = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : null;
  if (!row) return null;
  const awaiting = asUpdateAwaiting(row.awaiting);
  const subscription_id = typeof row.subscription_id === "string" && row.subscription_id
    ? row.subscription_id
    : null;
  const amount = asPositiveAmount(row.amount);
  const pending_day = asDayOfMonth(row.pending_day);
  const pending_month = asMonthNumber(row.pending_month);
  if (!awaiting && !subscription_id && amount == null && pending_day == null && pending_month == null) {
    return null;
  }
  return { awaiting, subscription_id, amount, pending_day, pending_month };
}

function writeUpdateDraft(next: SessionState, draft: UpdateDraft, extra?: Record<string, unknown>) {
  const name = typeof extra?.name === "string"
    ? extra.name
    : typeof next.last_result?.name === "string" ? next.last_result.name : null;
  const id = typeof extra?.id === "string"
    ? extra.id
    : draft.subscription_id ?? (typeof next.last_result?.id === "string" ? next.last_result.id : null);
  next.last_result = {
    ...(name ? { name } : {}),
    ...(id ? { id } : {}),
    update_draft: draft,
  };
}

function billingDayLabel(anchor: string, cycle: string): string {
  const day = Number(anchor.slice(8, 10));
  const month = Number(anchor.slice(5, 7));
  if (cycle === "yearly") return `매년 ${month}월 ${day}일`;
  if (cycle === "one_time") return `${month}월 ${day}일`;
  return `매월 ${day}일`;
}

function amountAskLabel(cycle: string, amount: number): string {
  const won = amount.toLocaleString("ko-KR");
  if (cycle === "yearly") return `연 ${won}원`;
  if (cycle === "one_time") return `일회 ${won}원`;
  return `월 ${won}원`;
}

function emptyState(): SessionState {
  return {
    version: 0,
    last_intent: null,
    ranked_subscription_ids: [],
    selected_subscription_id: null,
    query_period: null,
    billing_channel: null,
    last_result: null,
    candidate_ids: [],
    pending_action: null,
    pending_action_status: "none",
  };
}

function parseSession(raw: unknown): SessionState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyState();
  const row = raw as SessionRow;
  return {
    version: typeof row.version === "number" ? row.version : 0,
    last_intent: row.last_intent ?? null,
    ranked_subscription_ids: asStringArray(row.ranked_subscription_ids),
    selected_subscription_id: row.selected_subscription_id ?? null,
    query_period: row.query_period && typeof row.query_period === "object"
      ? row.query_period as Record<string, unknown>
      : null,
    billing_channel: row.billing_channel ?? null,
    last_result: row.last_result && typeof row.last_result === "object"
      ? row.last_result as Record<string, unknown>
      : null,
    candidate_ids: asStringArray(row.candidate_ids),
    pending_action: row.pending_action ?? null,
    pending_action_status: row.pending_action_status ?? "none",
  };
}

function cancelMessageForKind(kind: ManageKind | undefined): string {
  if (kind === "update") return "구독 변경을 취소했어요.";
  if (kind === "delete") return "구독 기록 삭제를 취소했어요.";
  if (kind === "pause" || kind === "resume") return "상태 변경을 취소했어요.";
  return "구독 등록을 취소했어요.";
}

async function cancelPendingFromTurn(input: {
  text: string;
  session: SessionState;
  client: SupabaseClient;
}): Promise<{ payload: TurnResponse; next: SessionState; alreadySaved: boolean }> {
  const { text, session, client } = input;
  const pending = session.pending_action;
  if (pending?.id) {
    const { data, error } = await client.rpc("cancel_pending_assistant_action", {
      p_action_id: pending.id,
      p_expected_version: session.version,
    });
    if (error) throw new Error(error.message);
    const payload = data as { ok?: boolean; code?: string; message?: string; session?: unknown } | null;
    const saved = payload?.session ? parseSession(payload.session) : emptyState();
    const cancelledOk = payload?.ok === true &&
      (payload.code === "cancelled" || payload.code === "already_cancelled" || payload.code === "ok");
    if (cancelledOk) {
      const reply = explainReply({
        userText: text,
        facts: { message: cancelMessageForKind(pending.kind) },
        style: "clarify",
      });
      return {
        payload: {
          ...emptyTurn("unknown", saved.version),
          reply,
          resolved_pending_action_id: pending.id,
        },
        next: saved,
        alreadySaved: true,
      };
    }
    const reply = explainReply({
      userText: text,
      facts: { message: payload?.message ?? "작업을 종료하지 못했어요. 다시 시도해 주세요." },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("unknown", session.version), reply }, next: saved, alreadySaved: true };
  }
  const cleared: SessionState = {
    ...session,
    last_intent: null,
    selected_subscription_id: null,
    last_result: null,
    candidate_ids: [],
    pending_action: null,
    pending_action_status: session.pending_action_status === "cancelled" ? "cancelled" : "none",
    ranked_subscription_ids: [],
  };
  const reply = explainReply({
    userText: text,
    facts: { message: cancelMessageForKind(pending?.kind) },
    style: "clarify",
  });
  return { payload: { ...emptyTurn("unknown", session.version), reply }, next: cleared, alreadySaved: true };
}

async function loadSession(client: SupabaseClient): Promise<SessionState> {
  const { data, error } = await client.rpc("load_assistant_session");
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; session?: unknown } | null;
  if (!payload?.ok || !payload.session) return emptyState();
  return parseSession(payload.session);
}

async function saveSession(client: SupabaseClient, state: SessionState): Promise<SessionState | "conflict"> {
  const { data, error } = await client.rpc("save_assistant_session", {
    p_expected_version: state.version,
    p_last_intent: state.last_intent,
    p_ranked_subscription_ids: state.ranked_subscription_ids,
    p_selected_subscription_id: state.selected_subscription_id,
    p_query_period: state.query_period,
    p_billing_channel: state.billing_channel,
    p_last_result: state.last_result,
    p_candidate_ids: state.candidate_ids,
    p_pending_action: state.pending_action,
    p_pending_action_status: state.pending_action_status,
    p_context_expires_at: new Date(Date.now() + CONTEXT_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; code?: string; session?: unknown } | null;
  if (payload?.code === "conflict") return "conflict";
  if (!payload?.ok) {
    throw new Error((payload as { message?: string } | null)?.message ?? "세션 저장에 실패했습니다.");
  }
  return parseSession(payload.session);
}

function intentToAction(intent: AssistantIntent): ManageKind | null {
  if (intent === "create_subscription") return "create";
  if (intent === "update_subscription") return "update";
  if (intent === "delete_subscription") return "delete";
  if (intent === "pause_subscription") return "pause";
  if (intent === "resume_subscription") return "resume";
  return null;
}

function asIsoTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

function snapshotExtract(sub: ToolSubscription, extra?: Record<string, unknown>): Record<string, unknown> {
  const expected = asIsoTimestamp(extra?.expected_updated_at) ?? asIsoTimestamp(sub.updated_at);
  return {
    name: extra?.name ?? sub.name,
    amount: extra?.amount ?? sub.amount,
    billing_cycle: extra?.billing_cycle ?? sub.billing_cycle,
    category_id: extra?.category_id ?? sub.category_id,
    anchor_date: extra?.anchor_date ?? sub.anchor_date,
    account_id: extra?.account_id ?? sub.account_id,
    preset_id: extra?.preset_id ?? sub.preset_id,
    memo: extra?.memo ?? sub.memo,
    emoji: extra?.emoji ?? sub.emoji,
    ...(expected ? { expected_updated_at: expected } : {}),
  };
}

function toClaudeExtract(
  extract: Record<string, unknown> | null,
  categories: { id: string; name: string; key: string | null }[],
): ClaudeExtract | null {
  if (!extract) return null;
  const name = typeof extract.name === "string" ? extract.name : null;
  const amount = typeof extract.amount === "number" ? extract.amount : null;
  const billing_cycle = typeof extract.billing_cycle === "string" ? extract.billing_cycle : null;
  const anchor_date = typeof extract.anchor_date === "string" ? extract.anchor_date : null;
  const next_payment_date = typeof extract.next_payment_date === "string" ? extract.next_payment_date : null;
  const categoryId = typeof extract.category_id === "string" ? extract.category_id : null;
  const category = categoryId ? categories.find((item) => item.id === categoryId) : undefined;
  return {
    name,
    amount,
    billing_cycle,
    anchor_date,
    next_payment_date,
    category_key: category?.key ?? null,
    category_name: category?.name ?? null,
    account_id: typeof extract.account_id === "string" ? extract.account_id : null,
    is_trial: typeof extract.is_trial === "boolean" ? extract.is_trial : null,
    trial_ends_at: typeof extract.trial_ends_at === "string" ? extract.trial_ends_at : null,
  };
}

function makePending(
  kind: ManageKind,
  subscriptionId: string | null,
  extract: Record<string, unknown> | null,
): PendingAction {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    kind,
    subscription_id: subscriptionId,
    extract,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
  };
}

function resolveReferent(
  classified: ClassifiedIntent,
  session: SessionState,
  all: ToolSubscription[],
): { id: string | null; candidates: ToolSubscription[]; error: string | null; fuzzy?: boolean } {
  const { referent, service_name } = classified;
  if (referent.kind === "ordinal") {
    const index = (referent.ordinal ?? 0) - 1;
    const id = session.ranked_subscription_ids[index];
    if (!id) {
      return { id: null, candidates: [], error: "어떤 구독을 말씀하시는지 목록에서 다시 골라 주세요." };
    }
    return { id, candidates: [], error: null };
  }
  if (referent.kind === "pronoun") {
    if (session.selected_subscription_id) {
      return { id: session.selected_subscription_id, candidates: [], error: null };
    }
    if (session.ranked_subscription_ids.length === 1) {
      return { id: session.ranked_subscription_ids[0], candidates: [], error: null };
    }
    return { id: null, candidates: [], error: "어떤 구독을 말씀하시는지 조금 더 구체적으로 알려 주세요." };
  }
  const query = referent.kind === "name" ? referent.name : service_name;
  if (!query || isFieldLabelName(query)) {
    if (session.selected_subscription_id) {
      return { id: session.selected_subscription_id, candidates: [], error: null };
    }
    return { id: null, candidates: [], error: null };
  }
  const hits = findByName(all, query);
  if (hits.length === 1) return { id: hits[0].id, candidates: [], error: null };
  if (hits.length > 1) {
    if (session.selected_subscription_id && hits.some((item) => item.id === session.selected_subscription_id)) {
      return { id: session.selected_subscription_id, candidates: [], error: null };
    }
    return { id: null, candidates: hits, error: null };
  }
  // 정확·부분 일치가 모두 실패하면 오타로 보고 가까운 이름을 후보로 제시한다.
  // 여기서 이름을 대신 고치지 않는다 — 후보를 보여주고 사용자가 직접 고른다.
  const fuzzy = findByNameFuzzy(all, query);
  if (fuzzy.length > 0) return { id: null, candidates: fuzzy, error: null, fuzzy: true };
  return { id: null, candidates: [], error: `"${query}" 구독을 찾지 못했어요. 이름을 확인해 주세요.` };
}

async function invokeCancelGuide(authHeader: string, body: Record<string, unknown>) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/cancel-guide`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: authHeader,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, unknown>;
}

function cancelReply(guide: Record<string, unknown>): string {
  if (guide.needs_intent) return "앱 목록에서 지울까요, 아니면 실제 서비스 해지 방법을 안내할까요?";
  if (guide.needs_billing_channel) {
    return "이 구독은 어디에 결제하고 있나요? 경로를 고르면 해지 안내를 찾아볼게요.";
  }
  if (guide.search_failed) {
    const warnings = Array.isArray(guide.warnings) ? guide.warnings : [];
    return typeof warnings[0] === "string" ? warnings[0] : "최신 공식 절차를 확인하지 못했습니다.";
  }
  const name = typeof guide.service_name === "string" ? guide.service_name : "구독";
  return `${name} 해지 안내입니다.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return json({ error: "Supabase 환경 변수가 없습니다." }, 503);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const text = body.text?.trim() ?? "";
  if (!text) return json({ error: "메시지가 비어 있습니다." }, 400);

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const [session, all, categories] = await Promise.all([
      loadSession(client),
      fetchSubscriptions(client),
      fetchCategories(client),
    ]);
    const active = all.filter((item) => item.is_active);
    const pendingReady = session.pending_action_status === "pending" && session.pending_action;
    const awaitingDuplicate = readCreateDraft(session.last_result)?.awaiting_duplicate === true;
    const confirmation = classifyConfirmationDecision(text);
    const finalConfirmPending = Boolean(pendingReady && !awaitingDuplicate);
    const classifyCtx = {
      last_intent: session.last_intent,
      last_name: readCreateDraft(session.last_result)?.name ??
        all.find((item) => item.id === session.selected_subscription_id)?.name ??
        (typeof session.last_result?.name === "string" ? session.last_result.name : null) ??
        (typeof session.last_result?.service_name === "string" ? session.last_result.service_name : null),
      last_amount: readCreateDraft(session.last_result)?.amount ?? null,
      last_cycle: readCreateDraft(session.last_result)?.billing_cycle ?? null,
      last_pending_day: readCreateDraft(session.last_result)?.pending_day ??
        readUpdateDraft(session.last_result)?.pending_day ?? null,
      last_pending_month: readCreateDraft(session.last_result)?.pending_month ??
        readUpdateDraft(session.last_result)?.pending_month ?? null,
      last_awaiting_duplicate: readCreateDraft(session.last_result)?.awaiting_duplicate ?? false,
      last_awaiting_account: readCreateDraft(session.last_result)?.awaiting_account ?? false,
      last_awaiting_update: readUpdateDraft(session.last_result)?.awaiting ?? null,
      last_listed: listedNamesFromResult(session.last_result),
      recent_turns: compactTurns(body.history),
    };
    const names = all.map((item) => item.name);
    const skipClassify = confirmation === "reject" && !awaitingDuplicate &&
      (finalConfirmPending || session.pending_action_status === "cancelled");
    const classified = skipClassify
      ? emptyClassifiedIntent()
      : await classifyIntent(text, names, classifyCtx);
    await client.rpc("sync_my_lifecycle_due");

    const response = await handleTurn({
      text,
      classified,
      confirmation,
      session,
      all,
      active,
      categories,
      client,
      authHeader,
      platform: body.platform ?? null,
    });

    if (response.alreadySaved) {
      return json({
        ...response.payload,
        session_version: response.next.version,
        ranked_subscription_ids: response.payload.ranked_subscription_ids ?? [],
        pending_action_id: response.next.pending_action_status === "pending"
          ? response.next.pending_action?.id ?? null
          : null,
        expires_at: response.next.pending_action_status === "pending"
          ? response.next.pending_action?.expires_at ?? null
          : null,
      } satisfies TurnResponse);
    }

    const saved = await saveSession(client, response.next);
    if (saved === "conflict") {
      return json({
        ...emptyTurn("unknown", session.version),
        reply: "다른 기기에서 대화 맥락이 바뀌었습니다. 다시 물어봐 주세요.",
      });
    }

    return json({
      ...response.payload,
      session_version: saved.version,
      ranked_subscription_ids: response.payload.ranked_subscription_ids ?? [],
      pending_action_id: saved.pending_action_status === "pending"
        ? saved.pending_action?.id ?? null
        : null,
      expires_at: saved.pending_action_status === "pending"
        ? saved.pending_action?.expires_at ?? null
        : null,
    } satisfies TurnResponse);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "요청을 처리하지 못했습니다." }, 500);
  }
});

function emptyTurn(intent: AssistantIntent, version: number): TurnResponse {
  return {
    reply: "어떤 구독을 말씀하시는지 조금 더 구체적으로 알려 주세요.",
    extract: null,
    action: null,
    subscription_id: null,
    candidate_ids: null,
    usage_checkin: null,
    intent,
    ranked_subscription_ids: [],
    pending_action_id: null,
    resolved_pending_action_id: null,
    expires_at: null,
    cancel_guide: null,
    cancel_guide_request: null,
    cleanup_recommendations: null,
    lifecycle_update: null,
    category_candidates: null,
    session_version: version,
    payment_instrument_request: false,
    name_needs_review: false,
  };
}

function listedNamesFromResult(result: Record<string, unknown> | null): string[] {
  const rows = result?.subscriptions;
  if (!Array.isArray(rows)) return [];
  const names: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) names.push(name.trim());
  }
  return names.slice(0, 15);
}

function compactTurns(history: { role: string; content: string }[] | undefined) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-6)
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: scrubPii(String(item.content ?? "")).slice(0, 160),
    }))
    .filter((item) => item.content);
}

async function handleTurn(input: {
  text: string;
  classified: ClassifiedIntent;
  confirmation: ConfirmationDecision;
  session: SessionState;
  all: ToolSubscription[];
  active: ToolSubscription[];
  categories: { id: string; name: string; key: string | null; normalized_name?: string | null }[];
  client: SupabaseClient;
  authHeader: string;
  platform: string | null;
}): Promise<{ payload: TurnResponse; next: SessionState; alreadySaved?: boolean }> {
  const { text, classified, confirmation, session, all, active, categories, client, authHeader, platform } = input;
  const createDraftOpen = readCreateDraft(session.last_result);

  // "결제수단 추가하고 싶어"는 "추가" 키워드 때문에 구독 등록으로 잘못 분류되기 쉽다 —
  // 구독 등록/수정 흐름이 진행 중이 아닐 때만, 금액 언급 없이 결제수단을 새로 붙이고 싶다는
  // 말이면 여기서 먼저 가로챈다. 클라이언트가 계좌/신용카드/체크카드 버튼을 보여준다.
  if (
    !createDraftOpen &&
    session.pending_action_status !== "pending" &&
    /(?:결제수단|카드|계좌)(?:을|를)?\s*(?:추가|등록|연결)(?:하고\s*싶어|해\s*줘|할래|하고싶어요|해줘요|하기|할게)?/.test(
      text.replace(/\s+/g, ""),
    ) &&
    !/\d/.test(text)
  ) {
    const reply = explainReply({
      userText: text,
      facts: { message: "어떤 결제수단을 추가할까요? 계좌, 신용카드, 체크카드 중에 골라 주세요." },
      style: "clarify",
    });
    const next: SessionState = {
      ...session,
      last_intent: null,
      ranked_subscription_ids: [],
      selected_subscription_id: null,
      candidate_ids: [],
      pending_action: null,
      pending_action_status: "none",
      last_result: null,
    };
    return {
      payload: { ...emptyTurn("unknown", session.version), reply, payment_instrument_request: true },
      next,
    };
  }

  if (
    confirmation === "correct" &&
    (session.pending_action?.kind === "create" ||
      (createDraftOpen?.name != null && session.last_intent === "create_subscription"))
  ) {
    classified.intent = "create_subscription";
    if (!classified.service_name && createDraftOpen?.name) classified.service_name = createDraftOpen.name;
  }
  // ChatGPT 수정: 중복 안내 직후의 짧은 긍정은 일반 update 확인이 아니라 "별도로 추가" 선택이다.
  if (isDuplicateAffirmativeUtterance(text, createDraftOpen?.awaiting_duplicate === true)) {
    classified.intent = "create_subscription";
    if (!classified.service_name && createDraftOpen?.name) classified.service_name = createDraftOpen.name;
  }
  const mentionedCategory = findMentionedCategory(categories, text);
  const categoryLookup = Boolean(mentionedCategory) &&
    /뭐|무엇|어떤|있어|목록|서비스|구독|보여|알려/.test(text.replace(/\s+/g, "")) &&
    !/등록|추가|변경|바꿔|수정|삭제|지워|숨기/.test(text.replace(/\s+/g, ""));
  if (categoryLookup && (classified.intent === "unknown" || classified.intent === "list_subscriptions")) {
    classified.intent = "category_analysis";
  }

  // 확신도가 낮아 먼저 확인을 물어본 의도가 대기 중이면, 이번 턴은 그 확인에 대한 답으로 본다
  // (이번 턴 자체의 classifyIntent 결과는 "네"/"아니" 같은 짧은 답이라 신뢰할 수 없으므로 버린다).
  const pendingConfidenceCheck = readPendingConfidenceCheck(session.last_result);
  if (pendingConfidenceCheck) {
    if (confirmation === "confirm") {
      Object.assign(classified, pendingConfidenceCheck);
      classified.confidence = 1;
      // 아래 실행 경로가 last_result를 다시 안 채우는 의도(예: lifecycle_update)도 있으므로,
      // 다음 턴이 이 확인 질문을 다시 답으로 오인하지 않도록 여기서 확실히 지운다.
      if (session.last_result) delete session.last_result.confidence_check;
    } else {
      const cleared: SessionState = {
        ...session,
        last_intent: null,
        candidate_ids: [],
        pending_action: null,
        pending_action_status: "none",
        last_result: null,
      };
      if (confirmation === "reject") {
        const reply = explainReply({
          userText: text,
          facts: { message: "알겠어요. 다시 말씀해 주시겠어요?" },
          style: "clarify",
        });
        return { payload: { ...emptyTurn("unknown", session.version), reply }, next: cleared };
      }
      // confirm도 reject도 아닌 애매한 답이면 확인 질문을 그대로 반복한다. 대기 상태는 유지.
      const reply = explainReply({
        userText: text,
        facts: {
          message: `${intentLabel(pendingConfidenceCheck.intent)}이(가) 맞을까요? "네"라고 답해 주시면 진행할게요.`,
        },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("unknown", session.version), reply }, next: { ...session } };
    }
  }

  const intent = classified.intent;
  const next: SessionState = {
    ...session,
    last_intent: intent,
    candidate_ids: [],
    pending_action: session.pending_action_status === "pending" ? session.pending_action : null,
    pending_action_status: session.pending_action_status === "pending" ? "pending" : "none",
  };

  const awaitingDuplicate = readCreateDraft(session.last_result)?.awaiting_duplicate === true;
  const awaitingAccount = readCreateDraft(session.last_result)?.awaiting_account === true;
  const pendingReady = session.pending_action_status === "pending" && session.pending_action;

  if (awaitingDuplicate && isDuplicateDeleteUtterance(text)) {
    const draft = readCreateDraft(session.last_result);
    const existing = draft?.name ? existingForCreate(all, draft.name) : [];
    if (existing.length === 0) {
      next.last_intent = null;
      next.pending_action = null;
      next.pending_action_status = "none";
      next.candidate_ids = [];
      const reply = explainReply({
        userText: text,
        facts: { message: "목록에서 지울 같은 이름 구독을 찾지 못했어요." },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("delete_subscription", session.version), reply }, next };
    }
    const only = existing.length === 1 ? existing[0] : null;
    const pendingDel = makePending("delete", only?.id ?? null, only ? snapshotExtract(only) : null);
    writeCreateDraft(next, {
      name: draft?.name ?? null,
      amount: draft?.amount ?? null,
      billing_cycle: draft?.billing_cycle ?? null,
      anchor_date: draft?.anchor_date ?? null,
      pending_day: draft?.pending_day ?? null,
      pending_month: draft?.pending_month ?? null,
      awaiting_duplicate: existing.length > 1,
      duplicate_ok: false,
    });
    next.pending_action = pendingDel;
    next.pending_action_status = "pending";
    next.candidate_ids = existing.map((item) => item.id);
    next.ranked_subscription_ids = next.candidate_ids;
    next.selected_subscription_id = only?.id ?? null;
    next.last_intent = "delete_subscription";
    const label = existing[0].name;
    const reply = explainReply({
      userText: text,
      facts: {
        action: "delete",
        name: only?.name,
        message: only
          ? undefined
          : [
            `어떤 ${withObjectParticle(label)} 목록에서 삭제할까요?`,
            ...existing.map((item, index) => `${index + 1}. ${formatExistingLine(item)}`),
          ].join("\n"),
      },
      style: only ? "confirm" : "clarify",
    });
    return {
      payload: {
        ...emptyTurn("delete_subscription", session.version),
        reply,
        action: "delete",
        subscription_id: only?.id ?? null,
        candidate_ids: only ? [] : next.candidate_ids,
        pending_action_id: pendingDel.id,
        expires_at: pendingDel.expires_at,
      },
      next,
    };
  }

  if (
    awaitingDuplicate &&
    !isCorrectionUtterance(text) &&
    (isDuplicateSameUtterance(text) || isRejectUtterance(text))
  ) {
    const draftName = readCreateDraft(session.last_result)?.name;
    const existing = draftName ? existingForCreate(all, draftName) : [];
    next.last_intent = null;
    next.pending_action = null;
    next.pending_action_status = "none";
    next.candidate_ids = [];
    next.selected_subscription_id = null;
    next.last_result = existing.length > 0
      ? {
        name: existing[0].name,
        subscriptions: existing.map((item) => ({
          id: item.id,
          name: item.name,
          amount: item.amount,
          next_payment_date: item.next_payment_date,
        })),
      }
      : null;
    next.ranked_subscription_ids = existing.map((item) => item.id);
    const label = existing[0]?.name ?? "이 구독";
    const reply = explainReply({
      userText: text,
      facts: {
        message: existing.length > 0
          ? `기존 ${withObjectParticle(label)} 그대로 둘게요. 금액을 바꾸려면 말해 주세요.`
          : "이 작업은 건너뛸게요. 다른 질문을 입력해 주세요.",
      },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
  }

  if (awaitingAccount && isRejectUtterance(text)) {
    // 계정을 물었는데 등록 자체를 취소하고 싶은 경우 — 그대로 두면 계정 없이는
    // 절대 못 빠져나가는 막다른 반복이 된다. 초안을 완전히 비워 다른 서비스든
    // 같은 서비스든 처음부터 다시 시작할 수 있게 한다.
    next.last_intent = null;
    next.pending_action = null;
    next.pending_action_status = "none";
    next.candidate_ids = [];
    next.selected_subscription_id = null;
    next.ranked_subscription_ids = [];
    next.last_result = null;
    const reply = explainReply({
      userText: text,
      facts: { message: "구독 등록을 취소했어요. 다른 구독을 등록하거나 다시 알려 주세요." },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
  }

  // 계정을 물을 때 말고도, 결제 주기·결제일·금액을 물을 때 등록 자체를 취소하고 싶을 수 있다.
  // 이 체크가 없으면 "취소"가 일반 분류기로 넘어가서 맥락을 잃고 엉뚱한 답이 나간다.
  if (
    session.last_intent === "create_subscription" &&
    createDraftOpen &&
    !awaitingDuplicate &&
    !awaitingAccount &&
    isRejectUtterance(text)
  ) {
    next.last_intent = null;
    next.pending_action = null;
    next.pending_action_status = "none";
    next.candidate_ids = [];
    next.selected_subscription_id = null;
    next.ranked_subscription_ids = [];
    next.last_result = null;
    const reply = explainReply({
      userText: text,
      facts: { message: "구독 등록을 취소했어요. 다른 구독을 등록하거나 다시 알려 주세요." },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
  }

  if (confirmation === "reject" && !awaitingDuplicate) {
    if (pendingReady || session.pending_action_status === "cancelled") {
      return await cancelPendingFromTurn({ text, session, client });
    }
  }

  // ChatGPT 수정: 중복 서비스 선택("별도 구독" 등)이나 계정 안내 응답은 "네/아니오"로
  // 딱 떨어지지 않아 classifyConfirmationDecision이 unclear로 판정하는 경우가 많다.
  // 이 catch-all이 awaitingDuplicate/awaitingAccount 상태를 배제하지 않으면 실제로는
  // 정상 응답인데도 "아직 확인할 작업이 있어요"로 가로채 초안(name 등)을 잃게 만든다.
  if (pendingReady && !awaitingDuplicate && !awaitingAccount && (confirmation === "unrelated" || confirmation === "unclear")) {
    next.pending_action = session.pending_action;
    next.pending_action_status = "pending";
    next.candidate_ids = session.candidate_ids;
    next.last_intent = session.last_intent;
    next.selected_subscription_id = session.selected_subscription_id;
    next.last_result = session.last_result;
    next.ranked_subscription_ids = session.ranked_subscription_ids;
    const reply = explainReply({
      userText: text,
      facts: {
        message: session.pending_action?.kind === "create"
          ? "아직 구독 등록을 확인하는 중이에요. 등록할까요, 아니면 취소할까요?"
          : "아직 확인할 작업이 있어요. 진행할까요, 아니면 취소할까요?",
      },
      style: "clarify",
    });
    return {
      payload: {
        ...emptyTurn(session.last_intent === "create_subscription" ? "create_subscription" : "unknown", session.version),
        reply,
        action: session.pending_action?.kind ?? null,
        pending_action_id: session.pending_action?.id ?? null,
        expires_at: session.pending_action?.expires_at ?? null,
      },
      next,
    };
  }

  if (
    confirmation === "confirm" &&
    !awaitingDuplicate &&
    session.pending_action_status === "pending" &&
    session.pending_action
  ) {
    const pending = session.pending_action;
    if (
      (pending.kind === "update" || pending.kind === "delete" || pending.kind === "pause" || pending.kind === "resume") &&
      !pending.subscription_id &&
      session.candidate_ids.length > 1
    ) {
      next.last_intent = classified.intent === "unknown" ? "update_subscription" : classified.intent;
      next.candidate_ids = session.candidate_ids;
      const names = session.candidate_ids
        .map((id) => all.find((item) => item.id === id))
        .filter((item): item is ToolSubscription => Boolean(item));
      const reply = explainReply({
        userText: text,
        facts: {
          message: [
            "같은 이름의 구독이 여러 개예요. 금액을 보고 하나를 골라 주세요.",
            ...names.map((item, index) =>
              `${index + 1}. ${item.name} · ${item.amount.toLocaleString("ko-KR")}원`
            ),
          ].join("\n"),
        },
        style: "clarify",
      });
      return {
        payload: {
          ...emptyTurn("update_subscription", session.version),
          reply,
          action: pending.kind,
          candidate_ids: session.candidate_ids,
          pending_action_id: pending.id,
          expires_at: pending.expires_at,
        },
        next,
      };
    }
    const { data, error } = await client.rpc("confirm_pending_assistant_action", {
      p_action_id: pending.id,
      p_expected_version: session.version,
      p_subscription_id: pending.subscription_id,
    });
    if (error) throw new Error(error.message);
    const payload = data as { ok?: boolean; code?: string; message?: string; session?: unknown } | null;
    const saved = payload?.session ? parseSession(payload.session) : emptyState();
    if (!payload?.ok && payload?.code !== "already_completed") {
      const reply = explainReply({
        userText: text,
        facts: { message: payload?.message ?? "확인하지 못했어요. 카드를 눌러 적용해 주세요." },
        style: "clarify",
      });
      return { payload: { ...emptyTurn(classified.intent, session.version), reply }, next: saved, alreadySaved: true };
    }
    const targetName = typeof pending.extract?.name === "string"
      ? pending.extract.name
      : all.find((item) => item.id === pending.subscription_id)?.name ?? "이 구독";
    const doneLabel = pending.kind === "create"
      ? `${withObjectParticle(targetName)} 등록했어요.`
      : pending.kind === "update"
      ? "변경했어요."
      : pending.kind === "delete"
      ? `${withObjectParticle(targetName)} 목록에서 삭제했어요.`
      : pending.kind === "pause"
      ? `${withObjectParticle(targetName)} 일시정지했어요.`
      : `${withObjectParticle(targetName)} 다시 켰어요.`;
    return {
      payload: { ...emptyTurn(classified.intent, saved.version), reply: doneLabel },
      next: saved,
      alreadySaved: true,
    };
  }

  // 되돌리기 어렵거나 헷갈릴 수 있는 의도(관리형 + 해지 안내/상태변경/절약액)인데 LLM
  // 확신도가 낮으면, 바로 실행하지 않고 먼저 "이거 맞나요?" 확인부터 받는다. 이미 진행
  // 중인 흐름(등록/수정 초안, pending_action, 같은 의도 이어가기)의 후속 턴은 그 자체로
  // 짧은 조각 답변이라 confidence가 낮게 나오기 쉬우므로 게이트 대상에서 제외한다.
  const riskyIntent = (MANAGE_INTENTS as readonly string[]).includes(intent) ||
    intent === "cancellation_guide" || intent === "lifecycle_update" || intent === "cancel_savings";
  const isContinuation = session.pending_action_status === "pending" ||
    Boolean(createDraftOpen) ||
    Boolean(readUpdateDraft(session.last_result)) ||
    session.last_intent === intent;
  if (riskyIntent && classified.confidence < LOW_CONFIDENCE_THRESHOLD && !isContinuation) {
    writePendingConfidenceCheck(next, classified);
    next.last_intent = null;
    next.pending_action = null;
    next.pending_action_status = "none";
    next.candidate_ids = [];
    next.selected_subscription_id = null;
    next.ranked_subscription_ids = [];
    const reply = explainReply({
      userText: text,
      facts: { message: `${intentLabel(intent)}이(가) 맞을까요? "네"라고 답해 주시면 진행할게요.` },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
  }

  const resolved = resolveReferent(classified, session, all);
  const isManage = (MANAGE_INTENTS as readonly string[]).includes(intent);
  const referentLookup = classified.referent.kind === "ordinal" || classified.referent.kind === "pronoun";
  const listLikeIntent = intent === "expensive_subscriptions" || intent === "list_subscriptions" ||
    intent === "upcoming_payments";
  const needsReferentTarget =
    (isManage && intent !== "create_subscription") ||
    intent === "usage_checkin" ||
    intent === "cancellation_guide" ||
    intent === "cancel_savings" ||
    intent === "lifecycle_update";

  if (resolved.error && (needsReferentTarget || (referentLookup && !listLikeIntent))) {
    const reply = explainReply({
      userText: text,
      facts: { message: resolved.error },
      style: "clarify",
    });
    next.last_intent = "unknown";
    if (isManage && classified.intent !== "create_subscription" && classified.service_name && !referentLookup) {
      next.ranked_subscription_ids = [];
      next.candidate_ids = [];
      next.selected_subscription_id = null;
      next.pending_action = null;
      next.pending_action_status = "none";
    }
    return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
  }

  if (intent === "unknown" && !referentLookup) {
    const reply = await unknownQueryReply(text, active, categories);
    return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
  }

  if (
    referentLookup && !isManage && intent !== "usage_checkin" && intent !== "cancellation_guide" &&
    !listLikeIntent
  ) {
    const target = all.find((item) => item.id === resolved.id);
    if (!target) {
      const reply = explainReply({
        userText: text,
        facts: { message: "어떤 구독을 말씀하시는지 조금 더 구체적으로 알려 주세요." },
        style: "clarify",
      });
      next.last_intent = "unknown";
      return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
    }
    next.selected_subscription_id = target.id;
    next.last_result = {
      id: target.id,
      name: target.name,
      amount: target.amount,
      billing_cycle: target.billing_cycle,
    };
    const reply = explainReply({
      userText: text,
      facts: next.last_result,
      style: "query",
    });
    return {
      payload: {
        ...emptyTurn(intent === "unknown" ? "monthly_total" : intent, session.version),
        reply,
        subscription_id: target.id,
        ranked_subscription_ids: session.ranked_subscription_ids,
      },
      next,
    };
  }

  if (intent === "period_comparison") {
    const snapshots = await fetchSnapshots(client, 8);
    const changes = await fetchAmountChanges(client);
    const monthStart = `${seoulYmd().year}-${String(seoulYmd().month).padStart(2, "0")}-01`;
    const thisMonthChanges = changes.filter((item) => item.created_at.slice(0, 7) === monthStart.slice(0, 7));
    const months = classified.period.days === 6 || classified.period.days === 3 ? classified.period.days : 1;
    const facts = periodComparison(snapshots, months, thisMonthChanges);
    assignFacts(next, facts);
    next.ranked_subscription_ids = [];
    next.selected_subscription_id = null;
    const reply = explainReply({ userText: text, facts, style: "query" });
    return { payload: { ...emptyTurn(intent, session.version), reply }, next };
  }

  if (intent === "price_increases") {
    const facts = priceIncreases(await fetchAmountChanges(client));
    assignFacts(next, facts);
    const reply = explainReply({ userText: text, facts, style: "query" });
    return { payload: { ...emptyTurn(intent, session.version), reply }, next };
  }

  if (intent === "monthly_total") {
    const facts = monthlyTotal(active);
    assignFacts(next, facts);
    next.ranked_subscription_ids = [];
    next.selected_subscription_id = null;
    const reply = explainReply({ userText: text, facts, style: "query" });
    return { payload: { ...emptyTurn(intent, session.version), reply }, next };
  }

  if (intent === "category_analysis") {
    const among = mentionsPriorList(text);
    const sessionPeriod = asSessionPeriod(session.query_period);
    const canInherit = session.last_intent === "list_subscriptions" ||
      session.last_intent === "expensive_subscriptions" ||
      session.last_intent === "upcoming_payments" ||
      session.last_intent === "category_analysis";
    let period = classified.period;
    if (period.type === "unknown" && sessionPeriod && (among || canInherit)) period = sessionPeriod;

    const byId = new Map(active.map((item) => [item.id, item]));
    const ranked = session.ranked_subscription_ids
      .map((id) => byId.get(id))
      .filter((item): item is ToolSubscription => Boolean(item));

    // ChatGPT 수정: 커스텀 카테고리는 사용자 문장과 정규화된 표시 이름을 직접 맞춘다.
    const requestedCategory = mentionedCategory;
    // 이번 턴에 카테고리를 새로 지목했으면, 직전 턴이 좁혀 놓은 목록(ranked) 안에서
    // 찾지 않는다 — "OTT 보여줘" 다음 "쇼핑 멤버십 보여줘"를 물으면 OTT로 좁혀진
    // 목록 안에서 쇼핑 멤버십을 찾다가 항상 0건이 나오는 사고가 났었다.
    let pool: ToolSubscription[];
    if (requestedCategory) {
      pool = period.type !== "unknown" ? subscriptionsInPeriod(active, period) : active;
    } else if (among && ranked.length > 0) pool = ranked;
    else if (period.type !== "unknown") pool = subscriptionsInPeriod(active, period);
    else if (canInherit && ranked.length > 0 && session.last_intent !== "expensive_subscriptions") {
      pool = ranked;
    } else if (canInherit && sessionPeriod) {
      pool = subscriptionsInPeriod(active, sessionPeriod);
    } else {
      pool = active;
    }

    if (requestedCategory) {
      pool = pool.filter((item) => item.category_id === requestedCategory.id);
    }

    const scoped = pool !== active || among || period.type !== "unknown" || Boolean(requestedCategory);
    const facts = scoped
      ? categorizedSubscriptions(pool, categories) as Record<string, unknown>
      : categoryTotals(active, categories) as Record<string, unknown>;
    if (!scoped) {
      const snapshots = await fetchSnapshots(client, 2);
      const today = seoulYmd();
      const thisStart = `${today.year}-${String(today.month).padStart(2, "0")}-01`;
      const prev = snapshots.find((item) => item.month_start < thisStart);
      if (prev) {
        facts.snapshot_note = `지난달 월평균 구독 지출액은 ${prev.monthly_total.toLocaleString("ko-KR")}원이었어요.`;
      }
    }
    assignFacts(next, facts);
    next.query_period = period.type === "unknown" ? session.query_period : { ...period };
    next.ranked_subscription_ids = pool.map((item) => item.id);
    next.selected_subscription_id = pool.length === 1 ? pool[0].id : null;

    // 카테고리 이름을 대려 한 것 같은데(오타 허용까지 실패) 못 찾았으면, 전체
    // 집계 대신 실제 카테고리 이름을 후보로 보여준다. 대신 골라주지는 않는다.
    if (!requestedCategory && categories.length > 0 && mentionsUnresolvedCategory(text)) {
      const candidateNames = categories.map((item) => item.name).slice(0, 8);
      const reply = explainReply({
        userText: text,
        facts: { message: "그런 카테고리를 못 찾았어요. 아래에서 골라 주세요." },
        style: "clarify",
      });
      return {
        payload: { ...emptyTurn(intent, session.version), reply, category_candidates: candidateNames },
        next,
      };
    }

    const reply = explainReply({ userText: text, facts, style: "query" });
    return { payload: { ...emptyTurn(intent, session.version), reply }, next };
  }

  if (intent === "list_subscriptions") {
    // "무료체험인 구독 보여줘"처럼 체험 여부로 거르는 질문은, 그 안의 "체험"이라는 말이
    // listFacts의 이름 검색으로 잘못 넘어가 버리기 전에 여기서 먼저 잡는다.
    const wantsTrialList = /체험/.test(text.replace(/\s+/g, "")) &&
      !/등록|추가|넣어줘/.test(text.replace(/\s+/g, ""));
    if (wantsTrialList) {
      const t = seoulYmd();
      const todayIso = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
      const facts = listTrial(active, todayIso);
      next.ranked_subscription_ids = facts.subscriptions.map((item) => item.id);
      next.selected_subscription_id = facts.subscriptions.length === 1 ? facts.subscriptions[0].id : null;
      assignFacts(next, facts);
      const reply = explainReply({ userText: text, facts, style: "query" });
      return {
        payload: {
          ...emptyTurn(intent, session.version),
          reply,
          ranked_subscription_ids: next.ranked_subscription_ids,
        },
        next,
      };
    }
    const facts = listFacts(classified, active);
    next.query_period = { ...classified.period };
    next.ranked_subscription_ids = facts.subscriptions.map((item) => item.id);
    next.selected_subscription_id = facts.subscriptions.length === 1 ? facts.subscriptions[0].id : null;
    assignFacts(next, facts);
    const reply = explainReply({ userText: text, facts, style: "query" });
    return {
      payload: {
        ...emptyTurn(intent, session.version),
        reply,
        ranked_subscription_ids: next.ranked_subscription_ids,
      },
      next,
    };
  }

  if (intent === "upcoming_payments") {
    const facts = upcomingFacts(classified, active);
    next.query_period = { ...classified.period };
    next.ranked_subscription_ids = facts.subscriptions.map((item) => item.id);
    next.selected_subscription_id = facts.subscriptions.length === 1 ? facts.subscriptions[0].id : null;
    assignFacts(next, facts);
    const reply = explainReply({ userText: text, facts, style: "query" });
    return {
      payload: {
        ...emptyTurn(intent, session.version),
        reply,
        ranked_subscription_ids: next.ranked_subscription_ids,
      },
      next,
    };
  }

  if (intent === "expensive_subscriptions") {
    const among = mentionsPriorList(text);
    let period = classified.period;
    const sessionPeriod = asSessionPeriod(session.query_period);
    const canInheritPeriod = session.last_intent === "list_subscriptions" ||
      session.last_intent === "expensive_subscriptions" ||
      session.last_intent === "upcoming_payments";
    if (period.type === "unknown" && sessionPeriod && (among || canInheritPeriod)) {
      period = sessionPeriod;
    }

    const byId = new Map(active.map((item) => [item.id, item]));
    const ranked = session.ranked_subscription_ids
      .map((id) => byId.get(id))
      .filter((item): item is ToolSubscription => Boolean(item));
    const inheritRanked = ranked.length > 0 && (
      among ||
      session.last_intent === "list_subscriptions" ||
      session.last_intent === "expensive_subscriptions" ||
      session.last_intent === "upcoming_payments"
    );

    let pool: ToolSubscription[];
    if (among && ranked.length > 0) {
      pool = ranked;
    } else if (period.type !== "unknown") {
      pool = subscriptionsInPeriod(active, period);
    } else if (inheritRanked) {
      pool = ranked;
    } else {
      pool = active;
    }

    const facts = expensive(pool, classified.limit ?? 3);
    next.ranked_subscription_ids = facts.subscriptions.map((item) => item.id);
    next.selected_subscription_id = facts.subscriptions.length === 1 ? facts.subscriptions[0].id : null;
    next.query_period = period.type === "unknown" ? session.query_period : { ...period };
    assignFacts(next, facts);
    const reply = explainReply({ userText: text, facts, style: "query" });
    return {
      payload: {
        ...emptyTurn(intent, session.version),
        reply,
        ranked_subscription_ids: next.ranked_subscription_ids,
      },
      next,
    };
  }

  if (intent === "cleanup_candidates") {
    const facts = await cleanupCandidates(client, active);
    next.ranked_subscription_ids = facts.subscriptions.map((item) => item.id);
    next.selected_subscription_id = facts.subscriptions.length === 1 ? facts.subscriptions[0].id : null;
    next.last_result = {
      ...facts,
      summary: facts.subscriptions.length === 0
        ? "정리 후보가 아직 없어요. 사용 여부를 알려주시면 후보를 고를 수 있어요."
        : undefined,
    };
    const reply = explainReply({ userText: text, facts: next.last_result, style: "query" });
    return {
      payload: {
        ...emptyTurn(intent, session.version),
        reply,
        ranked_subscription_ids: next.ranked_subscription_ids,
        cleanup_recommendations: facts.subscriptions,
      },
      next,
    };
  }

  if (intent === "cancel_savings") {
    const target = resolved.id ? all.find((item) => item.id === resolved.id) : undefined;
    if (!target) {
      const reply = explainReply({
        userText: text,
        facts: { message: "어떤 구독을 해지했을 때 절약액을 볼지 알려 주세요." },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
    }
    const facts = cancelSavings(target);
    next.selected_subscription_id = target.id;
    assignFacts(next, facts);
    const reply = explainReply({ userText: text, facts, style: "query" });
    return {
      payload: { ...emptyTurn(intent, session.version), reply, subscription_id: target.id },
      next,
    };
  }

  if (intent === "lifecycle_update") {
    const target = resolved.id ? all.find((item) => item.id === resolved.id) : undefined;
    const to = classified.lifecycle_status;
    if (!target || !to) {
      const reply = explainReply({
        userText: text,
        facts: { message: "어떤 구독의 해지 상태를 바꿀지 알려 주세요. 앱에서 삭제하는 것과는 다릅니다." },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
    }
    const endDate = to === "cancel_requested" || to === "ending_scheduled"
      ? (target.service_end_date ?? target.next_payment_date)
      : target.service_end_date;
    const reply = explainReply({
      userText: text,
      facts: { action: "lifecycle", name: target.name, lifecycle_status: to, amount: target.amount },
      style: "confirm",
    });
    next.selected_subscription_id = target.id;
    return {
      payload: {
        ...emptyTurn(intent, session.version),
        reply,
        subscription_id: target.id,
        lifecycle_update: {
          subscription_id: target.id,
          to,
          service_end_date: endDate,
        },
      },
      next,
    };
  }

  if (intent === "usage_checkin") {
    const targetId = resolved.id;
    if (!targetId || !classified.usage_response) {
      const reply = explainReply({
        userText: text,
        facts: { message: "어떤 구독을 얼마나 쓰셨는지 구체적으로 알려 주세요." },
        style: "clarify",
      });
      next.last_intent = "unknown";
      return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
    }
    next.selected_subscription_id = targetId;
    const usage_checkin = { subscription_id: targetId, response: classified.usage_response };
    const target = all.find((item) => item.id === targetId);
    const reply = explainReply({
      userText: text,
      facts: {
        name: target?.name,
        usage_response: classified.usage_response,
        summary: `${target?.name ?? "이 구독"} 사용 여부를 이렇게 기록할까요?`,
      },
      style: "confirm",
    });
    return {
      payload: {
        ...emptyTurn(intent, session.version),
        reply,
        usage_checkin,
        subscription_id: targetId,
      },
      next,
    };
  }

  if (intent === "cancellation_guide") {
    const target = resolved.id ? all.find((item) => item.id === resolved.id) : undefined;
    const request = {
      service_query: classified.service_name ?? target?.name ?? text,
      question_snippet: text,
      subscription_id: target?.id ?? null,
      // 결제 경로를 더 이상 묻지 않는다 — 항상 웹 결제 기준으로 안내하고, 다른 채널(스토어·
      // 통신사)은 CancelGuideCard의 고정 문구로 공식 사이트·고객센터 확인을 안내한다.
      billing_channel: "direct_web",
      platform,
      mode: "curated",
    };
    const guide = await invokeCancelGuide(authHeader, request);
    if (guide.redirect === "claude_proxy" && guide.intent === "app_delete") {
      classified.intent = "delete_subscription";
      return handleManage({
        text,
        classified,
        session,
        next,
        all,
        categories,
        resolved: target ? { id: target.id, candidates: [], error: null } : resolved,
      });
    }
    if (guide.redirect === "claude_proxy") {
      const reply = explainReply({
        userText: text,
        facts: { message: "구독 목록 조회·등록·변경으로 도와드릴까요?" },
        style: "clarify",
      });
      next.last_intent = "unknown";
      return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
    }
    if (target) next.selected_subscription_id = target.id;
    if (typeof guide.billing_channel === "string") next.billing_channel = guide.billing_channel;
    next.last_result = { service_name: guide.service_name ?? classified.service_name };
    const reply = cancelReply(guide);
    const showGuide = !guide.needs_intent && !guide.needs_billing_channel;
    return {
      payload: {
        ...emptyTurn("cancellation_guide", session.version),
        reply,
        cancel_guide: showGuide ? guide : null,
        cancel_guide_request: guide.needs_intent || guide.needs_billing_channel ? request : null,
        subscription_id: target?.id ?? null,
      },
      next,
    };
  }

  if (isManage) {
    return handleManage({ text, classified, session, next, all, categories, resolved });
  }

  const reply = await unknownQueryReply(text, active, categories);
  next.last_intent = "unknown";
  return { payload: { ...emptyTurn("unknown", session.version), reply }, next };
}

const HELP_REPLY = "무엇을 도와드릴까요? 월평균 구독 지출액, 이번 달 예상 지출액, 결제 예정, 등록·변경을 구체적으로 말씀해 주세요.";

function looksLikeMutation(text: string): boolean {
  return /삭제|지워|등록|추가|일시정지|중지|재개|다시시작|다시켜|바꿔|수정|변경|해지|갱신안|갱신하지|안내확인|종료됐|아직결제/.test(
    text.replace(/\s+/g, ""),
  );
}

async function unknownQueryReply(
  text: string,
  active: ToolSubscription[],
  categories: { id: string; name: string; key: string | null }[],
): Promise<string> {
  if (!looksLikeMutation(text)) {
    const labeled = active.map((item) => ({
      ...item,
      category: categories.find((row) => row.id === item.category_id)?.name ?? "기타",
    }));
    const claude = await explainQueryWithClaude(text, labeled).catch(() => null);
    if (claude) return claude;
  }
  return explainReply({
    userText: text,
    facts: { message: HELP_REPLY },
    style: "clarify",
  });
}

function asSessionPeriod(raw: Record<string, unknown> | null): ClassifiedPeriod | null {
  if (!raw) return null;
  const type = raw.type;
  if (type !== "calendar_month" && type !== "this_month" && type !== "last_month") return null;
  const month = typeof raw.month === "number" ? raw.month : Number(raw.month);
  const year = typeof raw.year === "number" ? raw.year : Number(raw.year);
  return {
    type,
    days: null,
    year: Number.isFinite(year) ? year : null,
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : null,
  };
}

function listFacts(classified: ClassifiedIntent, active: ToolSubscription[]) {
  const query = classified.referent.kind === "name"
    ? classified.referent.name
    : classified.service_name;
  if (query && !isFieldLabelName(query)) {
    return listNamed(active, query);
  }
  const period = classified.period;
  const today = seoulYmd();
  if (period.type === "calendar_month" && period.month != null) {
    return listByMonth(active, period.year ?? today.year, period.month);
  }
  if (period.type === "last_month") {
    const prev = shiftMonth(today.year, today.month, -1);
    return listByMonth(active, prev.year, prev.month);
  }
  if (period.type === "this_week" || period.type === "next_week") {
    const range = weekRange(period.type);
    return listByRange(active, range.start, range.end, "그 주에 결제 예정인 구독이 없어요.");
  }
  if (period.type === "this_month" || period.type === "unknown") {
    return listByMonth(active, today.year, today.month);
  }
  return listAll(active);
}

function upcomingFacts(classified: ClassifiedIntent, active: ToolSubscription[]) {
  const period = classified.period;
  if (period.type === "this_week" || period.type === "next_week") {
    const range = weekRange(period.type);
    const label = period.type === "next_week" ? "다음 주" : "이번 주";
    return listByRange(active, range.start, range.end, `${label}에 결제 예정인 구독이 없어요.`);
  }
  if (period.type === "calendar_month" && period.month != null) {
    const today = seoulYmd();
    return listByMonth(active, period.year ?? today.year, period.month);
  }
  const days = period.days ?? 7;
  return upcoming(active, days);
}

async function inferServiceCategory(input: {
  name: string;
  classifiedKey: string | null;
  currentKey?: string | null;
  currentPresetId?: string | null;
  all: ToolSubscription[];
  categories: { id: string; name: string; key: string | null }[];
  allowGemini: boolean;
}): Promise<{ key: string | null; presetId: string | null }> {
  const preset = matchPresetHint(input.name);
  if (preset && preset.category !== "etc") {
    return { key: preset.category, presetId: preset.id };
  }
  if (input.classifiedKey && input.classifiedKey !== "etc") {
    return { key: input.classifiedKey, presetId: preset?.id ?? input.currentPresetId ?? null };
  }
  if (input.currentKey && input.currentKey !== "etc") {
    return { key: input.currentKey, presetId: preset?.id ?? input.currentPresetId ?? null };
  }
  const peer = peerCategoryKey(input.all, input.name, input.categories);
  if (peer) return { key: peer, presetId: preset?.id ?? input.currentPresetId ?? null };
  if (input.allowGemini) {
    const gemini = await classifyCategoryKey(input.name);
    if (gemini) return { key: gemini, presetId: preset?.id ?? input.currentPresetId ?? null };
  }
  return {
    key: input.classifiedKey ?? preset?.category ?? input.currentKey ?? null,
    presetId: preset?.id ?? input.currentPresetId ?? null,
  };
}

function existingForCreate(all: ToolSubscription[], name: string): ToolSubscription[] {
  const active = all.filter((item) => item.is_active);
  const hits = findByName(active, name);
  const preset = matchPresetHint(name);
  if (!preset) return hits;
  const extra = active.filter((item) =>
    item.preset_id === preset.id || matchPresetHint(item.name)?.id === preset.id
  );
  const byId = new Map([...hits, ...extra].map((item) => [item.id, item]));
  return [...byId.values()];
}

function formatExistingLine(item: ToolSubscription): string {
  const cycle = item.billing_cycle === "yearly"
    ? "매년"
    : item.billing_cycle === "one_time"
    ? "일회성"
    : "매월";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(item.anchor_date)
    ? item.billing_cycle === "yearly" || item.billing_cycle === "one_time"
      ? `${Number(item.anchor_date.slice(5, 7))}월 ${Number(item.anchor_date.slice(8, 10))}일`
      : `${Number(item.anchor_date.slice(8, 10))}일`
    : "";
  return `${item.name} · ${item.amount.toLocaleString("ko-KR")}원 · ${cycle}${day ? ` ${day}` : ""}${
    item.account_id ? ` · ${item.account_id}` : ""
  }`;
}

function handleUpdateManage(input: {
  text: string;
  classified: ClassifiedIntent;
  session: SessionState;
  next: SessionState;
  all: ToolSubscription[];
  resolved: { id: string | null; candidates: ToolSubscription[]; error: string | null; fuzzy?: boolean };
}): { payload: TurnResponse; next: SessionState } {
  const { text, session, next, all, resolved } = input;
  const prior = readUpdateDraft(session.last_result);
  const compact = text.replace(/\s+/g, "");
  const invalidDay = invalidBillingDay(text);
  const calendarDate = parseKoreanDate(text);
  const billingDate = parseBillingDate(text, { allowBareDay: true });
  const spokenCycle = parseSpokenCycle(text);
  const dayOnly = calendarDate ? null : (parseUpdateBillingDay(text) ?? billingDate?.day ?? prior?.pending_day ?? null);
  const monthOnly = parseCreateMonthNumber(text, { allowBare: prior?.awaiting === "billing_month" });
  const spokenAmount = parseWonAmount(text);
  const wantsAmount = /금액|요금|가격/.test(compact) || spokenAmount != null || prior?.awaiting === "amount";
  const wantsDate = /결제일|결제날짜|결제\s*일/.test(text) || calendarDate != null || dayOnly != null ||
    spokenCycle != null || prior?.awaiting === "billing_day" || prior?.awaiting === "billing_month" ||
    prior?.awaiting === "weekday";

  next.last_intent = "update_subscription";
  next.ranked_subscription_ids = [];

  const candidates = resolved.candidates;
  if (candidates.length >= 1 && (candidates.length > 1 || resolved.fuzzy)) {
    const pendingDay = invalidDay != null ? null : dayOnly;
    const pending = makePending("update", null, {
      name: candidates[0].name,
      amount: spokenAmount,
      billing_cycle: spokenCycle,
      anchor_date: calendarDate ?? (pendingDay != null ? monthlyCanonicalAnchor(pendingDay) : null),
      pending_day: pendingDay,
      pending_month: monthOnly,
    });
    next.pending_action = pending;
    next.pending_action_status = "pending";
    next.candidate_ids = candidates.map((item) => item.id);
    next.selected_subscription_id = null;
    const awaiting: UpdateAwaitingField | null = spokenAmount == null && !calendarDate && pendingDay == null
      ? (wantsDate ? "billing_day" : "amount")
      : null;
    writeUpdateDraft(next, {
      awaiting,
      subscription_id: null,
      amount: spokenAmount,
      pending_day: pendingDay,
      pending_month: monthOnly,
    }, { name: candidates[0].name });
    const pickLine = wantsDate && !wantsAmount
      ? `어떤 ${candidates[0].name} 구독의 결제일을 바꿀까요?`
      : `어떤 ${candidates[0].name} 구독의 금액을 바꿀까요?`;
    // 오타로 못 찾아 가까운 이름을 후보로 띄운 경우엔 "몇 개예요"가 아니라 "이건가요?"로 묻는다.
    const headline = resolved.fuzzy
      ? (candidates.length === 1
        ? `혹시 ${candidates[0].name}을 말씀하신 건가요?`
        : `찾으시는 게 이 중에 있을까요?`)
      : `같은 이름의 구독이 ${candidates.length}개예요. ${pickLine}`;
    const reply = explainReply({
      userText: text,
      facts: {
        message: [
          headline,
          ...candidates.map((item, index) => `${index + 1}. ${formatExistingLine(item)}`),
        ].join("\n"),
      },
      style: "clarify",
    });
    return {
      payload: {
        ...emptyTurn("update_subscription", session.version),
        reply,
        action: "update",
        candidate_ids: next.candidate_ids,
        extract: toClaudeExtract({
          name: candidates[0].name,
          amount: spokenAmount,
          billing_cycle: spokenCycle,
          anchor_date: calendarDate ?? (pendingDay != null ? monthlyCanonicalAnchor(pendingDay) : null),
        }, []),
        pending_action_id: pending.id,
        expires_at: pending.expires_at,
      },
      next,
    };
  }

  const target = all.find((item) => item.id === resolved.id) ??
    all.find((item) => item.id === (prior?.subscription_id ?? session.selected_subscription_id));
  if (!target) {
    const reply = explainReply({
      userText: text,
      facts: { message: "어떤 구독을 바꿀까요? 목록에 있는 이름을 말해 주세요. 고르지 않고 다른 질문을 해도 됩니다." },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
  }

  if (invalidDay != null) {
    writeUpdateDraft(next, {
      awaiting: "billing_day",
      subscription_id: target.id,
      amount: spokenAmount ?? prior?.amount ?? null,
      pending_day: null,
      pending_month: null,
    }, { name: target.name, id: target.id });
    next.selected_subscription_id = target.id;
    const reply = explainReply({
      userText: text,
      facts: { message: `${target.name} 결제일은 1일부터 31일 사이로 알려 주세요.` },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
  }

  const pendingExtract = session.pending_action_status === "pending" &&
      session.pending_action?.kind === "update"
    ? session.pending_action.extract
    : null;
  const pendingAmount = asPositiveAmount(pendingExtract?.amount) ?? prior?.amount ?? null;
  const pendingDay = asDayOfMonth(pendingExtract?.pending_day) ?? prior?.pending_day ?? null;
  const pendingMonth = asMonthNumber(pendingExtract?.pending_month) ?? prior?.pending_month ?? null;
  const nextAmount = spokenAmount ?? pendingAmount;
  let nextDay = dayOnly ?? pendingDay;
  let nextMonth = monthOnly ?? pendingMonth;
  const cycle = spokenCycle ?? asCycle(target.billing_cycle) ?? "monthly";

  let nextAnchor: string | null = calendarDate;
  if (!nextAnchor && nextDay != null) {
    if (cycle === "one_time") {
      if (nextMonth == null) {
        writeUpdateDraft(next, {
          awaiting: "billing_month",
          subscription_id: target.id,
          amount: nextAmount,
          pending_day: nextDay,
          pending_month: null,
        }, { name: target.name, id: target.id });
        next.selected_subscription_id = target.id;
        const reply = explainReply({
          userText: text,
          facts: { message: `${target.name}은 일회성 결제예요. 결제일을 알려 주세요. 예: 9월 15일` },
          style: "clarify",
        });
        return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
      }
      nextAnchor = yearlyCanonicalAnchor(nextMonth, nextDay);
    } else if (cycle === "yearly") {
      if (nextMonth == null) {
        writeUpdateDraft(next, {
          awaiting: "billing_month",
          subscription_id: target.id,
          amount: nextAmount,
          pending_day: nextDay,
          pending_month: null,
        }, { name: target.name, id: target.id });
        next.selected_subscription_id = target.id;
        const reply = explainReply({
          userText: text,
          facts: { message: `${target.name}은 연간 결제예요. 몇 월 ${nextDay}일로 바꿀까요?` },
          style: "clarify",
        });
        return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
      }
      nextAnchor = yearlyCanonicalAnchor(nextMonth, nextDay);
    } else {
      nextAnchor = monthlyCanonicalAnchor(nextDay);
    }
  }
  const amountChanged = nextAmount != null && nextAmount !== target.amount;
  const dateChanged = nextAnchor != null && nextAnchor !== target.anchor_date;
  const cycleChanged = Boolean(spokenCycle && spokenCycle !== target.billing_cycle);

  if (!amountChanged && !dateChanged && !cycleChanged) {
    next.selected_subscription_id = target.id;
    next.pending_action = null;
    next.pending_action_status = "none";
    next.candidate_ids = [];
    if (wantsAmount && nextAmount == null) {
      writeUpdateDraft(next, {
        awaiting: "amount",
        subscription_id: target.id,
        amount: null,
        pending_day: null,
        pending_month: null,
      }, { name: target.name, id: target.id });
      const reply = explainReply({
        userText: text,
        facts: {
          message: `${target.name}의 현재 요금은 ${amountAskLabel(cycle, target.amount)}이에요. 얼마로 바꿀까요?`,
        },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
    }
    if (wantsDate && nextAnchor == null) {
      writeUpdateDraft(next, {
        awaiting: "billing_day",
        subscription_id: target.id,
        amount: nextAmount,
        pending_day: null,
        pending_month: null,
      }, { name: target.name, id: target.id });
      const dateAsk = cycle === "one_time" || cycle === "yearly"
        ? `${target.name}의 현재 결제일은 ${billingDayLabel(target.anchor_date, cycle)}이에요. 언제로 바꿀까요? 예: 9월 15일`
        : `${target.name}의 현재 결제일은 ${billingDayLabel(target.anchor_date, cycle)}이에요. 며칠로 바꿀까요?`;
      const reply = explainReply({
        userText: text,
        facts: {
          message: dateAsk,
        },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
    }
    if (!wantsAmount && !wantsDate) {
      writeUpdateDraft(next, {
        awaiting: "amount",
        subscription_id: target.id,
        amount: null,
        pending_day: null,
        pending_month: null,
      }, { name: target.name, id: target.id });
      const reply = explainReply({
        userText: text,
        facts: {
          message: `${target.name}을 어떻게 바꿀까요? 금액이나 결제일을 알려 주세요. 지금은 건너뛰고 다른 질문을 해도 됩니다.`,
        },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
    }
    writeUpdateDraft(next, {
      awaiting: null,
      subscription_id: target.id,
      amount: null,
      pending_day: null,
      pending_month: null,
    }, { name: target.name, id: target.id });
    const reply = explainReply({
      userText: text,
      facts: { message: `${target.name}은 이미 같은 값이에요.` },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
  }

  const extract = {
    name: target.name,
    ...(amountChanged ? { amount: nextAmount } : {}),
    ...(cycleChanged ? { billing_cycle: spokenCycle } : { billing_cycle: target.billing_cycle }),
    ...(dateChanged ? { anchor_date: nextAnchor } : {}),
    previous_amount: target.amount,
    previous_anchor_date: target.anchor_date,
    previous_billing_cycle: target.billing_cycle,
    expected_updated_at: asIsoTimestamp(target.updated_at),
  };
  const pending = makePending("update", target.id, extract);
  next.pending_action = pending;
  next.pending_action_status = "pending";
  next.selected_subscription_id = target.id;
  next.candidate_ids = [];
  writeUpdateDraft(next, {
    awaiting: null,
    subscription_id: target.id,
    amount: amountChanged ? nextAmount : null,
    pending_day: null,
    pending_month: null,
  }, { name: target.name, id: target.id });
  const reply = explainReply({
    userText: text,
    facts: {
      action: "update",
      name: target.name,
      amount: amountChanged ? nextAmount : undefined,
      previous_amount: amountChanged ? target.amount : undefined,
      billing_cycle: spokenCycle ?? target.billing_cycle,
      previous_billing_cycle: target.billing_cycle,
      anchor_date: dateChanged ? nextAnchor : undefined,
      previous_anchor_date: dateChanged ? target.anchor_date : undefined,
    },
    style: "confirm",
  });
  return {
    payload: {
      ...emptyTurn("update_subscription", session.version),
      reply,
      action: "update",
      subscription_id: target.id,
      extract: toClaudeExtract({
        name: target.name,
        amount: amountChanged ? nextAmount : target.amount,
        billing_cycle: spokenCycle ?? target.billing_cycle,
        anchor_date: dateChanged ? nextAnchor : target.anchor_date,
      }, []),
      pending_action_id: pending.id,
      expires_at: pending.expires_at,
    },
    next,
  };
}

async function handleManage(input: {
  text: string;
  classified: ClassifiedIntent;
  session: SessionState;
  next: SessionState;
  all: ToolSubscription[];
  categories: { id: string; name: string; key: string | null }[];
  resolved: { id: string | null; candidates: ToolSubscription[]; error: string | null; fuzzy?: boolean };
}): Promise<{ payload: TurnResponse; next: SessionState }> {
  const { text, classified, session, next, all, categories, resolved } = input;
  const action = intentToAction(classified.intent);
  if (!action) {
    return { payload: { ...emptyTurn("unknown", session.version) }, next };
  }

  if (action === "create") {
    const prior = readCreateDraft(session.last_result);
    const duplicateAffirmed = isDuplicateAffirmativeUtterance(text, prior?.awaiting_duplicate === true);
    const compactText = text.replace(/\s+/g, "");
    const invalidCalendar = /(?:\d{4}년)?\d{1,2}월\d{1,2}일/.test(compactText) &&
      !classified.anchor_date &&
      parseKoreanDate(text) == null;
    const invalidDay = invalidBillingDay(text);
    const amountIssue = spokenAmountIssue(text);
    const typedName = createNameFromText(text);
    // "별도 구독"/"다른 계정" 같은 중복 선택 응답은 "구독" 뒤의 "별도"/"다른 계정" 같은 말이
    // createNameFromText에 의해 그럴듯한 이름처럼 잘못 추출될 수 있다("별도 구독" → "별도").
    // 계정을 물은 직후의 답(이메일 등)도 마찬가지로 createNameFromText를 거치면 "qkqkwh
    // @gmail comq"처럼 이메일이 그대로 이름 자리에 들어간다. 두 경우 다 새 이름을 말한 게
    // 아니라 직전 질문에 답한 것뿐이므로 반드시 기존 초안 이름을 유지해야 한다.
    const keepDraftName = Boolean(prior?.name) && (
      duplicateAffirmed || isDuplicateSeparateUtterance(text) || isCorrectionUtterance(text) ||
      prior?.awaiting_account === true || !typedName || isFieldLabelName(typedName)
    );
    const draftName = cleanServiceName(
      keepDraftName
        ? prior?.name ?? null
        : typedName && !isFieldLabelName(typedName)
        ? typedName
        : (classified.service_name && !isFieldLabelName(classified.service_name)
          ? classified.service_name.trim()
          : prior?.name ?? null),
    );
    let draftCycle = classified.billing_cycle ?? prior?.billing_cycle ?? null;
    const waitingMonth = prior?.pending_day != null && prior?.pending_month == null;
    const waitingDay = prior?.pending_month != null && prior?.pending_day == null;
    const monthFromText = parseCreateMonthNumber(text, { allowBare: waitingMonth });
    const dayFromText = waitingMonth ? null : parseCreateDayNumber(text);
    const classifiedAmount = amountIssue || (looksLikeDateAttempt(compactText) &&
        (classified.amount == null || classified.amount < 100))
      ? null
      : classified.amount;
    const draftAmount = classifiedAmount ?? prior?.amount ?? null;
    let pendingDay = classified.anchor_date && !waitingDay
      ? null
      : (dayFromText ?? prior?.pending_day ?? null);
    let pendingMonth = classified.anchor_date && !waitingDay
      ? null
      : (monthFromText ?? prior?.pending_month ?? null);
    let draftAnchor = classified.anchor_date && !waitingDay
      ? classified.anchor_date
      : ((invalidCalendar ? null : prior?.anchor_date) ?? null);
    if (classified.anchor_date && !waitingDay) {
      pendingDay = null;
      pendingMonth = null;
    }
    if (invalidDay != null) {
      draftAnchor = null;
      pendingDay = null;
      pendingMonth = null;
    }
    // "지니뮤직 체험 ... 등록해줘"처럼 체험 언급이 첫 턴에만 있고 이후 "9900원"처럼 금액만
    // 답하는 후속 턴에는 없을 수 있다 — 한 번 감지되면 초안이 완성될 때까지 이어간다.
    const draftIsTrial = classified.is_trial === true || (prior?.is_trial ?? false);
    const draftTrialEndsAt = draftIsTrial
      ? (classified.trial_ends_at ?? prior?.trial_ends_at ?? draftAnchor)
      : null;
    // 앱·웹 폼과 동일한 규칙: 체험은 일회성과 조합할 수 없다. 앱/웹은 토글을 켤 때 UI에서
    // 바로 월간으로 바꾸는데, 채팅에는 그 토글이 없으니 여기서 같은 보정을 해준다.
    const trialBlockedOneTime = draftIsTrial && draftCycle === "one_time";
    if (trialBlockedOneTime) draftCycle = "monthly";
    const duplicateOk = isDuplicateSeparateUtterance(text) || duplicateAffirmed;
    const sameDraftName = !prior?.name || !draftName ||
      prior.name.replace(/\s+/g, "").toLowerCase() === draftName.replace(/\s+/g, "").toLowerCase();
    const skipDuplicatePicker = duplicateOk || (prior?.awaiting_account === true && sameDraftName);
    const draftAccount = parseAccountFromText(text, prior?.awaiting_account === true) ??
      prior?.account_id ?? null;
    if (duplicateOk) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: draftAnchor,
        pending_day: pendingDay,
        pending_month: pendingMonth,
        duplicate_ok: true,
        account_id: draftAccount,
      });
    }
    const wonLabel = draftAmount != null ? `${draftAmount.toLocaleString("ko-KR")}원` : "";
    next.last_intent = "create_subscription";
    next.pending_action = null;
    next.pending_action_status = "none";

    if (!draftName) {
      const reply = explainReply({
        userText: text,
        facts: { message: "어떤 구독을 등록할까요? 서비스 이름과 금액을 알려 주세요.\n예) 넷플릭스 17000원" },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    if (amountIssue || draftAmount == null) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: null,
        billing_cycle: draftCycle,
        anchor_date: draftAnchor,
        pending_day: pendingDay,
        pending_month: pendingMonth,
        duplicate_ok: duplicateOk,
      });
      const reply = explainReply({
        userText: text,
        facts: {
          message: draftIsTrial
            ? "체험은 보통 카드가 미리 등록돼 있어서 체험이 끝나면 바로 결제돼요. 체험 종료 후 결제될 금액을 알려 주세요.\n예) 5000원"
            : "정확한 결제 금액을 알려 주세요.\n예) 5000원",
        },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    if (invalidDay != null) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: null,
        pending_day: null,
        pending_month: null,
        duplicate_ok: duplicateOk,
      });
      const reply = explainReply({
        userText: text,
        facts: {
          message: `${invalidDay}일은 달력에 없어요. 결제일은 1일부터 31일 사이로 알려 주세요. 29~31일은 짧은 달이면 말일에 맞춰 계산해요.`,
        },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    if (invalidCalendar) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: null,
        pending_day: pendingDay,
        pending_month: pendingMonth,
      });
      const reply = explainReply({
        userText: text,
        facts: {
          message: draftCycle
            ? "그 날짜는 달력에 없어요. 결제일을 다시 알려 주세요. 예: 매월 15일"
            : "그 날짜는 달력에 없어요. 결제 주기와 결제일을 다시 알려 주세요. 예: 매월 15일",
        },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    if (!draftAnchor && pendingDay != null && pendingMonth != null) {
      const combined = calendarDateFromMonthDay(pendingMonth, pendingDay);
      if (!combined) {
        const keepMonth = monthFromText != null;
        writeCreateDraft(next, {
          name: draftName,
          is_trial: draftIsTrial,
          trial_ends_at: draftTrialEndsAt,
          amount: draftAmount,
          billing_cycle: draftCycle,
          anchor_date: null,
          pending_day: keepMonth ? null : pendingDay,
          pending_month: keepMonth ? pendingMonth : null,
        });
        const reply = explainReply({
          userText: text,
          facts: {
            message: keepMonth
              ? `${pendingMonth}월에는 ${pendingDay}일이 없어요. 며칠인가요? 예: 15, 또는 15일`
              : "그 날짜는 달력에 없어요. 몇 월인지 다시 알려 주세요. 예: 9, 또는 9월",
          },
          style: "clarify",
        });
        return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
      }
      draftAnchor = combined;
      pendingDay = null;
      pendingMonth = null;
    }
    if (!draftAnchor && waitingMonth && monthFromText == null && /^\d{1,2}$/.test(compactText)) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: null,
        pending_day: pendingDay,
        pending_month: null,
      });
      const reply = explainReply({
        userText: text,
        facts: { message: "1부터 12 사이의 월을 알려 주세요. 예: 9, 또는 9월" },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    if (!draftAnchor && pendingDay != null && pendingMonth == null) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: null,
        pending_day: pendingDay,
        pending_month: null,
      });
      const reply = explainReply({
        userText: text,
        facts: { message: `${pendingDay}일로 확인했어요. 몇 월인가요? 예: 9, 또는 9월` },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    if (!draftAnchor && pendingMonth != null && pendingDay == null) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: null,
        pending_day: null,
        pending_month: pendingMonth,
      });
      const reply = explainReply({
        userText: text,
        facts: { message: `${pendingMonth}월로 확인했어요. 며칠인가요? 예: 15, 또는 15일` },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    if (!draftCycle && !draftAnchor) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: null,
        anchor_date: null,
        pending_day: pendingDay,
        pending_month: pendingMonth,
      });
      const reply = explainReply({
        userText: text,
        facts: {
          message: `${draftName} ${wonLabel}으로 확인했어요. 결제 주기와 결제일은 언제인가요? 예: 매월 15일, 일회성 9월 15일`,
        },
        style: "clarify",
      });
      // 위 두 곳과 동일한 이유로 extract 없이 순수 질문만 보낸다.
      return {
        payload: {
          ...emptyTurn("create_subscription", session.version),
          reply,
        },
        next,
      };
    }
    if (!draftCycle) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: null,
        anchor_date: draftAnchor,
        pending_day: pendingDay,
        pending_month: pendingMonth,
      });
      const reply = explainReply({
        userText: text,
        facts: { message: "결제 주기는 어떻게 되나요? 월간, 연간, 일회성 중에 알려 주세요." },
        style: "clarify",
      });
      // extract를 함께 보내지 않는다 — 아직 결제 주기를 못 정해서 완결된 등록 확인이 아닌데,
      // 클라이언트(app/web)가 action이 'create'가 아니면 무조건 extract를 카드로 파싱해서
      // billing_cycle/anchor_date 기본값(월간·오늘)으로 채운 확인 카드를 앞서 보여주던 버그가 있었다.
      return {
        payload: {
          ...emptyTurn("create_subscription", session.version),
          reply,
        },
        next,
      };
    }
    if (!draftAnchor) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: null,
        pending_day: pendingDay,
        pending_month: pendingMonth,
      });
      const dateHint = draftCycle === "yearly"
        ? "매년 결제일은 언제인가요? 예: 9월 15일"
        : draftCycle === "one_time"
        ? "결제일은 언제인가요? 예: 9월 15일"
        : "매월 며칠에 결제되나요? 예: 15일, 또는 15";
      const reply = explainReply({
        userText: text,
        facts: { message: dateHint },
        style: "clarify",
      });
      // 위와 동일한 이유로 extract를 보내지 않는다 — 결제일이 아직 없으므로 확인 카드가 아니다.
      return {
        payload: {
          ...emptyTurn("create_subscription", session.version),
          reply,
        },
        next,
      };
    }
    const nextPay = nextPaymentFromAnchor(draftAnchor, draftCycle);
    if (!nextPay) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: null,
        pending_day: pendingDay,
        pending_month: pendingMonth,
      });
      const reply = explainReply({
        userText: text,
        facts: { message: "결제일을 다시 알려 주세요. 예: 매월 15일" },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
    }
    const inferred = await inferServiceCategory({
      name: draftName,
      classifiedKey: classified.category_key,
      all,
      categories,
      allowGemini: true,
    });
    const categoryId = resolveCategoryId(categories, inferred.key, null);
    const extract = {
      name: draftName,
      amount: draftAmount,
      billing_cycle: draftCycle,
      category_id: categoryId,
      anchor_date: draftAnchor,
      next_payment_date: nextPay,
      account_id: draftAccount,
      preset_id: inferred.presetId,
      emoji: iconValueForCategory(inferred.key),
      ...(draftIsTrial ? { is_trial: true, trial_ends_at: draftTrialEndsAt ?? draftAnchor } : {}),
    };
    const existing = existingForCreate(all, draftName);
    if (existing.length > 0 && !skipDuplicatePicker) {
      writeCreateDraft(next, {
        name: draftName,
        is_trial: draftIsTrial,
        trial_ends_at: draftTrialEndsAt,
        amount: draftAmount,
        billing_cycle: draftCycle,
        anchor_date: draftAnchor,
        pending_day: null,
        pending_month: null,
        awaiting_duplicate: true,
        duplicate_ok: false,
        account_id: draftAccount,
      });
      const pendingDup = makePending("update", null, extract);
      next.pending_action = pendingDup;
      next.pending_action_status = "pending";
      next.candidate_ids = existing.map((item) => item.id);
      next.ranked_subscription_ids = next.candidate_ids;
      next.selected_subscription_id = null;
      next.last_intent = "create_subscription";
      const replyDup = explainReply({
        userText: text,
        facts: {
          message: [
            `이미 ${existing[0].name}이 ${existing.length}개 있어요. 바로 추가하지는 않아요.`,
            existing.map((item, index) => `${index + 1}. ${formatExistingLine(item)}`).join("\n"),
            "기존 구독을 바꿀지, 별도로 추가할지, 그대로 둘지 골라 주세요.",
          ].join("\n\n"),
        },
        style: "clarify",
      });
      return {
        payload: {
          ...emptyTurn("create_subscription", session.version),
          reply: replyDup,
          action: "update",
          extract: toClaudeExtract(extract, categories),
          candidate_ids: next.candidate_ids,
          ranked_subscription_ids: next.ranked_subscription_ids,
          pending_action_id: pendingDup.id,
          expires_at: pendingDup.expires_at,
        },
        next,
      };
    }
    if (existing.length > 0) {
      if (!draftAccount) {
        writeCreateDraft(next, {
          name: draftName,
          is_trial: draftIsTrial,
          trial_ends_at: draftTrialEndsAt,
          amount: draftAmount,
          billing_cycle: draftCycle,
          anchor_date: draftAnchor,
          pending_day: null,
          pending_month: null,
          duplicate_ok: true,
          account_id: null,
          awaiting_account: true,
        });
        // 회피성 답으로 여기 다시 왔으면, 이유를 짚어주며 다시 요구한다 — 계정 없이는
        // 등록을 진행시키지 않는다. 동명 구독을 구분할 방법이 그것뿐이다.
        const isRetryAfterNonAnswer = prior?.awaiting_account === true && isNonAnswerAccountUtterance(text);
        const reply = explainReply({
          userText: text,
          facts: {
            message: isRetryAfterNonAnswer
              ? "계정을 알아야 어떤 구독인지 구분할 수 있어요. 이메일이나 아이디를 입력해 주세요."
              : "같은 서비스가 이미 있어요. 구분할 가입 계정(이메일 또는 아이디)을 알려 주세요. 비밀번호는 저장하지 않아요.",
          },
          style: "clarify",
        });
        return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
      }
      if (accountTakenByDuplicate(existing, draftAccount)) {
        writeCreateDraft(next, {
          name: draftName,
          is_trial: draftIsTrial,
          trial_ends_at: draftTrialEndsAt,
          amount: draftAmount,
          billing_cycle: draftCycle,
          anchor_date: draftAnchor,
          pending_day: null,
          pending_month: null,
          duplicate_ok: true,
          account_id: null,
          awaiting_account: true,
        });
        const reply = explainReply({
          userText: text,
          facts: {
            message: "같은 서비스에는 같은 계정을 넣을 수 없어요. 다른 계정을 알려 주세요. 다른 서비스는 같은 이메일이어도 괜찮아요.",
          },
          style: "clarify",
        });
        return { payload: { ...emptyTurn("create_subscription", session.version), reply }, next };
      }
    }
    const pending = makePending("create", null, extract);
    next.pending_action = pending;
    next.pending_action_status = "pending";
    writeCreateDraft(next, {
      name: draftName,
      is_trial: draftIsTrial,
      trial_ends_at: draftTrialEndsAt,
      amount: draftAmount,
      billing_cycle: draftCycle,
      anchor_date: draftAnchor,
      pending_day: null,
      pending_month: null,
      duplicate_ok: false,
      account_id: draftAccount,
      awaiting_account: false,
    });
    next.candidate_ids = [];
    next.ranked_subscription_ids = [];
    const reply = explainReply({
      userText: text,
      facts: {
        action: "create",
        name: extract.name,
        amount: extract.amount,
        billing_cycle: extract.billing_cycle,
        anchor_date: extract.anchor_date,
        next_payment_date: extract.next_payment_date,
        monthly_equivalent: draftCycle === "yearly" ? monthlyAmount(draftAmount, "yearly") : null,
        short_month_note: draftCycle === "monthly" && Number(draftAnchor.slice(8, 10)) >= 29,
        trial_forced_monthly: trialBlockedOneTime,
      },
      style: "confirm",
    });
    return {
      payload: {
        ...emptyTurn("create_subscription", session.version),
        reply,
        action: "create",
        extract: toClaudeExtract(extract, categories),
        pending_action_id: pending.id,
        expires_at: pending.expires_at,
        name_needs_review: looksLikeRiskyNameSource(text),
      },
      next,
    };
  }

  if (action === "update") {
    return handleUpdateManage({ text, classified, session, next, all, resolved });
  }

  const candidates = resolved.candidates;
  if (candidates.length >= 1 && (candidates.length > 1 || resolved.fuzzy)) {
    const inferred = action === "update"
      ? await inferServiceCategory({
        name: classified.service_name ?? candidates[0].name,
        classifiedKey: classified.category_key,
        all,
        categories,
        allowGemini: false,
      })
      : null;
    const pending = makePending(
      action,
      null,
      action === "update"
        ? {
          name: candidates[0].name,
          amount: classified.amount,
          billing_cycle: classified.billing_cycle,
          anchor_date: classified.anchor_date,
          category_id: resolveCategoryId(categories, inferred?.key ?? null, null),
          preset_id: inferred?.presetId,
        }
        : null,
    );
    next.pending_action = pending;
    next.pending_action_status = "pending";
    next.candidate_ids = candidates.map((item) => item.id);
    next.selected_subscription_id = null;
    next.last_result = { name: candidates[0].name, amount: classified.amount };
    const amountLabel = classified.amount != null
      ? `${classified.amount.toLocaleString("ko-KR")}원으로 `
      : "";
    const pickLine = action === "delete"
      ? `어떤 ${withObjectParticle(candidates[0].name)} 목록에서 삭제할까요?`
      : action === "pause"
      ? `어떤 ${withObjectParticle(candidates[0].name)} 일시정지할까요?`
      : action === "resume"
      ? `어떤 ${withObjectParticle(candidates[0].name)} 다시 시작할까요?`
      : `어떤 ${candidates[0].name} 요금을 ${amountLabel}바꿀까요?`;
    // 오타로 못 찾아 가까운 이름을 후보로 띄운 경우엔 "몇 개예요"가 아니라 "이건가요?"로 묻는다.
    const headline = resolved.fuzzy
      ? (candidates.length === 1
        ? `혹시 ${candidates[0].name}을 말씀하신 건가요?`
        : `찾으시는 게 이 중에 있을까요?`)
      : `같은 이름의 구독이 ${candidates.length}개예요. ${pickLine}`;
    const reply = explainReply({
      userText: text,
      facts: {
        action,
        message: [
          headline,
          ...candidates.map((item, index) => `${index + 1}. ${formatExistingLine(item)}`),
        ].join("\n"),
      },
      style: "clarify",
    });
    return {
      payload: {
        ...emptyTurn(classified.intent, session.version),
        reply,
        action,
        candidate_ids: next.candidate_ids,
        extract: action === "update" ? toClaudeExtract(pending.extract, categories) : null,
        pending_action_id: pending.id,
        expires_at: pending.expires_at,
      },
      next,
    };
  }

  const target = all.find((item) => item.id === resolved.id);
  if (!target) {
    if (action === "update") {
      next.last_intent = "update_subscription";
      const reply = explainReply({
        userText: text,
        facts: { message: "어떤 구독을 바꿀까요? 목록에 있는 이름을 말해 주세요. 고르지 않고 다른 질문을 해도 됩니다." },
        style: "clarify",
      });
      return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
    }
    const message = action === "delete"
      ? "어떤 구독을 삭제할까요? 목록에 있는 이름을 말해 주세요. 고르지 않고 다른 질문을 해도 됩니다."
      : "어떤 구독을 말씀하시는지 조금 더 구체적으로 알려 주세요. 고르지 않고 다른 질문을 해도 됩니다.";
    const reply = explainReply({
      userText: text,
      facts: { message },
      style: "clarify",
    });
    next.last_intent = classified.intent;
    return { payload: { ...emptyTurn(classified.intent, session.version), reply }, next };
  }

  if (
    action === "update" &&
    classified.amount == null &&
    !classified.billing_cycle &&
    !classified.anchor_date &&
    !classified.category_key &&
    asPositiveAmount(session.pending_action?.kind === "update" ? session.pending_action.extract?.amount : null) == null
  ) {
    next.last_intent = "update_subscription";
    next.selected_subscription_id = target.id;
    next.last_result = { name: target.name, id: target.id };
    const reply = explainReply({
      userText: text,
      facts: { message: `${withObjectParticle(target.name)} 어떻게 바꿀까요? 금액을 알려 주세요. 지금은 건너뛰고 다른 질문을 해도 됩니다.` },
      style: "clarify",
    });
    return { payload: { ...emptyTurn("update_subscription", session.version), reply }, next };
  }

  const currentKey = categories.find((item) => item.id === target.category_id)?.key ?? null;
  const inferred = action === "update"
    ? await inferServiceCategory({
      name: classified.service_name && !isFieldLabelName(classified.service_name)
        ? classified.service_name
        : target.name,
      classifiedKey: classified.category_key,
      currentKey,
      currentPresetId: target.preset_id,
      all,
      categories,
      allowGemini: currentKey === "etc" || !currentKey,
    })
    : null;
  const pendingExtract = action === "update" && session.pending_action_status === "pending" &&
      session.pending_action?.kind === "update" &&
      (session.pending_action.subscription_id === target.id || !session.pending_action.subscription_id)
    ? session.pending_action.extract
    : null;
  const pendingAmount = asPositiveAmount(pendingExtract?.amount);
  const pendingCycle = asCycle(pendingExtract?.billing_cycle);
  const pendingAnchor = typeof pendingExtract?.anchor_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(pendingExtract.anchor_date)
    ? pendingExtract.anchor_date
    : null;
  const extra = action === "update"
    ? {
      name: classified.service_name && !isFieldLabelName(classified.service_name)
        ? classified.service_name
        : target.name,
      amount: classified.amount ?? pendingAmount ?? target.amount,
      billing_cycle: classified.billing_cycle ?? pendingCycle ?? target.billing_cycle,
      category_id: resolveCategoryId(
        categories,
        inferred?.key ?? null,
        null,
        inferred?.key && inferred.key !== "etc" ? null : target.category_id,
      ) ?? target.category_id,
      anchor_date: classified.anchor_date ?? pendingAnchor ?? target.anchor_date,
      preset_id: inferred?.presetId ?? target.preset_id,
      emoji: target.emoji && !target.emoji.startsWith("lucide:")
        ? target.emoji
        : iconValueForCategory(inferred?.key ?? currentKey),
    }
    : undefined;
  const extract = snapshotExtract(target, extra);
  const pending = makePending(action, target.id, extract);
  next.pending_action = pending;
  next.pending_action_status = "pending";
  next.selected_subscription_id = target.id;
  next.candidate_ids = [];
  next.last_result = { name: target.name, id: target.id, amount: extract.amount };
  const reply = explainReply({
    userText: text,
    facts: {
      action,
      name: target.name,
      amount: extract.amount,
      previous_amount: target.amount,
      billing_cycle: extract.billing_cycle,
      ...(classified.anchor_date ? { anchor_date: extract.anchor_date } : {}),
    },
    style: "confirm",
  });
  return {
    payload: {
      ...emptyTurn(classified.intent, session.version),
      reply,
      action,
      subscription_id: target.id,
      extract: action === "update" || action === "create" ? toClaudeExtract(extract, categories) : null,
      pending_action_id: pending.id,
      expires_at: pending.expires_at,
    },
    next,
  };
}
